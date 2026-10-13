# AERA build plan

Companion to [AERA_BRS.md](AERA_BRS.md). This file records how the first delivery is
organised and which defaults were chosen where the BRS leaves a decision open.

## Delivery 1: twin service and web app

Covers BRS phases 0 to 4, simulator-first, so the whole product runs on a laptop with no
hardware, broker or Supabase project.

| Area | Requirements | Where |
| --- | --- | --- |
| GTFS import, line data | SIM-01, SIM-06, NET-01, NET-02 | `backend/aera_twin/gtfs/importer.py` → `data/lines/KJ.json` |
| Simulation clock and disruptions | SIM-02, SIM-03, SIM-04 | `backend/aera_twin/simclock.py`, `frontend/lib/sim/` |
| Train positions in the browser | NET-03, TWN-04, SIM-02 | `frontend/lib/sim/trains.ts` (Python twin: `backend/aera_twin/timetable.py`) |
| Station definition as data | TWN-01, §8.3 | `data/stations/*.json`, schema in `packages/contracts` |
| Ingest and validation | IOT-01 to IOT-06 | `backend/aera_twin/ingest/` |
| Occupancy engine | OCC-01 to OCC-06, §9.6 | `backend/aera_twin/engine/occupancy.py` (tested) |
| Alert rules | ALT-01 to ALT-05 | `backend/aera_twin/rules/alerts.py` (tested) |
| Simulator | IOT-02, OCC-07, §9.8 | `backend/aera_twin/simulator/` |
| Realtime to browser | IOT-07, NFR-05 | WebSocket `/ws`, `frontend/lib/realtime.ts` |
| Network twin | NET-01 to NET-08, UX-01 | `frontend/features/network-twin/` |
| Station twin | TWN-01 to TWN-10, UX-04 | `frontend/features/station-twin/` |
| Operator console | OPS-01 to OPS-04, ALT-06, ALT-07 | `/console` |
| Admin | ADM-01 to ADM-04, IOT-10 | `/admin/*` |
| Passenger view | PAX-01, PAX-02, PAX-04, ALT-08 | `/`, `/station/[id]` |
| Commands back to the model | IOT-08 | published on `aera/v1/{station}/{device}/cmd` |

## Defaults for open decisions (BRS §16.3)

Each default is a one-file change. Confirm or replace them with the team.

| Decision | Default used | Change it in |
| --- | --- | --- |
| Hero station | Taman Jaya (KJ20), elevated, one concourse, two side platforms | `data/stations/KJ20.json` (any file there makes that stop a twin) |
| Product name | AERA | `frontend/lib/brand.ts` |
| MQTT broker | In-process bus. Set `MQTT_URL` to use a real broker | `backend/.env` |
| Twin service language | Python with FastAPI | n/a |
| Auth | Dev accounts issued by the twin service (HS256 JWT) | replace with Supabase Auth in the persistence step |
| Persistence | In memory, with config/incidents/users snapshotted to `backend/var/state.json` | Supabase step |

## Deliberate deviations

- **Repository layout uses `frontend/` and `backend/`** at the top level instead of
  `apps/web` and `apps/twin-service` from BRS §11.5. Shared `data/`, `packages/contracts/`
  and `docs/` stay as described.

- **Trains are drawn with MapLibre layers, not deck.gl.** Around 50 trains do not need a
  second GPU stack, and it keeps the first view light (NFR-03). deck.gl can be added later
  if more lines are shown (NET-09).
- **The realtime channel is the twin service's own WebSocket** rather than Supabase Realtime.
  The twin service stays the single writer (§11.3.2). When Supabase is wired, the same
  messages can be fanned out through Realtime without changing the browser store.

## Status of delivery 1

Built and verified locally on 7 October 2026:

- Backend: 47 automated tests pass, covering BRS 14.1 criteria 3 to 9 through the runtime and API.
- Frontend: production build passes; train positions are checked against Python fixtures.
- Browser run (headless Chrome, desktop and 360 px phone): network twin, station dive, exploded and
  plan views, console, scenario director, ten gate crossings counted exactly, crowding alert shown
  to passengers and sent to the model's LEDs, estimated zones while devices are offline.

