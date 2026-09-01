import csv
import datetime
import io
import statistics
import time
import uuid
from collections import defaultdict
from pathlib import Path

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

import sqlite3

from app.api.queries import fetch_data_source_types, fetch_filter_options, fetch_observations
from app.audit import calculation_audit
from app.config import settings
from app.db.database import (
    db_session,
    get_active_source_type,
    init_db,
    reset_db,
    set_active_source_type,
)
from app.engine.anomaly import detect_spikes
from app.engine.competition import compute_route_competition
from app.engine.events import DEMO_NOTICE, get_all_events, tag_spikes_with_events
from app.engine.fairness import compute_fairness
from app.engine.whatif import project as whatif_project
from app.engine.vulnerability import compute_vulnerability
from app.engine.index import (
    compute_contributions, compute_group_index, compute_head_to_head,
    compute_index_timeseries, coverage_report, sensitivity_weighted_vs_unweighted,
)
from app.ingestion.live_fetch import fetch_live_fares
from app.ingestion.validate import validate_live_quotes, validate_rows
from app.model import LEAD_BUCKET_CODES, LEAD_BUCKET_LABELS
from app.providers import (
    get_configured_live_provider,
    get_live_provider,
    get_provider_statuses,
)

SAMPLE_CSV = Path(__file__).resolve().parent / "seed" / "sample_airfares.csv"

# In-memory store for the most recent live-fetch result (single-server demo).
_last_live_fetch: dict | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the database on startup (modern FastAPI lifespan pattern)."""
    init_db()
    yield


app = FastAPI(
    lifespan=lifespan,
    title="FarePulse India — Airfare Basket Monitoring Prototype",
    description=(
        "SIH 26056 — Transparent weighted Laspeyres airfare basket monitoring "
        "with publication coverage gates, anomaly detection, competition "
        "proxies, and uncalibrated scenario analysis. "
        "All bundled data is synthetic (seed=26056). "
        "API documentation: see /docs (Swagger) or /redoc."
    ),
    version="0.3.0",
    openapi_tags=[
        {"name": "dashboard", "description": "Core index and monitoring endpoints"},
        {"name": "data",      "description": "Data import, export, and administration"},
        {"name": "analysis",  "description": "Deep-dive analysis: comparison, head-to-head, scenario"},
        {"name": "system",    "description": "Health, version, and provider status"},
    ],
)

# Production auth boundary: deployment should sit behind MoSPI SSO or an
# equivalent identity proxy. Development CORS is restricted to configured
# origins, but CORS is not an authorization boundary.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Add X-Process-Time header to every response (ms). Useful for perf monitoring."""
    t0 = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    response.headers["X-Process-Time"] = f"{elapsed_ms}ms"
    return response



def _filters(
    origin: str | None = None,
    destination: str | None = None,
    airline: str | None = None,
    fare_class: str | None = None,
    lead_bucket: str | None = None,
    travel_date_from: str | None = None,
    travel_date_to: str | None = None,
) -> dict:
    return {
        "origin": origin, "destination": destination, "airline": airline,
        "fare_class": fare_class, "lead_bucket": lead_bucket,
        "travel_date_from": travel_date_from, "travel_date_to": travel_date_to,
    }


def _insert_observations(
    rows: list[dict],
    batch_id: str,
    filename: str,
    quarantined: list[dict],
    *,
    source_type: str,
) -> list[dict]:
    """Returns the full quarantine list, including rows rejected at insert time."""
    rejected = list(quarantined)
    with db_session() as conn:
        conn.execute(
            "INSERT INTO ingestion_batches "
            "(batch_id, filename, accepted_count, quarantined_count) VALUES (?, ?, ?, ?)",
            (batch_id, filename, len(rows), len(quarantined)),
        )
        # Inserted one at a time so a row that collides with data already in the
        # database is quarantined by name rather than aborting the whole batch.
        insert_sql = (
            "INSERT INTO observations (origin, destination, airline, travel_date, quote_date,"
            " lead_days, lead_bucket, fare_class, base_fare, airline_surcharge,"
            " statutory_taxes, airport_charges, taxes_fees, total_fare,"
            " source_batch_id, source_type, provider) VALUES (:origin, :destination, :airline, :travel_date,"
            " :quote_date, :lead_days, :lead_bucket, :fare_class, :base_fare,"
            " :airline_surcharge, :statutory_taxes, :airport_charges, :taxes_fees,"
            " :total_fare, :batch_id, :source_type, :provider)"
        )
        for row in rows:
            try:
                conn.execute(insert_sql, {
                    **row,
                    "batch_id": batch_id,
                    "source_type": source_type,
                    "provider": "demo" if source_type == "demo" else None,
                })
            except sqlite3.IntegrityError:
                rejected.append({
                    "raw_row": ",".join(str(row[c]) for c in (
                        "origin", "destination", "airline", "travel_date",
                        "quote_date", "fare_class", "base_fare", "taxes_fees")),
                    "reject_reason": "DUPLICATE_OF_EXISTING_ROW",
                })

        conn.execute(
            "UPDATE ingestion_batches SET accepted_count = ?, quarantined_count = ?"
            " WHERE batch_id = ?",
            (len(rows) - (len(rejected) - len(quarantined)), len(rejected), batch_id),
        )

        if rejected:
            conn.executemany(
                "INSERT INTO quarantined_rows (batch_id, raw_row, reject_reason)"
                " VALUES (?, ?, ?)",
                [(batch_id, q["raw_row"], q["reject_reason"]) for q in rejected],
            )
    return rejected


