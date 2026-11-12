"""GPS crowdsensing for train crowding: a reference implementation (not wired into AERA).

Run:  python3 research/gps-crowdsensing/crowdsense.py            (standard library only)
      python3 research/gps-crowdsensing/crowdsense.py --sweep    (several penetration rates)

What it does, end to end, on a simulated line:

1. Simulates one hour of a 10-station line: trains on a timetable but each running a hidden
   few minutes early or late, riders boarding and alighting, some of them with the app sharing
   location, plus phones that are NOT riders (people waiting on platforms, cars on a road that
   runs beside the track, people walking), GPS noise and a tunnel with no fixes.
2. On each phone ("on device"), snaps every fix to the track and sends only a distance along
   the line, an offset from it and a speed; never latitude and longitude.
3. On the server, keeps one small hidden Markov model per phone whose states are "not on a
   train" or "on trip j", updated online with each ping (forward algorithm). Riding a train
   means: close to the track, moving like that train, stopping where it stops; a car beside the
   line fails the last two.
4. Learns where each train really is from the phones on it (crowd-sourced vehicle location),
   which sharpens the matching for everyone else.
5. Turns phones per train into riders per train: a Gamma prior from the crowding model, a
   Poisson count of phones with the penetration rate p, giving a posterior that leans on the
   model when phones are few and on the phones when they are many.

Then it scores trip matching (precision, recall) and load estimates (error against the truth)
for the model alone, phones alone (count / p) and the fused estimate.

The design notes, privacy, scale and rollout are in README.md next to this file.
"""

from __future__ import annotations

import argparse
import math
import random
import statistics
from dataclasses import dataclass, field

# ------------------------------------------------------------------------------------- the line

STATIONS = 10
SPACING_M = 1200.0
LINE_M = SPACING_M * (STATIONS - 1)
CRUISE_MPS = 16.0
DWELL_S = 30.0
HEADWAY_S = 180.0
TUNNEL = (4 * SPACING_M + 200, 6 * SPACING_M - 200)  # no GPS here, like Ampang Park to Pasar Seni
HOP_S = SPACING_M / CRUISE_MPS  # running time between stations (constant speed, for brevity)


def scheduled_s(t_since_start: float) -> float | None:
    """Distance along the line of a train `t_since_start` seconds after leaving the first station."""
    if t_since_start < 0:
        return None
    leg = HOP_S + DWELL_S
    k, r = divmod(t_since_start, leg)
    if k >= STATIONS - 1:
        return None  # finished
    return k * SPACING_M + (0.0 if r < DWELL_S else (r - DWELL_S) * CRUISE_MPS)


def scheduled_v(t_since_start: float) -> float:
    r = t_since_start % (HOP_S + DWELL_S)
    return 0.0 if r < DWELL_S else CRUISE_MPS


@dataclass
class Trip:
    id: int
    start: float  # timetable departure from station 0
    delay: float  # hidden: how late (or early) it really runs

    def s(self, t: float, real: bool = True) -> float | None:
        return scheduled_s(t - self.start - (self.delay if real else 0.0))

    def dwelling_at(self, t: float) -> int | None:
        x = t - self.start - self.delay
        if x < 0:
            return None
        k, r = divmod(x, HOP_S + DWELL_S)
        return int(k) if r < DWELL_S and k < STATIONS - 1 else None


# ------------------------------------------------------------------------------------- the world

GPS_SD = 15.0


