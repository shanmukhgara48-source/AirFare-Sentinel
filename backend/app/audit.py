"""Reproducible calculation metadata for judge-facing evidence trails.

This is intentionally not described as an immutable regulatory audit log. It
records enough dataset and calculation identity to reproduce a result from the
same stored observations and versioned method.
"""
from __future__ import annotations

import datetime
import hashlib
import json


CALCULATION_VERSION = "farepulse-methodology-0.3.0"


def _dataset_fingerprint(observations: list[dict]) -> str:
    fields = (
        "id", "source_batch_id", "source_type", "origin", "destination",
        "airline", "fare_class", "lead_bucket", "travel_date", "quote_date",
        "total_fare",
    )
    canonical_rows = [
        [row.get(field) for field in fields]
        for row in sorted(
            observations,
            key=lambda row: (
                str(row.get("source_batch_id", "")),
                int(row.get("id") or 0),
                str(row.get("origin", "")),
                str(row.get("destination", "")),
            ),
        )
    ]
    payload = json.dumps(canonical_rows, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def calculation_audit(
    observations: list[dict],
    calculation: str,
    parameters: dict | None = None,
) -> dict:
    """Return deterministic dataset/calculation identity plus response time."""
    parameters = parameters or {}
    dataset_fingerprint = _dataset_fingerprint(observations)
    identity = json.dumps(
        {
            "calculation": calculation,
            "calculation_version": CALCULATION_VERSION,
            "dataset_fingerprint": dataset_fingerprint,
            "parameters": parameters,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    calculation_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]
    quote_dates = sorted(
        {str(row.get("quote_date")) for row in observations if row.get("quote_date")}
    )

    return {
        "calculation_id": calculation_id,
        "calculation_version": CALCULATION_VERSION,
        "computed_at": datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "dataset_fingerprint_sha256": dataset_fingerprint,
        "observation_count": len(observations),
        "source_types": sorted(
            {str(row.get("source_type", "imported")) for row in observations}
        ),
        "source_batch_ids": sorted(
            {
                str(row.get("source_batch_id"))
                for row in observations
                if row.get("source_batch_id")
            }
        ),
        "quote_date_start": quote_dates[0] if quote_dates else None,
        "quote_date_end": quote_dates[-1] if quote_dates else None,
        "parameters": parameters,
        "audit_scope": (
            "Reproducible calculation metadata, not an immutable user/action audit log."
        ),
    }