def _dataset_summary(source_types: list[str]) -> dict:
    """Build judge-safe labels from stored row provenance."""
    sources = sorted(set(source_types))
    if not sources:
        return {
            "dataset_mode": "empty",
            "dataset_label": "No observations loaded",
            "dataset_notice": "Load the bundled synthetic sample or import a validated CSV.",
        }
    if len(sources) > 1:
        readable = ", ".join(sources)
        return {
            "dataset_mode": "hybrid",
            "dataset_label": f"Hybrid dataset ({readable})",
            "dataset_notice": "Stored rows combine multiple provenance types; each observation retains its source type.",
        }
    source = sources[0]
    labels = {
        "demo": ("Demo dataset (synthetic)", "Deterministic synthetic fares with fictional carrier codes; not an official release."),
        "live": ("Live quote snapshots", "Provider quotes observed at fetch time; not transaction prices or forecasts."),
        "imported": ("Imported dataset", "User-supplied CSV observations; not automatically verified as live data."),
    }
    label, notice = labels.get(source, (f"{source.title()} dataset", "Stored observation provenance is reported per row."))
    return {"dataset_mode": source, "dataset_label": label, "dataset_notice": notice}


def _analysis_dataset_summary() -> dict:
    """Describe the isolated provenance cohort used by analysis endpoints."""
    active = get_active_source_type()
    available = fetch_data_source_types()
    return {
        **_dataset_summary([active] if active else []),
        "active_analysis_source": active,
        "available_analysis_sources": available,
        "source_isolation_notice": (
            "Analytical endpoints use only the active provenance source; "
            "stored demo, imported, and live rows are never combined implicitly."
        ),
        "stored_dataset": _dataset_summary(available),
    }


def _observation_source_label(observations: list[dict]) -> str:
    return _dataset_summary([o.get("source_type", "imported") for o in observations])["dataset_label"]


def _operating_mode() -> dict:
    configured = get_configured_live_provider()
    active = get_live_provider()
    if settings.demo_mode:
        return {
            "operating_mode": "demo",
            "mode_label": "Demo mode",
            "mode_notice": (
                "Live provider calls are disabled by DEMO_MODE=true."
                if configured else
                "Stable demo mode is active; no live provider credentials are configured."
            ),
        }
    if active:
        return {
            "operating_mode": "live",
            "mode_label": "Live ingestion enabled",
            "mode_notice": f"Provider calls are enabled for {active.name}; stored rows retain provenance.",
        }
    return {
        "operating_mode": "demo_fallback",
        "mode_label": "Demo fallback",
        "mode_notice": "Live mode was requested, but no provider credentials are configured.",
    }


def _insert_live_observations(rows: list[dict], batch_id: str,
                               quarantined: list[dict]) -> list[dict]:
    """
    Insert live-sourced observations.  Like _insert_observations() but writes
    the extended provenance columns (source_type, provider, flight_number,
    offer_id, offer_expiry) that the provider layer populates.
    """
    rejected = list(quarantined)
    with db_session() as conn:
        conn.execute(
            "INSERT INTO ingestion_batches "
            "(batch_id, filename, accepted_count, quarantined_count) VALUES (?, ?, ?, ?)",
            (batch_id, "live-fetch", len(rows), len(quarantined)),
        )
        insert_sql = (
            "INSERT INTO observations (origin, destination, airline, travel_date, quote_date,"
            " lead_days, lead_bucket, fare_class, base_fare, airline_surcharge,"
            " statutory_taxes, airport_charges, taxes_fees, total_fare,"
            " source_batch_id, source_type, provider, flight_number, offer_id, offer_expiry)"
            " VALUES (:origin, :destination, :airline, :travel_date, :quote_date,"
            " :lead_days, :lead_bucket, :fare_class, :base_fare, :airline_surcharge,"
            " :statutory_taxes, :airport_charges, :taxes_fees, :total_fare,"
            " :batch_id, :source_type, :provider, :flight_number, :offer_id, :offer_expiry)"
        )
        for row in rows:
            try:
                conn.execute(insert_sql, {
                    **row,
                    "batch_id": batch_id,
                    "source_type": row.get("source_type", "live"),
                    "provider": row.get("provider"),
                    "flight_number": row.get("flight_number"),
                    "offer_id": row.get("offer_id"),
                    "offer_expiry": row.get("offer_expiry"),
                })
            except sqlite3.IntegrityError:
                rejected.append({
                    "raw_row": ",".join(str(row.get(c, "")) for c in (
                        "origin", "destination", "airline", "travel_date",
                        "quote_date", "fare_class", "base_fare", "taxes_fees")),
                    "reject_reason": "DUPLICATE_OF_EXISTING_ROW",
                })

        conn.execute(
            "UPDATE ingestion_batches SET accepted_count = ?, quarantined_count = ?"
            " WHERE batch_id = ?",
            (len(rows) - (len(rejected) - len(quarantined)), len(rejected), batch_id),
        )

        if rejected:
            conn.executemany(
                "INSERT INTO quarantined_rows (batch_id, raw_row, reject_reason)"
                " VALUES (?, ?, ?)",
                [(batch_id, q["raw_row"], q["reject_reason"]) for q in rejected],
            )
    return rejected


