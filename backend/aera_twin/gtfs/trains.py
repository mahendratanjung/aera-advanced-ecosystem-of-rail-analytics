"""Timetables for every Klang Valley line other than the Kelana Jaya Line (TRAINS-01).

The twin simulates the Kelana Jaya Line in full (``data/lines/KJ.json``, with crowding). The
maps also show every other line's trains running to their own timetables, from three sources:

* **Rapid Rail** (LRT Ampang and Sri Petaling, Shah Alam, MRT Kajang and Putrajaya, Monorail,
  BRT Sunway): Prasarana GTFS Static, with each line's track shape and headways.
* **KTM Komuter** (Batu Caves - Pulau Sebang, Tanjung Malim - Pelabuhan Klang): KTMB GTFS
  Static, every timetabled trip, including the holiday swaps in calendar_dates. KTMB publishes
  no shapes, so the track is drawn straight between stations.
* **ERL** (KLIA Ekspres, KLIA Transit): no public GTFS. Trains follow the operator's published
  pattern (first and last trains, frequency and run time) and are marked as an estimate.

The KTM Skypark Link is listed without trains: the service was suspended in February 2023.

Output ``data/network/trains.json``. One format for all lines: stops with a distance along the
drawn track, stop patterns with times from the trip start, then either headway windows
(``frequencies``) or explicit trip starts (``trips``) per service, and the service calendar.

    uv run python -m aera_twin.gtfs.trains
    uv run python -m aera_twin.gtfs.trains --rapid ./rapid.zip --ktmb ./ktmb.zip
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from aera_twin.gtfs.importer import (
    FEED_URL,
    cumulative_distances,
    parse_gtfs_time,
    project_onto_shape,
    read_feed,
    tidy_name,
)
from aera_twin.gtfs.network import line_code, name_of
from aera_twin.paths import NETWORK_DIR

KTMB_URL = "https://api.data.gov.my/gtfs-static/ktmb"
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

# KTMB route id -> the poster's line id.
KTM_ROUTES = {"KC05_KB18": "K1", "KA15_KD19": "K2"}

# KTMB spells some stations differently from the integrated transit map.
KTM_NAMES = {
    "BDR TASEK SELATAN": "Bandar Tasik Selatan", "PERHENTIAN MIDVALLEY": "Mid Valley", "BATU KENTOMENN": "Batu Kentonmen",
    "PEL KLANG SEL": "Pelabuhan Klang", "JLN KASTAM": "Jalan Kastam", "KG RAJA UDA": "Kampung Raja Uda",
    "TELOK GADONG": "Teluk Gadong", "TELOK PULAI": "Teluk Pulai", "KG DATO HARUN": "Kampung Dato Harun",
    "TANJONG MALIM": "Tanjung Malim", "PULAU SEBANG/TAMPIN": "Pulau Sebang/Tampin", "KL SENTRAL": "KL Sentral",
    "UKM": "UKM",
}

# Rapid Rail stretches in tunnel, as (first stop, last stop) whose midpoints are the portals.
TUNNELS = {"KG": [("KG14", "KG15", "KG22", "KG23")], "PY": [("PY14", "PY15", "PY24", "PY27")]}
# Lines that run on the ground (others are drawn on a viaduct).
GROUND = {"K1", "K2", "E6", "E7", "SK"}

POSTER_COLOURS = {"K1": "#1E5AA8", "K2": "#B83A2E", "E6": "#6B2C91", "E7": "#1F97A8", "SK": "#8A9A2B"}

# ERL patterns: stops (id, name, lat, lon, minutes from KL Sentral, dwell s). Coordinates are
# approximate and replaced by the feeds' own where another line serves the same station; the
# times follow ERL's published frequency and run times.
ERL = {
    "E6": {
        "name": "KLIA Ekspres", "mode": "ERL",
        "stops": [("E6-1", "KL Sentral", 3.134167, 101.686111, 0, 0), ("E6-2", "KLIA T1", 2.7553, 101.7085, 28, 60),
                  ("E6-3", "KLIA T2", 2.7438, 101.6865, 33, 0)],
        # (start, end, headway) from KL Sentral and from KLIA T2, seconds after midnight.
        "windows": [(5 * 3600, 24 * 3600 + 60, 20 * 60)],
        "note": "Estimated from KLIA Ekspres's published timetable: every 20 minutes, 05:00 to midnight, 28 minutes to KLIA T1.",
    },
    "E7": {
        "name": "KLIA Transit", "mode": "ERL",
        "stops": [("E7-1", "KL Sentral", 3.134167, 101.686111, 0, 0), ("E7-2", "Bandar Tasik Selatan", 3.0763, 101.7111, 8, 45),
                  ("E7-3", "Putrajaya Sentral", 2.9324, 101.671, 21, 60), ("E7-4", "Salak Tinggi", 2.82556, 101.71306, 27, 45),
                  ("E7-5", "KLIA T1", 2.7553, 101.7085, 37, 60), ("E7-6", "KLIA T2", 2.7438, 101.6865, 41, 0)],
        "windows": [(5 * 3600 + 3 * 60, 6 * 3600, 30 * 60), (6 * 3600, 9 * 3600, 15 * 60), (9 * 3600, 16 * 3600, 30 * 60),
                    (16 * 3600, 19 * 3600, 15 * 60), (19 * 3600, 24 * 3600 + 4 * 60, 30 * 60)],
        "note": "Estimated from KLIA Transit's published timetable: every 15 minutes at peaks and 30 off-peak, 05:03 to midnight.",
    },
}


def _dist(coords: list[list[float]]) -> list[float]:
    return [round(d, 1) for d in cumulative_distances(coords)]


def _calendar(tables: dict, services: set[str]) -> dict[str, list[int]]:
    rows = {c["service_id"]: [int(c[d]) for d in DAYS] for c in tables.get("calendar", [])}
    return {s: rows.get(s, [1] * 7) for s in sorted(services)}


def _exceptions(tables: dict, services: set[str]) -> dict[str, dict[str, list[str]]]:
    out: dict[str, dict[str, list[str]]] = {}
    for r in tables.get("calendar_dates", []):
        if r["service_id"] not in services:
            continue
        day = out.setdefault(r["date"], {"add": [], "remove": []})
        day["add" if r["exception_type"] == "1" else "remove"].append(r["service_id"])
    return out


def _sorted_rows(tables: dict) -> dict[str, list[dict[str, str]]]:
    by_trip: dict[str, list[dict[str, str]]] = {}
    for st in tables.get("stop_times", []):
        by_trip.setdefault(st["trip_id"], []).append(st)
    for rows in by_trip.values():
        rows.sort(key=lambda r: int(r["stop_sequence"]))
    return by_trip


def _pattern(rows: list[dict[str, str]], index: dict[str, int], headsign: str) -> tuple[dict, int]:
    t0 = parse_gtfs_time(rows[0]["arrival_time"])
    stops = [index[r["stop_id"]] for r in rows]
    times = [[parse_gtfs_time(r["arrival_time"]) - t0, parse_gtfs_time(r["departure_time"]) - t0] for r in rows]
    return {"headsign": headsign, "stops": stops, "times": times}, t0


def _intern(patterns: list[dict], p: dict) -> int:
    for i, q in enumerate(patterns):
        if q["stops"] == p["stops"] and q["times"] == p["times"]:
            return i
    patterns.append(p)
    return len(patterns) - 1


def rapid_lines(tables: dict) -> list[dict]:
    """Every Rapid Rail line except the Kelana Jaya Line, with its shape and headways."""
    stops_by_id = {s["stop_id"]: s for s in tables["stops"]}
    by_trip = _sorted_rows(tables)
    shapes: dict[str, list[dict[str, str]]] = {}
    for p in tables.get("shapes", []):
        shapes.setdefault(p["shape_id"], []).append(p)
    out = []
    for route in tables["routes"]:
        code = line_code(route)
        if code == "KJ":
            continue
        trips = [t for t in tables["trips"] if t["route_id"] == route["route_id"] and by_trip.get(t["trip_id"])]
        if not trips:
            continue
        first = max(trips, key=lambda t: len(by_trip[t["trip_id"]]))
        order = [r["stop_id"] for r in by_trip[first["trip_id"]]]
        pts = sorted(shapes.get(first.get("shape_id", ""), []), key=lambda p: int(p["shape_pt_sequence"]))
        coords = [[round(float(p["shape_pt_lon"]), 6), round(float(p["shape_pt_lat"]), 6)] for p in pts]
        if len(coords) < 2:
            coords = [[float(stops_by_id[s]["stop_lon"]), float(stops_by_id[s]["stop_lat"])] for s in order]
        dists = cumulative_distances(coords)
        stops, last = [], 0.0
        for sid in order:
            s = stops_by_id[sid]
            lon, lat = float(s["stop_lon"]), float(s["stop_lat"])
            last = project_onto_shape(coords, dists, lon, lat, last)
            stops.append({"id": sid, "name": name_of(s["stop_name"]), "lat": round(lat, 6), "lon": round(lon, 6), "d": round(last, 1)})
        index = {s["id"]: i for i, s in enumerate(stops)}

        patterns: list[dict] = []
        template: dict[str, int] = {}
        for t in trips:
            rows = [r for r in by_trip[t["trip_id"]] if r["stop_id"] in index]
            if len(rows) < 2:
                continue
            raw = t.get("trip_headsign", "")
            head = raw[raw.lower().rindex(" to ") + 4:] if " to " in raw.lower() else raw
            p, _ = _pattern(rows, index, name_of(head) or stops[index[rows[-1]["stop_id"]]]["name"])
            template[t["trip_id"]] = _intern(patterns, p)
        frequencies: dict[str, list[list[int]]] = {}
        for f in tables.get("frequencies", []):
            if f["trip_id"] not in template:
                continue
            t = next(x for x in trips if x["trip_id"] == f["trip_id"])
            frequencies.setdefault(t["service_id"], []).append(
                [template[f["trip_id"]], parse_gtfs_time(f["start_time"]), parse_gtfs_time(f["end_time"]), int(f["headway_secs"])])
        for wins in frequencies.values():
            wins.sort()

        tunnels = []
        for a, b, c, d in TUNNELS.get(code, []):
            if all(x in index for x in (a, b, c, d)):
                da, db, dc, dd = (stops[index[x]]["d"] for x in (a, b, c, d))
                tunnels.append([round((da + db) / 2), round((dc + dd) / 2)])
        colour = (route.get("route_color") or "").strip().lstrip("#")
        out.append({
            "id": code, "name": route.get("route_long_name") or code, "mode": (route.get("category") or "").strip() or "BRT",
            "color": f"#{colour.upper()}" if colour else None, "source": "rapid", "level": "elevated", "tunnels": tunnels,
            "stops": stops, "shape": coords, "shape_d": _dist(coords), "patterns": patterns,
            "frequencies": frequencies, "trips": {}, "calendar": _calendar(tables, set(frequencies)), "dates": {},
        })
    return out


def ktm_lines(tables: dict) -> list[dict]:
    """KTM Komuter lines 1 and 2 from KTMB's timetable: every trip, straight track between stations."""
    stops_by_id = {s["stop_id"]: s for s in tables["stops"]}
    by_trip = _sorted_rows(tables)
    out = []
    for route_id, code in KTM_ROUTES.items():
        trips = [t for t in tables["trips"] if t["route_id"] == route_id and by_trip.get(t["trip_id"])]
        if not trips:
            continue
        longest = max(trips, key=lambda t: len(by_trip[t["trip_id"]]))
        order = [r["stop_id"] for r in by_trip[longest["trip_id"]]]
        coords = [[float(stops_by_id[s]["stop_lon"]), float(stops_by_id[s]["stop_lat"])] for s in order]
        dists = _dist(coords)
        stops = []
        for sid, d in zip(order, dists):
            s = stops_by_id[sid]
            raw = s["stop_name"].strip()
            stops.append({"id": sid, "name": KTM_NAMES.get(raw.upper(), tidy_name(raw)[0]), "lat": float(s["stop_lat"]),
                          "lon": float(s["stop_lon"]), "d": d})
        index = {s["id"]: i for i, s in enumerate(stops)}
        patterns: list[dict] = []
        starts: dict[str, list[list[int]]] = {}
        for t in trips:
            rows = [r for r in by_trip[t["trip_id"]] if r["stop_id"] in index]
            if len(rows) < 2:
                continue
            p, t0 = _pattern(rows, index, stops[index[rows[-1]["stop_id"]]]["name"])
            starts.setdefault(t["service_id"], []).append([_intern(patterns, p), t0])
        for v in starts.values():
            v.sort(key=lambda x: x[1])
        services = set(starts)
        out.append({
            "id": code, "name": next(r["route_long_name"] for r in tables["routes"] if r["route_id"] == route_id), "mode": "KTM Komuter",
            "color": POSTER_COLOURS[code], "source": "ktmb", "level": "ground", "tunnels": [],
            "stops": stops, "shape": [[lon, lat] for lon, lat in coords], "shape_d": dists, "patterns": patterns,
            "frequencies": {}, "trips": starts, "calendar": _calendar(tables, services), "dates": _exceptions(tables, services),
        })
    return out


