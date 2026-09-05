"""Ignav one-way economy fare quote snapshots (backend-only X-Api-Key auth).

Contract: https://ignav.com/docs/one-way and /docs/response-format.
Market IN requests INR pricing and Indian locale. Non-INR prices are discarded.
Ignav currently provides total prices, not itemized taxes. The 75% base / 25%
fees split below is a provider-normalization approximation, not a tax invoice.
The existing live ingestion endpoint passes these rows to validate_live_quotes
before storage, including reconciliation, plausibility and duplicate checks.
"""
from datetime import date
from http.client import HTTPException
import json
import math
import urllib.error
import urllib.request

from app.config import settings
from app.model import compute_lead_days, lead_bucket, normalize_code, parse_iso_date
from app.providers.base import FareProvider, ProviderError, ProviderNotConfiguredError

_TIMEOUT = 30


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward the API key to a redirected destination."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class IgnavSearchError(ProviderError):
    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"Ignav upstream search failed (HTTP {status_code}).")


class IgnavAccessError(ProviderError):
    """An account-wide problem; abort the remaining network searches."""


class IgnavProvider(FareProvider):
    name = "ignav"
    requires_credentials = True

    def is_configured(self) -> bool:
        return bool(settings.ignav_api_key.strip())

    def status(self) -> dict:
        configured = self.is_configured()
        enabled = configured and not settings.demo_mode
        return {
            "provider": self.name,
            "configured": configured,
            "enabled": enabled,
            "requires_credentials": True,
            "data_freshness": "not_fetched" if configured else "unavailable",
            "source_type": "live",
            "message": (
                "Ignav is configured and enabled for live fare quote snapshots."
                if enabled else
                "Ignav is configured; DEMO_MODE=true blocks live fetch."
                if configured else
                "Ignav is not configured. Set IGNAV_API_KEY in backend/.env."
            ),
            "setup_instructions": [
                "Set IGNAV_API_KEY in backend/.env or a backend secret manager.",
                "Set DEMO_MODE=false and restart the backend to enable live fetch.",
            ],
            "disclaimer": (
                "Live fare quote snapshots are observed at fetch time, not guaranteed "
                "final fares or official government data. Fare components are approximated."
            ),
        }

    def fetch_quotes(
        self, origin: str, destination: str, departure_date: str,
        *, adults: int = 1, max_offers: int = 10,
    ) -> list[dict]:
        if not self.is_configured():
            raise ProviderNotConfiguredError("Set IGNAV_API_KEY in backend/.env to fetch live fare quote snapshots.")
        if not 1 <= adults <= 9 or max_offers < 1:
            raise ProviderError("Ignav requires 1–9 adults and a positive max_offers.")

        origin, destination = normalize_code(origin), normalize_code(destination)
        request = urllib.request.Request(
            f"{settings.ignav_base_url}/fares/one-way",
            data=json.dumps({
                "origin": origin,
                "destination": destination,
                "departure_date": departure_date,
                "adults": adults,
                "cabin_class": "economy",
                "market": "IN",
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-Api-Key": settings.ignav_api_key},
            method="POST",
        )
        try:
            with urllib.request.build_opener(_NoRedirect()).open(request, timeout=_TIMEOUT) as response:
                body = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            # Do not read/log bodies or chain exceptions containing request URLs.
            code = exc.code
            exc.close()
            if code in (401, 403):
                raise IgnavAccessError("Ignav authentication failed. Check backend credentials.") from None
            if code == 402:
                raise IgnavAccessError("Ignav account billing is required before more searches.") from None
            if code == 429:
                raise IgnavAccessError("Ignav rate limit reached. Try again later.") from None
            raise IgnavSearchError(code) from None
        except (ValueError, UnicodeError):
            raise ProviderError("Ignav returned a malformed response.") from None
        except (urllib.error.URLError, OSError, HTTPException):
            raise ProviderError("Ignav request failed or timed out.") from None

        if not isinstance(body, dict) or not isinstance(body.get("itineraries"), list):
            raise ProviderError("Ignav returned a malformed response.")

        quote_date = date.today().isoformat()
        rows = []
        for item in body["itineraries"]:
            try:
                row = self._normalize_itinerary(item, origin, destination, departure_date, quote_date)
            except (KeyError, ValueError, TypeError, AttributeError, IndexError, OverflowError):
                # A malformed itinerary must not discard other results. Never
                # log raw payloads or exception text (which may contain secrets).
                continue
            rows.append(row)
            if len(rows) >= max_offers:
                break
        return rows

    def _text(self, value: object, max_length: int = 256) -> str:
        if not isinstance(value, str) or len(value) > max_length or settings.ignav_api_key in value:
            raise ValueError("Invalid provider text")
        return value.strip()

    def _normalize_itinerary(
        self, item: dict, origin: str, destination: str,
        departure_date: str, quote_date: str,
    ) -> dict:
        if item.get("inbound") or item.get("cabin_class") != "economy":
            raise ValueError("Not a one-way economy itinerary")
        price = item["price"]
        if price.get("currency") != "INR" or isinstance(price.get("amount"), bool):
            raise ValueError("Not an INR fare")
        total = round(float(price["amount"]), 2)
        if not math.isfinite(total) or total <= 0:
            raise ValueError("Invalid price")

        segments = item["outbound"]["segments"]
        if not isinstance(segments, list) or not segments:
            raise ValueError("Missing segments")
        if (segments[0]["departure_airport"] != origin
                or segments[-1]["arrival_airport"] != destination):
            raise ValueError("Route mismatch")
        travel_date = self._text(segments[0]["departure_time_local"])[:10]
        if travel_date != departure_date:
            raise ValueError("Departure date mismatch")
        ld = compute_lead_days(parse_iso_date(travel_date), parse_iso_date(quote_date))
        if ld < 0:
            raise ValueError("Past departure")
        flights = []
        for index, segment in enumerate(segments):
            if index and segments[index - 1]["arrival_airport"] != segment["departure_airport"]:
                raise ValueError("Disconnected itinerary")
            carrier = self._text(segment["marketing_carrier_code"], 3)
            number = self._text(segment.get("flight_number") or "", 10)
            flights.append(f"{carrier}{number}")

        # Provider-normalization approximation: Ignav has no documented
        # component breakdown. Preserve its returned total without inventing
        # currency conversion, expiry, or an official tax calculation.
        base = round(total * 0.75, 2)
        fees = round(total - base, 2)
        statutory = round(fees * 0.65, 2)
        return {
            "origin": origin, "destination": destination,
            "airline": self._text(segments[0]["marketing_carrier_code"], 3),
            "travel_date": travel_date, "quote_date": quote_date,
            "lead_days": ld, "lead_bucket": lead_bucket(ld),
            "fare_class": "ECONOMY_SAVER",
            "base_fare": base, "airline_surcharge": 0.0,
            "statutory_taxes": statutory, "airport_charges": round(fees - statutory, 2),
            "taxes_fees": fees, "total_fare": total,
            "source_type": "live", "provider": self.name,
            "flight_number": "/".join(flights),
            "offer_id": self._text(item["ignav_id"], 2048),
            "offer_expiry": None,  # Not supplied by the documented search API.
            "departure_time": self._text(segments[0]["departure_time_local"]),
            "arrival_time": self._text(segments[-1].get("arrival_time_local") or "") or None,
            "price_status": price.get("status") if price.get("status") in {"verified", "unverified"} else "unknown",
        }