# ---------------------------------------------------------------- system

@app.get("/api/health", tags=["system"])
def health() -> dict:
    """Liveness probe. Returns immediately without touching the database."""
    return {"status": "ok"}


@app.get("/api/version", tags=["system"])
def version() -> dict:
    """
    System version and configuration summary.

    Returns the application version, active data mode, provider list,
    and key methodology references. Safe to expose to judges.
    """
    provider = get_configured_live_provider()
    return {
        "version": "0.3.0",
        "project": "SIH 26056 — FarePulse India Airfare Basket Monitoring Prototype",
        "ministry": "Ministry of Statistics and Programme Implementation (MoSPI)",
        "demo_mode": settings.demo_mode,
        **_operating_mode(),
        **_analysis_dataset_summary(),
        "live_provider_configured": provider is not None,
        "configured_live_provider": provider.name if provider else None,
        "methodology": {
            "index": "Weighted Laspeyres with Jevons elementary aggregates",
            "anomaly": "Robust z-score on log fares within comparability cells",
            "cell_definition": "route × airline × fare_class × lead_bucket",
            "weight_source": "Illustrative traffic-proportional prototype weights; current DGCA calibration required",
            "coverage_gates": {"GREEN": "≥90%", "AMBER": "80–90%", "RED": "<80%"},
        },
        "upload_max_bytes": settings.upload_max_bytes,
        "providers_configured": sum(1 for s in get_provider_statuses() if s["configured"]),
        "live_providers_configured": sum(
            1 for s in get_provider_statuses()
            if s["requires_credentials"] and s["configured"]
        ),
    }


@app.get("/api/provider/status", tags=["system"])
def provider_status() -> dict:
    """
    Live data provider configuration status.

    Shows which fare providers are configured and ready.  Credentials are
    never returned — only masked indicators.  Use this to verify the
    Amadeus provider is set up before attempting live data ingestion.
    """
    statuses = get_provider_statuses()
    source_types = fetch_data_source_types()
    configured_provider = get_configured_live_provider()
    live_provider = get_live_provider()
    mode = _operating_mode()
    return {
        "providers": statuses,
        **mode,
        "live_provider_configured": configured_provider is not None,
        "live_fetch_enabled": live_provider is not None,
        # Provider readiness and stored live data are deliberately separate.
        # Credentials alone never justify a live-data claim.
        "live_data_available": "live" in source_types,
        "active_live_provider": live_provider.name if live_provider else None,
        "configured_live_provider": configured_provider.name if configured_provider else None,
        "demo_fallback": True,  # always available
        "notice": mode["mode_notice"],
    }


# ---------------------------------------------------------------- dashboard


@app.get("/api/filters", tags=["dashboard"])
def filters() -> dict:
    """Filter dropdown options: available routes, airlines, fare classes, lead buckets, date range."""
    return fetch_filter_options()


@app.get("/api/admin/analysis-source", tags=["data"])
def analysis_source() -> dict:
    """Return the isolated provenance cohort currently used for analysis."""
    return _analysis_dataset_summary()


@app.post("/api/admin/analysis-source", tags=["data"])
def select_analysis_source(
    source_type: str = Query(..., pattern="^(demo|imported|live)$"),
) -> dict:
    """Switch analysis to one stored provenance cohort without merging sources."""
    available = fetch_data_source_types()
    if source_type not in available:
        raise HTTPException(
            409,
            f"No stored {source_type} observations are available. Available sources: "
            f"{', '.join(available) if available else 'none'}.",
        )
    set_active_source_type(source_type)
    return _analysis_dataset_summary()


