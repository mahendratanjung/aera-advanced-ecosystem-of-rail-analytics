"""Build the crowding model for one line from data.gov.my ridership.

Inputs (downloaded once into var/cache):
- Daily origin-destination ridership for Rapid Rail, from tap-in/tap-out gates.
- Hourly origin-destination ridership for KTM Komuter, used only for the shape of the day,
  because Rapid Rail is published daily.

Output: data/models/{line}.json, a typical week of passengers per hour on every segment in
each direction, boardings per station, the uncertainty band, a back-test score and the daily
trend. The web app turns this into a predicted load for every simulated train.

    uv run --group data python -m aera_twin.ridership.build
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from aera_twin.paths import DATA_DIR, VAR_DIR
from aera_twin.ridership.assign import direction_of, journey_class, journey_on_line, segments_between
from aera_twin.timetable import Line

RAPID_URL = "https://storage.data.gov.my/transportation/rail/rapidrail_{year}_daily.parquet"
KOMUTER_URL = "https://storage.data.gov.my/transportation/ktmb/komuter_{year}.parquet"
KOMUTER_CORE = {"KL Sentral", "Kuala Lumpur", "Bank Negara", "Putra", "Midvalley", "Abdullah Hukum",
                "Angkasapuri", "Seputeh"}
DAYTYPE = {0: "weekday", 1: "weekday", 2: "weekday", 3: "weekday", 4: "fri", 5: "sat", 6: "sun"}
CAPACITY = 800  # four-car Innovia Metro 300 on the Kelana Jaya Line
CLASSES = ("inbound", "outbound", "other")


def fetch(url: str, cache: Path, refresh: bool = False) -> Path:
    path = cache / url.rsplit("/", 1)[1]
    if refresh or not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        with httpx.stream("GET", url, timeout=300, follow_redirects=True) as r:
            r.raise_for_status()
            with path.open("wb") as fh:
                for chunk in r.iter_bytes():
                    fh.write(chunk)
    return path


def komuter_profiles(k: pd.DataFrame) -> dict[str, dict[str, list[float]]]:
    """Share of each day's journeys starting in each hour, by day type and journey class."""
    k = k.copy()
    k["hour"] = k["time"].str[:2].astype(int)
    k["daytype"] = pd.to_datetime(k["date"]).dt.dayofweek.map(DAYTYPE)
    o_core = k["origin"].isin(KOMUTER_CORE)
    d_core = k["destination"].isin(KOMUTER_CORE)
    k["cls"] = np.select([d_core & ~o_core, o_core & ~d_core], ["inbound", "outbound"], "other")
    out: dict[str, dict[str, list[float]]] = {}
    for dt, g in k.groupby("daytype"):
        out[dt] = {}
        for cls in CLASSES:
            h = g[g["cls"] == cls].groupby("hour")["ridership"].sum().reindex(range(24), fill_value=0).astype(float)
            p = (h / h.sum()).to_numpy()
            # Komuter runs every 15-30 minutes, so its hourly taps bunch around departures and
            # zigzag between hours. A light 3-hour kernel removes that artefact (and softens the
            # sharpest peaks, which are steeper on Komuter than on the LRT).
            p = 0.2 * np.roll(p, 1) + 0.6 * p + 0.2 * np.roll(p, -1)
            out[dt][cls] = (p / p.sum()).round(5).tolist()
    return out


def line_journeys(od: pd.DataFrame) -> pd.DataFrame:
    """Daily journeys that ride the line, as (date, o, d, ridership) with line stop ids."""
    pairs = od[["origin", "destination"]].drop_duplicates()
    mapped = {(o, d): journey_on_line(o, d) for o, d in pairs.itertuples(index=False)}
    pairs["od"] = [mapped[(o, d)] for o, d in pairs.itertuples(index=False)]
    pairs = pairs.dropna(subset=["od"])
    pairs["o"] = pairs["od"].str[0]
    pairs["d"] = pairs["od"].str[1]
    j = od.merge(pairs[["origin", "destination", "o", "d"]], on=["origin", "destination"])
    return j.groupby(["date", "o", "d"], as_index=False)["ridership"].sum()


def run_minutes(line: Line) -> dict[int, dict[str, float]]:
    """Minutes from departing each stop to the start of the trip, per direction."""
    return {d: {s["station_id"]: s["dep"] / 60 for s in dd["stops"]} for d, dd in line.directions.items()}


