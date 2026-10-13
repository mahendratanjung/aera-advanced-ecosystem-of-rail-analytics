"""Ask AERA: a thin proxy to a free model on OpenRouter (ASK-01 to ASK-04).

The crowding engine and the route advisor run in the browser, so the tools run there too.
This service only holds the API key (NFR-08), fixes the system prompt and the tool list so a
client cannot change them, caps what is sent, and rate-limits each address. Every fact the
model gives must come from a tool result the browser worked out.

OpenRouter speaks the OpenAI chat-completions format. Free models have daily caps; when the
key is missing or the cap is reached the browser falls back to the advisor's own cards.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
PER_MINUTE = 10
PER_DAY = 150
MAX_MESSAGES = 30
MAX_CHARS = 6000

SYSTEM_PROMPT = """You are AERA, a friendly assistant for riders of the LRT Kelana Jaya Line in Kuala Lumpur.
AERA is a digital twin: train positions follow the timetable and crowding is a prediction from recent
gate data, not a live count. Say so when it matters.

Rules:
- Use the tools for every fact about trains, times, crowding, disruptions and routes. Never invent
  times, stations, lines or crowding. If a tool cannot answer, say what you do not know.
- Crowding words are exactly: Quiet, Comfortable, Busy, Crowded, Packed. Write in English only.
- When a train fails or a section is suspended, call service_status, then other_ways, and give the
  rider two or three clear choices: wait, go round on other lines, or bus/e-hailing across the gap.
  Lead with the fastest. Mention that times on other lines, walks and roads are estimates.
- Keep answers short: two to five sentences or a short list. Times as 24-hour HH:MM.
- The app shows the options from your tool calls as cards under your answer, so do not repeat every
  leg; summarise.
- You cannot buy tickets, control trains or see live CCTV. You do not know fares.
- If the rider is an operator or admin, you may give line-wide figures (busiest stretch, trains over
  capacity, disruption impact) from line_overview.
- For how busy any other line is (MRT, Ampang, Sri Petaling, Monorail, Shah Alam, KTM Komuter), call
  other_lines. Those figures are what trains usually carry at this hour, not live; say "usually".
