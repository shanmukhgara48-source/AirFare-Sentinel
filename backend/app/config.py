"""
Application settings — loaded from environment variables or a .env file.

All settings have safe defaults so the application starts without any
environment configuration.  Production deployments should set the relevant
variables; demo/hackathon deployments run fine with nothing set.

Usage:
    from app.config import settings
    if settings.amadeus_client_id:
        ...

Environment variables (see .env.example for the full list):
    AMADEUS_CLIENT_ID       — Amadeus API client ID
    AMADEUS_CLIENT_SECRET   — Amadeus API client secret
    AMADEUS_BASE_URL        — Amadeus base URL (default: test environment)
    DEMO_MODE               — "true" forces synthetic data (default: true)
    CORS_ORIGINS            — comma-separated allowed origins
    UPLOAD_MAX_BYTES        — max CSV upload size in bytes (default: 5 MB)
"""
import os
from pathlib import Path

# Load .env if present. python-dotenv is an optional dependency — if it is not
# installed the application still works by reading OS environment variables.
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    try:
        from dotenv import load_dotenv  # type: ignore[import]
        load_dotenv(_env_path, override=False)
    except ImportError:
        pass  # dotenv not installed; use OS env only


class _Settings:
    # ── Live data provider credentials ───────────────────────────────────────
    # Never hardcode credentials in source code. Set them in .env or in the
    # shell environment.  Logs will never print these values.
    amadeus_client_id: str = os.environ.get("AMADEUS_CLIENT_ID", "")
    amadeus_client_secret: str = os.environ.get("AMADEUS_CLIENT_SECRET", "")
    amadeus_base_url: str = os.environ.get(
        "AMADEUS_BASE_URL", "https://test.api.amadeus.com"
    )

    # ── Application mode ─────────────────────────────────────────────────────
    # When True (default), external provider calls are disabled. Local sample
    # and imported CSV data remain available.
    demo_mode: bool = os.environ.get("DEMO_MODE", "true").lower() != "false"

    # ── CORS ─────────────────────────────────────────────────────────────────
    # Comma-separated list of allowed CORS origins. Restricts which browser
    # origins can call the API. Default is localhost dev only.
    cors_origins: list[str] = [
        o.strip()
        for o in os.environ.get(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if o.strip()
    ]

    # ── Upload limits ─────────────────────────────────────────────────────────
    # Maximum CSV upload in bytes. 5 MB ≈ ~100,000 rows, enough for a large
    # batch while preventing accidental huge uploads.
    upload_max_bytes: int = int(
        os.environ.get("UPLOAD_MAX_BYTES", str(5 * 1024 * 1024))
    )

    def masked_credentials(self) -> dict:
        """Return a dict safe to log — credentials are masked."""
        def mask(s: str) -> str:
            return s[:4] + "****" if len(s) > 4 else "****" if s else "(not set)"

        return {
            "amadeus_client_id": mask(self.amadeus_client_id),
            "amadeus_client_secret": mask(self.amadeus_client_secret),
            "demo_mode": self.demo_mode,
            "cors_origins": self.cors_origins,
            "upload_max_bytes": self.upload_max_bytes,
        }


settings = _Settings()
