"""Predicted crowding on every other Klang Valley line (NETC-01).

The Kelana Jaya Line has its own detailed model (``build.py``). This one gives every other
line a typical-week load, so the maps and cards can say how full those trains usually are.

* **Rapid Rail** (LRT Ampang and Sri Petaling, MRT Kajang and Putrajaya, Monorail, LRT Shah
  Alam): data.gov.my publishes daily journeys between every pair of Rapid Rail stations. Each
  journey is routed on the network (``data/network/rapid.json``: run times, headways and
  walking transfers) over the quickest path and close alternatives (logit on travel time), spread over the day with the KTM Komuter hourly
  shape, and added to every stretch it rides. Journeys that change lines are counted on
  every line they use, which the Kelana Jaya model cannot do from gate data alone.
* **KTM Komuter** (both lines): data.gov.my publishes hourly journeys between Komuter
  stations, so the hours are measured, not shaped. Routed the same way on the two lines.
* ERL, BRT Sunway and the suspended Skypark Link have no public ridership, so no crowding.

Load is passengers per hour on a stretch divided by the seats-and-standing capacity of the
trains that pass in that hour (from the timetable). Where two lines share track (Ampang and
Sri Petaling as far as Chan Sow Lin, the Komuter core) riders are shared by every train.
Train capacities are approximate published figures.

Output ``data/models/network.json``: per line, per stretch ``"from>to"`` (GTFS stop ids, in
the direction of travel), three day types of 24 hourly loads in percent, or null when no
train runs.

    uv run --group data python -m aera_twin.ridership.network
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from aera_twin.paths import DATA_DIR, NETWORK_DIR, VAR_DIR

# Approximate full-load capacity of one train (seated and standing), by line.
CAPACITY = {
    "AG": 1000, "SP": 1000,  # six-car CRRC/AMY sets
    "KG": 1200, "PY": 1200,  # four-car MRT sets
    "MR": 430,               # four-car Scomi SUTRA monorail
    "SA": 650,               # three-car LRT3 sets
    "K1": 1000, "K2": 1000,  # six-car KTM Class 92 sets
}
DAYTYPES = ("weekday", "sat", "sun")
SAMPLE_DAY = {"weekday": 2, "sat": 5, "sun": 6}  # Monday = 0, used to pick services
PROFILE_DAY = {"weekday": "weekday", "sat": "sat", "sun": "sun"}
TRANSFER_WAIT_S = 180  # half a headway and a little reluctance to change
# Route choice: riders do not all take the single quickest path. Alternatives found by making
# the quickest path's stretches dearer share the riders by a logit on travel time, so a route
# 4 minutes slower still gets about 1 / (1 + e) of them. Routes over MAX_EXTRA_S slower get none.
ROUTE_PENALTY = 1.6
LOGIT_S = 240.0
MAX_EXTRA_S = 900.0
MAX_ROUTES = 3
CITY = (3.1494, 101.6962)  # Masjid Jamek, the middle of the network
CITY_RADIUS_M = 3000
CODE = re.compile(r"^([A-Z]+)(\d+)")
RAPID_PREFIX = {"PYL": "PY"}
KTM_ALIASES = {
    "Bandar Tasek Selatan": "Bandar Tasik Selatan", "Midvalley": "Mid Valley",
    "Pelabuhan Klang Selatan": "Pelabuhan Klang", "Pulau Sebang (Tampin)": "Pulau Sebang/Tampin",
    "Telok Gadong": "Teluk Gadong", "Telok Pulai": "Teluk Pulai", "Tanjong Malim": "Tanjung Malim",
}


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    dy = (b[0] - a[0]) * 110_540.0
    dx = (b[1] - a[1]) * 111_320.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


class Graph:
    """Stations as nodes; each stretch knows which lines' trains run along it.

    ``serve[(a, b)]`` lists ``(line, a_stop, b_stop, offset_s)`` for every line running from
    node a to node b, where offset_s is when a train reaches a after leaving its terminal.
    """

    def __init__(self) -> None:
        self.adj: dict[str, dict[str, float]] = defaultdict(dict)
        self.serve: dict[tuple[str, str], list[tuple[str, str, str, float]]] = defaultdict(list)
        self.pos: dict[str, tuple[float, float]] = {}
        self.direction: dict[tuple[str, str, str], str] = {}  # (line, a_stop, b_stop) -> direction id

    def ride(self, a: str, b: str, seconds: float, line: str, a_stop: str, b_stop: str, offset: float) -> None:
        self.adj[a][b] = min(self.adj[a].get(b, math.inf), max(30.0, seconds))
        self.serve[(a, b)].append((line, a_stop, b_stop, offset))

    def walk(self, a: str, b: str, seconds: float) -> None:
        for x, y in ((a, b), (b, a)):
            self.adj[x][y] = min(self.adj[x].get(y, math.inf), seconds + TRANSFER_WAIT_S)

    def paths_from(self, src: str, dearer: set[tuple[str, str]] | None = None) -> tuple[dict[str, float], dict[str, str]]:
        """Quickest time and previous node to every node (Dijkstra), optionally with some stretches made dearer."""
        dist = {src: 0.0}
        prev: dict[str, str] = {}
        heap = [(0.0, src)]
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist.get(u, math.inf):
                continue
            for v, w in self.adj[u].items():
                nd = d + (w * ROUTE_PENALTY if dearer and (u, v) in dearer else w)
                if nd < dist.get(v, math.inf):
                    dist[v], prev[v] = nd, u
                    heapq.heappush(heap, (nd, v))
        return dist, prev


def rides_on(g: Graph, dist: dict[str, float], prev: dict[str, str], dst: str) -> list[tuple[str, str, float]]:
    """The stretches ridden on the way to dst, with seconds from the start to their middle."""
    out = []
    v = dst
    while v in prev:
        u = prev[v]
        if (u, v) in g.serve:
            out.append((u, v, (dist[u] + dist[v]) / 2))
        v = u
    return out[::-1]


def path_to(prev: dict[str, str], dst: str) -> list[str]:
    nodes = [dst]
    while nodes[-1] in prev:
        nodes.append(prev[nodes[-1]])
    return nodes[::-1]


def legs_of(g: Graph, nodes: list[str]) -> tuple[float, list[tuple[str, str, float]]]:
    """Travel time of a path and its ridden stretches, with seconds from the start to their middle."""
    t = 0.0
    legs = []
    for u, v in zip(nodes, nodes[1:], strict=False):
        w = g.adj[u][v]
        if (u, v) in g.serve:
            legs.append((u, v, t + w / 2))
        t += w
    return t, legs


def routes(g: Graph, o: str, d: str, dist: dict[str, float], prev: dict[str, str]) -> list[tuple[float, list[tuple[str, str, float]]]]:
    """The quickest route and up to MAX_ROUTES - 1 real alternatives, each with its share of riders."""
    first = path_to(prev, d)
    found = [first]
    dearer: set[tuple[str, str]] = set()
    for _ in range(MAX_ROUTES - 1):
        dearer |= {(u, v) for p in found for u, v in zip(p, p[1:], strict=False) if (u, v) in g.serve}
        _, prev2 = g.paths_from(o, dearer)
        if d not in prev2:
            break
        alt = path_to(prev2, d)
        if alt in found:
            break
        found.append(alt)
    timed = [legs_of(g, p) for p in found]
    best = min(t for t, _ in timed)
    timed = [(t, legs) for t, legs in timed if t - best <= MAX_EXTRA_S]
    weights = [math.exp(-(t - best) / LOGIT_S) for t, _ in timed]
    total = sum(weights)
    return [(w / total, legs) for w, (_, legs) in zip(weights, timed, strict=True)]


def trains_per_hour(windows: list[tuple[float, float, float]], offset: float) -> list[float]:
    """Trains an hour passing a point, from headway windows (start, end, headway) at the terminal.

    The rate is the one in force while trains run, so an hour with service for only part of
    it (the first and last hours) still has its full rate: one train every headway.
    """
    out = [0.0] * 24
    for h in range(24):
        run = trains = 0.0
        for s0, s1, hw in windows:
            for shift in (0, -86400):  # late trips belong to the hours after midnight too
                a = max(h * 3600, s0 + offset + shift)
                b = min((h + 1) * 3600, s1 + offset + shift)
                if b > a and hw > 0:
                    run += b - a
                    trains += (b - a) / hw
        out[h] = 3600 * trains / run if run > 0 else 0.0
    return out


Windows = dict[tuple[str, str, int], list[tuple[float, float, float]]]


def rapid_graph(rapid: dict) -> tuple[Graph, dict[tuple[str, int], str], Windows]:
    """Graph of Rapid Rail, the OD-code lookup and headway windows per (line, direction, day type).

    Stops of different lines at the same platform (no walk at all) share one node, so the
    Ampang and Sri Petaling Lines' common track is one set of stretches served by both.
    """
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent.get(x, x) != x:
            x = parent[x]
        return x

    for t in rapid["transfers"]:
        if t["distance_m"] == 0:
            a, b = sorted((find(t["from"]), find(t["to"])))
            parent[b] = a
    g = Graph()
    codes: dict[tuple[str, int], str] = {}
    starts: Windows = {}
    for line in rapid["lines"]:
        for s in line["stops"]:
            g.pos[find(s["id"])] = (s["lat"], s["lon"])
            m = CODE.match(s["id"])
            if m:
                codes[(m.group(1), int(m.group(2)))] = s["id"]
        for d in line["directions"]:
            stops = d["stops"]
            for x, y in zip(stops, stops[1:], strict=False):
                g.ride(find(x["id"]), find(y["id"]), y["dep"] - x["dep"], line["id"], x["id"], y["id"], x["dep"])
                g.direction[(line["id"], x["id"], y["id"])] = str(d["direction_id"])
            for dt in DAYTYPES:
                wd = SAMPLE_DAY[dt]
                starts[(line["id"], str(d["direction_id"]), DAYTYPES.index(dt))] = [
                    (s0, s1, hw) for svc, days in line["calendar"].items() if days[wd]
                    for s0, s1, hw in line["frequencies"].get(svc, {}).get(str(d["direction_id"]), [])]
    for t in rapid["transfers"]:
        a, b = find(t["from"]), find(t["to"])
        if a != b:
            g.walk(a, b, t["walk_s"])
    return g, codes, starts


def assign(g: Graph, flows: dict[tuple[str, str], list[list[float]]]) -> dict[tuple[str, str], list[list[float]]]:
    """Passengers per hour on each stretch, by day type.

    flows maps (origin node, destination node) to hourly journeys per day type (as tapped in).
    A journey rides each stretch some minutes after tapping in, so its hours move later.
    Riders between a pair are shared between the quickest route and close alternatives.
    """
    load: dict[tuple[str, str], list[list[float]]] = defaultdict(lambda: [[0.0] * 24 for _ in DAYTYPES])
    by_origin: dict[str, list[tuple[str, list[list[float]]]]] = defaultdict(list)
    for (o, d), f in flows.items():
        if o != d:
            by_origin[o].append((d, f))
    for o, dests in by_origin.items():
        dist, prev = g.paths_from(o)
        for d, f in dests:
            if d not in dist:
                continue
            for share, legs in routes(g, o, d, dist, prev):
                for a, b, sec in legs:
                    whole, frac = divmod(sec / 3600.0, 1.0)
                    cell = load[(a, b)]
                    for k in range(len(DAYTYPES)):
                        for h, v in enumerate(f[k]):
                            if v:
                                cell[k][(h + int(whole)) % 24] += share * v * (1 - frac)
                                cell[k][(h + int(whole) + 1) % 24] += share * v * frac
    return load


def loads_by_line(g: Graph, load: dict[tuple[str, str], list[list[float]]],
                  tph: dict[tuple[str, str, str], list[list[float]]], lines: set[str]) -> dict[str, dict[str, list[list[int | None]]]]:
    """Percent of capacity per line and stretch: riders shared by every train along it."""
    out: dict[str, dict[str, list[list[int | None]]]] = defaultdict(dict)
    for (a, b), serving in g.serve.items():
        cell = load.get((a, b))
        for line, x, y, _ in serving:
            if line not in lines:
                continue
            series: list[list[int | None]] = []
            for k in range(len(DAYTYPES)):
                row: list[int | None] = []
                for h in range(24):
                    cap = sum(tph.get((ln, xs, ys), [[0.0] * 24] * len(DAYTYPES))[k][h] * CAPACITY.get(ln, 1000)
                              for ln, xs, ys, _ in serving)
                    own = tph.get((line, x, y), [[0.0] * 24] * len(DAYTYPES))[k][h]
                    row.append(None if own <= 0 or cap <= 0 else round(100 * (cell[k][h] if cell else 0.0) / cap))
                series.append(row)
            out[line][f"{x}>{y}"] = series
    return out


def rapid_tph(g: Graph, starts: Windows) -> dict[tuple[str, str, str], list[list[float]]]:
    tph: dict[tuple[str, str, str], list[list[float]]] = {}
    for serving in g.serve.values():
        for line, x, y, offset in serving:
            d = g.direction[(line, x, y)]
            tph[(line, x, y)] = [trains_per_hour(starts.get((line, d, k), []), offset) for k in range(len(DAYTYPES))]
    return tph


def ktm_graph(trains: dict) -> tuple[Graph, dict[tuple[str, str, str], list[list[float]]]]:
    """Komuter: stations by name (the two lines meet at KL Sentral, Kuala Lumpur, Bank Negara and Putra)."""
    g = Graph()
    tph: dict[tuple[str, str, str], list[list[float]]] = defaultdict(lambda: [[0.0] * 24 for _ in DAYTYPES])
    for line in trains["lines"]:
        if line["id"] not in ("K1", "K2"):
            continue
        stops = line["stops"]
        seen: set[tuple[str, str]] = set()
        for p in line["patterns"]:
            seq = p["stops"]
            for k in range(len(seq) - 1):
                i, j = seq[k], seq[k + 1]
                step = 1 if j > i else -1
                # A pattern that skips stops still runs along every stretch in between.
                span = list(range(i, j + step, step))
                t0, t1 = p["times"][k][1], p["times"][k + 1][0]
                for n, (x, y) in enumerate(zip(span, span[1:], strict=False)):
                    key = (stops[x]["name"], stops[y]["name"])
                    g.pos[key[0]] = (stops[x]["lat"], stops[x]["lon"])
                    g.pos[key[1]] = (stops[y]["lat"], stops[y]["lon"])
                    if (key, line["id"]) not in seen:
                        seen.add((key, line["id"]))
                        g.ride(key[0], key[1], (t1 - t0) / (len(span) - 1), line["id"], stops[x]["id"], stops[y]["id"], 0.0)
                    for dt in DAYTYPES:
                        wd = SAMPLE_DAY[dt]
                        for svc, days in line["calendar"].items():
                            if not days[wd]:
                                continue
                            for pi, s0 in line["trips"].get(svc, []):
                                if line["patterns"][pi] is p:
                                    at = s0 + t0 + (t1 - t0) * n / (len(span) - 1)
                                    tph[(line["id"], stops[x]["id"], stops[y]["id"])][DAYTYPES.index(dt)][int(at // 3600) % 24] += 1
    return g, tph


def journey_class(g: Graph, o: str, d: str) -> str:
    o_core = distance_m(g.pos[o], CITY) < CITY_RADIUS_M
    d_core = distance_m(g.pos[d], CITY) < CITY_RADIUS_M
    return "inbound" if d_core and not o_core else "outbound" if o_core and not d_core else "other"


def build(rapid: dict, trains: dict, od, komuter, weeks: int = 12) -> dict:
    """od: Rapid Rail daily OD (pandas); komuter: Komuter hourly OD (pandas)."""
    import pandas as pd

    from aera_twin.ridership.build import komuter_profiles

    profiles = komuter_profiles(komuter)
    dtype_of = {w: (0 if w < 5 else 1 if w == 5 else 2) for w in range(7)}

    # Rapid Rail: the median day per day type, shaped over the hours.
    g, codes, starts = rapid_graph(rapid)
    od = od.copy()
    od["date"] = pd.to_datetime(od["date"])
    latest = od["date"].max()
    start = latest - pd.Timedelta(days=weeks * 7 - 1)
    w = od[od["date"] >= start].copy()
    labels = pd.unique(pd.concat([w["origin"], w["destination"]]))
    node = {lab: _node_of(lab, codes, g) for lab in labels}
    w["o"] = w["origin"].map(node)
    w["d"] = w["destination"].map(node)
    w = w.dropna(subset=["o", "d"])
    w = w[w["o"] != w["d"]]
    w["k"] = w["date"].dt.dayofweek.map(dtype_of)
    days_of = w.groupby("k")["date"].nunique()
    per_day = w.groupby(["k", "date", "o", "d"], as_index=False)["ridership"].sum()
    # Median over the days of each type, counting days a pair had no journeys as zero.
    med = per_day.groupby(["k", "o", "d"])["ridership"].apply(
        lambda s: float(pd.concat([s, pd.Series([0] * (int(days_of[s.name[0]]) - len(s)))]).median()))
    flows: dict[tuple[str, str], list[list[float]]] = defaultdict(lambda: [[0.0] * 24 for _ in DAYTYPES])
    for (k, o, d), v in med.items():
        if v <= 0:
            continue
        prof = profiles[PROFILE_DAY[DAYTYPES[k]]][journey_class(g, o, d)]
        flows[(o, d)][k] = [flows[(o, d)][k][h] + v * prof[h] for h in range(24)]
    rapid_loads = loads_by_line(g, assign(g, flows), rapid_tph(g, starts), {"AG", "SP", "KG", "PY", "MR", "SA"})

    # KTM Komuter: hourly journeys are measured, so take the mean hour per day type.
    kg, ktph = ktm_graph(trains)
    k = komuter.copy()
    k["date"] = pd.to_datetime(k["date"])
    k_latest = k["date"].max()
    k = k[k["date"] >= k_latest - pd.Timedelta(days=weeks * 7 - 1)].copy()
    k["o"] = k["origin"].map(lambda n: KTM_ALIASES.get(n, n))
    k["d"] = k["destination"].map(lambda n: KTM_ALIASES.get(n, n))
    k = k[k["o"].isin(kg.pos) & k["d"].isin(kg.pos) & (k["o"] != k["d"])]
    k["k"] = k["date"].dt.dayofweek.map(dtype_of)
    k["h"] = k["time"].str[:2].astype(int)
    k_days = k.groupby("k")["date"].nunique()
    kf: dict[tuple[str, str], list[list[float]]] = defaultdict(lambda: [[0.0] * 24 for _ in DAYTYPES])
    for (kk, o, d, h), v in k.groupby(["k", "o", "d", "h"])["ridership"].sum().items():
        kf[(o, d)][kk][h] += v / k_days[kk]
    ktm_loads = loads_by_line(kg, assign(kg, kf), ktph, {"K1", "K2"})

    lines = {**rapid_loads, **ktm_loads}
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "window": {"from": start.date().isoformat(), "to": latest.date().isoformat(), "weeks": weeks},
        "source": {
            "rapid": "Daily Origin-Destination Ridership: Rapid Rail (KV), data.gov.my, routed on the network by quickest path",
            "ktm": "Hourly Origin-Destination Ridership: Komuter, data.gov.my",
            "profile": "Rapid Rail hours shaped like KTM Komuter's hourly taps",
        },
        "capacity": {ln: CAPACITY[ln] for ln in lines},
        "capacity_note": "Approximate full-load capacity of one train, seated and standing.",
        "daytypes": list(DAYTYPES),
        "units": "percent of capacity; stretch 'a>b' in the direction of travel; null when no train runs that hour",
        "lines": {ln: dict(sorted(v.items())) for ln, v in sorted(lines.items())},
    }


def _node_of(label: str, codes: dict[tuple[str, int], str], g: Graph) -> str | None:
    """Map an OD label to a graph node, following shared-platform merges (SP7 -> AG7)."""
    m = CODE.match(label.strip())
    if not m:
        return None
    sid = codes.get((RAPID_PREFIX.get(m.group(1), m.group(1)), int(m.group(2))))
    if sid is None:
        return None
    if sid in g.adj:
        return sid
    # A merged stop: find the node whose stretches name this stop.
    for (a, _b), serving in g.serve.items():
        if any(x == sid for _, x, _, _ in serving):
            return a
    return None


def main() -> None:
    import pandas as pd

    from aera_twin.ridership.build import KOMUTER_URL, RAPID_URL, fetch

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--years", nargs="+", type=int, default=[2025, 2026])
    ap.add_argument("--komuter-year", type=int, default=2026)
    ap.add_argument("--weeks", type=int, default=12)
    ap.add_argument("--refresh", action="store_true", help="Download the files again")
    args = ap.parse_args()

    cache = VAR_DIR / "cache"
    od = pd.concat([pd.read_parquet(fetch(RAPID_URL.format(year=y), cache, args.refresh)) for y in args.years])
    komuter = pd.read_parquet(fetch(KOMUTER_URL.format(year=args.komuter_year), cache, args.refresh))
    rapid = json.loads((NETWORK_DIR / "rapid.json").read_text())
    trains = json.loads((NETWORK_DIR / "trains.json").read_text())
    model = build(rapid, trains, od, komuter, args.weeks)
    out: Path = DATA_DIR / "models" / "network.json"
    out.write_text(json.dumps(model, separators=(",", ":")))
    for ln, segs in model["lines"].items():
        peak = max((v for s in segs.values() for row in s for v in row if v is not None), default=0)
        print(f"{ln}: {len(segs)} stretches, weekday peak {peak}%")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB); window {model['window']}")


if __name__ == "__main__":
    main()