@dataclass
class Device:
    """A phone with the app sharing its location. `truth` is what it is doing (for scoring)."""

    id: int
    kind: str  # "rider", "platform", "road", "walker"
    trip: Trip | None = None
    board: int = 0
    alight: int = 0
    station: int = 0
    road_s: float = 0.0
    road_v: float = 0.0
    road_stop_until: float = 0.0
    wait: float = 0.0
    last_s: float | None = None
    last_t: float | None = None

    def boards_at(self) -> float:
        """When the rider's train leaves their station (they are on it from then)."""
        assert self.trip
        return self.trip.start + self.trip.delay + self.board * (HOP_S + DWELL_S) + DWELL_S

    def position(self, t: float, rng: random.Random) -> tuple[float, float] | None:
        """True (distance along line, lateral offset) now, or None when gone."""
        if self.kind == "rider":
            assert self.trip
            if t < self.boards_at():
                return self.board * SPACING_M + self.road_s, self.road_v  # waiting on the platform
            s = self.trip.s(t)
            if s is None or s > self.alight * SPACING_M + 1:
                return None
            return s, rng.gauss(0, 2)
        if self.kind == "platform":
            # Standing on a platform (road_s is where on it, road_v how far from the track).
            return self.station * SPACING_M + self.road_s, self.road_v
        if self.kind == "walker":
            self.road_s += rng.choice((-1, 1)) * 1.3 * 10
            return self.road_s, self.road_v
        # A car on a road beside the track: it stops at traffic lights, not at stations.
        if t < self.road_stop_until:
            return self.road_s, 35.0
        self.road_s += self.road_v * 10
        if rng.random() < 0.06:
            self.road_stop_until = t + rng.uniform(20, 70)
        if self.road_s > LINE_M:
            return None
        return self.road_s, 35.0


def gps_fix(true: tuple[float, float], rng: random.Random) -> tuple[float, float] | None:
    """What the phone measures: along-track distance and lateral offset after snapping. None in the tunnel."""
    s, d = true
    if TUNNEL[0] < s < TUNNEL[1]:
        return None
    return s + rng.gauss(0, GPS_SD), abs(d + rng.gauss(0, GPS_SD))


# ------------------------------------------------------------------------------------- matching


@dataclass
class TripClock:
    """What the server believes about a trip's real position: its delay, learned from its phones."""

    delay: float = 0.0
    var: float = 60.0**2  # prior: about a minute off the timetable (PRIOR_SD)
    misses: int = 0  # confident phones in a row that disagreed with the estimate


@dataclass
class Belief:
    """One phone's state: P(not on a train) and P(on trip j), plus its last fix for speed."""

    p: dict[int | None, float] = field(default_factory=lambda: {None: 1.0})
    last: tuple[float, float] | None = None  # (t, s)
    speed: float | None = None
    station_stop: float = -1e9  # last time the phone stood still at a station (riders board at one)


OFF = None
P_BOARD = 0.25  # chance a phone that is not riding boards a train dwelling where it is
P_ALIGHT = 0.05  # chance per ping that a rider gets off while the train stands at a station
P_JOIN = 0.002  # chance per ping that a phone not yet matched is found riding a given train
P_DOUBT = 0.03  # chance per ping that a match was wrong all along: keeps beliefs from becoming certain
NEAR_TRACK_M = 80.0


CORRIDOR_M = 150.0
MIN_GAP_S = 0.4 * HEADWAY_S
PRIOR_SD = 60.0  # how far off the timetable a train usually is, seconds
MAX_DELAY_S = 2.5 * PRIOR_SD


def gauss(x: float, sd: float) -> float:
    return math.exp(-0.5 * (x / sd) ** 2) / (sd * math.sqrt(2 * math.pi))


def speed_on(speed: float, v_exp: float) -> float:
    """Speed on a train: near the train's (robust to braking between two pings)."""
    return 0.95 * gauss(speed - v_exp, 3.0) + 0.05 / 20


def where_off(s: float) -> float:
    """Where phones that are not riding are, along the line: many at stations, the rest anywhere."""
    k = min(STATIONS - 1, max(0, round(s / SPACING_M)))
    return 0.5 / LINE_M + 0.5 * gauss(s - k * SPACING_M, 60.0) / STATIONS


def speed_off(speed: float) -> float:
    """Speed off a train: mostly standing or walking, sometimes driving."""
    return 0.6 * gauss(speed, 1.5) * 2 + 0.4 / 20


