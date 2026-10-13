# Live data: what is real, what is predicted, and how to close the gap

Checked 12 October 2026 against the data.gov.my API.

## What AERA uses today

| Part of the twin | Source | Live? |
| --- | --- | --- |
| Stations, track shape, run times, headways | Prasarana GTFS Static for Rapid Rail KL (data.gov.my), imported into `data/lines/KJ.json` | Published timetable, refreshed when we re-import |
| Train positions | Computed from that timetable at the current Kuala Lumpur time (the clock chip says "Live time") | **No.** Where the timetable says a train should be, not where it is |
| Crowding inside trains | Model from data.gov.my daily origin-destination ridership (12-week window) shaped by KTM Komuter hourly taps | **No.** A typical-week prediction, back-tested at 4.7% median daily error |
| Other lines' trains (every Rapid Rail line, KTM Komuter, ERL) | Rapid KL GTFS Static, KTMB GTFS Static, ERL's published pattern (`data/network/trains.json`) | **No.** Timetable at real time |
| Other lines' crowding (Ampang, Sri Petaling, MRT Kajang and Putrajaya, Monorail, Shah Alam, both Komuter lines) | `data/models/network.json`: the same Rapid Rail OD data routed across the network by quickest path; Komuter from its own hourly OD | **No.** Typical week only: does not react to delays. ERL and BRT publish no ridership, so they have none |
| Disruptions | Entered by operators or simulation scenarios | Manual |

So AERA follows the real timetable in real time, but trains and crowding are **predicted, not
observed**.

## Why it is not live yet

data.gov.my's GTFS Realtime API has live vehicle positions for KTMB and Rapid KL **buses**, but not
for Rapid Rail. The endpoint answers:

```
GET https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-rail-kl
404 {"details": ["Vehicle Position feed for prasarana (rapid-rail-kl) does not exist."]}
```

Their documentation says rapid-rail-kl "does not yet have stable realtime feeds", and that trip
updates and service alerts are planned for 2026. Ridership is published daily, not hourly.

## What was built to follow live data

1. **Feed watcher** (`backend/aera_twin/feeds/gtfs_rt.py`). Checks the Rapid Rail feed every 15
   minutes and reports its state at `GET /api/live/feed` and in the WebSocket snapshot. The day
   Prasarana publishes it, the watcher decodes each vehicle, snaps it to the track and reports how
   far it runs behind the timetabled train (`behind_s`). No code change needed; change
   `AERA_GTFS_RT_URL` to point elsewhere or leave it empty to turn it off.
2. **Crowding from riders** (`backend/aera_twin/crowdsource/riders.py`), the Google Maps idea:
   - *Reports*: on a train card, riders tap Quiet to Packed (`POST /api/crowd/reports`).
   - *Locations* (opt in, backend ready, no UI switch yet): phones send positions
     (`POST /api/crowd/pings`); a phone moving along the track next to a train, on two fixes in a
     row, counts as on it. Phones per train divided by the share of riders who share location
     estimates the load. Published only once 3 phones are on a train.
3. **Crowding from train sensors** (`backend/aera_twin/crowdsource/sensors.py`, contract
   `packages/contracts/car-count.schema.json`): cameras, door counters or load-weigh send per-car
   counts over MQTT `aera/v1/train/{device}/count` or `POST /api/ingest/train/{device}`. Edge code
   is in `edge/` (see `edge/README.md`).
4. **Fusion** (`backend/aera_twin/crowdsource/fusion.py`, `frontend/lib/crowd/observed.ts`). Every
   source becomes an estimate with an error size (rider report 18 points, camera 8, door counter 6,
   load-weigh 4) that fades with a 4-minute half-life. The browser blends it with the model by the
   same rule, so one report nudges the prediction and a sensor nearly replaces it, and the
   correction carries on to the next stops. Train cards say "Updated with 2 rider reports and 1
   camera count".

Privacy: device ids are replaced by a keyed hash that changes daily; positions are reduced to a
distance along the line and forgotten within 3 minutes; cameras send counts, never images.

## Gaps, in order of value

| # | Gap | Effect | How to close it |
| --- | --- | --- | --- |
| 1 | No live train positions for Rapid Rail | Delays and bunching are invisible unless an operator enters them | Ask Prasarana / data.gov.my for the rail feed (the watcher is ready); meanwhile infer delays from rider phones (gap 5) |
| 2 | No live crowding data | Crowding is a typical-week prediction | Rider reports (built); a sensor pilot on one train (code ready); Prasarana's own load-weigh or fare-gate data via a data-sharing agreement |
| 3 | Ridership is daily and published with a lag | The model cannot see today's events or weather | Rebuild the model nightly (`npm run model` on a schedule); scale today's prediction by how yesterday compared with a typical day |
| 4 | Hourly shape borrowed from KTM Komuter | Peaks may be overstated for the LRT | Hourly Rapid Rail gate counts (request from Prasarana); calibrate with rider and sensor data once collected |
| 5 | Location sharing has no UI switch and needs many users | No phone counts yet | Add an opt-in switch with a clear privacy note; set `penetration` from phones counted per day against gate counts |
| 6 | GPS fails in the tunnel (Ampang Park to Pasar Seni) | Phones cannot be matched underground | Rider reports still work there; Bluetooth beacons on platforms could mark stations |
| 7 | Public holidays use the weekday timetable | Wrong headways on holidays | Add Malaysian public holidays as Sunday service in both `timetable.py` and `trains.ts` |
| 8 | Report spam | Distinct fake devices could skew a train | Today: per-device and per-address limits, outlier rejection. Before launch: sign-in or app attestation for reporters |
| 9 | Per-car shares are modelled | The best-car tip is a guess | Per-car sensors; the contract already carries `car` |

## Running it

```bash
npm run dev                                   # twin service + web
cd edge && uv run --project ../backend python -m aera_edge.demo --level crowded   # pretend sensors
curl localhost:8000/api/live/feed             # live feed state
curl localhost:8000/api/crowd/observed        # observed crowding per train
```

Set `AERA_INGEST_TOKEN` before deploying; without it any device can send readings.
