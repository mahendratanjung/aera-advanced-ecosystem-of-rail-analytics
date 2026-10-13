"""Turn noisy per-frame people counts into steady readings worth sending."""

from __future__ import annotations

import statistics
from collections import deque


class CountSmoother:
    """Median of the last ``window`` counts, reported when it changes or every ``every_s`` seconds.

    People hide behind each other and poles, so single frames jump around; the median over a
    few seconds is steady without lagging much.
    """

    def __init__(self, window: int = 9, min_change: int = 3, every_s: float = 30):
        self.counts: deque[int] = deque(maxlen=window)
        self.min_change = min_change
        self.every_s = every_s
        self.last_sent: int | None = None
        self.last_sent_at = -1e18

    def add(self, count: int, now_s: float) -> int | None:
        """Add one frame's count. Returns a value to send, or None."""
        self.counts.append(count)
        if len(self.counts) < self.counts.maxlen:
            return None
        value = round(statistics.median(self.counts))
        changed = self.last_sent is None or abs(value - self.last_sent) >= self.min_change
        if changed or now_s - self.last_sent_at >= self.every_s:
            self.last_sent, self.last_sent_at = value, now_s
            return value
        return None
