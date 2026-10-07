# AERA · Advanced Ecosystem of Rail Analytics

A digital twin of the LRT Kelana Jaya Line that predicts how full every train is,
built from data.gov.my gate-tap ridership and the published timetable. Requirements live in
[docs/AERA_BRS.md](docs/AERA_BRS.md), with the map-first experience in
[docs/AERA_UX_V2.md](docs/AERA_UX_V2.md); how each delivery maps onto them is in [docs/PLAN.md](docs/PLAN.md).

| Page | What it answers |
| --- | --- |
| `/` Live | Full-screen 3D map of every train, each car's roof coloured by its crowding. Search a station or tap one for its photo, next trains by car and advice; tap a train to follow it. `/?station=KJ15` and `/?train=…` open a card directly |
| `/trip` | Which train from A to B is the calmest in the next hour? |
| `/insights` | When is the line busiest through the week, and how was that worked out? |
| `/admin` | Scenarios, clock and disruptions for demonstrations (staff only) |

```
frontend/   Next.js 16 web app: live 3D map with station and train cards, ride planner, insights
backend/    FastAPI twin service: timetable, crowding model builder, simulation clock, scenarios, API
data/       Line timetable (GTFS), crowding model (data/models) and station definition files
packages/contracts/   JSON schemas for MQTT payloads and station definitions
docs/       BRS and build plan
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

Staff sign in at `/login` with the development accounts:

| Account | Role | Password |
| --- | --- | --- |
| admin@aera.dev | Admin | `aera-admin` |
| operator@aera.dev | Operator, Taman Jaya | `aera-operator` |
| operator.kls@aera.dev | Operator, KL Sentral (to show station scoping) | `aera-operator` |

Change the passwords and `AERA_JWT_SECRET` in `backend/.env` (see `backend/.env.example`) before
sharing a deployment.

## Tests

```bash
npm test
```

This runs the backend suite (ridership assignment and model build, timetable, scenarios, API) and
the frontend checks: train positions match the twin service exactly, and the crowding engine
behaves as expected (morning peak, held trains, event surges, trip options).

## The IoT scale model (parked)

The station-zone twin, operator console and device pages are kept in `frontend/_parked/iot` for
the scale-model phase. The twin service still accepts sensor messages on
`aera/v1/{station}/{device}/…` (set `AERA_MQTT_URL`) and runs their tests.

## Useful commands

```bash
npm run import:gtfs   # refresh data/lines/KJ.json from data.gov.my
npm run model         # rebuild data/models/KJ.json from the latest data.gov.my ridership
npm run contracts     # re-export JSON schemas after changing backend/aera_twin/contracts.py
npm run photos        # refresh station photos and credits from Wikimedia Commons
npm run typecheck     # frontend type check
```

## Demo script

1. Open `/` at the evening peak (Simulation › Evening peak). Train roofs turn orange and red south
   of KL Sentral, and the clock card names the most crowded stretch; tap it to fly there.
2. Search "Taman Jaya": its photo, next trains per direction by car, and a tip on whether to wait.
   Tap a train, then Chase, to ride behind it.
3. In Simulation, run **Train fault at Universiti**. Back on Taman Jaya or Asia Jaya, the first
   train after the fault arrives late and packed, and the bunched one behind it has room.
4. Open `/trip` from Taman Jaya to KL Sentral at 07:45 to see the calmest train recommended.
5. Close on `/insights`: the weekly heatmap and how the prediction was built.
