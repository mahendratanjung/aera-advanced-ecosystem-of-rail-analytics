"""Simulated devices for a twin station (IOT-02, section 9.8).

The simulator is a first-class publisher. It sends the same crossing and telemetry payloads
as the ESP32 on the scale model, on the same topics, from a device whose id starts with
``sim-``. It never writes zone state directly.
"""

from __future__ import annotations

import math
import random
from datetime import datetime, timezone

from aera_twin.engine.occupancy import OccupancyEngine
from aera_twin.station import StationModel
from aera_twin.timetable import demand, local_hour

PEAK_ENTRIES_PER_MIN = 45
MAX_DT_S = 10.0
# Mean seconds a passenger spends in each zone before moving on.
DWELL_IN = {"entrance": 12.0, "ticketing": 25.0, "concourse": 40.0}
DWELL_OUT = {"platform": 20.0, "concourse": 25.0, "ticketing": 15.0, "entrance": 10.0}


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def binomial(rng: random.Random, n: int, p: float) -> int:
    if n <= 0 or p <= 0:
        return 0
    if p >= 1:
        return n
    return rng.binomialvariate(n, p)


class StationSimulator:
    def __init__(self, station: StationModel, seed: int):
        self.station = station
        self.device_id = f"sim-{station.id}"
        self.rng = random.Random(f"{seed}:{station.id}")
        self.seq = 0
        self.exiting: dict[str, int] = {z: 0 for z in station.zones}
        self.last_telemetry_ms = 0
        self.started_ms = 0
        self._path_in = self._inbound_path()

    def topic(self, kind: str) -> str:
        return f"aera/v1/{self.station.id}/{self.device_id}/{kind}"

    def _next_seq(self) -> int:
        self.seq += 1
        return self.seq

    def _inbound_path(self) -> list[str]:
        """Links from outside towards the platforms, in order, following the zone graph."""
        links = self.station.d.links
        path, here = [], "outside"
        while True:
            nxt = [lk for lk in links if lk.from_ == here and self.station.zones.get(lk.to) is not None
                   and self.station.zones[lk.to].type != "platform"]
            if not nxt:
                return path
            path.append(nxt[0].id)
            here = nxt[0].to

    def status(self, now_ms: int) -> tuple[str, dict]:
        self.started_ms = now_ms
        return self.topic("status"), {"v": 1, "state": "online", "fw": "sim-1.0", "ts": iso(now_ms)}

    def on_alighting(self, platform_id: str, n: int) -> None:
        self.exiting[platform_id] = self.exiting.get(platform_id, 0) + n

    def reset(self) -> None:
        self.exiting = {z: 0 for z in self.station.zones}

    def _crossing(self, sensor_id: str, direction: str, count: int, now_ms: int) -> list[tuple[str, dict]]:
        out = []
        while count > 0:
            n = min(count, 50)
            out.append((self.topic("event"), {
                "v": 1, "seq": self._next_seq(), "ts": iso(now_ms), "sensor_id": sensor_id,
                "type": "crossing", "direction": direction, "count": n,
            }))
            count -= n
        return out

    def tick(
        self, engine: OccupancyEngine, now_ms: int, sim_ms: int, real_dt_s: float, speed: float,
        demand_mult: float, covered_sensors: set[str],
    ) -> list[tuple[str, dict]]:
        """Return messages to publish. Only sensors in ``covered_sensors`` are simulated."""
        msgs: list[tuple[str, dict]] = []
        dt = min(MAX_DT_S, real_dt_s * speed)
        hour = local_hour(sim_ms / 1000)
        zones, links = engine.zones, engine.links
        sensor_of = {s.link: s.sensor_id for s in self.station.d.sensors if s.kind == "crossing"}

        def usable(link_id: str) -> bool:
            lk = links[link_id]
            ok_zone = all(z == "outside" or zones[z].available for z in (lk.from_zone, lk.to_zone))
            return lk.available and ok_zone and sensor_of.get(link_id) in covered_sensors

        def move(link_id: str, direction: str, n: int) -> None:
            if n > 0:
                msgs.extend(self._crossing(sensor_of[link_id], direction, n, now_ms))

        # Inbound: arrivals at the street, then onwards through each zone.
        for i, link_id in enumerate(self._path_in):
            if not usable(link_id):
                continue
            if i == 0:
                lam = PEAK_ENTRIES_PER_MIN * demand(hour) * demand_mult * dt / 60
                move(link_id, "in", poisson(self.rng, lam))
            else:
                src = links[link_id].from_zone
                pool = max(0, zones[src].count - self.exiting.get(src, 0))
                move(link_id, "in", binomial(self.rng, pool, 1 - math.exp(-dt / DWELL_IN.get(zones[src].type, 30))))

        # Concourse to platforms, split by direction of travel.
        last = links[self._path_in[-1]].to_zone if self._path_in else None
        platform_links = [lk for lk in self.station.d.links
                          if lk.from_ == last and self.station.zones[lk.to].type == "platform" and usable(lk.id)]
        if last and platform_links:
            pool = max(0, zones[last].count - self.exiting.get(last, 0))
            leaving = binomial(self.rng, pool, 1 - math.exp(-dt / DWELL_IN.get(zones[last].type, 40)))
            to_city = 0.72 if hour < 12 else 0.38  # direction 0 runs towards the city centre
            shares = []
            for lk in platform_links:
                d = self.station.zones[lk.to].direction_id
                shares.append(to_city if d == 0 else 1 - to_city)
            total = sum(shares) or 1
            remaining = leaving
            for lk, share in zip(platform_links, shares):
                n = remaining if lk is platform_links[-1] else binomial(self.rng, leaving, share / total)
                n = min(n, remaining)
                move(lk.id, "in", n)
                remaining -= n

        # Outbound: alighting passengers walk back out the way they came.
        for lk in reversed(self.station.d.links):
            if lk.to == "outside" or not usable(lk.id):
                continue
            src = lk.to
            pool = min(self.exiting.get(src, 0), zones[src].count)
            if pool <= 0:
                self.exiting[src] = 0
                continue
            n = binomial(self.rng, pool, 1 - math.exp(-dt / DWELL_OUT.get(zones[src].type, 20)))
            if n:
                move(lk.id, "out", n)
                self.exiting[src] -= n
                if lk.from_ != "outside":
                    self.exiting[lk.from_] = self.exiting.get(lk.from_, 0) + n

        # Telemetry with station conditions every ten seconds (IOT-09).
        if now_ms - self.last_telemetry_ms >= 10_000:
            self.last_telemetry_ms = now_ms
            readings = []
            for s in self.station.d.sensors:
                if s.kind == "environment":
                    heat = 26.5 + 4.0 * math.sin(math.pi * max(0.0, min(1.0, (hour - 7) / 12)))
                    readings += [
                        {"sensor_id": s.sensor_id, "type": "temperature_c",
                         "value": round(heat + self.rng.uniform(-0.3, 0.3), 1)},
                        {"sensor_id": s.sensor_id, "type": "humidity_pct",
                         "value": round(72 - (heat - 26.5) * 2 + self.rng.uniform(-1, 1), 1)},
                    ]
            msgs.append((self.topic("telemetry"), {
                "v": 1, "seq": self._next_seq(), "ts": iso(now_ms), "readings": readings,
                "rssi": -48, "uptime_s": int((now_ms - self.started_ms) / 1000),
            }))
        return msgs