Not yet done from phases 0 to 4: Supabase schema and RLS (NFR-10), deployment pipeline, a formal
accessibility audit (14.1 criterion 10). Should items included early: exploded view, crowd
particles, living sky, analytics with CSV export, PWA manifest, wall mode.

## Next deliveries

1. Supabase schema, RLS and persistence adapter (§11.7, NFR-10), Supabase Auth in the web app.
2. Managed MQTT broker with TLS and per-device credentials (NFR-09), ESP32 firmware on the contract.
3. Should items: analytics heatmap and CSV, time scrubber, bilingual UI, PWA.

## Delivery 2: in-train crowding (7 October 2026)

Scope changed by the team: IoT and station zones are parked; the product focuses on congestion
inside trains, predicted from government data, with a redesigned interface.

| Area | What was built | Where |
| --- | --- | --- |
| Crowding model | Typical week of passengers per hour on every segment and direction, from 12 weeks of daily origin-destination gate taps (Rapid Rail) shaped by hourly KTM Komuter taps. Back-test: median daily error 4.7% over 28 days | `backend/aera_twin/ridership/`, `data/models/KJ.json` |
| Train loads | Every simulated train carries a load: segment flow x scheduled headway / 800, scaled by the actual gap behind the train ahead, plus event surges | `frontend/lib/crowd/model.ts` |
| Crowding levels | Quiet, Comfortable, Busy, Crowded, Packed (0/20/50/75/95% of capacity) | `frontend/lib/crowd/levels.ts` |
| What-if | Train fault, suspension and event crowd scenarios change train gaps and loads | `backend/aera_twin/simulator/scenarios.py` |
| Interface | Live strip map, station board with per-car crowding and advice, ride planner, insights | `frontend/features/` |

Decisions to confirm with the team:
- Crowding thresholds and wording (product choice, one file).
- Per-car shares are modelled (middle cars fuller), not measured.
- Peaks over 100% mean demand exceeds capacity. The Komuter-based hourly shape may overstate the
  sharpest LRT peaks; an hourly Rapid Rail dataset would remove this.

## Delivery 3: visual redesign (7 October 2026)

At the team's request the interface moved to a bright, modern mobile-app style: white
background, Plus Jakarta Sans, transit blue with cyan and orange accents, English crowding
levels with a distinct people icon per level, a bottom tab bar and "My station" card on
phones, and a 3D four-car train built from Kenney's CC0 Train Kit subway cars. The Komuter
hourly profile is now smoothed with a 3-hour kernel, removing an hour-to-hour zigzag.

## Delivery 4: the map is the app (7 October 2026)

After a second benchmark against Mini Tokyo 3D the requirements were rethought in
[AERA_UX_V2.md](AERA_UX_V2.md) (IDs `MAP-`, `CARD-`, `FIND-`, `PIC-`, `TRAIN-`).

| Area | What was built | Where |
| --- | --- | --- |
| Full-screen map | The live page is the map. Search, clock and service status float top left, round map buttons on the right, crowding key bottom right. The station strip and line panel are parked | `frontend/features/live/{LiveView,MapChrome}.tsx`, `_parked/strip-ui/` |
| Cards | One card at a time: My station, a station (photo, next trains by car, best car, advice, hourly bars) or a train (camera modes, 3D train, next stops). Desktop: left column; phones: bottom sheet with peek, half and full | `HomeStationCard.tsx`, `StationCard.tsx`, `TrainDetail.tsx`, `Sheet.tsx` |
| Search | Type-ahead over names and codes, keyboard navigable, "/" to focus, nearest station from the browser's location | `MapChrome.tsx` |
| Station photos | 37 Wikimedia Commons photos stored in the app with author and licence, refreshed by `npm run photos` | `frontend/scripts/fetch-station-photos.mjs`, `public/stations/`, `lib/stationPhotos.json` |
| 3D train | Innovia Metro 300 model (rounded silver body, blue doors and cab surround, red and blue stripes, windscreen). Crowding on roof and skirt. Same model on the map and in cards; Kenney cars no longer used | `frontend/features/train3d/innovia.ts` |
| Sharing | Selection kept in the URL; Share buttons copy the link. `/station/[id]` redirects to `/?station=` | `LiveView.tsx`, `app/station/[id]/page.tsx` |

