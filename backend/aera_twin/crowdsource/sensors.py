"""Crowding from in-train sensors: cameras, door counters and load-weigh (IoT).

Each ``CarCount`` becomes one observation per device and car. Sensors are far more precise
than rider reports, so in ``fusion`` they outweigh them. A car's load stands in for the whole
train's; with sensors in every car the cars average out to the train.
"""

from __future__ import annotations

from aera_twin.contracts import CarCount
from aera_twin.crowdsource.fusion import SOURCE_SD, Observation
from aera_twin.timetable import Line, TrainState

CARS = 4


def find_train(msg: CarCount, line: Line, trains: list[TrainState]) -> TrainState | None:
    """The train a sensor is on: by trip id, or the train at or just past the station it named."""
    if msg.trip_id:
        return next((t for t in trains if t.trip_id == msg.trip_id), None)
    idx = line.stop_index.get(msg.direction_id, {}).get(msg.station_id or "")
    if idx is None:
        return None
    here = [t for t in trains if t.direction_id == msg.direction_id and t.stop_index == idx]
    return here[0] if len(here) == 1 else None  # two trains match only if the timetable is off: skip


def car_observation(msg: CarCount, device_id: str, train: TrainState, capacity: int, sim_ms: int) -> Observation:
    car_capacity = capacity / CARS
    pct = msg.load_pct if msg.load_pct is not None else (msg.count or 0) / car_capacity * 100
    sd = SOURCE_SD[msg.method] / max(0.3, msg.confidence if msg.confidence is not None else 1.0)
    return Observation(trip_id=train.trip_id, key=f"s:{device_id}:{msg.car}", source=msg.method, pct=pct, sd=sd,
                       stop_index=train.stop_index, at_ms=sim_ms)