@app.get("/api/overview", tags=["dashboard"])
def overview(granularity: str = Query("day", pattern="^(day|week)$")) -> dict:
    observations = fetch_observations()
    if not observations:
        return {
            "empty": True,
            "message": "No data loaded. Go to the Admin page and load the sample dataset.",
        }

    series = compute_index_timeseries(observations, granularity=granularity)
    spikes = detect_spikes(observations)
    fares = [o["total_fare"] for o in observations]
    coverage = coverage_report(observations)
    publication_quality = coverage["quality_flag"]
    if publication_quality == "RED":
        indicator_name = "Experimental Basket Indicator"
        publication_status = "SUPPRESSED"
        suppression_reason = (
            f"National headline suppressed: mean matched weight coverage is "
            f"{coverage['mean_weight_coverage_pct']:.1f}%, below the 80% minimum. "
            "The displayed value is experimental and must not be quoted as a national index."
        )
    elif publication_quality == "AMBER":
        indicator_name = "Provisional Airfare Basket Indicator"
        publication_status = "PROVISIONAL"
        suppression_reason = (
            "Coverage is 80–90%; publish only with a provisional quality warning."
        )
    else:
        indicator_name = "Prototype Airfare Price Index"
        publication_status = "PUBLISHABLE_PROTOTYPE"
        suppression_reason = None

    latest = series[-1] if series else None
    first = series[0] if series else None
    change_pct = None
    if latest and first and first["apix_value"]:
        change_pct = round(
            100 * (latest["apix_value"] - first["apix_value"]) / first["apix_value"], 2
        )

    return {
        "empty": False,
        "indicator_name": indicator_name,
        "publication_status": publication_status,
        "headline_publishable": publication_status != "SUPPRESSED",
        "suppression_reason": suppression_reason,
        "headline_index": latest["apix_value"] if latest else None,
        "change_pct": change_pct,
        "period_start": first["period"] if first else None,
        "period_end": latest["period"] if latest else None,
        "series": series,
        "observation_count": len(observations),
        "route_count": len({(o["origin"], o["destination"]) for o in observations}),
        "airline_count": len({o["airline"] for o in observations}),
        "spike_count": len(spikes),
        "median_fare": round(statistics.median(fares), 2),
        "coverage": coverage,
        "top_routes": compute_group_index(observations, "route", granularity)[:6],
        "top_airlines": compute_group_index(observations, "airline", granularity)[:6],
        "lead_buckets": _ordered_bucket_index(observations, granularity),
        "last_updated": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "evidence": {
            "data_source": _observation_source_label(observations),
            "calculation_method": "Weighted Laspeyres with Jevons elementary aggregates",
            "formula": "APIx[t] = 100 \u00d7 \u03a3 (W[cell]/\u03a3W) \u00d7 R[cell,t]",
            "baseline": f"Base = 100 at {first['period'] if first else 'N/A'}",
            "sensitivity_formula": "Jevons[t] = 100 \u00d7 exp(mean(ln R[cell,t]))",
            "alert_formula": "robust_z = 0.6745 \u00d7 (ln(fare) \u2212 median(ln fare)) / MAD",
            "alert_threshold": 3.5,
            "alert_min_deviation_pct": 25.0,
            "cell_definition": "route \u00d7 airline \u00d7 fare class \u00d7 lead-time bucket",
            "weight_source": "Illustrative traffic-proportional prototype weights; current DGCA calibration required",
            "audit": calculation_audit(
                observations,
                "overview-index",
                {"granularity": granularity, "weighted": True},
            ),
        },
    }


def _ordered_bucket_index(observations: list[dict], granularity: str) -> list[dict]:
    """Lead-bucket indices in booking order, not sorted by size of move."""
    rows = {r["group"]: r for r in compute_group_index(observations, "lead_bucket", granularity)}
    return [
        {**rows[code], "label": LEAD_BUCKET_LABELS[code]}
        for code in LEAD_BUCKET_CODES
        if code in rows
    ]


