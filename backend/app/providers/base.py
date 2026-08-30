"""
Abstract base class for all fare data providers.

A provider is responsible for fetching fare quotes from one source and
returning them as normalized observation dicts that match the ingestion schema.

Each provider must implement:
  is_configured()  — whether it has all credentials/config it needs
  status()         — human-readable status dict (safe to return in API response)
  fetch_quotes()   — the actual data fetch (may be empty list if not configured)
"""
from abc import ABC, abstractmethod


class ProviderError(Exception):
    """Raised when a provider fails unexpectedly during a request."""


class ProviderNotConfiguredError(ProviderError):
    """
    Raised when fetch_quotes() is called on a provider that lacks credentials.

    The caller should treat this as a configuration problem, not a transient
    error, and return a clear "not configured" response to the user.
    """


class FareProvider(ABC):
    """
    Abstract fare data provider.

    All providers share this interface so the application can iterate
    over them, check their status, and call them uniformly regardless
    of the underlying source (synthetic data, Amadeus, any future source).
    """

    name: str = "base"
    requires_credentials: bool = False

    @abstractmethod
    def is_configured(self) -> bool:
        """
        Return True if this provider has all necessary credentials or config.

        Should NOT make any network calls — only check local state.
        """

    @abstractmethod
    def status(self) -> dict:
        """
        Return a dict describing provider configuration and availability.

        Must be safe to return directly in an API response. Must never
        expose raw credentials — only masked indicators.
        """

    @abstractmethod
    def fetch_quotes(
        self,
        origin: str,
        destination: str,
        departure_date: str,
        *,
        adults: int = 1,
        max_offers: int = 10,
    ) -> list[dict]:
        """
        Fetch fare quotes and return as normalized observation dicts.

        Args:
            origin:         IATA airport code, e.g. "DEL"
            destination:    IATA airport code, e.g. "BOM"
            departure_date: ISO date string, e.g. "2026-10-15"
            adults:         number of adult passengers
            max_offers:     maximum offers to return

        Returns:
            List of normalized observation dicts ready for ingestion.
            Each dict must include: origin, destination, airline,
            travel_date, quote_date, base_fare, taxes_fees, fare_class.

        Raises:
            ProviderNotConfiguredError if credentials are missing.
            ProviderError on unexpected API failures.
        """
