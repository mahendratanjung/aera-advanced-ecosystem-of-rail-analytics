"""Send in-train crowding readings to the AERA twin service.

Uses only the standard library so it runs on a Raspberry Pi or Jetson without extra
packages. Readings follow ``packages/contracts/car-count.schema.json``. When the network
drops (tunnels, depots), readings wait in a small queue and are sent in order once it is
back; readings older than ``max_age_s`` are dropped because stale crowding misleads riders.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Literal

Method = Literal["camera", "door_counter", "load_weigh"]
Post = Callable[[str, bytes, dict[str, str]], int]


def http_post(url: str, body: bytes, headers: dict[str, str], timeout: float = 5.0) -> int:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


class Sender:
    def __init__(self, api_url: str, device_id: str, token: str = "", queue_max: int = 500,
                 max_age_s: float = 120, post: Post = http_post, clock: Callable[[], float] = time.time):
        self.url = f"{api_url.rstrip('/')}/api/ingest/train/{device_id}"
        self.token = token
        self.queue: deque[tuple[float, dict]] = deque(maxlen=queue_max)
        self.max_age_s = max_age_s
        self.post = post
        self.clock = clock
        self.seq = 0
        self.rejected = 0

    def reading(self, *, car: int, method: Method, count: int | None = None, load_pct: float | None = None,
                confidence: float | None = None, trip_id: str | None = None, station_id: str | None = None,
                direction_id: int | None = None) -> dict:
        self.seq += 1
        msg: dict = {"v": 1, "seq": self.seq, "ts": datetime.fromtimestamp(self.clock(), UTC).isoformat(),
                     "method": method, "car": car}
        optional = {"count": count, "load_pct": load_pct, "confidence": confidence, "trip_id": trip_id,
                    "station_id": station_id, "direction_id": direction_id}
        msg.update({k: v for k, v in optional.items() if v is not None})
        return msg

    def send(self, msg: dict) -> bool:
        """Queue a reading and try to send everything waiting. True when the queue is empty."""
        self.queue.append((self.clock(), msg))
        return self.flush()

    def flush(self) -> bool:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["X-Ingest-Token"] = self.token
        while self.queue:
            queued_at, msg = self.queue[0]
            if self.clock() - queued_at > self.max_age_s:
                self.queue.popleft()
                continue
            try:
                status = self.post(self.url, json.dumps(msg).encode(), headers)
            except OSError:
                return False  # offline: keep the queue and try again with the next reading
            if status >= 500 or status == 429:
                return False
            self.queue.popleft()
            if status >= 400:
                self.rejected += 1  # bad token or bad reading: retrying will not help
        return True
