"""Snap a GPS point onto a line's track (distance along the line and how far off it is).

Used to match rider phones and live vehicle feeds to trains. Distances follow the line file's
``shape_distances``, so they compare directly with ``Line.distance`` and ``TrainState.distance_m``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from aera_twin.timetable import Line

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON_EQ = 111_320.0


@dataclass(frozen=True)
class Snap:
    distance_m: float  # along the line from the first station
    offset_m: float  # perpendicular distance from the track


class LineProjector:
    def __init__(self, line: Line):
        shape: list[list[float]] = line.data["shape"]  # [lon, lat]
        self.cum: list[float] = line.data["shape_distances"]
        lat0 = sum(p[1] for p in shape) / len(shape)
        self._lon0, self._lat0 = shape[0][0], shape[0][1]
        self._kx = M_PER_DEG_LON_EQ * math.cos(math.radians(lat0))
        self._pts = [self._xy(p[1], p[0]) for p in shape]
        self.length_m = self.cum[-1]

    def _xy(self, lat: float, lon: float) -> tuple[float, float]:
        return (lon - self._lon0) * self._kx, (lat - self._lat0) * M_PER_DEG_LAT

    def snap(self, lat: float, lon: float) -> Snap:
        px, py = self._xy(lat, lon)
        best = (math.inf, 0.0)
        for i in range(len(self._pts) - 1):
            (ax, ay), (bx, by) = self._pts[i], self._pts[i + 1]
            dx, dy = bx - ax, by - ay
            seg2 = dx * dx + dy * dy
            f = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
            qx, qy = ax + f * dx, ay + f * dy
            d2 = (px - qx) ** 2 + (py - qy) ** 2
            if d2 < best[0]:
                best = (d2, self.cum[i] + f * (self.cum[i + 1] - self.cum[i]))
        return Snap(distance_m=best[1], offset_m=math.sqrt(best[0]))

    def point_at(self, distance_m: float) -> tuple[float, float]:
        """(lat, lon) at a distance along the line. Used by tests and demo senders."""
        d = max(0.0, min(self.length_m, distance_m))
        lo, hi = 0, len(self.cum) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if self.cum[mid] <= d:
                lo = mid
            else:
                hi = mid
        span = self.cum[hi] - self.cum[lo]
        f = 0.0 if span == 0 else (d - self.cum[lo]) / span
        (ax, ay), (bx, by) = self._pts[lo], self._pts[hi]
        x, y = ax + f * (bx - ax), ay + f * (by - ay)
        return self._lat0 + y / M_PER_DEG_LAT, self._lon0 + x / self._kx