class Matcher:
    """Online HMM per phone. States: OFF or a trip id. Emissions: distance, offset and speed."""

    def __init__(self, trips: list[Trip]):
        self.trips = {tr.id: tr for tr in trips}
        self.clock = {tr.id: TripClock() for tr in trips}
        self.beliefs: dict[int, Belief] = {}

    def _expected(self, j: int, t: float) -> tuple[float | None, float, float]:
        """Where the matcher expects trip j now, how sure it is (sd in metres) and its speed."""
        tr, c = self.trips[j], self.clock[j]
        s = scheduled_s(t - tr.start - c.delay)
        v = scheduled_v(t - tr.start - c.delay)
        sd = math.sqrt(GPS_SD**2 + (CRUISE_MPS**2) * c.var + 25**2)
        return s, sd, v

    def _at_station(self, j: int, t: float) -> bool:
        """Whether the matcher thinks trip j is standing at a station now (its own estimate, not the truth)."""
        s_exp, sd, v = self._expected(j, t)
        return s_exp is not None and v == 0.0

    def update(self, dev: int, t: float, fix: tuple[float, float] | None) -> dict[int | None, float]:
        candidates = [j for j in self.trips if self._expected(j, t)[0] is not None]
        b = self.beliefs.get(dev)
        if b is None:
            # A phone seen for the first time may already be on a train (the app opened on board).
            b = self.beliefs[dev] = Belief()
            b.p = {OFF: 0.85, **{j: 0.15 / max(1, len(candidates)) for j in candidates}}

        # Transition: riders stay on or step off at a station; others board a train standing at a
        # station, or (rarely) are found already riding one.
        off = b.p.get(OFF, 0.0)
        prior: dict[int | None, float] = {OFF: off * (1 - P_JOIN * len(candidates))}
        for j in candidates:
            stay = b.p.get(j, 0.0)
            at = self._at_station(j, t)
            board = P_BOARD / 3 if at else 0.0
            leave = (P_ALIGHT if at else 0.0) + (P_DOUBT if fix is not None else 0.0)  # no news in a tunnel is not doubt
            prior[j] = stay * (1 - leave) + off * (board + P_JOIN)
            prior[OFF] += stay * leave - off * board
        # Phones on a trip that has just finished get off.
        prior[OFF] = max(1e-9, prior[OFF] + sum(v for k, v in b.p.items() if k is not None and k not in prior))
        if fix is None:
            post = prior  # tunnel: no evidence, keep the belief and let the trains move on
        else:
            s_obs, d_obs = fix
            speed = None
            t_prev = b.last[0] if b.last else None
            if b.last and t - b.last[0] > 0:
                speed = abs(s_obs - b.last[1]) / (t - b.last[0])
            b.last = (t, s_obs)
            b.speed = speed
            k_near = round(s_obs / SPACING_M)
            if speed is not None and speed < 1.5 and abs(s_obs - k_near * SPACING_M) < 60:
                b.station_stop = t
            # Lateral offset after snapping: riders sit on the track (GPS noise only); anyone else
            # can be anywhere within the corridor, a road beside a viaduct included.
            lat_on = 2 * gauss(d_obs, GPS_SD) if d_obs < NEAR_TRACK_M else 1e-4
            lat_off = 1 / CORRIDOR_M
            post = {}
            # Not on a train: anywhere along the line, standing, walking or driving.
            post[OFF] = prior[OFF] * where_off(s_obs) * lat_off * (1 / 20 if speed is None else speed_off(speed))
            for j in candidates:
                s_exp, sd, v_exp = self._expected(j, t)
                assert s_exp is not None
                like = gauss(s_obs - s_exp, sd) * lat_on
                if speed is not None and t_prev is not None:
                    # Compare like with like: the train's average speed over the same interval.
                    s_before = self._expected(j, t_prev)[0]
                    v_exp = abs(s_exp - s_before) / (t - t_prev) if s_before is not None else v_exp
                like *= 1 / 20 if speed is None else speed_on(speed, v_exp)  # moving like the train, stopping where it stops
                post[j] = prior.get(j, 0.0) * like
        z = sum(post.values()) or 1.0
        b.p = {k: v / z for k, v in post.items() if v / z > 1e-6 or k is OFF}
        if OFF not in b.p:
            b.p[OFF] = 1e-6
        return b.p

    def riding(self, dev: int, j: int, t: float) -> bool:
        """The decision rule: probably on trip j and, while it runs between stations, moving with it
        (a phone standing on the platform as its train leaves is not counted)."""
        b = self.beliefs.get(dev)
        if not b or b.p.get(j, 0.0) < 0.7:
            return False
        if self._at_station(j, t) or b.speed is None or (b.last and b.last[0] < t):
            return True  # at a station, or no fresh fix (tunnel): the belief alone decides
        return b.speed >= 5.0

    def learn_positions(self, t: float, fixes: dict[int, tuple[float, float] | None]) -> None:
        """Crowd-sourced vehicle location: phones confidently on a moving trip pull its delay towards them."""
        for dev, fix in fixes.items():
            if fix is None:
                continue
            b = self.beliefs.get(dev)
            if not b:
                continue
            j, pj = max(((k, v) for k, v in b.p.items() if k is not None), key=lambda kv: kv[1], default=(None, 0.0))
            # Only phones that are surely on a train and moving at train speed say where it is;
            # someone standing on a platform while a train stands there says nothing new.
            # A car on the road beside the line moves like a train too; a rider also stood at a
            # station shortly before (where they boarded), so only those phones are believed.
            if j is None or pj < 0.95 or b.speed is None or b.speed < 8 or self._at_station(j, t) or t - b.station_stop > 600:
                continue
            tr, c = self.trips[j], self.clock[j]
            s_sched = scheduled_s(t - tr.start - c.delay)
            if s_sched is None:
                continue
            # Ahead of where we thought means less delay: a Kalman step on the delay in seconds.
            implied = c.delay - (fix[0] - s_sched) / CRUISE_MPS
            r = (GPS_SD / CRUISE_MPS) ** 2 + 6.0**2
            if (implied - c.delay) ** 2 > 9 * (c.var + r):
                # Far off: one phone may be a wrong match, but several in a row mean the estimate
                # is wrong, so it is opened up again rather than defended.
                c.misses += 1
                if c.misses >= 3:
                    # Start again from the timetable, not from the estimate that went wrong.
                    c.delay, c.var, c.misses = 0.0, PRIOR_SD**2, 0
                continue
            c.misses = 0
            k = c.var / (c.var + r)
            c.delay += k * (implied - c.delay)
            c.var = max(3.0**2, (1 - k) * c.var)
            # An estimate a whole headway out is the train in front or behind, not this one.
            c.delay = max(-MAX_DELAY_S, min(MAX_DELAY_S, c.delay))

    def keep_order(self) -> None:
        """Trains cannot overtake: two estimates must not slide onto the same physical train.

        Without this, a trip whose estimate is wide can lock onto the train in front or behind
        (about one headway off) and take its riders. Each pair of neighbours is kept at least
        MIN_GAP apart; the less certain one gives way and is marked less certain.
        """
        ids = sorted(self.trips)
        for a, b in zip(ids, ids[1:]):
            ta, tb = self.trips[a], self.trips[b]
            ca, cb = self.clock[a], self.clock[b]
            gap = (tb.start + cb.delay) - (ta.start + ca.delay)
            if gap >= MIN_GAP_S:
                continue
            push = MIN_GAP_S - gap
            if cb.var >= ca.var:
                cb.delay += push
                cb.var = max(cb.var, 30.0**2)
            else:
                ca.delay -= push
                ca.var = max(ca.var, 30.0**2)

    def drift(self, dt: float) -> None:
        """Trains gain and lose time: each estimate gets a little less certain as time passes."""
        for c in self.clock.values():
            c.var = min(PRIOR_SD**2, c.var + 1.0 * dt)


