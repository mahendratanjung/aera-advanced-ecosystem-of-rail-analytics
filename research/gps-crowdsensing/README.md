# Train crowding from riders' phones: design note and reference code

Status: research only, **not wired into AERA**. `crowdsense.py` is a standalone, standard-library
reference implementation with a simulator, so the method can be judged on numbers before any of
it goes into `backend/aera_twin/crowdsource/`.

```bash
python3 research/gps-crowdsensing/crowdsense.py           # one run, 5% of riders sharing
python3 research/gps-crowdsensing/crowdsense.py --sweep   # 1-10%, four runs each (about 2 min)
```

## 1. The question

If many riders open AERA and agree to share their location, can we count how many people are on
each train, better than the crowding model alone? Google Maps does this for road traffic. Trains
are harder in four ways:

1. **Who is on the train?** A phone on the platform, in a car on the road beside the viaduct, or
   in a shop under the station is in the same place as a phone on the train.
2. **Which train?** Trains three minutes apart on the same track look alike, and the timetable is
   off by a minute or two. AERA has no live train positions (data.gov.my publishes none for Rapid Rail).
3. **No GPS underground.** Ampang Park to Pasar Seni is in a tunnel.
4. **Few phones.** If 2% of riders share, a train of 500 carries about 10 sharing phones. That is
   a noisy count.

## 2. What AERA does today

`backend/aera_twin/crowdsource/riders.py` snaps each ping to the track and counts a phone as on a
train when it is within 450 m of a simulated train and moving faster than 3 m/s. Phones per train
divided by a fixed 2% penetration gives riders; `fusion.py` blends that with the model by inverse
variance. It is simple and private (daily pseudonyms, k-anonymity of 3), but it decides from one
ping, cannot tell a car beside the line from a train, trusts the timetable for where trains are,
and assumes penetration instead of measuring it.

## 3. The proposed method

```
phone (on device)          server, per phone              server, per train            out
-----------------          -----------------              -----------------            ---
GPS fix                    HMM belief                     where is it really?          riders on board
 -> snap to track    --->   P(not riding), P(trip j)  --->  (learned from riders)  ---> per train, per leg
 -> send s, d, speed        updated every ping              phones counted              platform waiting
    (no lat/lon)            decision rule                   Gamma-Poisson fusion        train positions
```

### 3.1 On the phone: send a distance, not a position

The app already ships the track geometry. The phone snaps each fix itself and sends only
`(pseudonym, t, s along the line, d off the line, speed, accuracy)`; latitude and longitude never
leave it. Phones far from the corridor (d > 150 m) send nothing. Sampling adapts: every 5 s when
moving near the line, 15 s when still, off when the accelerometer says the phone is not moving.

### 3.2 Per phone: a small hidden Markov model

States: `OFF` (not riding) or `trip j` for each train now on the line. Each ping updates the
belief online (forward algorithm, O(trains near the phone) per ping).

- **Emission, on trip j**: Gaussian on `s - expected position of j` (spread = GPS error plus how
  unsure we are where j is), offset `d` near zero, and **speed matching the train's average speed
  over the same interval**. Comparing like with like matters: a train that left the platform five
  seconds ago averaged 8 m/s, not 16.
- **Emission, OFF**: people who are not riding are **concentrated at stations** (waiting,
  meeting, shopping) and spread along the corridor otherwise, at any offset, standing, walking
  or driving. Modelling this one fact cut false matches of platform phones by more than half.
- **Transitions**: board only a train standing at your station (by the server's own estimate,
  never the truth); alight only at stations; a small chance that an app opened on board is
  already riding; and a 3% per ping **doubt** that a match was wrong all along, so beliefs never
  become certain and recover within one or two pings. In a tunnel there is no doubt: no news is
  not evidence.
- **Decision rule**: count a phone on train j when P(j) ≥ 0.7 and, while j runs between
  stations, the phone is moving with it. Never sum small probabilities over all phones: 1,000
  phones at 1% each make ten ghost riders.

### 3.3 Per train: learn where it really is (crowd-sourced train positions)

Phones confidently on a train tell us where that train is. A Kalman filter per train estimates its
delay against the timetable, with four guards that each fixed a failure seen in the simulator:

| Guard | Failure it prevents |
| --- | --- |
| Learn only from phones moving at train speed that **stood at a station in the last 10 minutes** (they boarded there) | Cars on a road beside the line dragging a train's estimate |
| Gate out phones more than 3 sigma off; after 3 misses in a row, **restart from the timetable** (not from the wrong estimate) | An estimate locking onto a wrong value with false confidence |
| **Trains cannot overtake**: neighbouring estimates stay at least 0.4 headway apart | Two estimates sliding onto the same physical train |
| Bound estimates to 2.5x the usual delay spread | An estimate a whole headway out (the train in front) |

This is a useful product on its own: **live train positions from riders**, which AERA does not
have today. With them the twin can show a late train late, and the crowding model's gap factor
(actual vs scheduled wait) becomes real.

