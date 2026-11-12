# AERA · Advanced Ecosystem of Rail Analytics

A digital twin of the LRT Kelana Jaya Line that predicts how full every train is,
built from data.gov.my gate-tap ridership and the published timetable. Requirements live in
[docs/AERA_BRS.md](docs/AERA_BRS.md), with the map-first experience in
[docs/AERA_UX_V2.md](docs/AERA_UX_V2.md), and disruption help, the assistant and staff roles in
[docs/AERA_V3.md](docs/AERA_V3.md), the network map, welcome and You pages in
[docs/AERA_V4.md](docs/AERA_V4.md), every line's crowding and the two views in
[docs/AERA_V5.md](docs/AERA_V5.md), and the near-you Live page, one-page Operations and staff
sign in in [docs/AERA_V6.md](docs/AERA_V6.md); how each delivery maps onto them is in [docs/PLAN.md](docs/PLAN.md).

| Page | What it answers |
| --- | --- |
| `/` Live | Opens close on KLCC and the Petronas Towers, with your next train first: the station near you (or My station), the next train each way and how full it is car by car; "Show on map" flies to that train and follows it. Every train on every Klang Valley line; tap a station or train for its card. `/?station=KJ15` and `/?train=…` open a card directly |
| `/network` | The whole Klang Valley rail network drawn like the integrated transit map, with every line's trains running to their timetables (Kelana Jaya in its crowding colour); tap a station for its lines, times and walkways |
| `/trip` | Which train from A to B is the calmest in the next hour? When the line is broken: other ways (wait, go round on other lines, bus or e-hailing) |
| `/ask` | Ask AERA: a chat assistant that answers from the twin (on desktop it also opens as the map card) |
| `/me` | Settings (the avatar at the top): my station, saved journeys, crowd reporting, clearing data, staff sign in |
| `/login` | Staff sign in (operators and admins) |
| `/control` | Operations, one screen for staff: service state and figures, every train now, needs attention (incidents and alerts to acknowledge), notices to riders, the next two hours, an extra train with its relief, shift summary; a Trends tab for the charts |
| `/admin` | Scenarios, clock and disruptions, users, crowding levels, audit log (admins only) |

```
frontend/   Next.js 16 web app: live 3D map with station and train cards, ride planner, Ask AERA, Operations
backend/    FastAPI twin service: timetable, crowding model builder, simulation clock, scenarios, API
data/       Line timetable (GTFS), crowding model (data/models) and station definition files
packages/contracts/   JSON schemas for MQTT payloads and station definitions
docs/       BRS and build plan
research/   Studies not wired into the app (GPS crowdsensing design and reference code)
```

## Run it locally

