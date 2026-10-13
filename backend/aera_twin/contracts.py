"""Payload and station definition contracts (BRS sections 8.3 and 9.5).

These models are the source of truth for validation in the service. The JSON schemas in
``packages/contracts`` are exported from them so firmware tests can use the same rules:

    uv run python -m aera_twin.contracts
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from aera_twin.paths import CONTRACTS_DIR

SCHEMA_VERSION = 1
Level = Literal["low", "moderate", "busy", "crowded"]
Direction = Literal["in", "out"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---- MQTT payloads (section 9.5) -------------------------------------------------------


class CrossingEvent(_Strict):
    """Published on aera/v1/{station}/{device}/event the moment a crossing happens."""

    v: Literal[1]
    seq: int = Field(ge=0)
    ts: datetime
    sensor_id: str = Field(min_length=1, max_length=64)
    type: Literal["crossing"]
    direction: Direction
    count: int = Field(ge=1, le=50)


class SwitchEvent(_Strict):
    """Facility status from a toggle or reed switch. ``state`` true means in service."""

    v: Literal[1]
    seq: int = Field(ge=0)
    ts: datetime
    sensor_id: str = Field(min_length=1, max_length=64)
    type: Literal["switch"]
    state: bool


class TrainEvent(_Strict):
    """A model train detected at a platform sensor."""

    v: Literal[1]
    seq: int = Field(ge=0)
    ts: datetime
    sensor_id: str = Field(min_length=1, max_length=64)
    type: Literal["train"]
    present: bool


class CarCount(_Strict):
    """How full one car is, from an in-train sensor. Published on aera/v1/train/{device}/count.

    ``method`` says what measured it: an on-board camera counting people, door beam counters
    (boardings minus alightings) or the suspension's load-weigh signal. Send ``count``
    (people) or ``load_pct`` (percent of the car's capacity), not both. Name the train with
    ``trip_id`` when the device knows it, otherwise with the station it last stopped at and
    its direction; the service matches that to the train in the timetable.
    """

    v: Literal[1]
    seq: int = Field(ge=0)
    ts: datetime
    method: Literal["camera", "door_counter", "load_weigh"]
    car: int = Field(ge=1, le=4)
    count: int | None = Field(default=None, ge=0, le=600)
    load_pct: float | None = Field(default=None, ge=0, le=250)
    confidence: float | None = Field(default=None, ge=0, le=1)
    trip_id: str | None = Field(default=None, min_length=1, max_length=64)
    station_id: str | None = Field(default=None, min_length=1, max_length=16)
    direction_id: Literal[0, 1] | None = None

    @model_validator(mode="after")
    def _one_measure_and_a_train(self) -> CarCount:
        if (self.count is None) == (self.load_pct is None):
            raise ValueError("send exactly one of count or load_pct")
        if self.trip_id is None and (self.station_id is None or self.direction_id is None):
            raise ValueError("name the train with trip_id, or with station_id and direction_id")
        return self


class Reading(_Strict):
    sensor_id: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=32)
    value: float


class Telemetry(_Strict):
    """Published every ten seconds on aera/v1/{station}/{device}/telemetry."""

    v: Literal[1]
    seq: int = Field(ge=0)
    ts: datetime
    readings: list[Reading] = Field(default_factory=list, max_length=32)
    rssi: int | None = Field(default=None, ge=-120, le=0)
    uptime_s: int | None = Field(default=None, ge=0)


class Status(_Strict):
    """Retained on aera/v1/{station}/{device}/status. The last will publishes state offline."""

    v: Literal[1]
    state: Literal["online", "offline"]
    fw: str | None = Field(default=None, max_length=32)
    ts: datetime | None = None


class LedCommand(_Strict):
    zone: str
    level: Level | Literal["nodata", "off"]


class DisplayCommand(_Strict):
    line1: str = Field(max_length=21)
    line2: str = Field(max_length=21)


class Command(_Strict):
    """Published by the twin on aera/v1/{station}/{device}/cmd."""

    v: Literal[1]
    ts: datetime
    leds: list[LedCommand] = Field(default_factory=list)
    display: DisplayCommand | None = None


# ---- Station definition (section 8.3) ---------------------------------------------------


class LevelDef(_Strict):
    id: str
    name: str
    elevation: float


ZoneType = Literal["entrance", "ticketing", "faregate", "concourse", "circulation", "platform"]
LinkType = Literal["entrance", "faregate", "stairs", "escalator", "lift", "walkway"]


class ZoneDef(_Strict):
    id: str
    name: str
    level: str
    type: ZoneType
    polygon: list[tuple[float, float]] = Field(min_length=3)
    capacity: int = Field(gt=0)
    direction_id: int | None = None
    public: bool = True


class LinkDef(_Strict):
    id: str
    name: str | None = None
    type: LinkType
    from_: str = Field(alias="from")
    to: str
    position: tuple[float, float]
    level: str | None = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class SensorDef(_Strict):
    device_id: str
    sensor_id: str
    kind: Literal["crossing", "environment", "switch", "train"]
    link: str | None = None
    zone: str | None = None

    @model_validator(mode="after")
    def _target(self) -> SensorDef:
        if self.kind == "crossing" and not self.link:
            raise ValueError("crossing sensors need a link")
        if self.kind in ("environment", "train") and not self.zone:
            raise ValueError(f"{self.kind} sensors need a zone")
        if self.kind == "switch" and not (self.link or self.zone):
            raise ValueError("switch sensors need a link or zone")
        return self


class TrackDef(_Strict):
    direction_id: int
    y: float
    level: str
    x_from: float
    x_to: float


class StationDefinition(_Strict):
    id: str
    name: str
    line_id: str
    stop_id: str
    orientation_deg: float = 0
    levels: list[LevelDef] = Field(min_length=1)
    zones: list[ZoneDef] = Field(min_length=1)
    links: list[LinkDef] = Field(default_factory=list)
    sensors: list[SensorDef] = Field(default_factory=list)
    tracks: list[TrackDef] = Field(default_factory=list)

    @field_validator("zones")
    @classmethod
    def _unique_zones(cls, zones: list[ZoneDef]) -> list[ZoneDef]:
        ids = [z.id for z in zones]
        if len(ids) != len(set(ids)) or "outside" in ids:
            raise ValueError("zone ids must be unique and must not be 'outside'")
        return zones

    @model_validator(mode="after")
    def _references(self) -> StationDefinition:
        levels = {lv.id for lv in self.levels}
        zones = {z.id for z in self.zones} | {"outside"}
        links = {lk.id for lk in self.links}
        for z in self.zones:
            if z.level not in levels:
                raise ValueError(f"zone {z.id} uses unknown level {z.level}")
        for lk in self.links:
            if lk.from_ not in zones or lk.to not in zones:
                raise ValueError(f"link {lk.id} references an unknown zone")
        seen = set()
        for s in self.sensors:
            if s.sensor_id in seen:
                raise ValueError(f"duplicate sensor_id {s.sensor_id}")
            seen.add(s.sensor_id)
            if s.link and s.link not in links:
                raise ValueError(f"sensor {s.sensor_id} references unknown link {s.link}")
            if s.zone and s.zone not in zones:
                raise ValueError(f"sensor {s.sensor_id} references unknown zone {s.zone}")
        return self


EXPORTS: dict[str, type[BaseModel]] = {
    "crossing-event": CrossingEvent,
    "switch-event": SwitchEvent,
    "train-event": TrainEvent,
    "car-count": CarCount,
    "telemetry": Telemetry,
    "status": Status,
    "command": Command,
    "station-definition": StationDefinition,
}


def export_schemas() -> list[str]:
    CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for name, model in EXPORTS.items():
        schema = model.model_json_schema(by_alias=True)
        schema["$id"] = f"https://aera.dev/contracts/v{SCHEMA_VERSION}/{name}.schema.json"
        path = CONTRACTS_DIR / f"{name}.schema.json"
        path.write_text(json.dumps(schema, indent=2) + "\n")
        written.append(path.name)
    return written


if __name__ == "__main__":
    for name in export_schemas():
        print(f"wrote packages/contracts/{name}")
