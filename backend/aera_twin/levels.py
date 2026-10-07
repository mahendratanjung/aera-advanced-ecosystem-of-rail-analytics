from __future__ import annotations

from aera_twin.config import Thresholds

LEVELS = ("low", "moderate", "busy", "crowded")


def percent_of(count: float, capacity: int) -> float:
    return round(100.0 * count / capacity, 1) if capacity > 0 else 0.0


def level_for(percent: float, t: Thresholds) -> str:
    """Map an occupancy percentage to a congestion level (OCC-04, section 10.2)."""
    if percent >= t.crowded:
        return "crowded"
    if percent >= t.busy:
        return "busy"
    if percent >= t.moderate:
        return "moderate"
    return "low"
