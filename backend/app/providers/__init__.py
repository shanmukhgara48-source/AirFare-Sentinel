"""
Fare data provider registry.

Usage:
    from app.providers import get_provider_statuses, get_live_provider

    statuses = get_provider_statuses()   # for /api/provider/status
    provider = get_live_provider()       # None if none configured
"""
from app.providers.base import FareProvider, ProviderError, ProviderNotConfiguredError
from app.providers.demo import DemoProvider
from app.providers.amadeus import AmadeusProvider
from app.config import settings

_demo = DemoProvider()
_amadeus = AmadeusProvider()

# Ordered: demo first (always available), then live providers.
ALL_PROVIDERS: list[FareProvider] = [_demo, _amadeus]

__all__ = [
    "ALL_PROVIDERS",
    "FareProvider",
    "ProviderError",
    "ProviderNotConfiguredError",
    "get_provider_statuses",
    "get_configured_live_provider",
    "get_live_provider",
]


def get_provider_statuses() -> list[dict]:
    """Return status dicts for all registered providers. Safe to expose in API."""
    return [p.status() for p in ALL_PROVIDERS]


def get_configured_live_provider() -> FareProvider | None:
    """Return a credential-ready live provider, ignoring the operating mode."""
    for provider in ALL_PROVIDERS:
        if provider.name != "demo" and provider.is_configured():
            return provider
    return None


def get_live_provider() -> FareProvider | None:
    """
    Return the first configured non-demo provider, or None.

    Demo mode is an explicit safety gate. Credentials can be present and ready
    without allowing provider calls until DEMO_MODE=false.
    """
    if settings.demo_mode:
        return None
    return get_configured_live_provider()
