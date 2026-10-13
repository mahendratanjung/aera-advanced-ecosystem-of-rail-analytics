"""Station definitions loaded from ``data/stations`` (TWN-01, section 8.3).

The same file drives the 3D scene, the 2D plan, the zone graph used by the occupancy engine
and the device registry, so geometry and logic cannot drift apart.
"""

from __future__ import annotations

import json
from functools import cached_property
from pathlib import Path

from aera_twin.contracts import LinkDef, SensorDef, StationDefinition, ZoneDef
from aera_twin.paths import STATIONS_DIR


class StationModel:
    def __init__(self, definition: StationDefinition, raw: dict):
        self.d = definition
        self.raw = raw
        self.id = definition.id

    @classmethod
    def from_file(cls, path: Path) -> StationModel:
        raw = json.loads(path.read_text())
        return cls(StationDefinition.model_validate(raw), raw)

    @cached_property
    def zones(self) -> dict[str, ZoneDef]:
        return {z.id: z for z in self.d.zones}

    @cached_property
    def links(self) -> dict[str, LinkDef]:
        return {lk.id: lk for lk in self.d.links}

    @cached_property
    def sensors(self) -> dict[str, SensorDef]:
        return {s.sensor_id: s for s in self.d.sensors}

    @cached_property
    def devices(self) -> dict[str, list[SensorDef]]:
        out: dict[str, list[SensorDef]] = {}
        for s in self.d.sensors:
            out.setdefault(s.device_id, []).append(s)
        return out

    def zones_for_sensor(self, sensor: SensorDef) -> set[str]:
        if sensor.link:
            lk = self.links[sensor.link]
            return {z for z in (lk.from_, lk.to) if z != "outside"}
        return {sensor.zone} if sensor.zone and sensor.zone != "outside" else set()

    def zones_for_device(self, device_id: str) -> set[str]:
        """Zones whose state depends on a device (section 9.7)."""
        out: set[str] = set()
        for s in self.devices.get(device_id, []):
            if s.kind == "crossing":
                out |= self.zones_for_sensor(s)
        return out

    def crossing_links(self) -> list[LinkDef]:
        counted = {s.link for s in self.d.sensors if s.kind == "crossing"}
        return [lk for lk in self.d.links if lk.id in counted]

    def platform_for_direction(self, direction_id: int) -> ZoneDef | None:
        return next(
            (z for z in self.d.zones if z.type == "platform" and z.direction_id == direction_id), None
        )


def load_stations(directory: Path = STATIONS_DIR) -> dict[str, StationModel]:
    out = {}
    for path in sorted(directory.glob("*.json")):
        st = StationModel.from_file(path)
        out[st.id] = st
    return out
