"""
Amadeus Flight Offers Search v2 provider.

Credentials are loaded from environment variables — never hardcoded.

When AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET are not set, all
methods return a clean "provider not configured" response.  The
application continues to serve synthetic demo data without any error.

Live coverage note:
  The Amadeus test environment (test.api.amadeus.com) does not include
  all Indian domestic routes.  Production coverage requires an approved
  Amadeus production account and airline NDC/EDIFACT agreements.
  This is documented and not claimed as full coverage.

Auth: OAuth 2.0 client credentials flow.
Endpoint: GET /v2/shopping/flight-offers
"""
import json
import logging
import time
import urllib.parse
import urllib.request

from app.config import settings
from app.providers.base import FareProvider, ProviderError, ProviderNotConfiguredError

logger = logging.getLogger(__name__)

# HTTP timeout in seconds (connect + read)
_TIMEOUT = 15


class AmadeusProvider(FareProvider):
    """
    Live fare provider via the Amadeus Flight Offers Search API.

    Lifecycle:
      1. If credentials are absent → is_configured() returns False.
      2. status() returns clear setup instructions (no credentials exposed).
      3. fetch_quotes() raises ProviderNotConfiguredError if not configured.
      4. If credentials are present, OAuth token is fetched once and cached
         (refreshed 60 s before expiry).
    """

    name = "amadeus"
    requires_credentials = True

    def __init__(self) -> None:
        self._token: str | None = None
        self._token_expiry: float = 0.0

    def is_configured(self) -> bool:
        return bool(settings.amadeus_client_id and settings.amadeus_client_secret)

    def status(self) -> dict:
        if not self.is_configured():
            return {
                "provider": self.name,
                "configured": False,
                "requires_credentials": True,
                "data_freshness": "unavailable",
                "source_type": "live",
                "message": (
                    "Amadeus provider is not configured. "
                    "Set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET in your .env file "
                    "to enable live fare quotes from the Amadeus test environment."
                ),
                "setup_instructions": [
                    "1. Register at https://developers.amadeus.com (free test account)",
                    "2. Create an app in the developer portal",
                    "3. Copy client_id and client_secret from the app settings",
                    "4. Add to your .env file: AMADEUS_CLIENT_ID=... and AMADEUS_CLIENT_SECRET=...",
                    "5. Restart the backend: uvicorn app.main:app --reload",
                ],
                "live_coverage_note": (
                    "The Amadeus test environment has limited coverage of Indian domestic routes. "
                    "A production Amadeus account and airline agreements are needed for full coverage."
                ),
            }

        return {
            "provider": self.name,
            "configured": True,
            "requires_credentials": True,
            "data_freshness": "live",
            "source_type": "live",
            "base_url": settings.amadeus_base_url,
            "message": "Amadeus provider is configured and ready to fetch live fare quotes.",
            "disclaimer": (
                "Live fare data is sourced from the Amadeus test environment. "
                "Coverage of Indian domestic routes is limited in the test environment. "
                "Fares are indicative and may not represent all carriers or routes."
            ),
        }

    def _get_token(self) -> str:
        """Return a valid OAuth 2.0 bearer token, refreshing if needed."""
        if self._token and time.time() < self._token_expiry - 60:
            return self._token  # still valid

        if not self.is_configured():
            raise ProviderNotConfiguredError(
                "Cannot authenticate: AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET not set."
            )

        url = f"{settings.amadeus_base_url}/v1/security/oauth2/token"
        data = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": settings.amadeus_client_id,
            "client_secret": settings.amadeus_client_secret,
        }).encode()

        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")

        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
                body = json.loads(resp.read())
        except Exception as exc:
            # Never log the client_secret — log only the error type.
            logger.error(
                "Amadeus token fetch failed (client_id=%s***): %s",
                settings.amadeus_client_id[:4] if settings.amadeus_client_id else "",
                type(exc).__name__,
            )
            raise ProviderError(f"Amadeus authentication failed: {type(exc).__name__}") from exc

        self._token = body["access_token"]
        self._token_expiry = time.time() + body.get("expires_in", 1799)
        logger.info("Amadeus token refreshed, expires in %ss", body.get("expires_in", 1799))
        return self._token

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
        Fetch live fare quotes from Amadeus Flight Offers Search v2.

        Returns normalized observation dicts ready for ingestion.
        Returns [] if no results are found.
        Raises ProviderNotConfiguredError if credentials are missing.
        Raises ProviderError on API failures.
        """
        if not self.is_configured():
            raise ProviderNotConfiguredError(
                "Set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET in .env to fetch live fares."
            )

        token = self._get_token()
        params = urllib.parse.urlencode({
            "originLocationCode": origin.upper(),
            "destinationLocationCode": destination.upper(),
            "departureDate": departure_date,
            "adults": max(1, adults),
            "max": min(50, max_offers),
            "currencyCode": "INR",
        })
        url = f"{settings.amadeus_base_url}/v2/shopping/flight-offers?{params}"

        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {token}")

        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
                body = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            logger.error(
                "Amadeus flight-offers HTTP %s for %s-%s on %s",
                exc.code, origin, destination, departure_date,
            )
            raise ProviderError(
                f"Amadeus API returned HTTP {exc.code} for {origin}-{destination}"
            ) from exc
        except Exception as exc:
            logger.error(
                "Amadeus flight-offers failed for %s-%s: %s",
                origin, destination, type(exc).__name__,
            )
            raise ProviderError(
                f"Amadeus API request failed: {type(exc).__name__}"
            ) from exc

        offers = body.get("data", [])
        from datetime import date
        quote_date = date.today().isoformat()

        normalized = []
        for offer in offers:
            try:
                normalized.extend(self._normalize_offer(offer, quote_date))
            except Exception as exc:
                logger.warning("Skipping malformed Amadeus offer: %s", exc)

        logger.info(
            "Amadeus: %d offers → %d observations for %s-%s on %s",
            len(offers), len(normalized), origin, destination, departure_date,
        )
        return normalized

    def _normalize_offer(self, offer: dict, quote_date: str) -> list[dict]:
        """
        Convert one Amadeus flight offer to a list of normalized observation dicts.

        Each leg × each traveler pricing combination becomes one observation.
        Unmappable or out-of-range fares are silently skipped.
        """
        from datetime import date
        from app.model import (
            normalize_code, lead_bucket, compute_lead_days, parse_iso_date,
            MIN_PLAUSIBLE_FARE, MAX_PLAUSIBLE_FARE,
        )

        # Cabin → fare_class mapping. Unknown cabins default to ECONOMY_SAVER.
        _CABIN_MAP = {
            "ECONOMY": "ECONOMY_SAVER",
            "PREMIUM_ECONOMY": "PREMIUM_ECONOMY",
            "BUSINESS": "BUSINESS",
            "FIRST": "BUSINESS",   # map First to BUSINESS for this schema
        }

        results = []
        q_date = parse_iso_date(quote_date)

        for itinerary in offer.get("itineraries", []):
            for segment in itinerary.get("segments", []):
                dep_str = segment["departure"]["at"][:10]  # "YYYY-MM-DDTHH:MM" → "YYYY-MM-DD"
                try:
                    travel_date = parse_iso_date(dep_str)
                except (ValueError, AttributeError):
                    continue

                ld = compute_lead_days(travel_date, q_date)
                if ld < 0:
                    continue  # quote after departure — skip

                seg_origin = normalize_code(segment["departure"]["iataCode"])
                seg_dest = normalize_code(segment["arrival"]["iataCode"])
                carrier = normalize_code(segment.get("carrierCode", ""))
                flight_number = f"{segment.get('carrierCode','')}{segment.get('number','')}"
                seg_id = segment.get("id", "")

                price = offer.get("price", {})
                total_str = price.get("grandTotal") or price.get("total", "0")
                try:
                    total_fare = float(total_str)
                except (ValueError, TypeError):
                    continue

                if not (MIN_PLAUSIBLE_FARE <= total_fare <= MAX_PLAUSIBLE_FARE):
                    continue

                base_str = price.get("base", "")
                try:
                    base_fare = float(base_str) if base_str else round(total_fare * 0.55, 2)
                except (ValueError, TypeError):
                    base_fare = round(total_fare * 0.55, 2)
                taxes_fees = round(total_fare - base_fare, 2)

                for tp in offer.get("travelerPricings", []):
                    for fd in tp.get("fareDetailsBySegment", []):
                        if fd.get("segmentId") != seg_id:
                            continue
                        cabin = fd.get("cabin", "ECONOMY").upper()
                        fare_class = _CABIN_MAP.get(cabin, "ECONOMY_SAVER")

                        results.append({
                            "origin": seg_origin,
                            "destination": seg_dest,
                            "airline": carrier,
                            "travel_date": dep_str,
                            "quote_date": quote_date,
                            "lead_days": ld,
                            "lead_bucket": lead_bucket(ld),
                            "fare_class": fare_class,
                            "base_fare": round(base_fare, 2),
                            "airline_surcharge": 0.0,
                            "statutory_taxes": round(taxes_fees * 0.65, 2),
                            "airport_charges": round(taxes_fees * 0.35, 2),
                            "taxes_fees": round(taxes_fees, 2),
                            "total_fare": total_fare,
                            # Extended fields for snapshot storage
                            "source_type": "live",
                            "provider": self.name,
                            "flight_number": flight_number,
                            "offer_id": offer.get("id", ""),
                            "offer_expiry": offer.get("lastTicketingDateTime", ""),
                        })

        return results