@app.get("/api/trends", tags=["dashboard"])
def trends(
    granularity: str = Query("day", pattern="^(day|week)$"),
    origin: str | None = None,
    destination: str | None = None,
    airline: str | None = None,
    fare_class: str | None = None,
    lead_bucket: str | None = None,
    travel_date_from: str | None = None,
    travel_date_to: str | None = None,
) -> dict:
    observations = fetch_observations(
        **_filters(origin, destination, airline, fare_class,
                   lead_bucket, travel_date_from, travel_date_to)
    )
    if not observations:
        return {"empty": True, "series": [], "lead_time_curve": [],
                "fare_class_breakdown": [], "lead_bucket_index": [],
                "observation_count": 0}

    # Average fare by lead-time bucket — the classic booking curve.
    by_bucket: dict[str, list[float]] = defaultdict(list)
    for o in observations:
        by_bucket[o["lead_bucket"]].append(o["total_fare"])
    lead_curve = [
        {
            "lead_bucket": code,
            "label": LEAD_BUCKET_LABELS[code],
            "avg_fare": round(sum(by_bucket[code]) / len(by_bucket[code]), 2),
            "median_fare": round(statistics.median(by_bucket[code]), 2),
            "observation_count": len(by_bucket[code]),
        }
        for code in LEAD_BUCKET_CODES
        if code in by_bucket
    ]

    by_class: dict[str, list[float]] = defaultdict(list)
    for o in observations:
        by_class[o["fare_class"]].append(o["total_fare"])
    class_breakdown = [
        {"fare_class": k, "avg_fare": round(sum(v) / len(v), 2),
         "median_fare": round(statistics.median(v), 2), "observation_count": len(v)}
        for k, v in sorted(by_class.items(), key=lambda kv: sum(kv[1]) / len(kv[1]))
    ]

    return {
        "empty": False,
        "series": compute_index_timeseries(observations, granularity=granularity),
        "lead_time_curve": lead_curve,
        "fare_class_breakdown": class_breakdown,
        "lead_bucket_index": _ordered_bucket_index(observations, granularity),
        "coverage": coverage_report(observations),
        "observation_count": len(observations),
    }


@app.get("/api/compare", tags=["analysis"])
def compare(
    dimension: str = Query("route", pattern="^(route|airline)$"),
    fare_class: str | None = None,
    lead_bucket: str | None = None,
) -> dict:
    observations = fetch_observations(fare_class=fare_class, lead_bucket=lead_bucket)
    if not observations:
        return {"empty": True, "rows": []}

    groups: dict[str, list[dict]] = defaultdict(list)
    for o in observations:
        key = f"{o['origin']}-{o['destination']}" if dimension == "route" else o["airline"]
        groups[key].append(o)

    index_by_group = {
        r["group"]: r for r in compute_group_index(observations, dimension)
    }

    rows = []
    for key, obs in groups.items():
        fares = [o["total_fare"] for o in obs]
        idx = index_by_group.get(key, {})
        rows.append({
            "group": key,
            "avg_fare": round(sum(fares) / len(fares), 2),
            "median_fare": round(statistics.median(fares), 2),
            "min_fare": round(min(fares), 2),
            "max_fare": round(max(fares), 2),
            "apix_value": idx.get("apix_value"),
            "delta": idx.get("delta"),
            "change_pct": idx.get("change_pct"),
            "cell_count": idx.get("cell_count"),
            "observation_count": len(obs),
            "airline_count": len({o["airline"] for o in obs}) if dimension == "route" else None,
            "route_count": len({(o["origin"], o["destination"]) for o in obs})
            if dimension == "airline" else None,
        })

    rows.sort(key=lambda r: r["avg_fare"], reverse=True)
    return {"empty": False, "dimension": dimension, "rows": rows}


@app.get("/api/contributions", tags=["analysis"])
def contributions(granularity: str = Query("day", pattern="^(day|week)$")) -> dict:
    """Contribution decomposition: how much each cell contributed to headline change."""
    observations = fetch_observations()
    if not observations:
        return {"empty": True, "contributions": []}
    contribs = compute_contributions(observations, granularity=granularity)
    return {"empty": False, "contributions": contribs[:50]}


@app.get("/api/sensitivity", tags=["analysis"])
def sensitivity(granularity: str = Query("day", pattern="^(day|week)$")) -> dict:
    """Weighted vs unweighted index sensitivity analysis."""
    observations = fetch_observations()
    if not observations:
        return {"empty": True}
    result = sensitivity_weighted_vs_unweighted(observations, granularity)
    series = compute_index_timeseries(observations, granularity=granularity, weighted=True)
    return {
        "empty": False,
        **result,
        "series": [
            {"period": s["period"],
             "weighted": s["apix_weighted"],
             "unweighted": s["apix_unweighted"],
             "divergence": round(abs(s["apix_weighted"] - s["apix_unweighted"]), 2)}
            for s in series
        ],
    }


@app.get("/api/head-to-head", tags=["analysis"])
def head_to_head(
    route: str = Query(..., pattern=r"^[A-Z]{3}-[A-Z]{3}$"),
    fare_class: str | None = Query(None),
    lead_bucket: str | None = Query(None),
) -> dict:
    """Head-to-head airline comparison on a specific route."""
    origin, destination = route.split("-")
    observations = fetch_observations()
    if not observations:
        return {"empty": True, "route": route, "airlines": []}
    results = compute_head_to_head(
        observations, origin, destination,
        fare_class=fare_class, lead_bucket=lead_bucket,
    )
    return {"empty": len(results) == 0, "route": route, "airlines": results}


