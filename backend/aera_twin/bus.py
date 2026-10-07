"""Message transport (section 9.3).

``InProcessBus`` lets the whole system run with no broker. ``MqttBus`` connects to a managed
broker over TLS, or over WebSockets on port 443 when the venue blocks MQTT ports. Hardware
and the simulator use the same topics in both cases.
"""

from __future__ import annotations

import asyncio
import json
import logging
import ssl
from collections import deque
from typing import Awaitable, Callable
from urllib.parse import urlparse

log = logging.getLogger(__name__)

Handler = Callable[[str, bytes], Awaitable[None]]
INBOUND = ("aera/v1/+/+/event", "aera/v1/+/+/telemetry", "aera/v1/+/+/status")


class InProcessBus:
    name = "in-process"

    def __init__(self) -> None:
        self.handler: Handler | None = None
        self.outbound: deque[tuple[str, dict]] = deque(maxlen=100)
        self.connected = True

    async def start(self, handler: Handler) -> None:
        self.handler = handler

    async def publish(self, topic: str, payload: dict, retain: bool = False) -> None:
        if topic.endswith("/cmd"):
            self.outbound.append((topic, payload))
            return
        if self.handler:
            await self.handler(topic, json.dumps(payload).encode())

    async def stop(self) -> None:
        self.handler = None


class MqttBus:
    name = "mqtt"

    def __init__(self, url: str, client_id: str = "aera-twin-service") -> None:
        self.url = urlparse(url)
        self.client_id = client_id
        self.handler: Handler | None = None
        self.client = None
        self.connected = False
        self.outbound: deque[tuple[str, dict]] = deque(maxlen=100)
        self._task: asyncio.Task | None = None

    def _client(self):
        import aiomqtt

        u = self.url
        secure = u.scheme in ("mqtts", "wss")
        websockets = u.scheme in ("ws", "wss")
        port = u.port or (443 if u.scheme == "wss" else 80 if u.scheme == "ws" else 8883 if secure else 1883)
        return aiomqtt.Client(
            hostname=u.hostname or "localhost",
            port=port,
            username=u.username,
            password=u.password,
            identifier=self.client_id,
            transport="websockets" if websockets else "tcp",
            websocket_path=(u.path or "/mqtt") if websockets else None,
            tls_context=ssl.create_default_context() if secure else None,
        )

    async def _run(self) -> None:
        import aiomqtt

        while True:
            try:
                async with self._client() as client:
                    self.client = client
                    self.connected = True
                    log.info("connected to MQTT broker %s", self.url.hostname)
                    for t in INBOUND:
                        await client.subscribe(t, qos=1)
                    async for msg in client.messages:
                        if self.handler:
                            payload = msg.payload if isinstance(msg.payload, bytes) else str(msg.payload).encode()
                            await self.handler(str(msg.topic), payload)
            except aiomqtt.MqttError as exc:
                log.warning("MQTT connection lost (%s), retrying in 3 s", exc)
            finally:
                self.client = None
                self.connected = False
            await asyncio.sleep(3)

    async def start(self, handler: Handler) -> None:
        self.handler = handler
        self._task = asyncio.create_task(self._run())

    async def publish(self, topic: str, payload: dict, retain: bool = False) -> None:
        if topic.endswith("/cmd"):
            self.outbound.append((topic, payload))
        if self.client is None:
            return
        try:
            await self.client.publish(topic, json.dumps(payload), qos=1, retain=retain)
        except Exception as exc:  # never let a publish failure stop the tick loop
            log.warning("publish to %s failed: %s", topic, exc)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()


def make_bus(url: str):
    return MqttBus(url) if url else InProcessBus()
