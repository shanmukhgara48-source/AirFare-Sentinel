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
        return bool(
            settings.amadeus_client_id.strip()
            and settings.amadeus_client_secret.strip()
        )

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
                    "5. Restart the backend: python -m uvicorn app.main:app --reload",
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
            "data_freshness": "not_fetched",
            "source_type": "live",
            "base_url": settings.amadeus_base_url,
            "message": "Amadeus provider is configured and ready to fetch live fare quotes.",
            "disclaimer": (
                "When a fetch succeeds, quote snapshots are sourced from the Amadeus test environment. "
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
            # Never log credential material, including partial client IDs.
            logger.error(
                "Amadeus token fetch failed: %s",
                type(exc).__name__,
            )
            raise ProviderError(f"Amadeus authentication failed: {type(exc).__name__}") from exc

        access_token = body.get("access_token") if isinstance(body, dict) else None
        if not isinstance(access_token, str) or not access_token.strip():
            raise ProviderError(
                "Amadeus authentication returned no usable access token."
            )
        self._token = access_token
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
                normalized.extend(
                    self._normalize_offer(
                        offer,
                        quote_date,
                        requested_origin=origin,
                        requested_destination=destination,
                        requested_adults=adults,
                    )
                )
            except Exception as exc:
                # Provider payloads can contain opaque identifiers.  Log only
                # the failure class so neither credentials nor raw offers can
                # leak through exception text.
                logger.warning(
                    "Skipping malformed Amadeus offer (%s)", type(exc).__name__
                )

        logger.info(
            "Amadeus: %d offers → %d observations for %s-%s on %s",
            len(offers), len(normalized), origin, destination, departure_date,
        )
        return normalized

    def _normalize_offer(
        self,
        offer: dict,
        quote_date: str,
        *,
        requested_origin: str,
        requested_destination: str,
        requested_adults: int = 1,
    ) -> list[dict]:
        """
        Convert one one-way Amadeus offer into one comparable quote snapshot.

        Amadeus prices apply to the complete itinerary, not to each connection
        segment.  Emitting one row per segment would duplicate the full fare
        and mislabel a DEL-BOM itinerary via HYD as two point-to-point fares.
        We therefore retain the searched origin/destination and store the
        segment flight numbers together as provenance.
        """
        from app.model import (
            FARE_CLASS_RANK,
            MAX_PLAUSIBLE_FARE,
            MIN_PLAUSIBLE_FARE,
            compute_lead_days,
            lead_bucket,
            normalize_code,
            parse_iso_date,
        )

        # Cabin → fare_class mapping. Unknown cabins default to ECONOMY_SAVER.
        _CABIN_MAP = {
            "ECONOMY": "ECONOMY_SAVER",
            "PREMIUM_ECONOMY": "PREMIUM_ECONOMY",
            "BUSINESS": "BUSINESS",
            "FIRST": "BUSINESS",   # map First to BUSINESS for this schema
        }

        q_date = parse_iso_date(quote_date)
        itineraries = offer.get("itineraries") or []
        if not itineraries:
            return []
        segments = itineraries[0].get("segments") or []
        if not segments:
            return []

        dep_str = segments[0]["departure"]["at"][:10]
        travel_date = parse_iso_date(dep_str)
        ld = compute_lead_days(travel_date, q_date)
        if ld < 0:
            return []

        origin = normalize_code(segments[0]["departure"]["iataCode"])
        destination = normalize_code(segments[-1]["arrival"]["iataCode"])
        if (
            origin != normalize_code(requested_origin)
            or destination != normalize_code(requested_destination)
        ):
            return []

        validating = offer.get("validatingAirlineCodes") or []
        carrier = normalize_code(
            validating[0] if validating else segments[0].get("carrierCode", "")
        )
        flight_number = "/".join(
            f"{segment.get('carrierCode', '')}{segment.get('number', '')}"
            for segment in segments
        )

        price = offer.get("price", {})
        total_value = float(price.get("grandTotal") or price.get("total", "0"))
        traveler_pricings = offer.get("travelerPricings") or []
        traveler_count = len(traveler_pricings) or max(1, requested_adults)
        total_fare = round(total_value / traveler_count, 2)
        if not (MIN_PLAUSIBLE_FARE <= total_fare <= MAX_PLAUSIBLE_FARE):
            return []

        base_value = price.get("base")
        try:
            base_fare = (
                round(float(base_value) / traveler_count, 2)
                if base_value not in (None, "")
                else round(total_fare * 0.55, 2)
            )
        except (ValueError, TypeError):
            base_fare = round(total_fare * 0.55, 2)
        taxes_fees = round(total_fare - base_fare, 2)
        if taxes_fees < 0:
            return []

        segment_ids = {segment.get("id") for segment in segments}
        mapped_classes = []
        if traveler_pricings:
            for detail in traveler_pricings[0].get("fareDetailsBySegment", []):
                if detail.get("segmentId") in segment_ids:
                    cabin = str(detail.get("cabin", "ECONOMY")).upper()
                    mapped_classes.append(_CABIN_MAP.get(cabin, "ECONOMY_SAVER"))
        fare_class = max(
            mapped_classes or ["ECONOMY_SAVER"],
            key=lambda value: FARE_CLASS_RANK[value],
        )

        statutory_taxes = round(taxes_fees * 0.65, 2)
        airport_charges = round(taxes_fees - statutory_taxes, 2)
        return [{
            "origin": origin,
            "destination": destination,
            "airline": carrier,
            "travel_date": dep_str,
            "quote_date": quote_date,
            "lead_days": ld,
            "lead_bucket": lead_bucket(ld),
            "fare_class": fare_class,
            "base_fare": base_fare,
            "airline_surcharge": 0.0,
            "statutory_taxes": statutory_taxes,
            "airport_charges": airport_charges,
            "taxes_fees": taxes_fees,
            "total_fare": total_fare,
            "source_type": "live",
            "provider": self.name,
            "flight_number": flight_number,
            "offer_id": offer.get("id", ""),
            "offer_expiry": offer.get("lastTicketingDateTime", ""),
        }]
