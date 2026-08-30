"""
Provider layer tests.

Covers:
  - DemoProvider is always configured, never raises, returns valid status.
  - AmadeusProvider returns "not configured" when credentials are absent.
  - Provider registry surfaces all providers and returns valid status shapes.
  - get_live_provider() returns None when no credentials are set.

These tests do NOT make any network calls.
"""
import unittest

from app.providers.base import ProviderNotConfiguredError
from app.providers.demo import DemoProvider
from app.providers.amadeus import AmadeusProvider
from app.providers import ALL_PROVIDERS, get_live_provider, get_provider_statuses


# ─── DemoProvider ─────────────────────────────────────────────────────────────

class TestDemoProvider(unittest.TestCase):
    """Demo provider must always be ready — no credentials, no network."""

    def setUp(self):
        self.provider = DemoProvider()

    def test_is_always_configured(self):
        self.assertTrue(self.provider.is_configured())

    def test_does_not_require_credentials(self):
        self.assertFalse(self.provider.requires_credentials)

    def test_status_has_required_keys(self):
        s = self.provider.status()
        for key in ("provider", "configured", "requires_credentials",
                    "message", "data_freshness", "source_type"):
            self.assertIn(key, s, f"status() missing key: {key!r}")

    def test_status_configured_is_true(self):
        self.assertTrue(self.provider.status()["configured"])

    def test_status_source_type_is_demo(self):
        self.assertEqual(self.provider.status()["source_type"], "demo")

    def test_status_data_freshness_is_static(self):
        self.assertEqual(self.provider.status()["data_freshness"], "static")

    def test_fetch_quotes_returns_empty_list(self):
        """Demo provider returns no live quotes — data comes from CSV."""
        result = self.provider.fetch_quotes("DEL", "BOM", "2026-10-01")
        self.assertIsInstance(result, list)
        self.assertEqual(result, [])

    def test_fetch_quotes_does_not_raise(self):
        """Calling fetch_quotes on an unconfigured scenario must not raise."""
        try:
            self.provider.fetch_quotes("DEL", "BOM", "2026-10-01")
        except Exception as exc:
            self.fail(f"DemoProvider.fetch_quotes raised unexpectedly: {exc}")


# ─── AmadeusProvider ──────────────────────────────────────────────────────────

class TestAmadeusProvider(unittest.TestCase):
    """
    Amadeus provider when credentials are absent (the default state in any
    environment that has not set AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET).
    """

    def setUp(self):
        self.provider = AmadeusProvider()

    def test_not_configured_when_credentials_missing(self):
        """Without env vars, the provider must report not configured."""
        # This holds in any environment where the vars are absent.
        import os
        if os.environ.get("AMADEUS_CLIENT_ID") or os.environ.get("AMADEUS_CLIENT_SECRET"):
            self.skipTest("Amadeus credentials are set — skipping not-configured tests")
        self.assertFalse(self.provider.is_configured())

    def test_requires_credentials(self):
        self.assertTrue(self.provider.requires_credentials)

    def test_status_has_required_keys(self):
        s = self.provider.status()
        for key in ("provider", "configured", "requires_credentials",
                    "message", "data_freshness"):
            self.assertIn(key, s, f"status() missing key: {key!r}")

    def test_status_not_configured_has_setup_instructions(self):
        import os
        if os.environ.get("AMADEUS_CLIENT_ID"):
            self.skipTest("Amadeus credentials set")
        s = self.provider.status()
        self.assertFalse(s["configured"])
        self.assertIn("setup_instructions", s)
        self.assertGreater(len(s["setup_instructions"]), 0)

    def test_status_not_configured_data_freshness_is_unavailable(self):
        import os
        if os.environ.get("AMADEUS_CLIENT_ID"):
            self.skipTest("Amadeus credentials set")
        self.assertEqual(self.provider.status()["data_freshness"], "unavailable")

    def test_status_provider_name_is_amadeus(self):
        self.assertEqual(self.provider.status()["provider"], "amadeus")

    def test_fetch_quotes_raises_when_not_configured(self):
        import os
        if os.environ.get("AMADEUS_CLIENT_ID") and os.environ.get("AMADEUS_CLIENT_SECRET"):
            self.skipTest("Amadeus credentials set — this test requires them to be absent")
        with self.assertRaises(ProviderNotConfiguredError):
            self.provider.fetch_quotes("DEL", "BOM", "2026-10-01")

    def test_status_message_is_non_empty_string(self):
        s = self.provider.status()
        self.assertIsInstance(s["message"], str)
        self.assertGreater(len(s["message"]), 10)


# ─── Provider registry ────────────────────────────────────────────────────────

class TestProviderRegistry(unittest.TestCase):

    def test_all_providers_is_non_empty(self):
        self.assertGreater(len(ALL_PROVIDERS), 0)

    def test_demo_provider_is_in_registry(self):
        names = [p.name for p in ALL_PROVIDERS]
        self.assertIn("demo", names)

    def test_amadeus_provider_is_in_registry(self):
        names = [p.name for p in ALL_PROVIDERS]
        self.assertIn("amadeus", names)

    def test_get_provider_statuses_returns_one_per_provider(self):
        statuses = get_provider_statuses()
        self.assertEqual(len(statuses), len(ALL_PROVIDERS))

    def test_every_status_has_provider_key(self):
        for s in get_provider_statuses():
            self.assertIn("provider", s)
            self.assertIn("configured", s)

    def test_get_live_provider_returns_none_when_no_credentials(self):
        """With no env vars set, no live provider should be returned."""
        import os
        if os.environ.get("AMADEUS_CLIENT_ID") and os.environ.get("AMADEUS_CLIENT_SECRET"):
            self.skipTest("Live provider is configured")
        result = get_live_provider()
        self.assertIsNone(result)

    def test_demo_is_never_returned_as_live_provider(self):
        """get_live_provider() must never return the demo provider."""
        from app.providers.demo import DemoProvider
        result = get_live_provider()
        if result is not None:
            self.assertNotIsInstance(result, DemoProvider)


if __name__ == "__main__":
    unittest.main()
