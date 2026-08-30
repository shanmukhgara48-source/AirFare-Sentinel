"""Keep API tests isolated from the developer/demo database."""
import os
import tempfile
from pathlib import Path


_TEST_DB_DIR = tempfile.TemporaryDirectory(prefix="farepulse-tests-")
os.environ["FAREPULSE_DB_PATH"] = str(Path(_TEST_DB_DIR.name) / "test.db")

# Test modules create TestClient instances during collection, so initialize the
# isolated database before those modules are imported.
from app.db.database import init_db  # noqa: E402

init_db()
