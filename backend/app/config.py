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
    IGNAV_API_KEY           — backend-only Ignav API key
    IGNAV_BASE_URL          — Ignav base URL (default: https://ignav.com/api)
    AMADEUS_CLIENT_ID       — Amadeus API client ID
    AMADEUS_CLIENT_SECRET   — Amadeus API client secret
    AMADEUS_BASE_URL        — Amadeus base URL (default: test environment)
    DEMO_MODE               — "true" forces synthetic data (default: true)
    CORS_ORIGINS            — comma-separated allowed origins
    UPLOAD_MAX_BYTES        — max CSV upload size in bytes (default: 5 MB)
"""
import os
from pathlib import Path
from urllib.parse import urlparse

# Load .env if present. python-dotenv is an optional dependency — if it is not
# installed the application still works by reading OS environment variables.
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    try:
        from dotenv import load_dotenv  # type: ignore[import]
        load_dotenv(_env_path, override=False)
    except ImportError:
        pass  # dotenv not installed; use OS env only


def _parse_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError(
        f"{name} must be one of true/false, yes/no, on/off, or 1/0"
    )


def _parse_positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive integer") from exc
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _validate_base_url(raw: str, name: str = "AMADEUS_BASE_URL") -> str:
    value = raw.strip().rstrip("/")
    parsed = urlparse(value)
    if (not parsed.scheme or not parsed.netloc or parsed.query or parsed.fragment
            or parsed.username is not None or parsed.password is not None):
        raise ValueError(f"{name} must be an absolute base URL without credentials, query, or fragment")
    is_local_http = parsed.scheme == "http" and parsed.hostname in {
        "localhost",
        "127.0.0.1",
        "::1",
    }
    if parsed.scheme != "https" and not is_local_http:
        raise ValueError(f"{name} must use HTTPS outside localhost")
    return value


class _Settings:
    def __init__(self) -> None:
        # Never hardcode credentials in source code or expose them to the
        # frontend. Provider diagnostics must only report presence/absence.
        self.ignav_api_key = os.environ.get("IGNAV_API_KEY", "").strip()
        self.ignav_base_url = _validate_base_url(
            os.environ.get("IGNAV_BASE_URL", "https://ignav.com/api"),
            "IGNAV_BASE_URL",
        )
        self.amadeus_client_id = os.environ.get("AMADEUS_CLIENT_ID", "").strip()
        self.amadeus_client_secret = os.environ.get(
            "AMADEUS_CLIENT_SECRET", ""
        ).strip()
        self.amadeus_base_url = _validate_base_url(
            os.environ.get("AMADEUS_BASE_URL", "https://test.api.amadeus.com")
        )

        # Demo mode disables all external provider calls. Local sample and
        # imported CSV data remain available.
        self.demo_mode = _parse_bool("DEMO_MODE", True)
        self.live_only = _parse_bool("LIVE_ONLY", False)
        if self.live_only and self.demo_mode:
            raise ValueError("LIVE_ONLY=true requires DEMO_MODE=false")

        self.cors_origins = list(
            dict.fromkeys(
                origin.strip().rstrip("/")
                for origin in os.environ.get(
                    "CORS_ORIGINS",
                    "http://localhost:5173,http://127.0.0.1:5173",
                ).split(",")
                if origin.strip()
            )
        )
        if not self.cors_origins:
            raise ValueError("CORS_ORIGINS must contain at least one origin")
        if "*" in self.cors_origins:
            raise ValueError("CORS_ORIGINS must list explicit origins, not '*'")

        self.upload_max_bytes = _parse_positive_int(
            "UPLOAD_MAX_BYTES", 5 * 1024 * 1024
        )

        credential_presence = (
            bool(self.amadeus_client_id),
            bool(self.amadeus_client_secret),
        )
        if credential_presence[0] != credential_presence[1]:
            raise ValueError(
                "AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET must be set together"
            )
        if not self.demo_mode and not self.provider_credentials_configured:
            raise ValueError(
                "DEMO_MODE=false requires IGNAV_API_KEY or both Amadeus credential variables"
            )

    @property
    def provider_credentials_configured(self) -> bool:
        return bool(self.ignav_api_key or (self.amadeus_client_id and self.amadeus_client_secret))

    def masked_credentials(self) -> dict:
        """Return a dict safe to log — credentials are masked."""
        def mask(s: str) -> str:
            return s[:4] + "****" if len(s) > 4 else "****" if s else "(not set)"

        return {
            "ignav_api_key": "(set)" if self.ignav_api_key else "(not set)",
            "amadeus_client_id": mask(self.amadeus_client_id),
            # Never reveal even a prefix of a secret in logs or diagnostics.
            "amadeus_client_secret": "(set)" if self.amadeus_client_secret else "(not set)",
            "demo_mode": self.demo_mode,
            "cors_origins": self.cors_origins,
            "upload_max_bytes": self.upload_max_bytes,
        }


settings = _Settings()
