"""WebSocket fan-out to browsers (IOT-07, NFR-05).

Each client has its own queue so a slow phone cannot hold up the engine. Messages carry an
audience so passengers never receive operator-only data (section 11.3.5).
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from fastapi import WebSocket

from aera_twin.store import User

log = logging.getLogger(__name__)
Audience = Literal["all", "staff", "admin"]


@dataclass(eq=False)
class Client:
    ws: WebSocket
    user: User | None
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=2000))

    def sees(self, audience: Audience, station_id: str | None) -> bool:
        if audience == "all":
            return True
        if not self.user:
            return False
        if self.user.role == "admin":
            return True
        if audience == "admin":
            return False
        return station_id is None or self.user.station_id == station_id


class Hub:
    def __init__(self) -> None:
        self.clients: set[Client] = set()

    def broadcast(
        self, msg: dict, audience: Audience = "all", station_id: str | None = None,
        public: Callable[[], dict | None] | None = None,
    ) -> None:
        """Queue ``msg`` for every client allowed to see it. ``public`` builds the passenger variant."""
        staff_text = json.dumps(msg, default=str)
        public_text: str | None = None
        public_done = False
        for c in list(self.clients):
            if c.sees(audience, station_id):
                text = staff_text
            elif public is not None:
                if not public_done:
                    variant = public()
                    public_text = json.dumps(variant, default=str) if variant else None
                    public_done = True
                text = public_text
            else:
                continue
            if text is None:
                continue
            try:
                c.queue.put_nowait(text)
            except asyncio.QueueFull:
                log.warning("dropping slow realtime client")
                self.clients.discard(c)

    async def serve(self, client: Client, first: dict[str, Any]) -> None:
        self.clients.add(client)
        await client.ws.send_text(json.dumps(first, default=str))

        async def writer() -> None:
            while True:
                await client.ws.send_text(await client.queue.get())

        task = asyncio.create_task(writer())
        try:
            while True:  # read pings so disconnects are noticed promptly
                text = await client.ws.receive_text()
                if text == "ping":
                    client.queue.put_nowait(json.dumps({"type": "pong"}))
        except Exception:
            pass
        finally:
            task.cancel()
            self.clients.discard(client)