def erl_lines(anchor: dict[str, tuple[float, float]]) -> list[dict]:
    """KLIA Ekspres and KLIA Transit from the operator's published pattern, marked as estimates."""
    out = []
    for code, spec in ERL.items():
        stops = []
        for sid, name, lat, lon, _, _ in spec["stops"]:
            la, lo = anchor.get(name, (lat, lon))
            stops.append({"id": sid, "name": name, "lat": la, "lon": lo})
        coords = [[s["lon"], s["lat"]] for s in stops]
        for s, d in zip(stops, _dist(coords)):
            s["d"] = d
        n = len(stops)
        down = {"headsign": stops[-1]["name"], "stops": list(range(n)),
                "times": [[m * 60, m * 60 + dw] for (_, _, _, _, m, dw) in spec["stops"]]}
        total = spec["stops"][-1][4] * 60
        up = {"headsign": "KL Sentral", "stops": list(reversed(range(n))),
              "times": [[total - m * 60, total - m * 60 + dw] for (_, _, _, _, m, dw) in reversed(spec["stops"])]}
        windows = [[p, a, b, h] for p in (0, 1) for (a, b, h) in spec["windows"]]
        out.append({
            "id": code, "name": spec["name"], "mode": spec["mode"], "color": POSTER_COLOURS[code], "source": "estimate",
            "note": spec["note"], "level": "ground", "tunnels": [], "stops": stops, "shape": coords, "shape_d": _dist(coords),
            "patterns": [down, up], "frequencies": {"daily": windows}, "trips": {}, "calendar": {"daily": [1] * 7}, "dates": {},
        })
    return out


