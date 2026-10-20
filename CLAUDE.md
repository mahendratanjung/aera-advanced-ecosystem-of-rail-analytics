# AERA project context

Loaded automatically at the start of every Claude Code chat. Keep it current: a Stop hook
(`.claude/hooks/context-check.sh`) asks for an update whenever project files changed after
this file. Update "Current state" when facts change and add one entry to "Session log".

## Ground rules

- **Mahendra is the sole author.** Never add Claude/Anthropic attribution anywhere: no
  `Co-Authored-By`, no "Generated with Claude Code", no author fields. Do not commit unless asked.
- Git repo with remote `origin` on GitHub. Do not commit or push unless asked.
- Requirements: `docs/AERA_BRS.md` (requirement IDs like `NET-03` are stable; quote them).
  The live experience follows `docs/AERA_UX_V2.md` (map-first; IDs `MAP-`, `CARD-`, `FIND-`,
  `PIC-`, `TRAIN-`). Revision 3 (`docs/AERA_V3.md`, IDs `ROUTE-`, `ASK-`, `MAPC-`, `INS-`,
  `ROLE-`) adds other ways round disruptions, the Ask AERA assistant and staff roles. Revision 4
  (`docs/AERA_V4.md`, IDs `NETM-`, `ONB-`, `YOU-`, `STAT-`, `LOGIN-`, `ASK-06..08`) adds the
  network map, welcome, You and status pages. Revision 5 (`docs/AERA_V5.md`, IDs `NETC-`,
  `VIEW-`, `CTRL-`, `PLAN-`) adds crowding on every line, the rider/operator views and the
  simpler Plan and Busy times pages, and holds the latest brainstorm backlog.
  Delivery history and decisions: `docs/PLAN.md`. Run instructions: `README.md`. What is live vs
  predicted, and the data gaps: `docs/LIVE_DATA.md`.
- Every chat ends checked: a Stop hook (`.claude/hooks/quality-check.sh`) runs `npm run check`
  (ruff, backend + edge pytest, frontend tests, tsc) when code changed; CI also builds.
- Layout: top-level `frontend/` (Next.js) and `backend/` (FastAPI), not `apps/*`.
- Keep colours, fonts, radii, shadows and motion in `frontend/styles/theme.css` only.
- Logo: **Express** (chosen 19 Oct 2026, `brand/guideline/AERA_Brand_Guideline.pdf`). The
  geometry lives in `brand/build.mjs` and `LogoMark` (`components/TopBar.tsx`); change both together.
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

- Live data (checked 12 Oct 2026): data.gov.my has **no GTFS Realtime feed for Rapid Rail** (404),
  only for KTMB and buses. Trains run on the published timetable at real KL time; crowding is
  predicted. `feeds/gtfs_rt.py` keeps checking (`/api/live/feed`) and uses the feed once it exists.