def build(line: Line, od: pd.DataFrame, komuter: pd.DataFrame, weeks: int = 12) -> dict:
    stations = line.station_ids
    idx = {s: i for i, s in enumerate(stations)}
    n_seg = len(stations) - 1
    profiles = komuter_profiles(komuter)
    j = line_journeys(od)
    j["date"] = pd.to_datetime(j["date"])
    latest = j["date"].max()
    start = latest - pd.Timedelta(days=weeks * 7 - 1)
    window = j[j["date"] >= start]

    daily_total = j.groupby("date")["ridership"].sum()
    trend_index = pd.date_range(daily_total.index.min(), latest, freq="D")
    trend = daily_total.reindex(trend_index, fill_value=0).astype(int)

    # Typical day per weekday: the median journey count of each pair over the window. The
    # median ignores the odd public holiday without needing a holiday calendar.
    pivot = window.pivot_table(index=["o", "d"], columns="date", values="ridership", aggfunc="sum", fill_value=0)
    typical: dict[int, pd.Series] = {}
    band: dict[str, list[float]] = {}
    win_totals = daily_total[daily_total.index >= start]
    for w in range(7):
        cols = [c for c in pivot.columns if c.dayofweek == w]
        typical[w] = pivot[cols].median(axis=1)
        totals = win_totals[[c for c in win_totals.index if c.dayofweek == w]]
        med = totals.median()
        band[str(w)] = [round(float((totals / med).quantile(0.1)), 3), round(float((totals / med).quantile(0.9)), 3)]

    # Back-test: forecast each of the last 28 days from the same weekday in the 12 weeks before.
    errors, test_days = [], daily_total.index[daily_total.index > latest - pd.Timedelta(days=28)]
    for day in test_days:
        hist = daily_total[(daily_total.index < day - pd.Timedelta(days=27)) &
                           (daily_total.index >= day - pd.Timedelta(days=27 + weeks * 7)) &
                           (daily_total.index.dayofweek == day.dayofweek)]
        if len(hist) >= 4 and daily_total[day] > 0:
            errors.append(abs(hist.median() - daily_total[day]) / daily_total[day])
    accuracy = {"days": len(errors), "mape_pct": round(100 * float(np.median(errors)), 1) if errors else None,
                "mean_ape_pct": round(100 * float(np.mean(errors)), 1) if errors else None}

    runs = run_minutes(line)
    load = {str(w): {"0": np.zeros((n_seg, 24)), "1": np.zeros((n_seg, 24))} for w in range(7)}
    board = {str(w): {"0": np.zeros((len(stations), 24)), "1": np.zeros((len(stations), 24))} for w in range(7)}
    prof_arr = {dt: {c: np.array(v) for c, v in by.items()} for dt, by in profiles.items()}
    for w, series in typical.items():
        dt = DAYTYPE[w]
        for (o, d), flow in series.items():
            if flow <= 0:
                continue
            oi, di = idx[o], idx[d]
            direction = direction_of(oi, di)
            p = prof_arr[dt][journey_class(o, d)] * flow
            board[str(w)][str(direction)][oi] += p
            t0 = runs[direction][o]
            for seg in segments_between(oi, di):
                a, b = stations[seg], stations[seg + 1]
                minutes = max(0.0, (runs[direction][a] + runs[direction][b]) / 2 - t0)
                whole, frac = divmod(minutes / 60.0, 1.0)
                # Wrap past midnight: a 23:50 tap-in rides at 00:05 of the same typical day.
                shifted = np.roll(p, int(whole))
                nxt = np.roll(shifted, 1)
                load[str(w)][str(direction)][seg] += shifted * (1 - frac) + nxt * frac

    def ints(a: np.ndarray) -> list[list[int]]:
        return np.rint(a).astype(int).tolist()

    return {
        "line_id": line.id,
        "capacity": CAPACITY,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window": {"from": start.date().isoformat(), "to": latest.date().isoformat(), "weeks": weeks},
        "source": {
            "od": "Daily Origin-Destination Ridership: Rapid Rail (KV), data.gov.my",
            "profile": "Hourly Origin-Destination Ridership: Komuter, data.gov.my (shape of the day only)",
        },
        "stations": stations,
        "units": "passengers per hour; segment s joins stations[s] and stations[s+1]; weekday 0 = Monday",
        "load": {w: {d: ints(a) for d, a in by.items()} for w, by in load.items()},
        "board": {w: {d: ints(a) for d, a in by.items()} for w, by in board.items()},
        "band": band,
        "accuracy": accuracy,
        "trend": {"start": trend.index[0].date().isoformat(), "daily": trend.tolist()},
        "profiles": profiles,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--line", default="KJ")
    ap.add_argument("--years", nargs="+", type=int, default=[2025, 2026])
    ap.add_argument("--komuter-year", type=int, default=2026)
    ap.add_argument("--weeks", type=int, default=12)
    ap.add_argument("--refresh", action="store_true", help="Download the files again")
    args = ap.parse_args()

    cache = VAR_DIR / "cache"
    od = pd.concat([pd.read_parquet(fetch(RAPID_URL.format(year=y), cache, args.refresh)) for y in args.years])
    komuter = pd.read_parquet(fetch(KOMUTER_URL.format(year=args.komuter_year), cache, args.refresh))
    model = build(Line.load(args.line), od, komuter, args.weeks)
    out = DATA_DIR / "models" / f"{args.line}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(model, separators=(",", ":")))
    peak = max(max(max(row) for row in d) for w in model["load"].values() for d in w.values())
    print(f"wrote {out} ({out.stat().st_size // 1024} KB); window {model['window']}; "
          f"peak segment load {peak} pax/h; back-test {model['accuracy']}")


if __name__ == "__main__":
    main()
