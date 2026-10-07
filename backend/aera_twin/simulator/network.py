"""Simulated busyness for stations without sensors (OCC-07).

Values are deterministic per station and minute so the picture is stable between refreshes.
"""

from __future__ import annotations

from aera_twin.config import Thresholds
from aera_twin.levels import level_for
from aera_twin.timetable import Disruption, demand, local_hour

# Relative ridership weights. Interchanges and city stations are busier.
WEIGHTS: dict[str, float] = {
    "KJ15": 0.95, "KJ13": 0.9, "KJ10": 0.85, "KJ14": 0.75, "KJ12": 0.62, "KJ16": 0.6,
    "KJ28": 0.7, "KJ24": 0.65, "KJ9": 0.6, "KJ37": 0.6, "KJ1": 0.55, "KJ19": 0.55,
    "KJ11": 0.55, "KJ5": 0.5, "KJ17": 0.5, "KJ21": 0.5,
}
DEFAULT_WEIGHT = 0.4


def _noise(station_id: str, minute: int) -> float:
    h = sum(ord(c) * (i + 1) for i, c in enumerate(station_id))
    return ((h * 7919 + minute * 104729) % 1000) / 1000


def simulated_percent(
    station_id: str, sim_s: float, demand_mult: float, disruptions: list[Disruption]
) -> float:
    base = demand(local_hour(sim_s)) * WEIGHTS.get(station_id, DEFAULT_WEIGHT) * demand_mult
    pct = base * 100 * (0.85 + 0.3 * _noise(station_id, int(sim_s // 60)))
    for d in disruptions:
        if station_id in (d.stop_id, d.to_stop_id):
            pct *= 1.35  # waiting passengers build up at a disrupted station
    return round(max(0.0, min(110.0, pct)), 1)


def summary(station_id: str, sim_s: float, demand_mult: float, disruptions: list[Disruption],
            thresholds: Thresholds) -> dict:
    pct = simulated_percent(station_id, sim_s, demand_mult, disruptions)
    return {"id": station_id, "percent": pct, "level": level_for(pct, thresholds), "source": "sim",
            "has_twin": False}
