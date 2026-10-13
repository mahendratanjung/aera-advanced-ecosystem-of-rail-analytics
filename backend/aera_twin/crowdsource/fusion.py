"""Fuse every crowding observation of one train into a single observed load.

Each source says how full a train is, in percent of capacity, with its own typical error
(``sd``, in percentage points). Observations are combined by inverse-variance weighting and
fade with a half-life, so a report from ten minutes ago counts far less than one from now.
The browser then blends this observed load with the model's prediction the same way
(``frontend/lib/crowd/observed.ts``), so a single rider report nudges the prediction and
a camera count nearly replaces it.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from typing import Literal

Source = Literal["rider_report", "rider_location", "camera", "door_counter", "load_weigh"]

# Typical error of one observation from each source, in percentage points of capacity.
# Rider locations have no fixed value: their error depends on how many phones were matched.
SOURCE_SD: dict[str, float] = {
    "rider_report": 18.0,
    "camera": 8.0,
    "door_counter": 6.0,
    "load_weigh": 4.0,
}
MAX_AGE_S = 15 * 60


@dataclass(frozen=True)
class Observation:
    trip_id: str
    key: str  # one per reporter or device on a trip: a newer observation replaces the older one
    source: Source
    pct: float  # train load in percent of capacity
    sd: float
    stop_index: int  # the leg the train was on: load leaving this stop
    at_ms: int  # simulation time


@dataclass
class ObservedLoad:
    trip_id: str
    pct: float
    sd: float
    stop_index: int
    n: int
    sources: dict[str, int] = field(default_factory=dict)
    updated_ms: int = 0
    # sd holds at as_of_ms; later it grows as the observations fade (the browser keeps fading it).
    as_of_ms: int = 0
    half_life_s: float = 240

    def to_dict(self) -> dict:
        return {"trip_id": self.trip_id, "pct": round(self.pct, 1), "sd": round(self.sd, 1),
                "stop_index": self.stop_index, "n": self.n, "sources": self.sources,
                "updated_ms": self.updated_ms, "as_of_ms": self.as_of_ms, "half_life_s": self.half_life_s}


def _drop_outlying_reports(obs: list[Observation]) -> list[Observation]:
    """Ignore rider reports far from what most other riders on the train said."""
    reports = [o for o in obs if o.source == "rider_report"]
    if len(reports) < 4:
        return obs
    values = [o.pct for o in reports]
    med = statistics.median(values)
    mad = statistics.median(abs(v - med) for v in values) * 1.4826
    limit = max(25.0, 3 * mad)
    return [o for o in obs if o.source != "rider_report" or abs(o.pct - med) <= limit]


def fuse(obs: list[Observation], now_ms: int, half_life_s: float) -> ObservedLoad | None:
    live = [o for o in obs if 0 <= (now_ms - o.at_ms) / 1000 <= MAX_AGE_S]
    live = _drop_outlying_reports(live)
    if not live:
        return None
    total_w = 0.0
    total = 0.0
    for o in live:
        age_s = max(0.0, (now_ms - o.at_ms) / 1000)
        w = 0.5 ** (age_s / half_life_s) / max(1.0, o.sd) ** 2
        total_w += w
        total += w * o.pct
    newest = max(live, key=lambda o: o.at_ms)
    sources: dict[str, int] = {}
    for o in live:
        sources[o.source] = sources.get(o.source, 0) + 1
    return ObservedLoad(
        trip_id=newest.trip_id, pct=total / total_w, sd=1 / math.sqrt(total_w),
        stop_index=newest.stop_index, n=len(live), sources=sources, updated_ms=newest.at_ms,
        as_of_ms=now_ms, half_life_s=half_life_s,
    )


class ObservationBook:
    """Observations per train. ``version`` changes whenever the summary may have changed."""

    def __init__(self, half_life_s: float = 240):
        self.half_life_s = half_life_s
        self._by_trip: dict[str, dict[str, Observation]] = {}
        self.version = 0

    def add(self, o: Observation) -> None:
        self._by_trip.setdefault(o.trip_id, {})[o.key] = o
        self.version += 1

    def remove(self, trip_id: str, key: str) -> None:
        if self._by_trip.get(trip_id, {}).pop(key, None) is not None:
            self.version += 1
            if not self._by_trip[trip_id]:
                del self._by_trip[trip_id]

    def prune(self, now_ms: int, active_trips: set[str]) -> None:
        """Forget trains that finished their trip and observations too old to matter."""
        for trip_id in list(self._by_trip):
            obs = self._by_trip[trip_id]
            for key, o in list(obs.items()):
                if trip_id not in active_trips or (now_ms - o.at_ms) / 1000 > MAX_AGE_S or o.at_ms > now_ms:
                    del obs[key]
                    self.version += 1
            if not obs:
                del self._by_trip[trip_id]

    def observed(self, trip_id: str, now_ms: int) -> ObservedLoad | None:
        return fuse(list(self._by_trip.get(trip_id, {}).values()), now_ms, self.half_life_s)

    def summary(self, now_ms: int) -> dict[str, dict]:
        out = {}
        for trip_id in self._by_trip:
            o = self.observed(trip_id, now_ms)
            if o:
                out[trip_id] = o.to_dict()
        return out

    def clear(self) -> None:
        if self._by_trip:
            self._by_trip.clear()
            self.version += 1