### 3.4 From phones to riders: calibrate, then fuse

- **Calibrate "counted phones per rider", never penetration alone.** What matters is penetration
  times the matcher's detection rate. Estimate it per station and hour as phones seen boarding
  divided by gate entries from data.gov.my (daily, so smooth it over weeks with a Beta-Binomial
  prior and per-station multipliers).
- **Fuse with the crowding model** (Gamma-Poisson): prior on riders N from the model,
  Gamma(a, b) with mean = model and CV = model error; phones n ~ Poisson(p_eff N). Posterior
  Gamma(a + n, b + p_eff): with few phones it stays near the model, with many it follows the
  phones, with no tuning. This replaces the fixed inverse-variance weights in `fusion.py`.
- Read loads **between stations** (load is constant there), not during dwells.

### 3.5 Results from the simulator

10 stations, one hour, trains every 3 minutes running up to two minutes off timetable (delays carry
from train to train, no overtaking), riders waiting 20 s to 4 min on platforms, GPS noise 15 m,
a 2 km tunnel, and as many non-rider phones as rider phones (platform loiterers, cars on a road
35 m from the track that stop at lights, walkers). Crowding model error 30% per train.

```
   p    matching precision            recall   model   phones   fused
  1%         93% (58%-96%)     79% (43%-87%)     20%      59%     20%
  2%         81% (65%-94%)     76% (56%-84%)     19%      44%     20%
  5%         89% (85%-94%)     80% (76%-84%)     20%      25%     17%
 10%         88% (68%-94%)     80% (59%-84%)     20%      21%     18%
```

(median over four runs, range in brackets; error = median error in riders per train; train
positions were learned to within about 1 s in every run.)

What this says:

- **Below about 5% of riders sharing, phones add little to the load estimate**, because counts of
  a few phones are noisy. Train positions, however, are already learned well at 1-2%.
- **At 5-10% the fused estimate beats the model**, modestly (about 17% vs 20% error). Phones
  alone match the model only at about 10%.
- **The weak runs share one failure: aliasing.** When neighbouring trains are both well off
  timetable, the labels can shift by one train as a block: every train's riders are consistently
  matched to the next trip id, and every per-phone check passes. It needs an outside anchor (see 5).

## 4. Privacy and abuse

- No raw position leaves the phone (3.1); the server keeps a belief per daily pseudonym, dropped
  10 minutes after the last ping. Only per-train counts are stored, never trajectories.
- Publish a train's phone-based estimate only with at least k = 5 phones on it; add Laplace noise
  (epsilon about 1 per train per 5 minutes) to any count shown publicly.
- One phone, one vote: rate limits per pseudonym and per address (already in `riders.py`),
  plausibility checks (no teleporting, no 60 m/s), and a device's weight drops when it often
  disagrees with the others on its train. Spoofing a crowd needs many devices, which rate limits
  and attestation (Play Integrity / App Attest) make expensive.

## 5. Making it production grade

| Need | How |
| --- | --- |
| Anchor train identities (the aliasing failure) | Terminal dispatch times (close to the timetable), operator train-control data (the line runs CBTC, so Prasarana knows every train's position) or a BLE beacon per train |
| Per-car loads | GPS cannot split 20 m cars. A BLE beacon per car (phone reports the strongest) or a "which car are you in" tap. Until then cars stay modelled |
| Platforms | Phones in `OFF` near a station: waiting riders per platform, for operators |
| Scale (100k riders sharing, a ping every 10 s: about 10k messages a second) | HTTPS ingest into a log (Redpanda/Kafka, or Redis Streams at first), partitioned by pseudonym so each phone's HMM lives in one worker's memory; a per-train aggregator emits every 5 s to Redis; the existing WebSocket fans out. Python is fine to a few thousand pings a second per core; the HMM step is tiny |
| Validation | Gate taps (daily totals), manual counts on sample trips, load-weigh or camera counts where trains have them (`edge/`), and replaying recorded pings |
| Battery | Adaptive sampling (3.1); geofence wake-up near stations; nothing in the background unless the rider opts in |

## 6. Roll-out

1. **Now (built)**: nearest-train matching, k = 3, fixed penetration, inverse-variance fusion.
2. **Next**: on-device snapping and the new ping format; the HMM and decision rule server-side;
   Gamma-Poisson fusion; calibration against gate entries. Shadow mode first: compute, compare with
   the model, publish nothing until it beats the model on held-out days.
3. **Then**: crowd-sourced train positions into the twin (late trains drawn late), platform
   waiting for operators.
4. **Later**: per-car beacons, an operator feed as the identity anchor, differential privacy on
   public counts.

## 7. Files

- `crowdsense.py`: simulator, on-device snapping, the per-phone HMM (`Matcher.update`), the
  decision rule (`Matcher.riding`), train-position learning with its guards (`learn_positions`,
  `keep_order`, `drift`), Gamma-Poisson fusion (`fuse`) and the scoring.
