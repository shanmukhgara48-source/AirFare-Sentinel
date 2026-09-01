"""Shared observation-fetching with the filter set every screen uses."""
from app.db.database import get_active_source_type, get_connection
from app.model import LEAD_BUCKET_CODES, LEAD_BUCKET_LABELS


def fetch_observations(
    origin: str | None = None,
    destination: str | None = None,
    airline: str | None = None,
    fare_class: str | None = None,
    lead_bucket: str | None = None,
    travel_date_from: str | None = None,
    travel_date_to: str | None = None,
    source_type: str | None = None,
    include_all_sources: bool = False,
) -> list[dict]:
    clauses = []
    params: list = []

    for column, value in (
        ("origin", origin),
        ("destination", destination),
        ("airline", airline),
        ("fare_class", fare_class),
        ("lead_bucket", lead_bucket),
    ):
        if value:
            clauses.append(f"{column} = ?")
            params.append(value.upper())

    if travel_date_from:
        clauses.append("travel_date >= ?")
        params.append(travel_date_from)
    if travel_date_to:
        clauses.append("travel_date <= ?")
        params.append(travel_date_to)
    selected_source = source_type
    if selected_source is None and not include_all_sources:
        selected_source = get_active_source_type()
    if selected_source:
        clauses.append("source_type = ?")
        params.append(selected_source.lower())

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"SELECT * FROM observations {where} ORDER BY quote_date"

    conn = get_connection()
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def fetch_filter_options() -> dict:
    active_source = get_active_source_type()
    conn = get_connection()
    try:
        where = " WHERE source_type = ?" if active_source else ""
        params = (active_source,) if active_source else ()
        routes = conn.execute(
            "SELECT DISTINCT origin, destination FROM observations" + where
            + " ORDER BY origin, destination",
            params,
        ).fetchall()
        airlines = conn.execute(
            "SELECT DISTINCT airline FROM observations" + where + " ORDER BY airline",
            params,
        ).fetchall()
        fare_classes = conn.execute(
            "SELECT DISTINCT fare_class FROM observations" + where + " ORDER BY fare_class",
            params,
        ).fetchall()
        present_buckets = {
            r["lead_bucket"]
            for r in conn.execute(
                "SELECT DISTINCT lead_bucket FROM observations" + where, params
            ).fetchall()
        }
        date_range = conn.execute(
            "SELECT MIN(travel_date) AS min_date, MAX(travel_date) AS max_date "
            "FROM observations" + where,
            params,
        ).fetchone()

        source_types = [
            r["source_type"]
            for r in conn.execute(
                "SELECT DISTINCT source_type FROM observations ORDER BY source_type"
            ).fetchall()
        ]

        return {
            "routes": [f"{r['origin']}-{r['destination']}" for r in routes],
            "airlines": [r["airline"] for r in airlines],
            "fare_classes": [r["fare_class"] for r in fare_classes],
            # Always in model order, never alphabetical — these are ordinal.
            "lead_buckets": [
                {"code": code, "label": LEAD_BUCKET_LABELS[code]}
                for code in LEAD_BUCKET_CODES
                if code in present_buckets
            ],
            "source_types": source_types,
            "active_source_type": active_source,
            "travel_date_min": date_range["min_date"],
            "travel_date_max": date_range["max_date"],
        }
    finally:
        conn.close()


def fetch_data_source_types() -> list[str]:
    """Return the distinct stored provenance types without loading fare rows."""
    conn = get_connection()
    try:
        return [
            r["source_type"]
            for r in conn.execute(
                "SELECT DISTINCT source_type FROM observations ORDER BY source_type"
            ).fetchall()
        ]
    finally:
        conn.close()