@app.get("/api/vulnerability", tags=["dashboard"])
def vulnerability(
    origin: str | None = None,
    destination: str | None = None,
    airline: str | None = None,
    fare_class: str | None = None,
) -> dict:
    """
    Lead-Time Vulnerability Index by booking window.

    Combines fare deviation, alert frequency, booking urgency, and coverage
    confidence into a 0–100 score for each lead-time bucket.  Optional filters
    narrow the analysis to a specific route, carrier, or fare class.
    """
    observations = fetch_observations(
        origin=origin, destination=destination,
        airline=airline, fare_class=fare_class,
    )
    if not observations:
        return {
            "empty": True,
            "message": "No data matches the selected filters.",
            "buckets": [],
        }

    spike_cases = detect_spikes(observations)
    buckets = compute_vulnerability(observations, spike_cases)

    most_vulnerable = max(buckets, key=lambda b: b["vulnerability_score"]) if buckets else None
    least_vulnerable = min(buckets, key=lambda b: b["vulnerability_score"]) if buckets else None

    return {
        "empty": False,
        "observation_count": len(observations),
        "spike_count": len(spike_cases),
        "most_vulnerable_bucket": most_vulnerable["lead_bucket"] if most_vulnerable else None,
        "least_vulnerable_bucket": least_vulnerable["lead_bucket"] if least_vulnerable else None,
        "buckets": buckets,
    }


@app.get("/api/competition", tags=["dashboard"])
def competition() -> dict:
    """
    Per-route competition monitoring signals.

    Returns carrier count, HHI concentration proxy, fare pressure level, and a
    summary status (Healthy / Watch / High Risk) for every route in the dataset.
    These are statistical monitoring indicators — not legal findings of
    anti-competitive behaviour.
    """
    observations = fetch_observations()
    if not observations:
        return {
            "empty": True,
            "message": "No data loaded. Go to the Admin page and load the sample dataset.",
            "data_source": "No observations loaded",
            "summary": {"healthy_count": 0, "watch_count": 0,
                        "high_risk_count": 0, "total_routes": 0},
            "routes": [],
        }

    routes = compute_route_competition(observations)
    summary = {
        "healthy_count": sum(1 for r in routes if r["status"] == "Healthy"),
        "watch_count": sum(1 for r in routes if r["status"] == "Watch"),
        "high_risk_count": sum(1 for r in routes if r["status"] == "High Risk"),
        "total_routes": len(routes),
    }
    return {
        "empty": False,
        "data_source": _observation_source_label(observations),
        "summary": summary,
        "routes": routes,
    }


@app.get("/api/events", tags=["dashboard"])
def events() -> dict:
    """
    Demo event calendar — illustrative festival, holiday and city-event windows.

    All dates and typical-surge estimates are synthetic demo data.
    See the demo_notice field for the full disclaimer.
    """
    return {
        "demo_notice": DEMO_NOTICE,
        "events": get_all_events(),
    }


@app.get("/api/whatif", tags=["analysis"])
def whatif(
    demand_change_pct:   float = Query(0.0, ge=-100.0, le=100.0),
    fuel_change_pct:     float = Query(0.0, ge=-100.0, le=100.0),
    capacity_change_pct: float = Query(0.0, ge=-100.0, le=100.0),
    carriers:            int   = Query(4,   ge=1,       le=20),
    baseline_apix:       float = Query(100.0, ge=0.1,  le=10000.0),
) -> dict:
    """
    What-If Scenario Simulator — project airfare index change from market inputs.

    Uses a transparent, deterministic formula combining demand elasticity,
    fuel cost pass-through, capacity effect, and competition adjustment.

    This is a scenario-planning tool, NOT a forecast.  Results do not
    predict real future fares.
    """
    return whatif_project(
        demand_change_pct=demand_change_pct,
        fuel_change_pct=fuel_change_pct,
        capacity_change_pct=capacity_change_pct,
        carriers=carriers,
        baseline_apix=baseline_apix,
    )


@app.get("/api/fairness", tags=["dashboard"])
def fairness() -> dict:
    """
    Fairness Lens — like-for-like index movement by route category.

    Compares each category's matched-cell index change with basket index change,
    alongside alert rate and the passenger exposure proxy. Unknown imported/live
    routes remain in an explicit Unclassified bucket.

    These are monitoring indicators for policy context, not findings of
    discrimination or wrongdoing.
    """
    observations = fetch_observations()
    if not observations:
        return {
            "empty": True,
            "message": "No data loaded. Go to the Admin page and load the sample dataset.",
            "categories": [],
        }

    spike_cases = detect_spikes(observations)
    categories = compute_fairness(observations, spike_cases)
    return {"empty": False, "categories": categories}


