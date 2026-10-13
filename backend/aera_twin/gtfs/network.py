"""Rapid Rail network for the route advisor (ROUTE-01).

Every line in the Rapid Rail KL GTFS feed, reduced to what a route search needs: stops in
order, run times between them, headways and walking transfers between lines. The Kelana
Jaya Line keeps its full detail in ``data/lines/KJ.json``; this file only lets the advisor
send riders round a broken section on other lines.

Transfers are not in the feed. Stops of different lines within ``TRANSFER_RADIUS_M`` of
each other are treated as an interchange, with a walking time estimated from the straight
distance. The times are approximate and the advisor says so.

    uv run python -m aera_twin.gtfs.network
    uv run python -m aera_twin.gtfs.network --zip ./feed.zip
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import UTC, datetime
from pathlib import Path

import httpx

from aera_twin.gtfs.importer import FEED_URL, parse_gtfs_time, read_feed, tidy_name
from aera_twin.paths import NETWORK_DIR

TRANSFER_RADIUS_M = 400
WALK_MPS = 1.2
WALK_DETOUR = 1.3  # corridors, stairs and fare gates are not straight lines
TRANSFER_BASE_S = 120  # leave one platform, reach the next


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dy = (lat2 - lat1) * 110_540.0
    dx = (lon2 - lon1) * 111_320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def name_of(raw: str) -> str:
    """Tidy a stop or headsign name, capitalising each part of a hyphenated name."""
    return "-".join(p[:1].upper() + p[1:] for p in tidy_name(raw.strip())[0].split("-"))


def line_code(route: dict[str, str]) -> str:
    """Signage code: 'KJL' becomes 'KJ', 'BRT' stays 'BRT'."""
    short = (route.get("route_short_name") or route["route_id"]).strip().upper()
    return short[:-1] if len(short) == 3 and short.endswith("L") else short


def build_network(tables: dict[str, list[dict[str, str]]]) -> dict:
    stops_by_id = {s["stop_id"]: s for s in tables["stops"]}
    trips = tables.get("trips", [])
    stop_times: dict[str, list[dict[str, str]]] = {}
    for st in tables.get("stop_times", []):
        stop_times.setdefault(st["trip_id"], []).append(st)
    for rows in stop_times.values():
        rows.sort(key=lambda r: int(r["stop_sequence"]))

    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    calendar_all = {c["service_id"]: [int(c[d]) for d in days] for c in tables.get("calendar", [])}
    trip_meta = {t["trip_id"]: t for t in trips}

    lines = []
    stop_line: dict[str, str] = {}
    for route in tables["routes"]:
        rid = route["route_id"]
        code = line_code(route)
        rtrips = [t for t in trips if t["route_id"] == rid]
        templates: dict[int, dict] = {}
        for t in rtrips:
            d = int(t.get("direction_id") or 0)
            rows = stop_times.get(t["trip_id"])
            if d in templates or not rows:
                continue
            t0 = parse_gtfs_time(rows[0]["arrival_time"])
            raw = t.get("trip_headsign", "")
            head = raw[raw.lower().rindex(" to ") + 4:] if " to " in raw.lower() else raw
            templates[d] = {
                "direction_id": d,
                "headsign": name_of(head),
                "stops": [{"id": r["stop_id"], "arr": parse_gtfs_time(r["arrival_time"]) - t0,
                           "dep": parse_gtfs_time(r["departure_time"]) - t0} for r in rows],
            }
        if not templates:
            continue

        frequencies: dict[str, dict[str, list[list[int]]]] = {}
        for f in tables.get("frequencies", []):
            t = trip_meta.get(f["trip_id"])
            if not t or t["route_id"] != rid:
                continue
            svc = frequencies.setdefault(t["service_id"], {"0": [], "1": []})
            svc[str(int(t.get("direction_id") or 0))].append(
                [parse_gtfs_time(f["start_time"]), parse_gtfs_time(f["end_time"]), int(f["headway_secs"])])
        for svc in frequencies.values():
            for wins in svc.values():
                wins.sort()

        ids = [s["id"] for s in next(iter(templates.values()))["stops"]]
        stops = []
        for sid in ids:
            s = stops_by_id.get(sid)
            if not s:
                continue
            stop_line[sid] = code
            stops.append({"id": sid, "name": name_of(s["stop_name"]),
                          "lat": round(float(s["stop_lat"]), 6), "lon": round(float(s["stop_lon"]), 6)})
        color = (route.get("route_color") or "").strip().lstrip("#")
        lines.append({
            "id": code,
            "route_id": rid,
            "name": route.get("route_long_name") or code,
            "mode": (route.get("category") or "").strip() or ("BRT" if route.get("route_type") == "0" else "Rail"),
            "color": f"#{color.upper()}" if color else None,
            "stops": stops,
            "directions": [templates[d] for d in sorted(templates)],
            "frequencies": frequencies,
            "calendar": {sid: calendar_all.get(sid, [1] * 7) for sid in frequencies},
        })

    all_stops = [(s, ln["id"]) for ln in lines for s in ln["stops"]]
    transfers = []
    for i, (a, la) in enumerate(all_stops):
        for b, lb in all_stops[i + 1:]:
            if la == lb:
                continue
            dist = distance_m(a["lat"], a["lon"], b["lat"], b["lon"])
            if dist <= TRANSFER_RADIUS_M:
                transfers.append({"from": a["id"], "to": b["id"], "distance_m": round(dist),
                                  "walk_s": round(TRANSFER_BASE_S + dist * WALK_DETOUR / WALK_MPS)})

    return {
        "source": {
            "name": "Prasarana Rapid Rail KL GTFS Static, via data.gov.my",
            "url": FEED_URL,
            "imported_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "transfers": f"Estimated: stops of different lines within {TRANSFER_RADIUS_M} m",
        },
        "lines": lines,
        "transfers": transfers,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--zip", type=Path, help="Use a local feed ZIP instead of downloading")
    ap.add_argument("--out", type=Path, help="Output path, default data/network/rapid.json")
    args = ap.parse_args()
    if args.zip:
        data = args.zip.read_bytes()
    else:
        resp = httpx.get(FEED_URL, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        data = resp.content
    net = build_network(read_feed(data))
    out = args.out or NETWORK_DIR / "rapid.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(net, separators=(",", ":")))
    print(f"wrote {out} with {len(net['lines'])} lines and {len(net['transfers'])} transfers")


if __name__ == "__main__":
    main()
