"""GTFS static importer (SIM-01, SIM-06).

Downloads the Rapid Rail KL feed from data.gov.my, extracts one line and writes a compact
line file to ``data/lines/{route_id}.json``. The application reads only that file, so it
never depends on the portal at run time.

    uv run python -m aera_twin.gtfs.importer --route KJ
    uv run python -m aera_twin.gtfs.importer --route KJ --zip ./feed.zip
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import httpx

from aera_twin.paths import LINES_DIR

FEED_URL = "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl"
FALLBACK_SPEED_MPS = 11.0  # about 40 km/h including acceleration
FALLBACK_DWELL_S = 30
FALLBACK_HEADWAY_S = 300
FALLBACK_SERVICE = (6 * 3600, 23 * 3600 + 30 * 60)
UPPER_TOKENS = {"KL", "KLCC", "USJ", "SS", "CBP", "LRT", "MRT"}


def read_feed(zip_bytes: bytes) -> dict[str, list[dict[str, str]]]:
    tables: dict[str, list[dict[str, str]]] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in zf.namelist():
            if not name.endswith(".txt") or name.startswith("__MACOSX") or "/." in name:
                continue
            text = zf.read(name).decode("utf-8-sig")
            tables[Path(name).stem] = list(csv.DictReader(io.StringIO(text)))
    return tables


def parse_gtfs_time(value: str) -> int:
    h, m, s = (int(p) for p in value.strip().split(":"))
    return h * 3600 + m * 60 + s


def tidy_name(raw: str) -> tuple[str, str]:
    """Return (short name, full name). Sponsor suffixes after ' - ' are kept only in full."""

    def word(w: str) -> str:
        if w.upper() in UPPER_TOKENS or any(ch.isdigit() for ch in w):
            return w.upper()
        return w[:1].upper() + w[1:].lower()

    def title(s: str) -> str:
        return " ".join(word(w) for w in s.split())

    full = title(raw)
    short = title(raw.split(" - ")[0])
    return short, full


def clean_headsign(raw: str) -> str:
    """'From Putra Heights to Gombak' becomes 'Gombak'."""
    text = raw.strip()
    if " to " in text.lower():
        text = text[text.lower().rindex(" to ") + 4:]
    return tidy_name(text)[0] if text.isupper() else text


def _local_xy(lon: float, lat: float, lat0: float) -> tuple[float, float]:
    k = 111_320.0
    return lon * k * math.cos(math.radians(lat0)), lat * 110_540.0


def cumulative_distances(coords: list[list[float]]) -> list[float]:
    lat0 = coords[0][1]
    out = [0.0]
    for (a, b) in zip(coords, coords[1:]):
        ax, ay = _local_xy(a[0], a[1], lat0)
        bx, by = _local_xy(b[0], b[1], lat0)
        out.append(out[-1] + math.hypot(bx - ax, by - ay))
    return out


def project_onto_shape(
    coords: list[list[float]], dists: list[float], lon: float, lat: float, min_dist: float
) -> float:
    """Distance along the shape of the closest point to (lon, lat), not before min_dist."""
    lat0 = coords[0][1]
    px, py = _local_xy(lon, lat, lat0)
    best = (math.inf, min_dist)
    for i in range(len(coords) - 1):
        if dists[i + 1] < min_dist:
            continue
        ax, ay = _local_xy(coords[i][0], coords[i][1], lat0)
        bx, by = _local_xy(coords[i + 1][0], coords[i + 1][1], lat0)
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
        d = math.hypot(ax + t * dx - px, ay + t * dy - py)
        along = dists[i] + t * (dists[i + 1] - dists[i])
        if d < best[0] and along >= min_dist:
            best = (d, along)
    return best[1]


def build_line(tables: dict[str, list[dict[str, str]]], route_id: str) -> dict:
    routes = [r for r in tables["routes"] if r["route_id"] == route_id]
    if not routes:
        raise SystemExit(f"route {route_id!r} not found in feed")
    route = routes[0]
    trips = [t for t in tables.get("trips", []) if t["route_id"] == route_id]
    trip_ids = {t["trip_id"] for t in trips}
    stops_by_id = {s["stop_id"]: s for s in tables["stops"]}

    stop_times: dict[str, list[dict[str, str]]] = {}
    for st in tables.get("stop_times", []):
        if st["trip_id"] in trip_ids:
            stop_times.setdefault(st["trip_id"], []).append(st)
    for rows in stop_times.values():
        rows.sort(key=lambda r: int(r["stop_sequence"]))

    # Templates: one stop pattern per direction, taken from the first trip with stop times.
    templates: dict[int, list[dict]] = {}
    headsigns: dict[int, str] = {}
    for t in trips:
        d = int(t.get("direction_id") or 0)
        rows = stop_times.get(t["trip_id"])
        if d in templates or not rows:
            continue
        t0 = parse_gtfs_time(rows[0]["arrival_time"])
        templates[d] = [
            {
                "station_id": r["stop_id"],
                "arr": parse_gtfs_time(r["arrival_time"]) - t0,
                "dep": parse_gtfs_time(r["departure_time"]) - t0,
            }
            for r in rows
        ]
        headsigns[d] = clean_headsign(t.get("trip_headsign", ""))

    # Ordered station list. Prefer direction 1, otherwise reverse direction 0, otherwise stops.txt order.
    if 1 in templates:
        order = [s["station_id"] for s in templates[1]]
    elif 0 in templates:
        order = [s["station_id"] for s in reversed(templates[0])]
    else:
        order = [s["stop_id"] for s in tables["stops"] if s.get("route_id") == route_id]
    if len(order) < 2:
        raise SystemExit(f"route {route_id!r} has fewer than two stops")

    # Shape for the ordered direction, or straight segments between stations (SIM-06).
    shape_id = next((t.get("shape_id") for t in trips if int(t.get("direction_id") or 0) == 1), None)
    shape_pts = [p for p in tables.get("shapes", []) if p["shape_id"] == shape_id] if shape_id else []
    shape_pts.sort(key=lambda p: int(p["shape_pt_sequence"]))
    used_shape_fallback = len(shape_pts) < 2
    if used_shape_fallback:
        coords = [[float(stops_by_id[s]["stop_lon"]), float(stops_by_id[s]["stop_lat"])] for s in order]
    else:
        coords = [[float(p["shape_pt_lon"]), float(p["shape_pt_lat"])] for p in shape_pts]
    dists = cumulative_distances(coords)

    stations = []
    last = 0.0
    for seq, sid in enumerate(order, start=1):
        s = stops_by_id[sid]
        lon, lat = float(s["stop_lon"]), float(s["stop_lat"])
        along = project_onto_shape(coords, dists, lon, lat, last)
        last = along
        short, full = tidy_name(s["stop_name"])
        stations.append(
            {"id": sid, "name": short, "full_name": full, "lat": lat, "lon": lon, "sequence": seq,
             "distance_m": round(along, 1)}
        )

    # Fill a missing direction template from distances (SIM-06).
    used_time_fallback = False
    for d in (0, 1):
        if d in templates:
            continue
        used_time_fallback = True
        seq = stations if d == 1 else list(reversed(stations))
        t, rows = 0.0, []
        for i, st in enumerate(seq):
            if i:
                t += abs(st["distance_m"] - seq[i - 1]["distance_m"]) / FALLBACK_SPEED_MPS
            rows.append({"station_id": st["id"], "arr": round(t), "dep": round(t) + FALLBACK_DWELL_S})
            t += FALLBACK_DWELL_S
        templates[d] = rows
        headsigns.setdefault(d, f"To {seq[-1]['name']}")

    # Frequencies by service id and direction.
    trip_meta = {t["trip_id"]: t for t in trips}
    frequencies: dict[str, dict[str, list[dict]]] = {}
    for f in tables.get("frequencies", []):
        t = trip_meta.get(f["trip_id"])
        if not t:
            continue
        svc = frequencies.setdefault(t["service_id"], {"0": [], "1": []})
        svc[str(int(t.get("direction_id") or 0))].append(
            {"start": parse_gtfs_time(f["start_time"]), "end": parse_gtfs_time(f["end_time"]),
             "headway": int(f["headway_secs"])}
        )
    services_used = {t["service_id"] for t in trips}
    used_headway_fallback = not frequencies
    if used_headway_fallback:
        for svc in services_used or {"daily"}:
            win = {"start": FALLBACK_SERVICE[0], "end": FALLBACK_SERVICE[1], "headway": FALLBACK_HEADWAY_S}
            frequencies[svc] = {"0": [dict(win)], "1": [dict(win)]}
    for svc in frequencies.values():
        for wins in svc.values():
            wins.sort(key=lambda w: w["start"])

    calendar = {}
    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    for c in tables.get("calendar", []):
        if c["service_id"] in frequencies:
            calendar[c["service_id"]] = [int(c[d]) for d in days]
    for svc in frequencies:
        calendar.setdefault(svc, [1] * 7)

    color = (route.get("route_color") or "").strip().lstrip("#")
    text_color = (route.get("route_text_color") or "FFFFFF").strip().lstrip("#")
    return {
        "id": route_id,
        "name": route.get("route_long_name") or route_id,
        "short_name": route.get("route_short_name") or route_id,
        "color": f"#{color.upper()}" if color else None,
        "text_color": f"#{text_color.upper()}",
        "timezone": "Asia/Kuala_Lumpur",
        "source": {
            "name": "Prasarana Rapid Rail KL GTFS Static, via data.gov.my",
            "url": FEED_URL,
            "imported_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "fallbacks": {
                "straight_segments": used_shape_fallback,
                "estimated_run_times": used_time_fallback,
                "default_headway": used_headway_fallback,
            },
        },
        "stations": stations,
        "shape": [[round(x, 6), round(y, 6)] for x, y in coords],
        "shape_distances": [round(d, 1) for d in dists],
        "directions": [
            {"direction_id": d, "headsign": headsigns.get(d, ""), "stops": templates[d]} for d in (0, 1)
        ],
        "frequencies": frequencies,
        "calendar": calendar,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--route", default="KJ", help="GTFS route_id, default KJ (Kelana Jaya Line)")
    ap.add_argument("--zip", type=Path, help="Use a local feed ZIP instead of downloading")
    ap.add_argument("--out", type=Path, help="Output path, default data/lines/{route}.json")
    args = ap.parse_args()

    if args.zip:
        data = args.zip.read_bytes()
    else:
        resp = httpx.get(FEED_URL, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        data = resp.content
    line = build_line(read_feed(data), args.route)
    out = args.out or LINES_DIR / f"{args.route}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(line, separators=(",", ":")))
    print(f"wrote {out} with {len(line['stations'])} stations and {len(line['shape'])} shape points")


if __name__ == "__main__":
    main()
