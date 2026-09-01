import sqlite3
import os
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(
    os.environ.get(
        "FAREPULSE_DB_PATH",
        Path(__file__).resolve().parent.parent.parent / "apix.db",
    )
)
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _run_migrations(conn: sqlite3.Connection) -> None:
    """
    Add columns introduced after the initial schema without dropping existing data.

    SQLite supports ALTER TABLE ADD COLUMN but not IF NOT EXISTS — we catch
    the OperationalError that fires when a column already exists.
    """
    new_columns: list[tuple[str, str, str]] = [
        # (table, column_name, column_definition)
        ("observations", "source_type", "TEXT NOT NULL DEFAULT 'demo'"),
        ("observations", "provider",    "TEXT"),
        ("observations", "flight_number", "TEXT"),
        ("observations", "offer_id",    "TEXT"),
        ("observations", "offer_expiry", "TEXT"),
    ]
    for table, col, col_def in new_columns:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}")
        except sqlite3.OperationalError:
            pass  # Column already exists — no-op


def _seed_route_weights(conn: sqlite3.Connection) -> None:
    """Keep the documented route_weights table aligned with the model constants."""
    from app.model import ROUTE_BASKET

    conn.executemany(
        "INSERT OR IGNORE INTO route_weights "
        "(origin, destination, stratum, weight, source, effective_from) "
        "VALUES (?, ?, ?, ?, 'prototype-model-v1', '2026-01-01')",
        [
            (origin, destination, stratum.value, weight)
            for (origin, destination), (stratum, weight) in ROUTE_BASKET.items()
        ],
    )


def init_db() -> None:
    conn = get_connection()
    try:
        conn.executescript(SCHEMA_PATH.read_text())
        _run_migrations(conn)
        _seed_route_weights(conn)
        conn.commit()
    finally:
        conn.close()


def reset_db() -> None:
    """Drop and recreate all tables — used by 'load sample data' so demos always start fresh."""
    conn = get_connection()
    try:
        conn.executescript(
            "PRAGMA foreign_keys = OFF;"
            "DROP TABLE IF EXISTS quarantined_rows;"
            "DROP TABLE IF EXISTS analysis_state;"
            "DROP TABLE IF EXISTS ingestion_batches;"
            "DROP TABLE IF EXISTS observations;"
            "DROP TABLE IF EXISTS route_weights;"
            "PRAGMA foreign_keys = ON;"
        )
        conn.executescript(SCHEMA_PATH.read_text())
        _seed_route_weights(conn)
        conn.commit()
    finally:
        conn.close()


@contextmanager
def db_session():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def set_active_source_type(source_type: str | None) -> None:
    """Select the only provenance cohort used by analytical endpoints."""
    if source_type not in {None, "demo", "live", "imported"}:
        raise ValueError(f"Unsupported source type: {source_type}")
    with db_session() as conn:
        conn.execute(
            "INSERT INTO analysis_state (id, active_source_type, updated_at) "
            "VALUES (1, ?, datetime('now')) "
            "ON CONFLICT(id) DO UPDATE SET active_source_type = excluded.active_source_type, "
            "updated_at = excluded.updated_at",
            (source_type,),
        )


def get_active_source_type() -> str | None:
    """Return an explicit active source, inferring one safely for migrated DBs.

    A legacy database can predate ``analysis_state``. If several provenance
    types exist, the source from the most recently uploaded non-empty batch is
    selected. At no point are different source types combined by default.
    """
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT active_source_type FROM analysis_state WHERE id = 1"
        ).fetchone()
        if row and row["active_source_type"]:
            return row["active_source_type"]

        sources = [
            r["source_type"]
            for r in conn.execute(
                "SELECT DISTINCT source_type FROM observations ORDER BY source_type"
            ).fetchall()
        ]
        if not sources:
            return None
        if len(sources) == 1:
            selected = sources[0]
        else:
            latest = conn.execute(
                "SELECT o.source_type FROM ingestion_batches b "
                "JOIN observations o ON o.source_batch_id = b.batch_id "
                "GROUP BY b.batch_id, o.source_type "
                "ORDER BY b.uploaded_at DESC, b.rowid DESC LIMIT 1"
            ).fetchone()
            selected = latest["source_type"] if latest else sources[0]

        conn.execute(
            "UPDATE analysis_state SET active_source_type = ?, updated_at = datetime('now') "
            "WHERE id = 1",
            (selected,),
        )
        conn.commit()
        return selected
    finally:
        conn.close()