def skypark_line(anchor: dict[str, tuple[float, float]]) -> dict:
    places = [("SK-1", "KL Sentral", 3.134167, 101.686111), ("SK-2", "Subang Jaya", 3.084554, 101.587373),
              ("SK-3", "Terminal Skypark", 3.1306, 101.549)]
    stops = []
    for sid, name, lat, lon in places:
        la, lo = anchor.get(name, (lat, lon))
        stops.append({"id": sid, "name": name, "lat": la, "lon": lo})
    coords = [[s["lon"], s["lat"]] for s in stops]
    for s, d in zip(stops, _dist(coords)):
        s["d"] = d
    return {
        "id": "SK", "name": "KTM KL Sentral - Terminal Skypark", "mode": "KTM", "color": POSTER_COLOURS["SK"], "source": "suspended",
        "note": "KTMB suspended the Skypark Link on 15 February 2023, so no trains run.", "level": "ground", "tunnels": [],
        "stops": stops, "shape": coords, "shape_d": _dist(coords), "patterns": [], "frequencies": {}, "trips": {},
        "calendar": {}, "dates": {},
    }


def build_trains(rapid: dict, ktmb: dict) -> dict:
    ktm = ktm_lines(ktmb)
    lines = rapid_lines(rapid) + ktm
    # KTM first: its KL Sentral is the ERL's, not the monorail station of the same name.
    anchor: dict[str, tuple[float, float]] = {}
    for ln in ktm + lines:
        for s in ln["stops"]:
            anchor.setdefault(s["name"], (s["lat"], s["lon"]))
    lines += erl_lines(anchor) + [skypark_line(anchor)]
    return {
        "source": {
            "rapid": f"Prasarana Rapid Rail KL GTFS Static, via data.gov.my ({FEED_URL})",
            "ktmb": f"KTMB GTFS Static, via data.gov.my ({KTMB_URL})",
            "estimate": "ERL: estimated from the operator's published frequency and run times",
            "imported_at": datetime.now(UTC).isoformat(timespec="seconds"),
        },
        "lines": lines,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rapid", type=Path, help="Local Rapid Rail GTFS ZIP")
    ap.add_argument("--ktmb", type=Path, help="Local KTMB GTFS ZIP")
    ap.add_argument("--out", type=Path, help="Output path, default data/network/trains.json")
    args = ap.parse_args()

    def fetch(path: Path | None, url: str) -> bytes:
        if path:
            return path.read_bytes()
        resp = httpx.get(url, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        return resp.content

    net = build_trains(read_feed(fetch(args.rapid, FEED_URL)), read_feed(fetch(args.ktmb, KTMB_URL)))
    out = args.out or NETWORK_DIR / "trains.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(net, separators=(",", ":")))
    print(f"wrote {out}: " + ", ".join(f"{ln['id']} ({len(ln['patterns'])} patterns)" for ln in net["lines"]))


if __name__ == "__main__":
    main()
