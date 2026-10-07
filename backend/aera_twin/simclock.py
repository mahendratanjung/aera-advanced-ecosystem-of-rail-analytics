"""Shared simulation clock (SIM-03).

The service broadcasts only the anchors. Each browser computes
``sim_now = anchor_sim_ms + (real_now - anchor_real_ms) * speed`` so trains move smoothly
without streaming positions (section 11.3.1).
"""

from __future__ import annotations

import time
from datetime import datetime

from aera_twin.timetable import KL_TZ

MIN_SPEED, MAX_SPEED = 0.25, 120.0


def wall_ms() -> int:
    return int(time.time() * 1000)


class SimClock:
    def __init__(self, sim_ms: int | None = None, speed: float = 1.0, real_ms: int | None = None):
        real = real_ms if real_ms is not None else wall_ms()
        self.anchor_real_ms = real
        self.anchor_sim_ms = sim_ms if sim_ms is not None else real
        self.speed = speed
        self.paused = False

    def now_ms(self, real_ms: int | None = None) -> int:
        real = real_ms if real_ms is not None else wall_ms()
        if self.paused:
            return self.anchor_sim_ms
        return int(self.anchor_sim_ms + (real - self.anchor_real_ms) * self.speed)

    def _reanchor(self, real_ms: int | None = None) -> None:
        real = real_ms if real_ms is not None else wall_ms()
        self.anchor_sim_ms = self.now_ms(real)
        self.anchor_real_ms = real

    def set_speed(self, speed: float, real_ms: int | None = None) -> None:
        if not MIN_SPEED <= speed <= MAX_SPEED:
            raise ValueError(f"speed must be between {MIN_SPEED} and {MAX_SPEED}")
        self._reanchor(real_ms)
        self.speed = speed

    def pause(self, real_ms: int | None = None) -> None:
        self._reanchor(real_ms)
        self.paused = True

    def resume(self, real_ms: int | None = None) -> None:
        self.anchor_real_ms = real_ms if real_ms is not None else wall_ms()
        self.paused = False

    def jump(self, sim_ms: int, real_ms: int | None = None) -> None:
        self.anchor_real_ms = real_ms if real_ms is not None else wall_ms()
        self.anchor_sim_ms = sim_ms

    def jump_to_local_time(self, hhmm: str, real_ms: int | None = None) -> None:
        """Jump to a Kuala Lumpur time of day on the current simulated date."""
        h, m = (int(p) for p in hhmm.split(":"))
        current = datetime.fromtimestamp(self.now_ms(real_ms) / 1000, KL_TZ)
        target = current.replace(hour=h, minute=m, second=0, microsecond=0)
        self.jump(int(target.timestamp() * 1000), real_ms)

    def to_dict(self) -> dict:
        return {
            "anchor_real_ms": self.anchor_real_ms,
            "anchor_sim_ms": self.anchor_sim_ms,
            "speed": self.speed,
            "paused": self.paused,
            "server_now_ms": wall_ms(),
        }