@app.get("/api/spikes", tags=["dashboard"])
def spikes(threshold: float = Query(3.5, ge=1.0, le=10.0)) -> dict:
    observations = fetch_observations()
    flagged = detect_spikes(observations, threshold=threshold)
    # Tag each spike with event-window context.
    tagged = tag_spikes_with_events(flagged)
    in_window = sum(1 for s in tagged if s["in_event_window"])
    return {
        "threshold": threshold,
        "flagged_count": len(tagged),
        "scanned_count": len(observations),
        "event_window_count": in_window,
        "flagged": tagged[:100],
        "last_updated": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "evidence": {
            "data_source": _observation_source_label(observations),
            "algorithm": "Rule-based robust z-score on log fares within each comparability cell",
            "formula": "robust_z = 0.6745 \u00d7 (ln(fare) \u2212 median(ln fare)) / MAD",
            "threshold": threshold,
            "min_deviation_pct": 25.0,
            "cell_definition": "route \u00d7 airline \u00d7 fare class \u00d7 lead-time bucket",
            "min_cell_observations": 8,
            "reason_codes": 7,
            "confidence_bands": "Low (<15 obs), Medium (15\u201329 obs), High (\u226530 obs)",
            "audit": calculation_audit(
                observations,
                "robust-spike-detection",
                {"robust_z_threshold": threshold, "min_deviation_pct": 25.0},
            ),
        },
    }


# ---------------------------------------------------------------- admin

@app.post("/api/admin/load-sample", tags=["data"])
def load_sample() -> dict:
    if not SAMPLE_CSV.exists():
        raise HTTPException(500, "Sample dataset missing. Run the generator script.")

    reset_db()
    accepted, quarantined = validate_rows(SAMPLE_CSV.read_text())
    batch_id = f"sample-{uuid.uuid4().hex[:8]}"
    final_rejected = _insert_observations(
        accepted, batch_id, SAMPLE_CSV.name, quarantined, source_type="demo"
    )
    inserted_count = len(accepted) - (len(final_rejected) - len(quarantined))
    if inserted_count > 0:
        set_active_source_type("demo")

    return {
        "batch_id": batch_id,
        "filename": SAMPLE_CSV.name,
        "accepted_count": inserted_count,
        "quarantined_count": len(final_rejected),
        "quarantined": final_rejected[:50],
        "message": f"Loaded {inserted_count} sample observations (database was reset first).",
    }


