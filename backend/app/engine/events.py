"""
Festival / Event Sensitivity Layer.

DEMO DATA — All events and typical-surge estimates listed here are
team-authored illustrative assumptions. They are not a cited, year-aware
calendar, a fitted model, or a regulatory finding. Event dates are expressed
as month-day (MM-DD) ranges and repeat year-over-year, which is an
approximation — actual festival dates shift annually.

Purpose
-------
This layer annotates each flagged fare with the nearest relevant event and
classifies the spike magnitude relative to a typical event-window baseline.
It is purely advisory: an analyst can use it to distinguish "this fare spike
looks like normal Diwali pressure" from "this spike is far beyond what we
normally see in a Diwali window" — without claiming causation.

Event categories
----------------
festival        — Major religious/cultural festivals (Diwali, Christmas, Holi …)
national_holiday — Republic/Independence Day and associated long weekends
long_weekend    — Government-holiday-adjacent 3–4 day windows
school_vacation — Predictable family-travel peaks tied to school calendars
city_event      — Illustrative major-event placeholders (for demo purposes)

Event-sensitivity classifications
----------------------------------
Expected seasonal pressure
    Travel date is in an event window AND the fare deviation is within the
    range normally associated with this event type (≤ 1.5 × typical_surge_pct).
    Anticipated; does not require immediate analyst action.

Elevated beyond event baseline
    Travel date is in an event window BUT the deviation is substantially above
    the typical event-season uplift (> 1.5 × typical_surge_pct).  Requires
    monitoring — the event alone may not explain the full magnitude.

Unrelated to event window
    Travel date falls outside all identified event windows, OR the anomaly is
    a price drop (drops are not associated with demand-driven event pressure).
    The reason code from the spike detector is the primary signal.
"""
from __future__ import annotations

# ── Demo event calendar ───────────────────────────────────────────────────────
# Fields:
#   id               — machine-readable slug
#   name             — display name
#   category         — festival | national_holiday | long_weekend |
#                      school_vacation | city_event
#   start_md         — window start "MM-DD" (inclusive)
#   end_md           — window end  "MM-DD" (inclusive)
#   typical_surge_pct — approximate % above-baseline fares observed historically
#                        (illustrative; used only for classification thresholds)
#   description      — one-sentence plain-English context
#   routes_note      — which routes / hubs are most affected