Not done from AERA_UX_V2: TRAIN-04 for delayed trains (held trains already carry a beacon;
the live feed has no per-train delay yet).

## Delivery 5: other ways, Ask AERA, roles (8 October 2026)

From a gap review against the BRS and UX v2, recorded with new IDs in
[AERA_V3.md](AERA_V3.md) (`ROUTE-`, `ASK-`, `MAPC-`, `INS-`, `ROLE-`).

| Area | What was built | Where |
| --- | --- | --- |
| Other ways to travel | All Rapid Rail lines from the GTFS feed with estimated transfers; a tested route advisor offering wait, go round or bus/e-hailing when a Kelana Jaya ride is blocked | `backend/aera_twin/gtfs/network.py`, `frontend/lib/advisor/`, `/trip` |
| Ask AERA | Chat on `/ask` and as the desktop map card. A free OpenRouter model chooses tools that the browser runs on the twin; quick answers without a model | `backend/aera_twin/assistant.py`, `frontend/lib/assistant/`, `features/assistant/` |
| Crowding on the map | Crowding bands on each track, crowding words on station labels, the line as a list, late-train beacons | `GeoMap.tsx`, `geo3d.ts`, `LineList.tsx` |
| Insights | Answer-first: right now, when my ride is calmer, busiest stretches; charts under "Explore the data", readable and tappable on phones | `features/insights/`, `features/charts/` |
| Roles | Line control for operators (impact, extra train with predicted relief, notices); admin users, crowding levels and audit log; persona sign-in in development | `features/control/`, `features/admin/AdminPages.tsx`, `/api/control/*` |
| Phone polish | Sheet drags by its content with flick-to-snap; PWA icons and white manifest; About credits | `Sheet.tsx`, `app/manifest.ts`, `public/icons/` |

Deliberate deviations: other ways go beyond BRS §6.4 (journey planning out of scope) for
disruptions only; the chatbot moves from Could to Must, kept tied to the twin's tools.

## Delivery 6: live data, rider reports, train sensors (12 October 2026)

Checked what data.gov.my publishes live: vehicle positions for KTMB and Rapid KL buses, none for
Rapid Rail. Details and the gap list in [LIVE_DATA.md](LIVE_DATA.md).

| Area | What was built | Where |
| --- | --- | --- |
| Live feed watcher | Polls the Rapid Rail GTFS Realtime feed, reports it unavailable today, snaps vehicles to the track and compares them with the timetable once it exists | `backend/aera_twin/feeds/gtfs_rt.py`, `/api/live/feed` |
| Rider crowding | Reports from the train card; opt-in phone locations matched to trains (backend only); daily-rotating pseudonyms, rate limits, outlier rejection, 3-phone minimum | `backend/aera_twin/crowdsource/riders.py`, `/api/crowd/*`, `TrainDetail.tsx` |
| Train sensors | `CarCount` contract (camera, door counter, load-weigh) over MQTT or HTTP; edge sender with offline queue, YOLO camera counter, demo sender | `contracts.py`, `crowdsource/sensors.py`, `edge/` |
| Fusion | Inverse-variance blend with a half-life, server and browser using the same rule | `crowdsource/fusion.py`, `frontend/lib/crowd/observed.ts` |
| Quality gates | Ruff lint, `npm run check`, GitHub Actions CI with production build, Claude Code Stop hook running the checks | `backend/pyproject.toml`, `package.json`, `.github/workflows/ci.yml`, `.claude/hooks/quality-check.sh` |

Not done: a location-sharing switch in the UI; observed crowding on station boards, the My station
card and Ask AERA (they call `engine.departures` directly; the map, line list and train cards
blend it); calibration of the model's per-train error and of phone
penetration against real data.

