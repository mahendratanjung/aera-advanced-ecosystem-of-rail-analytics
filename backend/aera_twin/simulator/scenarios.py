"""Scenario director presets (section 4.2, ADM-04, SIM-04)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    description: str
    demand_mult: float = 1.0
    alight_share: float = 0.2
    jump_to: str | None = None  # Kuala Lumpur time of day
    speed: float | None = None
    # Disruptions as templates: start is "now" and duration_min None means until cleared.
    disruptions: tuple[dict, ...] = field(default_factory=tuple)
    close_zones: tuple[tuple[str, str], ...] = ()  # (zone_id, reason) on twin stations
    close_links: tuple[tuple[str, str], ...] = ()
    reset: bool = False
    hidden: bool = False  # station-zone scenarios for the IoT phase, not offered in the UI


SCENARIOS: dict[str, Scenario] = {s.id: s for s in [
    Scenario("normal", "Typical day", "Crowding as predicted from recent weeks of gate data."),
    Scenario("morning_peak", "Morning peak", "Jump to 07:45, when trains towards the city are fullest.",
             alight_share=0.1, jump_to="07:45"),
    Scenario("evening_peak", "Evening peak", "Jump to 18:15, when trains leaving the city are fullest.",
             alight_share=0.32, jump_to="18:15"),
    Scenario("train_fault", "Train fault at Universiti",
             "A southbound train is held at Universiti for 12 minutes. The trains behind it bunch up "
             "and the first one after the fault leaves very full.",
             disruptions=({"kind": "hold", "stop_id": "KJ19", "direction_id": 1, "duration_min": 12,
                           "note": "Train fault (scenario)"},)),
    Scenario("suspension", "City section suspended",
             "No trains between Masjid Jamek and KLCC for 20 minutes. Passengers build up on both sides.",
             disruptions=({"kind": "suspend", "stop_id": "KJ13", "to_stop_id": "KJ10", "duration_min": 20,
                           "note": "Section suspended (scenario)"},)),
    Scenario("event_surge", "Event crowd at KLCC",
             "Three times the usual number of people board at KLCC for 45 minutes, as after a concert.",
             disruptions=({"kind": "surge", "stop_id": "KJ10", "multiplier": 3.0, "duration_min": 45,
                           "note": "Event crowd (scenario)"},)),
    Scenario("platform_closure", "Platform closure", "Platform 2 and its stairs close for an incident.",
             close_zones=(("platform-2", "Closed for an incident (scenario)"),),
             close_links=(("stairs-p2", "Closed for an incident (scenario)"),), hidden=True),
    Scenario("quiet", "Late evening", "Jump to 22:15 when trains run every seven minutes.", jump_to="22:15"),
    Scenario("reset", "Reset", "Clear every disruption and return to the typical day.", reset=True),
]}
