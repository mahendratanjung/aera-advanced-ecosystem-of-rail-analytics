# AERA project context

Loaded automatically at the start of every Claude Code chat. Keep it current: a Stop hook
(`.claude/hooks/context-check.sh`) asks for an update whenever project files changed after
this file. Update "Current state" when facts change and add one entry to "Session log".

## Ground rules

- **Mahendra is the sole author.** Never add Claude/Anthropic attribution anywhere: no
  `Co-Authored-By`, no "Generated with Claude Code", no author fields. Do not commit unless asked.
- The folder is not a git repo. Do not `git init` unless asked.
- Requirements: `docs/AERA_BRS.md` (requirement IDs like `NET-03` are stable; quote them).
  The live experience follows `docs/AERA_UX_V2.md` (map-first; IDs `MAP-`, `CARD-`, `FIND-`,
  `PIC-`, `TRAIN-`).
  Delivery history and decisions: `docs/PLAN.md`. Run instructions: `README.md`.
- Layout: top-level `frontend/` (Next.js) and `backend/` (FastAPI), not `apps/*`.
- Keep colours, fonts, radii, shadows and motion in `frontend/styles/theme.css` only.
- Design direction (user's choice, 7 Oct 2026): bright modern mobile-app look on a **white
  background**, colourful but professional. Plus Jakarta Sans everywhere (tabular figures for
  times). Transit blue primary, cyan and orange accents, line red only for line identity.
  Cards with soft shadows and 16px radius, pill controls, Phosphor icons, bottom tab bar on
  phones. Experimenting with UI/UX is welcome; no emoji icons.
- **Use English for crowding labels**, never Malay words (no "sesak", "lengang" etc.).

## What AERA is now

UTP Technopreneurship project (Group 2). A digital twin of the **LRT Kelana Jaya Line** that
predicts **crowding inside every train** from government data. IoT and
station-zone features are **parked** (team decision, 7 Oct 2026), not deleted.

- Trains: schedule-driven simulation from Prasarana GTFS Static (`data/lines/KJ.json`, 37
  stations). Positions are a pure function of timetable + shared sim clock + disruptions.
- Crowding model: `data/models/KJ.json`, built by `backend/aera_twin/ridership/build.py` from
  data.gov.my daily origin-destination ridership (Rapid Rail, 12-week window) with the
  time-of-day shape from KTM Komuter hourly OD. Capacity 800 per 4-car train. Back-test median
  daily error 4.7%.
- Train load (browser, `frontend/lib/crowd/model.ts`): segment flow x scheduled headway /
  capacity, x gap factor (actual vs scheduled wait), + event surges, x scenario multiplier.
- Crowding levels (`frontend/lib/crowd/levels.ts`): Quiet <20%, Comfortable 20-50, Busy
  50-75, Crowded 75-95, Packed 95%+. Colours `--crowd-1..5` (emerald, amber, orange, rose,
  deep red; passes CVD and normal-vision separation checks), always with a per-level people
  icon and label. Loads over 100% are shown as "over capacity".
- The hourly shape comes from KTM Komuter taps smoothed with a 3-hour kernel (Komuter's
  sparse trains make raw hourly taps zigzag).
- Live page = full-screen 3D map (user's choice, 7 Oct 2026: no station list beside the map).
  Floating chrome like Mini Tokyo 3D: search + clock/service status top left, round map
  buttons right, crowding key bottom right. One card at a time (My station / station / train):
  desktop left column 400 px, phones a bottom sheet (peek/half/full) above the tab bar. The
  top bar is hidden on `/`. Selection lives in the URL (`/?station=KJ15`, `/?train=<trip>`).
- 3D map: tilted MapLibre camera, translucent extruded buildings from the Carto tiles, grey
  viaduct with a line-red stripe (translucent ribbon in the tunnel, `TUNNEL_M` approx.), white
  platform slabs. Trains are instanced three.js meshes in a MapLibre custom layer
  (`trainLayer.ts`) on left-hand tracks, sized up to a minimum on-screen size when zoomed out.
  Lighting follows the sun at the sim time (`lib/sim/sun.ts`, `--map-*-night/-dusk` tokens).
  Map switches (3D, underground, live sky, camera) live in `lib/ui.ts`; buttons drive the map
  through `mapApi` in `GeoMap.tsx`. Camera Follow / Chase / Orbit are in the train card.
- 3D train: Innovia Metro 300 model built in code (`features/train3d/innovia.ts`, livery
  tokens `--train-*`), shared by the map and the cards. Each car's roof and skirt carry its
  crowding colour. Kenney cars in `public/models/train/` are no longer used.
- Station photos: Wikimedia Commons, one per station in `frontend/public/stations/`, credits
  in `frontend/lib/stationPhotos.json` (shown on every card). Five are hand-picked in the
  script's `FILES` map.

## Map of the code

| Area | Path |
| --- | --- |
| GTFS importer | `backend/aera_twin/gtfs/importer.py` |
| Timetable (Python twin of `frontend/lib/sim/trains.ts`) | `backend/aera_twin/timetable.py` |
| Ridership model builder + tests | `backend/aera_twin/ridership/`, `backend/tests/test_ridership.py` |
| Sim clock, scenarios, disruptions (incl. `surge`) | `backend/aera_twin/simclock.py`, `simulator/scenarios.py`, `runtime.py` |
| API + WebSocket `/api/ws` | `backend/aera_twin/api/routes.py` (`/api/lines/KJ/model` serves the model) |
| Crowding engine + live feed | `frontend/lib/crowd/{model,levels,feed}.ts` |
| Crowding UI kit (tag, meter, icon, car diagram, scale) | `frontend/components/Crowd.tsx` |
| App shell (top bar, mobile tab bar) | `frontend/components/{TopBar,BottomNav,nav}.tsx` |
| 3D train | `frontend/features/train3d/{Train3D,TrainView}.tsx` |
| Live page (full-screen map, floating chrome, cards, sheet) | `frontend/features/live/{LiveView,MapChrome,StationCard,HomeStationCard,TrainDetail,Sheet}.tsx` |
| Station photos (fetch script, credits) | `frontend/scripts/fetch-station-photos.mjs`, `frontend/lib/{photos.ts,stationPhotos.json}` |
| 3D map geometry (viaduct, platforms, car poses) | `frontend/features/live/geo3d.ts`, drawn by `GeoMap.tsx` |
| 3D map trains (three.js custom layer) and day/night palette | `frontend/features/live/{trainLayer,daylight}.ts`, `frontend/lib/sim/sun.ts` |
| Innovia train model (map + cards) | `frontend/features/train3d/{innovia.ts,Train3D.tsx}` |
| Ride planner, insights, simulation admin | `frontend/features/{trip,insights,admin}/` |
| Charts (SVG, hover, sr-only tables) | `frontend/features/charts/` |
| Parked IoT/old UI and the old strip map (excluded from build) | `frontend/_parked/` |
| Parked IoT backend (still tested) | `backend/aera_twin/{engine,rules,ingest}/`, `data/stations/KJ20.json` |

Invariants:
- `frontend/lib/sim/trains.ts` must match `backend/aera_twin/timetable.py`; parity is tested
  against `frontend/lib/sim/__fixtures__/positions.json` (regenerate from Python if the
  algorithm changes).
- Zustand selectors must not return fresh `[]`/`{}`; use `NO_DISRUPTIONS` / `NO_LINKS`.
- MapLibre v6 worker is served from `public/maplibre/` (copied by `postinstall`) and set with
  `setWorkerUrl`.

## Commands

```bash
npm run setup      # uv sync (dev+data groups) + npm install
npm run dev        # twin service :8000 + web :3000 (AERA_SIM_START=17:30 to start at a time)
npm test           # backend pytest + frontend node tests
npm run model      # rebuild data/models/KJ.json from data.gov.my
npm run import:gtfs
npm run photos     # refresh station photos + credits from Wikimedia Commons
cd frontend && npm run build   # production build check
```

Dev logins: admin@aera.dev / aera-admin, operator@aera.dev / aera-operator.

## Current state

- Delivery 1 (twin service, IoT ingest, station 3D twin) done, now parked.
- Delivery 2 (in-train crowding) done. Delivery 3 (visual redesign: white, colourful,
  mobile-app style, English labels, 3D train) done and checked in headless Chrome at 1440 px
  and 390 px: 53 backend tests, 14 frontend tests, build passing. Dark mode was dropped for
  the app; only the map goes dark at night (sim clock).
- Delivery 4 (map is the app, `docs/AERA_UX_V2.md`) done: full-screen map, floating chrome,
  station photos, Innovia train model, search, shareable URLs. Checked in headless Chrome at
  1440 px and an emulated 390 px phone; 14 frontend tests and build passing.
- Open decisions: crowding on roof/skirt vs whole-car tint; photo licences for the pitch
  video; TRAIN-04 beacons for delayed trains (feed has no per-train delay);
  crowding thresholds/wording; per-car split is modelled not measured;
  Komuter-shaped peaks may overstate LRT peaks; Supabase persistence and deployment
  (Vercel/Render) not started.

## Session log

Newest first. One short entry per chat: date, what changed, anything left unfinished.

- **2026-10-07** Rethought the requirements against Mini Tokyo 3D (`docs/AERA_UX_V2.md`) and
  rebuilt the live page as a full-screen map: floating search/clock/status/buttons, one card
  at a time (desktop column, phone bottom sheet), station photos for all 37 stations, an
  Innovia Metro 300 train model shared by map and cards, URL sharing. Strip map and line
  panel parked. Open: delayed-train beacons, night check of the new train materials.

- **2026-10-07** Map upgraded towards Mini Tokyo 3D: three.js modelled trains (per-car
  crowding colours, lights), sun-driven day/dusk/night lighting, Underground mode, Follow/
  Chase/Orbit cameras, hover cards, clock chip. Trains no longer rebuild GeoJSON every frame.
  Checked in headless Chrome at 1440/390 px, dusk and night. Open: night palette and
  "Live sky" default are a design call (user chose a white look); tunnel portals still estimates.

- **2026-10-07** Live map made 3D like Mini Tokyo 3D (`geo3d.ts`, `GeoMap.tsx`, new
  `--map-building/viaduct/sky/horizon/fog` tokens). Checked in headless Chrome at 1440 and
  390 px; build and 9 frontend tests pass. Open: tunnel portal positions are estimates;
  at-grade stretches are drawn as viaduct.

- **2026-10-07** Visual redesign on user request: white background, Plus Jakarta Sans,
  blue/cyan/orange palette, English crowding levels with icons, mobile tab bar and "My station"
  card, 3D Kenney subway train on station and train views, restyled ride planner. Smoothed the
  Komuter hourly profile (fixes zigzag, lowers peak to ~11.9k pax/h). Not done: dark mode.

- **2026-10-07** Added this CLAUDE.md and the Stop hook that keeps it updated.
- **2026-10-07** Rescoped to in-train crowding. Built the ridership model from data.gov.my OD
  data, crowding engine, crowding levels, surge disruption, and a new UI (strip map, station
  board, ride planner, insights, simulation page). IoT UI moved to `frontend/_parked/`.
- **2026-10-07** First build from the BRS: FastAPI twin service (GTFS import, sim clock,
  occupancy engine, alerts, simulator, MQTT/HTTP ingest) and Next.js app (network map,
  station 3D twin, console, admin). Layout changed to `frontend/` + `backend/`.