"""

TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": {
        "name": "service_status",
        "description": "Current simulated time, active disruptions on the Kelana Jaya Line, and the busiest stretch now.",
        "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {
        "name": "find_station",
        "description": "Look up a Rapid Rail station by name or code (e.g. 'kl sentral', 'KJ15', 'klcc').",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "next_trains",
        "description": "Next Kelana Jaya Line trains at a station in both directions, with predicted crowding and the best car.",
        "parameters": {"type": "object", "properties": {"station": {"type": "string", "description": "Name or code"}},
                       "required": ["station"]}}},
    {"type": "function", "function": {
        "name": "plan_ride",
        "description": "Trains on the Kelana Jaya Line between two stations in the next hour, with crowding and the calmest one.",
        "parameters": {"type": "object", "properties": {
            "from": {"type": "string"}, "to": {"type": "string"},
            "leave_at": {"type": "string", "description": "Optional HH:MM, Kuala Lumpur time"}},
            "required": ["from", "to"]}}},
    {"type": "function", "function": {
        "name": "other_ways",
        "description": "Ways to get between two stations when the line is disrupted: wait, go round on other Rapid Rail lines, or bus/e-hailing across the gap. Also plans rides to stations on other lines.",
        "parameters": {"type": "object", "properties": {"from": {"type": "string"}, "to": {"type": "string"}},
                       "required": ["from", "to"]}}},
    {"type": "function", "function": {
        "name": "best_time",
        "description": "Typical crowding by hour for a ride on a given weekday, and the calmer hours to travel.",
        "parameters": {"type": "object", "properties": {
            "from": {"type": "string"}, "to": {"type": "string"},
            "day": {"type": "string", "description": "Optional weekday name, default today"}},
            "required": ["from", "to"]}}},
    {"type": "function", "function": {
        "name": "line_overview",
        "description": "Line-wide figures for operators: trains running, trains over capacity, the busiest stretches now.",
        "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {
        "name": "other_lines",
        "description": "How full trains on the other Klang Valley rail lines usually are at this hour (typical week, from gate data): every line, or one line by name or code (e.g. 'MRT Kajang', 'KG', 'monorail').",
        "parameters": {"type": "object", "properties": {"line": {"type": "string", "description": "Optional line name or code"}},
                       "required": []}}},
]


class ToolCall(BaseModel):
    id: str = Field(max_length=200)
    type: Literal["function"] = "function"
    function: dict[str, Any]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "tool"]
    content: str | None = Field(default=None, max_length=MAX_CHARS)
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = Field(default=None, max_length=200)


class AskContext(BaseModel):
    role: Literal["rider", "operator", "admin"] = "rider"
    sim_time: str | None = Field(default=None, max_length=40)
    my_station: str | None = Field(default=None, max_length=80)


class AskBody(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    context: AskContext = Field(default_factory=AskContext)


class AssistantError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class RateLimiter:
    def __init__(self, per_minute: int = PER_MINUTE, per_day: int = PER_DAY):
        self.per_minute = per_minute
        self.per_day = per_day
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        q = self.hits[key]
        while q and q[0] < now - 86400:
            q.popleft()
        if len(q) >= self.per_day or sum(1 for x in q if x >= now - 60) >= self.per_minute:
            raise AssistantError(429, "rate_limited", "Too many questions for now. Try again in a minute.")
        q.append(now)


class Assistant:
    def __init__(self, api_key: str, model: str, transport: httpx.AsyncBaseTransport | None = None):
        self.api_key = api_key.strip()
        self.model = model.strip() or "openrouter/free"
        self.transport = transport
        self.limiter = RateLimiter()

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def _messages(self, body: AskBody) -> list[dict[str, Any]]:
        ctx = body.context
        facts = [f"The person asking is a {ctx.role}."]
        if ctx.sim_time:
            facts.append(f"Simulated time now: {ctx.sim_time} (Kuala Lumpur).")
        if ctx.my_station:
            facts.append(f"Their saved station is {ctx.my_station}.")
        out: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT + "\n" + " ".join(facts)}]
        for m in body.messages:
            msg: dict[str, Any] = {"role": m.role, "content": m.content or ""}
            if m.tool_calls:
                msg["tool_calls"] = [tc.model_dump() for tc in m.tool_calls]
            if m.tool_call_id:
                msg["tool_call_id"] = m.tool_call_id
            out.append(msg)
        return out

    async def ask(self, body: AskBody, client_key: str) -> dict[str, Any]:
        if not self.enabled:
            raise AssistantError(503, "no_key", "The assistant is not set up on this server.")
        self.limiter.check(client_key)
        payload = {
            "model": self.model,
            "messages": self._messages(body),
            "tools": TOOLS,
            "tool_choice": "auto",
            "temperature": 0.2,
            "max_tokens": 700,
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "X-Title": "AERA"}
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=45) as client:
                resp = await client.post(OPENROUTER_URL, json=payload, headers=headers)
        except httpx.HTTPError as e:
            raise AssistantError(502, "upstream", "The assistant could not be reached.") from e
        if resp.status_code == 429:
            raise AssistantError(429, "rate_limited", "The free assistant is busy or has reached its daily limit.")
        if resp.status_code >= 400:
            raise AssistantError(502, "upstream", f"The assistant returned an error ({resp.status_code}).")
        data = resp.json()
        if data.get("error"):
            raise AssistantError(502, "upstream", "The assistant returned an error.")
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        return {
            "message": {"role": "assistant", "content": msg.get("content") or "", "tool_calls": msg.get("tool_calls") or None},
            "model": data.get("model", self.model),
        }
