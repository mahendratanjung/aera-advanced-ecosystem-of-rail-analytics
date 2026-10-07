"""Topic parsing and payload validation (IOT-01 to IOT-06, section 9.7).

Hardware and the simulator arrive through the same function. Rejected messages are
counted by reason, and the abnormal ones are reported so the runtime can raise ALT-04.
"""

from __future__ import annotations

import json
from collections import Counter, deque
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from aera_twin.config import Settings
from aera_twin.contracts import CrossingEvent, Status, SwitchEvent, Telemetry, TrainEvent
from aera_twin.station import StationModel

TOPIC_PREFIX = "aera/v1/"
KINDS = ("event", "telemetry", "status", "cmd")
SIM_PREFIX = "sim-"
ABNORMAL = {"seq_backwards", "out_of_range", "rate"}
EVENT_MODELS: dict[str, type[BaseModel]] = {
    "crossing": CrossingEvent,
    "switch": SwitchEvent,
    "train": TrainEvent,
}


def is_sim_device(device_id: str) -> bool:
    return device_id.startswith(SIM_PREFIX)


def parse_topic(topic: str) -> tuple[str, str, str] | None:
    if not topic.startswith(TOPIC_PREFIX):
        return None
    parts = topic[len(TOPIC_PREFIX):].split("/")
    if len(parts) != 3 or parts[2] not in KINDS or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1], parts[2]


@dataclass
class IngestResult:
    accepted: bool
    station_id: str | None = None
    device_id: str | None = None
    kind: str | None = None
    source: str = "device"
    message: BaseModel | None = None
    reason: str | None = None
    detail: str | None = None

    @property
    def abnormal(self) -> bool:
        return self.reason in ABNORMAL


class Validator:
    def __init__(self, stations: dict[str, StationModel], settings: Settings):
        self.stations = stations
        self.settings = settings
        self.last_seq: dict[str, int] = {}
        self.recent: dict[str, deque] = {}
        self.accepted = 0
        self.rejected: Counter[str] = Counter()

    def stats(self) -> dict[str, Any]:
        return {"accepted": self.accepted, "rejected": dict(self.rejected),
                "rejected_total": sum(self.rejected.values())}

    def _reject(self, r: IngestResult, reason: str, detail: str | None = None) -> IngestResult:
        r.accepted = False
        r.reason = reason
        r.detail = detail
        self.rejected[reason] += 1
        return r

    def validate(self, topic: str, payload: bytes | str | dict, received_ms: int) -> IngestResult:
        r = IngestResult(accepted=False)
        parsed = parse_topic(topic)
        if not parsed:
            return self._reject(r, "malformed", f"bad topic {topic!r}")
        r.station_id, r.device_id, r.kind = parsed
        r.source = "sim" if is_sim_device(r.device_id) else "device"
        if r.kind == "cmd":
            return self._reject(r, "malformed", "cmd topics are outbound only")
        station = self.stations.get(r.station_id)
        if not station:
            return self._reject(r, "unknown_station", r.station_id)

        try:
            body = payload if isinstance(payload, dict) else json.loads(payload)
            if not isinstance(body, dict):
                raise ValueError("payload is not an object")
            if r.kind == "status":
                r.message = Status.model_validate(body)
            elif r.kind == "telemetry":
                r.message = Telemetry.model_validate(body)
            else:
                model = EVENT_MODELS.get(str(body.get("type")))
                if not model:
                    raise ValueError(f"unknown event type {body.get('type')!r}")
                r.message = model.model_validate(body)
        except (ValueError, ValidationError) as exc:
            return self._reject(r, "malformed", str(exc)[:300])

        dev_key = f"{r.station_id}/{r.device_id}"
        if r.kind == "status":
            if isinstance(r.message, Status) and r.message.state == "online":
                self.last_seq.pop(dev_key, None)  # a reboot restarts the sequence
            self.accepted += 1
            r.accepted = True
            return r

        seq = r.message.seq  # type: ignore[attr-defined]
        last = self.last_seq.get(dev_key)
        if last is not None and seq == last:
            return self._reject(r, "duplicate", f"seq {seq}")
        if last is not None and seq < last:
            return self._reject(r, "seq_backwards", f"seq {seq} after {last}")

        if r.kind == "event":
            sensor = station.sensors.get(r.message.sensor_id)  # type: ignore[attr-defined]
            if not sensor or (r.source == "device" and sensor.device_id != r.device_id):
                return self._reject(r, "unknown_sensor", r.message.sensor_id)  # type: ignore[attr-defined]
            if sensor.kind != r.message.type:  # type: ignore[attr-defined]
                return self._reject(r, "malformed", f"sensor {sensor.sensor_id} is {sensor.kind}")
            if isinstance(r.message, CrossingEvent):
                window = self.recent.setdefault(f"{r.station_id}/{sensor.sensor_id}", deque())
                while window and window[0][0] < received_ms - 1000:
                    window.popleft()
                total = sum(c for _, c in window) + r.message.count
                if total > self.settings.ingest.max_crossings_per_s:
                    self.last_seq[dev_key] = seq
                    return self._reject(r, "rate", f"{total} crossings in one second")
                window.append((received_ms, r.message.count))
        elif r.kind == "telemetry":
            for reading in r.message.readings:  # type: ignore[attr-defined]
                lo_hi = self.settings.ingest.ranges.get(reading.type)
                if lo_hi and not lo_hi[0] <= reading.value <= lo_hi[1]:
                    self.last_seq[dev_key] = seq
                    return self._reject(r, "out_of_range", f"{reading.type}={reading.value}")

        self.last_seq[dev_key] = seq
        self.accepted += 1
        r.accepted = True
        return r
