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


def init_db() -> None:
    conn = get_connection()
    try:
        conn.executescript(SCHEMA_PATH.read_text())
        _run_migrations(conn)
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
            "DROP TABLE IF EXISTS ingestion_batches;"
            "DROP TABLE IF EXISTS observations;"
            "PRAGMA foreign_keys = ON;"
        )
        conn.executescript(SCHEMA_PATH.read_text())
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