- Observed crowding: rider reports (train card), opt-in phone locations (backend only) and in-train
  sensors (`CarCount`: camera, door counter, load-weigh; `edge/`) are fused per trip with
  inverse-variance weights and a half-life (`crowdsource/fusion.py`); the browser blends that
  into the model (`lib/crowd/observed.ts`) in the live feed, so map, line list and train cards
  show it. Station boards, My station and Ask AERA do not yet.
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
- Basemap (user's choice, 8 Oct 2026, to match Mini Tokyo 3D): **Mapbox GL v3 + Mapbox
  Standard** when `NEXT_PUBLIC_MAPBOX_TOKEN` is set in `frontend/.env.local` (3D trees,
  landmarks, windowed facades, shadows; `lightPreset` dawn/day/dusk/night follows the sim sun;
  terrain off; POI/transit/road labels off). Free tier is 50k map loads/month; the user wants
  it to stay free, so never add anything that creates extra maps. No token or a refused token
  falls back to MapLibre + Carto automatically (`createMap` in `GeoMap.tsx`).
- 3D map: tilted camera, translucent extruded buildings from the Carto tiles (fallback only), grey
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
| Rapid Rail network builder (all lines, transfers) | `backend/aera_twin/gtfs/network.py` → `data/network/rapid.json` |
| Route advisor (wait / go round / road) + option cards | `frontend/lib/advisor/`, `frontend/features/advisor/RouteOptions.tsx` |
| Ask AERA: OpenRouter proxy, browser tools, quick answers, chat UI | `backend/aera_twin/assistant.py`, `frontend/lib/assistant/{tools,local,chat}.ts`, `frontend/features/assistant/` |
| Line control (operators), admin users/levels/audit | `frontend/features/control/LineControl.tsx`, `frontend/features/admin/AdminPages.tsx`, `/api/control/*` |
| Every other line's trains: builder, browser sim, 3D geometry | `backend/aera_twin/gtfs/trains.py`, `frontend/lib/network/trains.ts`, `frontend/features/live/network3d.ts`, `features/network/NetTrainCard.tsx` |
| Other lines' crowding: builder, browser lookups, every-line-now hook | `backend/aera_twin/ridership/network.py` → `data/models/network.json`, `frontend/lib/network/crowd.ts`, `frontend/features/insights/linesNow.ts` |
| Station picker, search; operator alerts | `frontend/components/StationPicker.tsx`, `frontend/lib/stationSearch.ts`, `frontend/lib/control/alerts.ts` |
| Rider/operator views, nav per view, view switch | `frontend/lib/view.ts`, `frontend/components/{nav.ts,ViewSwitch.tsx}` |
| Control room (line strip), operator Analytics, rider Busy times | `frontend/features/control/{LineControl,LineStrip}.tsx`, `frontend/features/insights/{Analytics,Insights}.tsx` (`/control`, `/control/analytics`, `/insights`) |
| Network map (poster data, layout, SVG map, page) | `frontend/lib/network/{schematic,layout}.ts`, `frontend/features/network/` |
| Welcome, You, Service status pages | `frontend/features/{welcome,you,status}/` |
| Rider prefs (welcomed, saved rides, sharing), location sharer | `frontend/lib/prefs.ts`, `frontend/lib/crowd/share.tsx` |
| Line as a list (map text equivalent) | `frontend/features/live/LineList.tsx` |
| Map shortcuts, shortcuts panel, full screen; recent stations | `frontend/features/live/Shortcuts.tsx`, `frontend/lib/recent.ts` |
| Live feed watcher (GTFS Realtime), track snapping | `backend/aera_twin/feeds/gtfs_rt.py`, `backend/aera_twin/geo.py` |
| Rider reports/locations, train sensors, fusion | `backend/aera_twin/crowdsource/`, `/api/crowd/*`, `/api/ingest/train/{device}`, `frontend/lib/crowd/observed.ts` |
| Edge sensor software (sender, YOLO counter, demo) | `edge/aera_edge/`, `edge/tests/` |
| Charts (SVG, hover, sr-only tables) | `frontend/features/charts/` |
| Brand kit: Express logo files, mockups, guideline PDF (one generator) | `brand/` (`node brand/build.mjs`, also writes the app icons) |
| Parked IoT/old UI and the old strip map (excluded from build) | `frontend/_parked/` |
| Parked IoT backend (still tested) | `backend/aera_twin/{engine,rules,ingest}/`, `data/stations/KJ20.json` |

Invariants:
- Other lines' trains (`lib/network/trains.ts`) are display-only and timetable-driven, with a
  typical-week crowding lookup (`lib/network/crowd.ts`, no delays, no per-car split; ERL/BRT have
  none). Disruptions and the live crowding engine stay Kelana Jaya only. Their ids start `net:`.
- Two views: everyone gets the rider view; signed-in staff default to the operator view (navy
  `--ops-*` chrome, own tabs) and switch with `ViewSwitch`. Add new pages to `navFor` per view.
- The planner never suggests waiting more than 20 minutes (`MAX_WAIT_S` in `TripPlanner.tsx`).
- The map's time is `now + ui.ahead` minutes (`lib/crowd/feed.ts`); cards stay at now. Rider
  reports are never blended into a look ahead.
- On the 3D map other lines use `slim()` sizes (network3d.ts) so Kelana Jaya stays the hero.
- 3D map sizes follow `dimsAt` (geo3d.ts): steady on screen from `STEADY_ZOOM` (13.5) up, fixed in
  metres below it (shrink with the map, Mini Tokyo 3D's rule), with a ~3 px floor for trains. New
  map geometry should use `dims.dp` (design pixel), not `dims.px`, or it clutters when zoomed out.
- The network map's station ids for Rapid lines are the GTFS ids; `lib/network/layout.test.ts`
  fails if a stop is added to `data/network/rapid.json` without a place on the map.
- Network map coordinates are poster units (about one per poster pixel); line colours are the
  `--line-*` tokens in `theme.css`.
- `frontend/lib/sim/trains.ts` must match `backend/aera_twin/timetable.py`; parity is tested
  against `frontend/lib/sim/__fixtures__/positions.json` (regenerate from Python if the
  algorithm changes).
- Zustand selectors must not return fresh `[]`/`{}`; use `NO_DISRUPTIONS` / `NO_LINKS`.
- `TrainLayer.render` accepts both MapLibre's projection data and Mapbox's raw matrix.
- MapLibre v6 worker is served from `public/maplibre/` (copied by `postinstall`) and set with
  `setWorkerUrl`.
- The assistant never states facts itself: every figure comes from `lib/assistant/tools.ts`.
  The OpenRouter key (`AERA_OPENROUTER_API_KEY`) lives only in `backend/.env`.
- Disruption kind `insert` (extra train) adds a trip in `tripsBetween`/`trips_between`; keep the
  Python and TypeScript versions in step.
- `<table className="sr-only">` leaks its width on phones; wrap such tables in a `sr-only` div.
- Tests that start the app must pass `gtfs_rt_url=""` to `Env`, or they poll data.gov.my.
- Sim-clock tests must pin the time (`clock.jump(...)`, `clock.pause()`): at night no trains run.
- Raw rider device ids are never stored (daily-rotating HMAC pseudonyms); keep it that way.

## Commands

```bash
npm run setup      # uv sync (dev+data groups) + npm install
npm run dev        # twin service :8000 + web :3000 (AERA_SIM_START=17:30 to start at a time)
npm test           # backend + edge pytest + frontend node tests
npm run check      # ruff lint + tests + typecheck (what the Stop hook and CI run)
npm run model      # rebuild data/models/KJ.json from data.gov.my
npm run model:network  # data/models/network.json, crowding on every other line
npm run import:gtfs
npm run import:network   # data/network/rapid.json, all Rapid Rail lines for the route advisor
npm run import:trains    # data/network/trains.json, every other line's timetable (Rapid GTFS, KTMB GTFS, ERL estimate)
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
- Map switched to Mapbox Standard (8 Oct 2026), checked in headless Chrome at 1440 px by day,
  at night and with a refused token (falls back to Carto); 53 backend + 14 frontend tests and
  build passing. Not yet checked on a phone (Standard is heavier than Carto).
- Delivery 5 (8 Oct 2026, `docs/AERA_V3.md`) done: other ways round disruptions, Ask AERA
  (OpenRouter free model, quick answers without a key), crowding bands and station words on the
  map, line list, answer-first Insights, Line control and admin pages, sheet drag, PWA icons.
  63 backend + 25 frontend tests and build passing; checked in headless Chrome at 1440 px and an
  emulated 390 px phone. Not checked: a real OpenRouter key (none set), a real phone.
- Delivery 6 (12 Oct 2026, `docs/LIVE_DATA.md`) done: live feed watcher, rider reports, phone
  location matching, train-sensor ingest and edge code, fusion, ruff, CI, quality Stop hook.
  80 backend + 5 edge + 29 frontend tests, lint, typecheck and build passing; end-to-end checked
  against a running service (demo sensors on 40 trains, real 404 from data.gov.my). Not done: UI
  switch for location sharing, observed crowding on station boards/My station/Ask AERA.
- Revision 4 (12 Oct 2026, `docs/AERA_V4.md`) done: `/network` integrated transit map (13
  lines, 220 stations, live KJ trains), `/welcome` first-visit flow, `/me` (my station, saved
  rides, location sharing UI), `/status`, redesigned staff login, Ask AERA empty state, voice and
  side panel. Phone tabs are now Live, Network, Plan, Ask, You. Checked in headless Chrome at
  1440 px and an emulated 390 px phone.
- All trains (12 Oct 2026, TRAINS in `docs/AERA_V4.md`): every line's trains run on the 3D map
  and the network map from `data/network/trains.json` (Rapid GTFS, KTMB GTFS, ERL estimate;
  Skypark suspended). About 170 other-line trains at the morning peak. Checked in headless
  Chrome at 1440 px; 84 backend + 41 frontend tests and build passing.
- Map polish (13 Oct 2026, POL in `docs/AERA_V4.md`): zoom-aware sizes like Mini Tokyo 3D, line
  colour and station marks when zoomed out, crowding bands fade in from zoom 12, ranked station
  labels, remembered map switches, keyboard shortcuts + panel, button tooltips, full screen,
  recent stations in search, "Tour the line", trains-by-crowding bar. Checked in headless Chrome
  at 1440 px (zoom 10 to 17) and an emulated 390 px phone; 84 backend + 5 edge + 42 frontend
  tests, lint, typecheck and build passing.
- Revision 5 (14 Oct 2026, `docs/AERA_V5.md`): typical crowding on 8 more lines, rider and
  operator views, Control room line strip, Analytics, rebuilt Plan and Busy times. Checked in
  headless Chrome at 1440 px and an emulated 390 px phone (no sideways scroll); 89 backend + 5
  edge + 50 frontend tests, lint and typecheck passing.
- Brand (19 Oct 2026): Express logo adopted in the app; `brand/` holds the logo pack (SVG/PNG/PDF/ICO),
  mockups and the 14-page `AERA_Brand_Guideline.pdf`, all from `node brand/build.mjs`.
- Open decisions: crowding on roof/skirt vs whole-car tint; photo licences for the pitch
  video; TRAIN-04 beacons for delayed trains (feed has no per-train delay);
  crowding thresholds/wording; per-car split is modelled not measured;
  Komuter-shaped peaks may overstate LRT peaks; Supabase persistence and deployment
  (Vercel/Render) not started.

## Session log

Newest first. One short entry per chat: date, what changed, anything left unfinished.

- **2026-10-19** Word report template (`brand/word/`): four border proposals, then four frame
  variants; user chose A1 plain frame. `build_word.py` writes `.dotx`, blank and sample `.docx`
  with native-shape frame, mark, PAGE pill, AERA styles and embedded Plus Jakarta Sans
  (ExtraBold as its own family for headings). Checked in Word for Mac. Open: Word for Mac loaded
  the embedded ExtraBold on a first open but not on a later rebuild in the same session (session
  cache?); installing `brand/word/fonts/` avoids it. Not checked on Windows.

- **2026-10-19** Guideline trimmed on user request: cover shows only "Brand guideline" and the
  version, footers read "AERA Brand Guideline" / "Page n", history, exploration, selection and
  files pages removed (14 pages).

- **2026-10-19** Express chosen as the logo. Other options deleted (kept only as a record in
  `brand/history/`). New `brand/` kit from one generator: 16 SVG versions/lockups (outlined
  wordmark), PNG, PDF, favicon.ico, 8 mockups, live-app screenshots, and an 18-page brand
  guideline PDF with the logo's history and selection. App `LogoMark`, `icon.svg`, phone icons and
  favicon now Express. Open: printer proof for CMYK, wordmark licence note (OFL) if shipped.

- **2026-10-17** Logo options for the brand guideline in `brand/logo-options/`: six directions
  grown from the Bullet A (Express, Four Cars, Twin, Interchange, Counter, Rush Hour), each with
  meaning and risks, SVGs on tile and on white, a stakeholder board (`index.html`) and README
  (name history: Latin *aera*, counters). Recommended Express + Four Cars motif. Open: team
  choice, then swap `LogoMark`, `icon.svg`, PNG icons and favicon; write the full guideline.

- **2026-10-14** "Improve more": network model now splits riders over close alternative routes
  (logit), advisor legs on other lines carry crowding, Plan takes any Rapid Rail station (cross-line
  options), searchable station picker, map "crowding ahead" slider with play (key A), Control room
  "Needs attention" alerts. Open: alert acknowledgement, platform-waiting alerts, real-phone check.

- **2026-10-14** Revision 5 on user request (brainstorm, phone UI, operator vs rider, simpler
  Insights and Plan): network crowding model for AG/SP/KG/PY/MR/SA/K1/K2 shown on both maps,
  train and station cards, Busy times, Control and Ask AERA (`other_lines`); rider/operator views
  with their own tabs and navy operator chrome; Control room line strip; Analytics page holds the
  old Insights charts; Plan and Busy times rebuilt phone first. Open: backlog in `docs/AERA_V5.md`
  (time slider, leave-now alerts, station picker, cross-line planning), Monorail likely
  under-counted by quickest-path routing, capacities approximate, real-phone check.

- **2026-10-13** New logo (user's reference): white "A" with a light-blue bullet train as its
  crossbar on a navy tile, colours `--brand-*` (`LogoMark` in `components/TopBar.tsx`, static copy `public/icon.svg`, PNGs in
  `public/icons/`, `app/favicon.ico`). The tab icon now shows (metadata `icons` had hidden
  `app/icon.svg`); default tab title is "AERA · Advanced Ecosystem of Rail Analytics".

- **2026-10-13** Map made clean at every zoom (Mini Tokyo 3D rule: steady size from zoom 13.5,
  shrinking with the map below; stripe in line colour, station marks, crowding bands fade in,
  ranked labels). Brainstormed usability and built POL-04..09: remembered switches, shortcuts
  panel and tooltips, full screen, recent stations, line tour, trains by crowding, map loading
  pill. Dev-only `window.__aeraMap` for headless checks. Open: backlog in `docs/AERA_V4.md` POL
  (crowding-ahead slider, train labels, low-detail mode), real-phone check.

- **2026-10-12** Added every line's trains to the 3D map and the network map: new timetable
  builder for Rapid Rail (with shapes), KTMB (real trips) and ERL (estimated), browser sim,
  slim 3D tracks/stations/cars, hover, follow camera, train cards, KTM/ERL times on station
  cards and the status page. Open: KTMB realtime feed, Skypark status, ERL exact timetable,
  real-phone performance with ~200 extra trains.

- **2026-10-12** Built the Klang Valley integrated transit map at `/network` from the poster the
  user shared (all 13 lines, KTM/ERL without data, live KJ trains, search, line focus, station
  cards) and a gap analysis (`docs/AERA_V4.md`) with welcome, You, status, login and Ask AERA
  upgrades. Open: poster licence for the pitch, KTMB GTFS for KTM/ERL times, notifications,
  Bahasa Malaysia, real-phone check of the network map.

- **2026-10-12** Answered "is it live?": no Rapid Rail realtime feed exists on data.gov.my, so the
  twin runs the timetable at real time with predicted crowding. Built the GTFS-RT watcher,
  crowdsourced crowding (reports, opt-in locations with k-anonymity), train-sensor contract and
  `edge/` code (YOLO counter, demo), fusion in backend and browser, report buttons on the train
  card, ruff + `npm run check` + CI + quality Stop hook, `docs/LIVE_DATA.md`. Open: location
  sharing UI, station boards using observed crowding, calibrating penetration and model error.

- **2026-10-08** Gap review against the BRS/UX v2, then built revision 3 (`docs/AERA_V3.md`):
  Rapid Rail network + route advisor, Ask AERA chatbot via OpenRouter with browser-run tools and
  a no-key fallback, crowding bands/station words/line list/late beacons on the map, Insights
  rebuilt answer-first and phone-friendly (fixed sr-only tables widening the page), Line control
  (impact, extra train what-if, notices), admin users/crowding levels/audit, persona sign-in,
  sheet content drag, PWA icons, About credits. Open: add an OpenRouter key and try it; real-phone
  check; notifications, rider reports, scrubber/CSV, Bahasa Malaysia still undecided.

- **2026-10-08** Basemap moved to Mapbox Standard (user's token in `frontend/.env.local`) for
  Mini Tokyo 3D-level detail: Petronas Towers landmark, trees, facades, lit windows at night.
  Our viaduct, platforms, labels and three.js trains sit on top unchanged; MapLibre + Carto
  remain as the no-token fallback. Open: phone performance, restrict the token to the
  deployed URL before going live.

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