@app.post("/api/admin/upload", tags=["data"])
async def upload(file: UploadFile = File(...)) -> dict:
    """
    Upload a custom CSV fare dataset for ingestion.

    The file must be UTF-8 encoded CSV with these required columns:
    origin, destination, airline, travel_date, quote_date, fare_class,
    base_fare, taxes_fees.

    File size is limited to keep upload safe for the demo environment.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Please upload a .csv file.")

    raw_bytes = await file.read()
    if len(raw_bytes) > settings.upload_max_bytes:
        max_mb = settings.upload_max_bytes / (1024 * 1024)
        raise HTTPException(
            413,
            f"File too large ({len(raw_bytes):,} bytes). "
            f"Maximum allowed is {max_mb:.1f} MB ({settings.upload_max_bytes:,} bytes). "
            "Split the file into smaller batches.",
        )

    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded text.")

    accepted, quarantined = validate_rows(text)
    batch_id = f"upload-{uuid.uuid4().hex[:8]}"
    final_rejected = _insert_observations(
        accepted, batch_id, file.filename, quarantined, source_type="imported"
    )
    inserted_count = len(accepted) - (len(final_rejected) - len(quarantined))
    if inserted_count > 0:
        set_active_source_type("imported")

    return {
        "batch_id": batch_id,
        "filename": file.filename,
        "accepted_count": inserted_count,
        "quarantined_count": len(final_rejected),
        "quarantined": final_rejected[:50],
        "message": f"{inserted_count} rows accepted, {len(final_rejected)} quarantined.",
    }


@app.get("/api/admin/batches", tags=["data"])
def batches() -> dict:
    with db_session() as conn:
        rows = conn.execute(
            "SELECT b.*, (SELECT COUNT(*) FROM observations o"
            " WHERE o.source_batch_id = b.batch_id) AS live_rows"
            " FROM ingestion_batches b ORDER BY uploaded_at DESC"
        ).fetchall()
        return {"batches": [dict(r) for r in rows]}


@app.get("/api/admin/observations", tags=["data"])
def observations_table(limit: int = Query(100, ge=1, le=1000), offset: int = 0) -> dict:
    with db_session() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM observations").fetchone()["c"]
        rows = conn.execute(
            "SELECT * FROM observations ORDER BY quote_date DESC, id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return {"total": total, "rows": [dict(r) for r in rows]}


@app.delete("/api/admin/data", tags=["data"])
def clear_data() -> dict:
    reset_db()
    return {"message": "All data cleared."}


@app.post("/api/admin/live-fetch", tags=["data"])
def live_fetch(quick: bool = Query(False)) -> dict:
    """
    Fetch live fare quotes from the configured provider and ingest them.

    Each quote is a *snapshot* of a fare observed today for a future travel date
    (tomorrow, T+7, T+15, T+30, T+45).  Quotes are NOT guaranteed future prices.

    Set quick=true to restrict to the 6 highest-traffic metro trunk routes
    (fewer API calls — useful for demos).

    Returns 409 while demo mode is active and 503 when live mode has no provider.
    """
    global _last_live_fetch
    if settings.demo_mode:
        raise HTTPException(
            409,
            "Live fetch is disabled while DEMO_MODE=true. Set DEMO_MODE=false and restart "
            "only when provider credentials are configured and live ingestion is intended.",
        )

    provider = get_live_provider()
    if provider is None:
        raise HTTPException(
            503,
            "No live fare provider is configured.  "
            "Set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET in .env and restart.",
        )

    fetch_result = fetch_live_fares(provider, quick=quick)
    raw_quotes = fetch_result["quotes"]

    accepted, quarantined = validate_live_quotes(raw_quotes)
    batch_id = f"live-{uuid.uuid4().hex[:8]}"
    final_rejected = _insert_live_observations(accepted, batch_id, quarantined)

    inserted_count = len(accepted) - max(0, len(final_rejected) - len(quarantined))
    if inserted_count > 0:
        set_active_source_type("live")
    result = {
        "batch_id": batch_id,
        "provider": provider.name,
        "quick_mode": quick,
        "fetched_at": fetch_result["fetched_at"],
        "api_calls": fetch_result["fetch_count"],
        "api_errors": fetch_result["error_count"],
        "raw_quotes": len(raw_quotes),
        "accepted_count": inserted_count,
        "quarantined_count": len(final_rejected),
        "quarantined": final_rejected[:20],
        "fetch_errors": fetch_result["errors"],
        "message": (
            f"Live fetch complete. {inserted_count} quotes accepted from "
            f"{fetch_result['fetch_count']} API calls."
            if inserted_count > 0 else
            "Live fetch completed, but no quote rows were stored. Review provider "
            "coverage, route errors, and quarantined rows before making any live-data claim."
        ),
        "data_notice": (
            "Stored rows are live fare quote snapshots observed today for future travel dates; "
            "they are not guaranteed prices or forecasts."
            if inserted_count > 0 else
            "No live quote rows were stored by this run. Existing dataset provenance is unchanged."
        ),
    }
    _last_live_fetch = result
    return result


@app.get("/api/admin/live-fetch/status", tags=["data"])
def live_fetch_status() -> dict:
    """
    Return the result of the most recent live-fetch run (this server process only).

    Returns a stable 200 response with ``has_result=false`` when no fetch has
    been run since the server started.
    """
    configured_provider = get_configured_live_provider()
    provider = get_live_provider()
    if _last_live_fetch is None:
        return {
            "has_result": False,
            **_operating_mode(),
            "live_provider_configured": configured_provider is not None,
            "live_fetch_enabled": provider is not None,
            "active_live_provider": provider.name if provider else None,
            "configured_live_provider": configured_provider.name if configured_provider else None,
            # Backward-compatible aliases for the original status contract.
            "active_provider": provider.name if provider else None,
            "configured_provider": configured_provider.name if configured_provider else None,
            "message": "No live fetch has been run in this server session.",
        }
    return {
        "has_result": True,
        **_operating_mode(),
        "live_provider_configured": configured_provider is not None,
        "live_fetch_enabled": provider is not None,
        "active_live_provider": provider.name if provider else None,
        "configured_live_provider": configured_provider.name if configured_provider else None,
        # Backward-compatible aliases for the original status contract.
        "active_provider": provider.name if provider else None,
        "configured_provider": configured_provider.name if configured_provider else None,
        **_last_live_fetch,
    }


@app.get("/api/export/observations.csv", tags=["data"])
def export_observations(
    origin: str | None = None,
    destination: str | None = None,
    airline: str | None = None,
    fare_class: str | None = None,
    lead_bucket: str | None = None,
) -> StreamingResponse:
    rows = fetch_observations(
        **_filters(origin, destination, airline, fare_class, lead_bucket, None, None)
    )
    buffer = io.StringIO()
    summary = _dataset_summary([r.get("source_type", "imported") for r in rows])
    buffer.write(
        f"# FarePulse export — {summary['dataset_label']}; "
        "advertised/observed fares, not transaction prices or an official statistical release\n"
    )
    if rows:
        writer = csv.DictWriter(buffer, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=apix_observations.csv"},
    )