You need Node 20+ and [uv](https://docs.astral.sh/uv/) (which installs Python 3.12+ for you).

```bash
npm install          # root tools (concurrently)
npm run setup        # backend venv + frontend packages
npm run dev          # twin service on :8000 and web app on :3000
```

Open http://localhost:3000. Trains run from the published timetable on a simulated clock, and the
simulator drives Taman Jaya until hardware is connected. Outside service hours (about 23:15 to
06:00 KL time) the line is empty. Start at a busier time with `AERA_SIM_START=17:30 npm run dev`,
or use the scenario director.

The detailed 3D city (modelled trees, landmarks such as the Petronas Towers, lit windows at night)
comes from Mapbox. Put a public Mapbox token in `frontend/.env.local` as
`NEXT_PUBLIC_MAPBOX_TOKEN=pk...` (see `frontend/.env.example`). It is free up to 50,000 map loads
a month. Without a token, or if Mapbox refuses it, the map falls back to the free Carto basemap
with plain extruded buildings. Before deploying, restrict the token to your site's URL in the
Mapbox account so nobody else can use up the free quota.

Ask AERA uses free AI models through [OpenRouter](https://openrouter.ai/keys). Put a key in
`backend/.env` as `AERA_OPENROUTER_API_KEY=sk-or-...` and check it with
`cd backend && uv run python -m aera_twin.assistant`. `AERA_OPENROUTER_MODEL` is optional: a
comma-separated list (first choice, then up to two fallbacks); empty uses the free models listed in
`backend/aera_twin/assistant.py`, which OpenRouter tries in turn when one is busy. The key never
reaches the browser.
Free models have daily limits; without a key, or when the limit is reached, the assistant gives
quick answers worked out in the browser from the same tools, so it still works on demo day.

Staff sign in at `/login` with the development accounts (in development the login page also has
one-click Operator and Admin demo buttons):

| Account | Role | Password |
| --- | --- | --- |
| admin@aera.dev | Admin | `aera-admin` |
| operator@aera.dev | Operator, Taman Jaya | `aera-operator` |
| operator.kls@aera.dev | Operator, KL Sentral (to show station scoping) | `aera-operator` |

Change the passwords and `AERA_JWT_SECRET` in `backend/.env` (see `backend/.env.example`) before
sharing a deployment.

## Tests and checks

```bash
npm test     # backend, edge and frontend tests
npm run check  # lint (ruff) + tests + typecheck: what CI and the Claude Code Stop hook run
```

This runs the backend suite (ridership assignment and model build, timetable, scenarios, crowd
reports and sensors, live feed watcher, API), the edge sender tests and the frontend checks: train
positions match the twin service exactly, the crowding engine behaves as expected, and observed
crowding blends into predictions. GitHub Actions (`.github/workflows/ci.yml`) also runs the
production build.

## Deployment

Live: **https://aera-rail.vercel.app** (website) · https://aera-api-xuoz.onrender.com/api/health (backend).
Pushing to `main` redeploys both.

| Part | Where | Notes |
| --- | --- | --- |
| Website (`frontend/`) | Vercel, root directory `frontend` | Env: `NEXT_PUBLIC_API_URL` (the backend URL), `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_SITE_URL` |
| Backend (`backend/`) | Render, from `render.yaml` | A long-running server (WebSocket, simulation loop), so not Vercel. Health check `/api/health` |
| Database | Supabase Postgres, schema `aera` | `backend/db/schema.sql`, then `backend/db/backend_role.sql` with a generated password |

The backend uses Postgres when `AERA_DATABASE_URL` is set (Supabase session pooler, role
`aera_backend`), otherwise `backend/var/state.json`. Set `AERA_CORS_ORIGINS` to the website's
address. Test the store against a database with
`AERA_TEST_DATABASE_URL=postgresql://aera_backend:…@localhost/aera_test uv run pytest tests/test_store_pg.py`.

## Live data, rider reports and sensors

Trains follow the published timetable at the real Kuala Lumpur time, and crowding is predicted:
data.gov.my has no live feed for Rapid Rail yet. AERA watches for that feed, takes crowding
reports from riders on the train card, and accepts per-car counts from cameras, door counters or
load-weigh (`edge/`). See [docs/LIVE_DATA.md](docs/LIVE_DATA.md) for the gaps and how to close them.

## The IoT scale model (parked)

The station-zone twin, operator console and device pages are kept in `frontend/_parked/iot` for
the scale-model phase. The twin service still accepts sensor messages on
`aera/v1/{station}/{device}/…` (set `AERA_MQTT_URL`) and runs their tests.

## Useful commands

```bash
npm run import:gtfs   # refresh data/lines/KJ.json from data.gov.my
npm run import:network # refresh data/network/rapid.json (all Rapid Rail lines, for other ways to travel)
npm run model         # rebuild data/models/KJ.json from the latest data.gov.my ridership
npm run contracts     # re-export JSON schemas after changing backend/aera_twin/contracts.py
npm run photos        # refresh station photos and credits from Wikimedia Commons
npm run typecheck     # frontend type check
npm run lint          # ruff on backend and edge
```

## Demo script

1. Open `/` at the evening peak (Simulation › Evening peak). Train roofs turn orange and red south
   of KL Sentral, and the clock card names the most crowded stretch; tap it to fly there.
2. Search "Taman Jaya": its photo, next trains per direction by car, and a tip on whether to wait.
   Tap a train, then Chase, to ride behind it.
3. In Simulation, run **Train fault at Universiti**. Back on Taman Jaya or Asia Jaya, the first
   train after the fault arrives late and packed, and the bunched one behind it has room.
4. Run **City section suspended**. The track goes blank between Masjid Jamek and KLCC; the clock
   card offers "Ask AERA what to do". Ask how to get from Taman Jaya to KLCC: wait, go round on the
   MRT, or bus across the gap, fastest first. `/trip` shows the same options.
5. Sign in as the operator (`/login` › Operator). In Line control, preview and send an extra train,
   and publish a notice; it appears on the map at once.
6. Open `/trip` from Taman Jaya to KL Sentral at 07:45 to see the calmest train recommended.
7. Close on Operations › Trends (`/control#trends`): every line now, the week, the busiest
   stretches, and how the prediction was built.