DEMO_EVENT_CALENDAR: list[dict] = [
    # ── Festivals ─────────────────────────────────────────────────────────────
    {
        "id": "diwali_dussehra",
        "name": "Diwali / Dussehra",
        "category": "festival",
        "start_md": "10-10",
        "end_md": "10-27",
        "typical_surge_pct": 35,
        "description": (
            "Major festival season; highest annual air-travel demand across all routes. "
            "A fare spike associated with this window is an expected seasonal signal."
        ),
        "routes_note": "All routes elevated; metro trunk routes (DEL-BOM, BOM-BLR) most affected.",
    },
    {
        "id": "christmas_new_year",
        "name": "Christmas & New Year",
        "category": "festival",
        "start_md": "12-20",
        "end_md": "12-31",
        "typical_surge_pct": 30,
        "description": (
            "Holiday travel season; leisure and visiting-friends-relatives (VFR) demand peaks."
        ),
        "routes_note": "DEL, BOM, BLR hubs see highest volumes; coastal destinations elevated.",
    },
    {
        "id": "holi",
        "name": "Holi",
        "category": "festival",
        "start_md": "03-23",
        "end_md": "03-28",
        "typical_surge_pct": 20,
        "description": "Spring festival; moderate demand spike on North–South corridor routes.",
        "routes_note": "DEL-originating routes most affected.",
    },
    {
        "id": "ganesh_chaturthi",
        "name": "Ganesh Chaturthi",
        "category": "festival",
        "start_md": "08-22",
        "end_md": "09-05",
        "typical_surge_pct": 18,
        "description": (
            "Major Maharashtra festival; elevated BOM-route demand. "
            "Dates are approximate — actual date shifts annually with the lunar calendar."
        ),
        "routes_note": "BOM hub routes most affected (BOM-DEL, BOM-BLR, BOM-CCU).",
    },
    # ── National holidays / long weekends ─────────────────────────────────────
    {
        "id": "independence_day",
        "name": "Independence Day",
        "category": "national_holiday",
        "start_md": "08-13",
        "end_md": "08-16",
        "typical_surge_pct": 15,
        "description": "Long weekend around Aug 15; short-haul leisure demand rises.",
        "routes_note": "Short-haul leisure routes and hill-station-adjacent hubs elevated.",
    },
    {
        "id": "gandhi_jayanti_weekend",
        "name": "Gandhi Jayanti long weekend",
        "category": "long_weekend",
        "start_md": "09-29",
        "end_md": "10-03",
        "typical_surge_pct": 12,
        "description": (
            "Oct 2 national holiday creates a 3–4 day travel window. "
            "A fare spike here may be associated with long-weekend demand, "
            "not unusual market behaviour."
        ),
        "routes_note": "Regional and leisure routes more affected than metro trunk routes.",
    },
    {
        "id": "republic_day",
        "name": "Republic Day",
        "category": "national_holiday",
        "start_md": "01-24",
        "end_md": "01-27",
        "typical_surge_pct": 12,
        "description": "Long weekend around Jan 26; domestic leisure demand rises.",
        "routes_note": "South Indian holiday destinations (MAA, BLR, HYD) see upticks.",
    },
    # ── School vacations ──────────────────────────────────────────────────────
    {
        "id": "diwali_school_break",
        "name": "Diwali school break",
        "category": "school_vacation",
        "start_md": "10-25",
        "end_md": "11-07",
        "typical_surge_pct": 25,
        "description": (
            "Post-Diwali school vacation; family leisure travel peaks. "
            "Fares elevated above the festival baseline as families take extended trips."
        ),
        "routes_note": "Leisure routes elevated; advance booking pressure rises 2+ weeks ahead.",
    },
    {
        "id": "summer_vacation",
        "name": "Summer school vacation",
        "category": "school_vacation",
        "start_md": "05-01",
        "end_md": "06-15",
        "typical_surge_pct": 28,
        "description": "Peak leisure travel season; families book holidays months ahead.",
        "routes_note": "All leisure routes; coastal / hill destinations most affected.",
    },
    {
        "id": "winter_break",
        "name": "Winter school break",
        "category": "school_vacation",
        "start_md": "01-01",
        "end_md": "01-10",
        "typical_surge_pct": 18,
        "description": "New Year school break; continued holiday travel demand into early January.",
        "routes_note": "Extends Christmas demand window; leisure routes remain elevated.",
    },
    # ── City events (illustrative placeholders) ───────────────────────────────
    {
        "id": "bengaluru_tech_summit",
        "name": "Bengaluru Tech Summit (Demo)",
        "category": "city_event",
        "start_md": "11-10",
        "end_md": "11-12",
        "typical_surge_pct": 18,
        "description": (
            "Illustrative major city conference. In production, real MICE-event calendars "
            "would be ingested here. Elevated inbound demand at BLR hub."
        ),
        "routes_note": "BLR-inbound routes (DEL-BLR, BOM-BLR, HYD-BLR) most affected.",
    },
    {
        "id": "delhi_air_show",
        "name": "Delhi Air Show (Demo)",
        "category": "city_event",
        "start_md": "09-18",
        "end_md": "09-23",
        "typical_surge_pct": 15,
        "description": (
            "Illustrative aviation event in the Delhi NCR region. "
            "Included as a demo placeholder for city-event sensitivity."
        ),
        "routes_note": "DEL-inbound routes (BOM-DEL, BLR-DEL, HYD-DEL) may see demand uplift.",
    },
]