# ------------------------------------------------------------------------------------- load estimate


def fuse(prior_mean: float, prior_cv: float, phones: float, p: float) -> tuple[float, float]:
    """Gamma prior on riders N (from the crowding model) and a Poisson count of phones ~ Poisson(p N).

    Posterior: Gamma(a + n, b + p). Few phones: close to the model. Many: close to n / p.
    """
    a = 1 / prior_cv**2
    b = a / max(prior_mean, 1.0)
    a2, b2 = a + phones, b + p
    return a2 / b2, math.sqrt(a2) / b2


# ------------------------------------------------------------------------------------- simulation


def simulate(p: float, seed: int = 7, quiet: bool = False) -> dict[str, float]:
    rng = random.Random(seed)
    hour = 3600.0
    trips: list[Trip] = []
    delay = 0.0
    for i in range(int(hour / HEADWAY_S) + 6):
        # Delays carry over from train to train, and trains never overtake.
        delay = 0.6 * delay + rng.gauss(0, 40)
        if trips:
            delay = max(delay, trips[-1].delay - HEADWAY_S + 60)
        trips.append(Trip(i, i * HEADWAY_S, delay))

    # Riders: each station sends riders downstream; busier towards the middle of the line.
    devices: list[Device] = []
    riders_on: dict[tuple[int, int], int] = {}  # (trip, leg) -> riders, everyone (the truth)
    for tr in trips:
        for k in range(STATIONS - 1):
            boarding = _poisson(rng, 45 + 60 * math.sin(math.pi * k / (STATIONS - 1)))
            for _ in range(boarding):
                dest = rng.randint(k + 1, STATIONS - 1)
                for leg in range(k, dest):
                    riders_on[(tr.id, leg)] = riders_on.get((tr.id, leg), 0) + 1
                if rng.random() < p:
                    devices.append(Device(len(devices), "rider", trip=tr, board=k, alight=dest,
                                          wait=rng.uniform(20, 240), road_s=rng.uniform(-40, 40), road_v=rng.uniform(2, 12)))
    n_riders = sum(1 for d in devices if d.kind == "rider")
    # Phones that are not riding: as many as the riders' phones, so matching has real work to do.
    for _ in range(n_riders // 3):
        devices.append(Device(len(devices), "platform", station=rng.randrange(STATIONS), road_s=rng.uniform(-40, 40), road_v=rng.uniform(4, 20)))
    for _ in range(n_riders // 3):
        devices.append(Device(len(devices), "road", road_s=rng.uniform(0, LINE_M * 0.6), road_v=rng.uniform(8, 17)))
    for _ in range(n_riders // 3):
        devices.append(Device(len(devices), "walker", road_s=rng.uniform(0, LINE_M), road_v=rng.uniform(10, 120)))

    matcher = Matcher(trips)
    tp = fp = fn = 0
    by_kind: dict[tuple[str, str], int] = {}
    errs: dict[str, list[float]] = {"model": [], "phones": [], "fused": []}
    # Calibration: phones counted per rider, learned in the first half hour from the truth (in
    # real life from gate entries on data.gov.my), then used for every estimate after it. It
    # folds the share of riders sharing location and the share the matcher catches into one.
    cal_phones = cal_riders = 0.0
    tick = 10.0
    for step in range(int((hour + 1800) / tick)):
        t = step * tick
        fixes: dict[int, tuple[float, float] | None] = {}
        truth: dict[int, int | None] = {}
        kinds: dict[int, str] = {}
        for dev in devices:
            if dev.kind == "rider":
                assert dev.trip
                if t < dev.boards_at() - dev.wait:
                    continue  # not at the station yet
            pos = dev.position(t, rng)
            if pos is None:
                continue
            fixes[dev.id] = gps_fix(pos, rng)
            riding = dev.kind == "rider" and dev.trip is not None and t >= dev.boards_at()
            truth[dev.id] = dev.trip.id if riding and dev.trip else None
            kinds[dev.id] = dev.kind
        for dev_id, fix in fixes.items():
            matcher.update(dev_id, t, fix)
        matcher.learn_positions(t, fixes)
        matcher.keep_order()
        matcher.drift(tick)

        # Score matching once every minute, after the first ten minutes (beliefs need a few pings).
        if t >= 600 and step % 6 == 0:
            for dev_id in fixes:
                bp = matcher.beliefs[dev_id].p
                guess, pg = max(bp.items(), key=lambda kv: kv[1])
                actual = truth[dev_id]
                # Scored while trains run between stations, which is when loads are read: at a
                # platform a phone waiting and a phone on board are in the same place.
                if any(j is not None and matcher._at_station(j, t) for j in (guess, actual)):
                    continue
                said = guess if guess is not None and matcher.riding(dev_id, guess, t) else None
                if said is not None:
                    if said == actual:
                        tp += 1
                    else:
                        fp += 1
                        key = (kinds[dev_id], "wrong train" if actual is not None else "not riding")
                        by_kind[key] = by_kind.get(key, 0) + 1
                if actual is not None and said != actual:
                    fn += 1

            # Load per moving trip, mid-way between stations.
            for tr in trips:
                x = t - tr.start - tr.delay
                s = scheduled_s(x)
                if s is None or tr.dwelling_at(t) is not None:
                    continue
                leg = int(s // SPACING_M)
                true_n = riders_on.get((tr.id, leg), 0)
                if true_n < 20:
                    continue
                phones = sum(1 for d in fixes if matcher.riding(d, tr.id, t))
                if t < 1800:
                    cal_phones += phones
                    cal_riders += true_n
                    continue
                p_eff = max(1e-3, cal_phones / max(1.0, cal_riders))
                # The crowding model: right on average, off by about 30% train to train.
                model = true_n * math.exp(rng.gauss(0, 0.3))
                fused, _ = fuse(model, 0.3, phones, p_eff)
                errs["model"].append(abs(model - true_n) / true_n)
                errs["phones"].append(abs(phones / p_eff - true_n) / true_n)
                errs["fused"].append(abs(fused - true_n) / true_n)

    delay_err = statistics.median(abs(matcher.clock[tr.id].delay - tr.delay) for tr in trips[2:-6])
    out = {
        "penetration": p,
        "precision": tp / max(1, tp + fp),
        "recall": tp / max(1, tp + fn),
        "model_err": statistics.median(errs["model"]),
        "phones_err": statistics.median(errs["phones"]),
        "fused_err": statistics.median(errs["fused"]),
        "delay_err_s": delay_err,
        "phones_on_trains": n_riders,
        "false_matches": by_kind,
        "counted_per_rider": cal_phones / max(1.0, cal_riders),
    }
    if not quiet:
        print(f"Penetration {p:.0%}: {n_riders} riders' phones and {len(devices) - n_riders} other phones in one hour")
        print(f"  Trip matching   precision {out['precision']:.1%}   recall {out['recall']:.1%}")
        print(f"  Train position  median error {delay_err:.0f} s (prior spread 50 s), learned from the phones")
        print(f"  Counted phones per rider {out['counted_per_rider']:.1%} (calibrated in the first half hour)")
        print(f"  Riders per train, median error:  model {out['model_err']:.0%}   phones alone {out['phones_err']:.0%}   fused {out['fused_err']:.0%}")
    return out


def _poisson(rng: random.Random, lam: float) -> int:
    """Knuth's method; fine for the small means used here."""
    limit, k, prod = math.exp(-lam), 0, rng.random()
    while prod > limit:
        k += 1
        prod *= rng.random()
    return k


def _col(rs: list[dict], k: str) -> str:
    v = sorted(r[k] for r in rs)
    return f"{statistics.median(v):.0%} ({v[0]:.0%}-{v[-1]:.0%})"


def _med(rs: list[dict], k: str) -> float:
    return statistics.median(r[k] for r in rs)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--p", type=float, default=0.05, help="share of riders sharing location (default 0.05)")
    ap.add_argument("--sweep", action="store_true", help="try several penetration rates")
    args = ap.parse_args()
    if args.sweep:
        print("Median over 4 runs (range in brackets). Error = median error in riders per train.")
        print(f"{'p':>4}  {'matching precision':>20}  {'recall':>16}  {'model':>6}  {'phones':>7}  {'fused':>6}")
        for p in (0.01, 0.02, 0.05, 0.10):
            rs = [simulate(p, seed=seed, quiet=True) for seed in (1, 2, 3, 4)]

            print(f"{p:>4.0%}  {_col(rs, 'precision'):>20}  {_col(rs, 'recall'):>16}  {_med(rs, 'model_err'):>6.0%}  {_med(rs, 'phones_err'):>7.0%}  {_med(rs, 'fused_err'):>6.0%}")
    else:
        simulate(args.p)
