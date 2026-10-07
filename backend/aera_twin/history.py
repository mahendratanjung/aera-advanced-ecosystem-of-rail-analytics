"""One-minute occupancy buckets (OCC-05)."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from aera_twin.levels import LEVELS

BUCKET_MS = 60_000
KEEP_BUCKETS = 24 * 60


@dataclass
class _Acc:
    bucket: int
    total: float = 0.0
    n: int = 0
    max_count: int = 0
    worst: int = 0


class ZoneHistory:
    def __init__(self) -> None:
        self.series: dict[str, deque[dict]] = {}
        self._acc: dict[str, _Acc] = {}

    def observe(self, key: str, count: int, level: str, at_ms: int) -> None:
        bucket = at_ms - at_ms % BUCKET_MS
        acc = self._acc.get(key)
        if acc and acc.bucket != bucket:
            self._close(key, acc)
            acc = None
        if acc is None:
            acc = self._acc[key] = _Acc(bucket)
        acc.total += count
        acc.n += 1
        acc.max_count = max(acc.max_count, count)
        acc.worst = max(acc.worst, LEVELS.index(level))

    def _close(self, key: str, acc: _Acc) -> None:
        q = self.series.setdefault(key, deque(maxlen=KEEP_BUCKETS))
        q.append({
            "bucket_ms": acc.bucket,
            "avg_count": round(acc.total / max(1, acc.n), 1),
            "max_count": acc.max_count,
            "level": LEVELS[acc.worst],
        })

    def get(self, key: str, since_ms: int = 0) -> list[dict]:
        rows = [r for r in self.series.get(key, ()) if r["bucket_ms"] >= since_ms]
        acc = self._acc.get(key)
        if acc and acc.bucket >= since_ms:  # include the bucket still being filled
            rows.append({"bucket_ms": acc.bucket, "avg_count": round(acc.total / max(1, acc.n), 1),
                         "max_count": acc.max_count, "level": LEVELS[acc.worst], "partial": True})
        return rows
