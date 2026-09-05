"""Keep API tests isolated from the developer/demo database."""
import os
import tempfile
from pathlib import Path


_TEST_DB_DIR = tempfile.TemporaryDirectory(prefix="farepulse-tests-")
os.environ["FAREPULSE_DB_PATH"] = str(Path(_TEST_DB_DIR.name) / "test.db")
# Never use developer credentials or enable real provider calls in tests.
# Explicit values also prevent python-dotenv from loading secrets from .env.
os.environ["DEMO_MODE"] = "true"
os.environ["LIVE_ONLY"] = "false"
for name in ("IGNAV_API_KEY", "AMADEUS_CLIENT_ID", "AMADEUS_CLIENT_SECRET"):
    os.environ[name] = ""

# Test modules create TestClient instances during collection, so initialize the
# isolated database before those modules are imported.
from app.db.database import init_db  # noqa: E402

init_db()
