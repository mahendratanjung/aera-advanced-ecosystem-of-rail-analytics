"""Watch the GTFS Realtime vehicle feed for the line.

As of October 2026 data.gov.my publishes live vehicle positions for KTMB and Rapid KL buses
but not for Rapid Rail: the API answers 404 "Vehicle Position feed for prasarana
(rapid-rail-kl) does not exist". So the twin runs on the published timetable, and this
watcher reports the feed as unavailable, checking again every 15 minutes. Once the feed
appears, each vehicle is snapped to the track and compared with the nearest timetabled train,
which shows how far the real service is running from the timetable.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Literal

import httpx
from google.protobuf.message import DecodeError
from google.transit import gtfs_realtime_pb2

from aera_twin.geo import LineProjector
from aera_twin.simclock import wall_ms
from aera_twin.timetable import Line, TrainState

log = logging.getLogger(__name__)
FeedState = Literal["checking", "unavailable", "live", "error"]
LIVE_EVERY_S = 20
MISSING_EVERY_S = 15 * 60
ERROR_EVERY_S = 2 * 60
OFF_LINE_M = 100.0


@dataclass
class LiveVehicle:
    vehicle_id: str
    trip_id: str | None
    direction_id: int | None
    lat: float
    lon: float
    timestamp: int | None
    distance_m: float
    # Nearest timetabled train in the same direction and how far behind it this vehicle runs
    # (positive: later than the timetable).
    nearest_trip_id: str | None = None
    behind_s: float | None = None


@dataclass
class FeedStatus:
    url: str
    state: FeedState = "checking"
    detail: str = ""
    checked_ms: int | None = None
    last_live_ms: int | None = None
    vehicles: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def decode(data: bytes) -> list[gtfs_realtime_pb2.FeedEntity]:
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(data)
    return [e for e in feed.entity if e.HasField("vehicle") and e.vehicle.HasField("position")]


def match(entities: list, line: Line, projector: LineProjector, trains: list[TrainState]) -> list[LiveVehicle]:
    speed = {d: (projector.length_m / dur if dur else 10.0) for d, dur in line.duration.items()}
    out: list[LiveVehicle] = []
    for e in entities:
        v = e.vehicle
        route = v.trip.route_id if v.HasField("trip") else ""
        if route and route != line.id:
            continue
        lat, lon = v.position.latitude, v.position.longitude
        snap = projector.snap(lat, lon)
        if snap.offset_m > OFF_LINE_M:
            continue
        direction = v.trip.direction_id if v.HasField("trip") and v.trip.HasField("direction_id") else None
        lv = LiveVehicle(
            vehicle_id=v.vehicle.id or e.id, trip_id=(v.trip.trip_id or None) if v.HasField("trip") else None,
            direction_id=direction, lat=lat, lon=lon, timestamp=v.timestamp or None, distance_m=round(snap.distance_m),
        )
        same = [t for t in trains if direction is None or t.direction_id == direction]
        nearest = min(same, key=lambda t: abs(t.distance_m - snap.distance_m), default=None)
        if nearest is not None:
            sign = 1 if nearest.direction_id == 1 else -1  # direction 1 runs towards larger distances
            lv.nearest_trip_id = nearest.trip_id
            lv.behind_s = round(sign * (nearest.distance_m - snap.distance_m) / speed[nearest.direction_id])
        out.append(lv)
    return out


class FeedWatcher:
    def __init__(self, url: str, line: Line, projector: LineProjector,
                 trains: Callable[[], list[TrainState]], on_change: Callable[[FeedStatus], None] | None = None,
                 transport: httpx.AsyncBaseTransport | None = None):
        self.status = FeedStatus(url=url)
        self.line = line
        self.projector = projector
        self.trains = trains
        self.on_change = on_change
        self.transport = transport
        self.vehicles: list[LiveVehicle] = []
        self._task: asyncio.Task | None = None

    async def poll_once(self) -> FeedStatus:
        before = (self.status.state, self.status.vehicles)
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True, transport=self.transport) as client:
                resp = await client.get(self.status.url, headers={"User-Agent": "AERA twin (UTP student project)"})
            if resp.status_code == 404:
                self.vehicles = []
                self.status.state = "unavailable"
                self.status.detail = _detail(resp) or "The operator does not publish live positions for this line."
            elif resp.status_code == 200:
                self.vehicles = match(decode(resp.content), self.line, self.projector, self.trains())
                self.status.state = "live"
                self.status.detail = f"{len(self.vehicles)} trains on the line"
                self.status.last_live_ms = wall_ms()
            else:
                self.status.state = "error"
                self.status.detail = f"HTTP {resp.status_code}"
        except (httpx.HTTPError, DecodeError) as exc:
            self.status.state = "error"
            self.status.detail = type(exc).__name__
        self.status.vehicles = len(self.vehicles)
        self.status.checked_ms = wall_ms()
        if self.on_change and before != (self.status.state, self.status.vehicles):
            self.on_change(self.status)
        return self.status

    async def _run(self) -> None:
        while True:
            try:
                await self.poll_once()
            except Exception:  # keep watching whatever one response looked like
                log.exception("GTFS Realtime poll failed")
                self.status.state = "error"
            wait = {"live": LIVE_EVERY_S, "unavailable": MISSING_EVERY_S}.get(self.status.state, ERROR_EVERY_S)
            await asyncio.sleep(wait)

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task


def _detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return ""
    details = body.get("details") if isinstance(body, dict) else None
    return str(details[0])[:200] if isinstance(details, list) and details else ""