# ── Public accessors ──────────────────────────────────────────────────────────

DEMO_NOTICE = (
    "⚠ DEMO DATA — Event calendar is illustrative. Dates use approximate "
    "MM-DD ranges that recur annually; actual festival dates shift with the "
    "lunar calendar. Typical surge percentages are rough estimates, not "
    "official statistics. Do not use for regulatory or legal purposes."
)

_EVENT_CATEGORIES = {
    "festival":        "Festival",
    "national_holiday": "National Holiday",
    "long_weekend":    "Long Weekend",
    "school_vacation": "School Vacation",
    "city_event":      "City / MICE Event (Demo)",
}

# Multiplier applied to typical_surge_pct to set the "Elevated beyond
# event baseline" threshold.  A spike deviating more than this multiple
# of the typical event uplift is classified as elevated.
_ELEVATION_THRESHOLD_FACTOR = 1.5


def get_all_events() -> list[dict]:
    """Return the full demo event calendar with display-ready category labels."""
    return [
        {**ev, "category_label": _EVENT_CATEGORIES.get(ev["category"], ev["category"])}
        for ev in DEMO_EVENT_CALENDAR
    ]


def tag_event(travel_date: str) -> dict | None:
    """
    Return the first matching event whose window contains *travel_date*.

    Parameters
    ----------
    travel_date:
        ISO-8601 date string "YYYY-MM-DD".

    Returns
    -------
    Event dict (with category_label added) or None if no window matches.
    """
    if not travel_date or len(travel_date) < 10:
        return None
    md = travel_date[5:]  # "YYYY-MM-DD" → "MM-DD"
    for ev in DEMO_EVENT_CALENDAR:
        if ev["start_md"] <= md <= ev["end_md"]:
            return {**ev, "category_label": _EVENT_CATEGORIES.get(ev["category"], ev["category"])}
    return None


def classify_event_sensitivity(spike: dict, event: dict | None) -> str:
    """
    Classify a flagged fare relative to its event context.

    Parameters
    ----------
    spike:
        Must contain keys ``direction`` and ``pct_above_median``.
    event:
        Return value of ``tag_event()``.  None if no event window.

    Returns
    -------
    One of:
      "Expected seasonal pressure"
      "Elevated beyond event baseline"
      "Unrelated to event window"
    """
    # Price drops are not demand-driven and do not associate with seasonal events.
    if spike.get("direction") == "drop":
        return "Unrelated to event window"

    if event is None:
        return "Unrelated to event window"

    deviation = abs(spike.get("pct_above_median", 0.0))
    threshold = event["typical_surge_pct"] * _ELEVATION_THRESHOLD_FACTOR
    if deviation > threshold:
        return "Elevated beyond event baseline"
    return "Expected seasonal pressure"


def tag_spikes_with_events(spikes: list[dict]) -> list[dict]:
    """
    Annotate each spike case with event context fields.

    Adds the following keys to every spike:
      event_tag            — event name string or None
      event_category       — category slug or None
      event_category_label — human-readable category or None
      event_typical_surge_pct — int or None
      event_description    — string or None
      event_window_label   — "MM-DD – MM-DD" or None
      in_event_window      — bool
      event_classification — one of the three sensitivity labels

    Does not mutate the input; returns a new list of dicts.
    """
    result = []
    for spike in spikes:
        event = tag_event(spike.get("travel_date", ""))
        classification = classify_event_sensitivity(spike, event)
        result.append({
            **spike,
            "event_tag":              event["name"] if event else None,
            "event_category":         event["category"] if event else None,
            "event_category_label":   event["category_label"] if event else None,
            "event_typical_surge_pct": event["typical_surge_pct"] if event else None,
            "event_description":      event["description"] if event else None,
            "event_window_label": (
                f"{event['start_md']} – {event['end_md']}" if event else None
            ),
            "in_event_window":        event is not None,
            "event_classification":   classification,
        })
    return result
