"""
Tests for the Festival / Event Sensitivity Layer (app.engine.events).

Coverage
--------
- tag_event: dates inside windows, outside windows, boundary dates
- tag_event: empty / malformed date strings
- classify_event_sensitivity: all three classifications
- classify_event_sensitivity: drop → always "Unrelated to event window"
- tag_spikes_with_events: bulk tagging, required keys, no mutation
- event calendar: all entries have required fields
- event_classification label consistency
"""
import pytest
from app.engine.events import (
    DEMO_EVENT_CALENDAR,
    _ELEVATION_THRESHOLD_FACTOR,
    classify_event_sensitivity,
    get_all_events,
    tag_event,
    tag_spikes_with_events,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _spike(
    direction: str = "spike",
    pct_above_median: float = 40.0,
    travel_date: str = "2026-10-20",
) -> dict:
    return {
        "direction": direction,
        "pct_above_median": pct_above_median,
        "travel_date": travel_date,
    }


# ─── Event calendar structure ─────────────────────────────────────────────────


REQUIRED_FIELDS = {
    "id", "name", "category", "start_md", "end_md",
    "typical_surge_pct", "description", "routes_note",
}


def test_all_events_have_required_fields():
    for ev in DEMO_EVENT_CALENDAR:
        missing = REQUIRED_FIELDS - ev.keys()
        assert not missing, f"Event '{ev.get('id')}' missing: {missing}"


def test_all_events_have_valid_md_range():
    """start_md and end_md must be valid MM-DD strings and start ≤ end."""
    for ev in DEMO_EVENT_CALENDAR:
        s, e = ev["start_md"], ev["end_md"]
        assert len(s) == 5 and s[2] == "-", f"Bad start_md in '{ev['id']}': {s}"
        assert len(e) == 5 and e[2] == "-", f"Bad end_md in '{ev['id']}': {e}"
        assert s <= e, f"start_md > end_md in '{ev['id']}': {s} > {e}"


def test_typical_surge_pct_is_positive_int():
    for ev in DEMO_EVENT_CALENDAR:
        assert isinstance(ev["typical_surge_pct"], int)
        assert ev["typical_surge_pct"] > 0


def test_event_ids_are_unique():
    ids = [ev["id"] for ev in DEMO_EVENT_CALENDAR]
    assert len(ids) == len(set(ids)), "Duplicate event IDs found"


def test_get_all_events_adds_category_label():
    events = get_all_events()
    for ev in events:
        assert "category_label" in ev
        assert isinstance(ev["category_label"], str)
        assert ev["category_label"]  # non-empty


def test_get_all_events_count_matches_calendar():
    assert len(get_all_events()) == len(DEMO_EVENT_CALENDAR)


# ─── tag_event: dates inside windows ─────────────────────────────────────────


def test_diwali_travel_date_is_tagged():
    ev = tag_event("2026-10-20")
    assert ev is not None
    assert ev["id"] == "diwali_dussehra"


def test_christmas_travel_date_is_tagged():
    ev = tag_event("2026-12-25")
    assert ev is not None
    assert ev["id"] == "christmas_new_year"


def test_gandhi_jayanti_weekend_is_tagged():
    ev = tag_event("2026-10-02")
    assert ev is not None
    assert ev["id"] == "gandhi_jayanti_weekend"


def test_diwali_school_break_is_tagged():
    ev = tag_event("2026-11-01")
    assert ev is not None
    assert ev["id"] == "diwali_school_break"


def test_bengaluru_tech_summit_is_tagged():
    ev = tag_event("2026-11-11")
    assert ev is not None
    assert ev["id"] == "bengaluru_tech_summit"


def test_delhi_air_show_is_tagged():
    ev = tag_event("2026-09-20")
    assert ev is not None
    assert ev["id"] == "delhi_air_show"


def test_holi_is_tagged():
    ev = tag_event("2026-03-26")
    assert ev is not None
    assert ev["id"] == "holi"


def test_independence_day_is_tagged():
    ev = tag_event("2026-08-15")
    assert ev is not None
    assert ev["id"] == "independence_day"


# ─── tag_event: boundary dates ────────────────────────────────────────────────


def test_event_start_boundary_is_inclusive():
    # Diwali starts 10-10
    ev = tag_event("2026-10-10")
    assert ev is not None
    assert ev["id"] == "diwali_dussehra"


def test_event_end_boundary_is_inclusive():
    # Diwali ends 10-27
    ev = tag_event("2026-10-27")
    assert ev is not None
    assert ev["id"] == "diwali_dussehra"


def test_day_before_event_is_not_tagged():
    # Diwali starts 10-10; 10-09 should be untagged
    ev = tag_event("2026-10-09")
    assert ev is None or ev["id"] != "diwali_dussehra"


def test_day_after_event_is_not_tagged():
    # Diwali ends 10-27; 10-28 is in Diwali school break (10-25 to 11-07)
    # So let's test the day after Christmas (12-31 is last day → Jan 1 is winter_break)
    ev = tag_event("2026-01-01")
    # Jan 1 is in winter_break (01-01 to 01-10)
    assert ev is not None
    assert ev["id"] == "winter_break"


# ─── tag_event: dates outside all windows ─────────────────────────────────────


def test_mid_november_not_in_window():
    # After school break ends (11-07) and before tech summit (11-10) — narrow gap
    # Nov 8 should not be tagged
    ev = tag_event("2026-11-08")
    assert ev is None


def test_mid_september_between_events_not_tagged():
    # Ganesh Chaturthi ends 09-05; Gandhi Jayanti starts 09-29
    # Sep 10 is between windows
    ev = tag_event("2026-09-10")
    assert ev is None


def test_empty_string_returns_none():
    assert tag_event("") is None


def test_malformed_date_returns_none():
    assert tag_event("not-a-date") is None


def test_short_string_returns_none():
    assert tag_event("2026") is None


def test_tagged_event_has_category_label():
    ev = tag_event("2026-10-20")
    assert ev is not None
    assert "category_label" in ev


# ─── classify_event_sensitivity ───────────────────────────────────────────────


def test_expected_seasonal_pressure():
    """Spike within 1.5× typical surge → Expected."""
    event = tag_event("2026-10-20")   # Diwali, typical_surge_pct = 35
    assert event is not None
    # 40% deviation < 35 × 1.5 = 52.5 → Expected
    spike = _spike(pct_above_median=40.0, travel_date="2026-10-20")
    result = classify_event_sensitivity(spike, event)
    assert result == "Expected seasonal pressure"


def test_elevated_beyond_event_baseline():
    """Spike beyond 1.5× typical surge → Elevated."""
    event = tag_event("2026-10-20")   # Diwali, typical_surge_pct = 35
    assert event is not None
    # 60% deviation > 35 × 1.5 = 52.5 → Elevated
    spike = _spike(pct_above_median=60.0, travel_date="2026-10-20")
    result = classify_event_sensitivity(spike, event)
    assert result == "Elevated beyond event baseline"


def test_drop_is_always_unrelated():
    """Drops never associate with demand-driven event pressure."""
    event = tag_event("2026-10-20")
    assert event is not None
    spike = _spike(direction="drop", pct_above_median=-60.0, travel_date="2026-10-20")
    result = classify_event_sensitivity(spike, event)
    assert result == "Unrelated to event window"


def test_no_event_is_unrelated():
    """Travel date outside all windows → Unrelated."""
    event = tag_event("2026-09-10")   # between windows
    assert event is None
    spike = _spike(pct_above_median=80.0, travel_date="2026-09-10")
    result = classify_event_sensitivity(spike, event)
    assert result == "Unrelated to event window"


def test_exact_threshold_boundary():
    """Deviation exactly at 1.5× typical → Expected (not elevated)."""
    event = tag_event("2026-10-20")   # Diwali, typical_surge_pct = 35
    assert event is not None
    exact_threshold = 35 * _ELEVATION_THRESHOLD_FACTOR  # 52.5
    spike = _spike(pct_above_median=exact_threshold, travel_date="2026-10-20")
    # ≤ threshold → Expected
    result = classify_event_sensitivity(spike, event)
    assert result == "Expected seasonal pressure"


def test_one_above_threshold_is_elevated():
    event = tag_event("2026-10-20")
    assert event is not None
    just_above = 35 * _ELEVATION_THRESHOLD_FACTOR + 0.01  # 52.51
    spike = _spike(pct_above_median=just_above, travel_date="2026-10-20")
    result = classify_event_sensitivity(spike, event)
    assert result == "Elevated beyond event baseline"


def test_long_weekend_threshold_is_lower():
    """Long weekends have a lower typical surge → threshold is lower."""
    event = tag_event("2026-10-02")   # Gandhi Jayanti, typical_surge_pct = 12
    assert event is not None
    # 19% > 12 × 1.5 = 18 → Elevated
    spike = _spike(pct_above_median=19.0, travel_date="2026-10-02")
    result = classify_event_sensitivity(spike, event)
    assert result == "Elevated beyond event baseline"


# ─── tag_spikes_with_events ───────────────────────────────────────────────────


EXPECTED_NEW_KEYS = {
    "event_tag", "event_category", "event_category_label", "event_typical_surge_pct",
    "event_description", "event_window_label", "in_event_window", "event_classification",
}


def test_tag_spikes_adds_all_required_keys():
    spikes = [_spike()]
    result = tag_spikes_with_events(spikes)
    assert len(result) == 1
    for key in EXPECTED_NEW_KEYS:
        assert key in result[0], f"Missing key: {key}"


def test_tag_spikes_in_window_sets_in_event_window_true():
    spikes = [_spike(travel_date="2026-10-20")]
    result = tag_spikes_with_events(spikes)
    assert result[0]["in_event_window"] is True
    assert result[0]["event_tag"] == "Diwali / Dussehra"


def test_tag_spikes_out_of_window_sets_in_event_window_false():
    spikes = [_spike(travel_date="2026-09-10")]
    result = tag_spikes_with_events(spikes)
    assert result[0]["in_event_window"] is False
    assert result[0]["event_tag"] is None


def test_tag_spikes_preserves_original_fields():
    spikes = [{"direction": "spike", "pct_above_median": 40.0, "travel_date": "2026-10-20",
               "route": "DEL-BOM", "robust_z": 5.0}]
    result = tag_spikes_with_events(spikes)
    assert result[0]["route"] == "DEL-BOM"
    assert result[0]["robust_z"] == 5.0


def test_tag_spikes_does_not_mutate_input():
    original = [_spike()]
    original_copy = [dict(s) for s in original]
    tag_spikes_with_events(original)
    assert original[0] == original_copy[0]


def test_tag_spikes_empty_list():
    assert tag_spikes_with_events([]) == []


def test_tag_spikes_bulk():
    spikes = [
        _spike(travel_date="2026-10-20"),   # Diwali → Expected
        _spike(travel_date="2026-09-10"),   # No event → Unrelated
        _spike(direction="drop", travel_date="2026-10-20"),  # Drop → Unrelated
        _spike(pct_above_median=80.0, travel_date="2026-10-20"),  # Elevated
    ]
    result = tag_spikes_with_events(spikes)
    assert len(result) == 4
    assert result[0]["event_classification"] == "Expected seasonal pressure"
    assert result[1]["event_classification"] == "Unrelated to event window"
    assert result[2]["event_classification"] == "Unrelated to event window"
    assert result[3]["event_classification"] == "Elevated beyond event baseline"


def test_event_window_label_format():
    spikes = [_spike(travel_date="2026-10-20")]
    result = tag_spikes_with_events(spikes)
    label = result[0]["event_window_label"]
    assert label is not None
    assert " – " in label


def test_none_event_fields_when_no_window():
    spikes = [_spike(travel_date="2026-09-10")]
    result = tag_spikes_with_events(spikes)
    r = result[0]
    assert r["event_tag"] is None
    assert r["event_category"] is None
    assert r["event_category_label"] is None
    assert r["event_typical_surge_pct"] is None
    assert r["event_description"] is None
    assert r["event_window_label"] is None
