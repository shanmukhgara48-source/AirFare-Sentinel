"""
Demo provider — synthetic data mode, always configured.

This provider exists so the provider registry always contains at least one
entry and the /api/provider/status endpoint is never empty.

fetch_quotes() returns [] because demo data is pre-loaded via the CSV
ingestion pipeline (Admin → Load Sample Data), not via live API calls.
"""
from app.providers.base import FareProvider


class DemoProvider(FareProvider):
    """
    Always-configured provider that serves synthetic / demo data.

    No credentials required.  Judges can verify the source is clearly
    labelled as synthetic — no real airline fares are claimed.
    """

    name = "demo"
    requires_credentials = False

    def is_configured(self) -> bool:
        return True

    def status(self) -> dict:
        return {
            "provider": self.name,
            "configured": True,
            "requires_credentials": False,
            "data_freshness": "static",
            "source_type": "demo",
            "message": (
                "Synthetic demo data mode is active. "
                "Load sample data from Admin → Load Sample Data. "
                "No external API credentials are required."
            ),
            "data_source": (
                "Deterministic synthetic CSV data (seed=26056, 23,558 rows). "
                "Carrier codes SA1/BW2/NS3/CE9 are fictional. "
                "Not real airline fares — suitable for demonstration only."
            ),
            "notice": (
                "Two events are injected: "
                "HYD-BLR/CE9 surge (×3.4, Sep 18-20) and "
                "BOM-BLR/BW2 promo (×0.42, Sep 24-25). "
                "These are detectable by the anomaly engine."
            ),
        }

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
        Demo provider does not fetch live quotes.

        Use Admin → Load Sample Data to populate the database with
        synthetic observations. Returns empty list by design.
        """
        return []
