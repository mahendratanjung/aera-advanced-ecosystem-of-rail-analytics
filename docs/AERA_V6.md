# AERA revision 6: answer first on Live, one Operations page, staff sign in, a working assistant

Status: built 13 November 2026. New stable IDs: `LIVE-` (live page), `OPS-` (Operations),
`LOGIN-02..03`, `ASK-09..11`. Earlier IDs are unchanged; `STAT-01..03` are retired (the Status page
was removed), `VIEW-03` (Analytics) now lives inside Operations as Trends.

## 1. Why

- **Live opened on a whole-line overview.** A rider had to find their station, then their train,
  to learn how full it was. On a phone the map buttons covered the right edge and the sheet showed
  only My station.
- **Riders asked for congestion first, the twin second.** The 3D map impresses, but the first
  thing a rider needs is "how long, how full, which car".
- **Staff pages were spread over six tabs** (Control, Map, Analytics, Network, Ask, Status), and
  the line between the rider app and staff pages was blurred.
- **The sign-in page did not meet the usual standard** (no throttling, no "keep me signed in", no
  Caps Lock warning, app chrome around the form).
- **Ask AERA had no key and one model.** Free models are often busy, and reasoning models can run
  out of tokens mid-answer.

## 2. Built

### Live (riders)

| ID | What | Where |
| --- | --- | --- |
| LIVE-01 | The map opens close on KLCC LRT with the Petronas Towers behind it (user's choice, 13 Nov 2026), drifting slowly until touched; phones open a step further out. The card is about the station near the rider (location asked once, on the first visit; it never leaves the phone) or My station when location is off or the rider is over 4 km from the line. "Show on map" (or the crosshair button) flies the twin to the card's train and follows it. A link or a pick always wins. | `lib/nearby.ts`, `features/live/GlanceCard.tsx`, `LiveView.tsx`, `OPENING` in `GeoMap.tsx` |
| LIVE-02 | The glance card, answer first and calm (white; colour only for crowding): near you / My station with one quiet switch line, direction tabs with the wait in each, the next train's wait, level, % and people, the train as one row of four joined cars in their crowding colours with the car that has most room ringed, where to stand in words, the trains after it as a plain list, Show on map / Train details. At night: "First train 06:37". Phones also get the line's most crowded stretch. | `GlanceCard.tsx`, `TrainCars` in `components/Crowd.tsx` |
| LIVE-03 | Phone map controls: Map layers (one labelled panel with every switch and a line on what it does), Your train, and a compass only when the map is turned. You moved to the avatar in the search bar. | `PhoneMapButtons`, `LayersPanel` in `MapChrome.tsx` |
| LIVE-04 | Plan and Ask start from the station near the rider too. | `TripPlanner.tsx`, `AssistantChat.tsx` |

### Navigation

| ID | What | Where |
| --- | --- | --- |
| VIEW-04 | Rider tabs: Live, Network, Plan, Busy times, Ask on every screen size; You is the avatar at the top. Status removed (`/status` redirects to Live, whose status chip says whether the line is running). | `components/nav.ts`, `TopBar.tsx`, `BottomNav.tsx`, `next.config.ts` |
| OPS-01 | Staff tabs: Operations, Live map, Ask, and Admin for admins. Operations and Admin share a light navy workspace background, apart from the white rider app. | `nav.ts`, `LineControl.tsx`, `app/admin/layout.tsx` |

### Operations: one simple screen for staff

Redesigned on the user's request (13 Nov 2026) from a long scrolling page into one screen that
answers "is the line all right, and is there anything I need to do?" at a glance.

| Stakeholder | Needs | Where |
| --- | --- | --- |
| Line controller | Is the line healthy, what needs action, what is coming, tell riders | Header service state, figures, Every train now, Needs attention, Notices |
| Duty manager / handover | The state of the line in one paragraph | Shift summary |
| Service planner / management | How busy, when, where, and how the prediction works | Trends tab |
| Admin | Simulation, users, crowding levels, audit | Admin pages (linked) |

| ID | What | Where |
| --- | --- | --- |
| OPS-02 | Header: line, date and time, service state pill, Now / Trends switch, Shift summary, Ask AERA | `LineControl.tsx` |
| OPS-03 | Needs attention: disruption impact (stations affected, riders waiting) and alerts with Show on map and Acknowledge (kept for the browser tab's session); "All clear" only when there is no incident. First on phones | `Impact`, `NeedsAttention`, `useAcked` |
| OPS-04 | Six figures in one strip: trains running, riders on trains, crowded or packed, over capacity, held, late 2+ min | `Stat` |
| OPS-05 | Next 2 hours: the fullest train every 10 minutes, coloured by level, against a dashed Crowded line, the peak ringed and named | `forecast`, `Forecast` |
| OPS-07 | Shift summary copied for handover: service, figures, top alerts, the coming peak, notices, extra trains | `shiftSummary`, `CopySummary` |
| OPS-08 | Trends tab: other lines now, then every line, the week, along the line, demand, method (was Analytics; `/control/analytics` redirects to `/control#trends`) | `Trends` in `features/insights/Analytics.tsx` |
| OPS-09 | Notices to riders (live ones first, a compact composer) and Send an extra train (folded, with the predicted relief) | `Notices`, `ExtraTrain` |
| OPS-10 | Every train now: the line diagram on a dark control-room panel with a count per crowding level; tap a train to follow it on the map | `EveryTrain`, `LineStrip` (`bare`) |

### Staff sign in

| ID | What | Where |
| --- | --- | --- |
| LOGIN-01 (updated) | Split screen without app chrome: product panel (headline, animated line with trains coloured by crowding, three facts) and a focused form: labelled fields with `username`/`current-password` autocomplete, show password, Caps Lock warning, Forgot password (explains the admin reset), Keep me signed in, spinner, plain error that does not say which field was wrong, Continue as a rider, development demo accounts. Email is focused on desktop only (a phone keyboard would cover the page). | `app/login/LoginForm.tsx` |
| LOGIN-02 | Five wrong passwords for one address and email pause sign-in for that email for ten minutes (429 with the wait); a right password clears the count | `LoginThrottle` in `backend/aera_twin/api/routes.py`, `tests/test_login.py` |
| LOGIN-03 | Keep me signed in: on keeps the session in this browser, off ends it with the tab; an expired token is dropped on load | `lib/session.ts` |

### Ask AERA

| ID | What | Where |
| --- | --- | --- |
| ASK-09 | Progress while it works: one plain line per tool ("Checking the next trains at KL Sentral") | `lib/assistant/steps.ts`, `chat.ts`, `AssistantChat.tsx` |
| ASK-10 | Free models in a fallback chain (ERNIE 5.5 Flash, Nemotron 3 Ultra, OpenRouter's free router; checked 13 Nov 2026), low hidden reasoning, 1,200-token cap, a cut-off reply trimmed to its last whole sentence; a fresh question must start with a tool call (`tool_choice: required`), so every figure comes from the twin; a refused key reads as "not set up" | `backend/aera_twin/assistant.py`, `tests/test_assistant.py` |
| ASK-11 | The rider's nearby station goes with the question; phone layout: compact two-by-two starters, swipeable suggestions, one-line notice | `AskContext.near_station`, `AssistantChat.tsx`, `AskPage.tsx` |

Key check: `cd backend && uv run python -m aera_twin.assistant` asks one question and says which
model answered.

### GPS crowdsensing (research, not built into the app)

Requested as a technical opinion with code that is not plugged in: `research/gps-crowdsensing/`
holds a design note and a standard-library reference implementation with a simulator (per-phone
hidden Markov model, crowd-sourced train positions with four guards, calibration against gate
entries, Gamma-Poisson fusion). Headline: train positions are learned from riders' phones at
1-2% of riders sharing; crowding estimates beat the model only from about 5% sharing, modestly.

### Phone layout

- Network: one-line intro and a swipeable row of line chips at the sheet's first height; the long
  explanation moved to the bottom; pinch to zoom (no +/- buttons on phones).
- Plan and Busy times were already phone first (revision 5); Plan now starts near the rider.
- Operations: header stacks, three figures per row, Needs attention first, the train panel scrolls sideways.

## 3. Checked

Headless Chrome at 1440 px and an emulated 390 px phone, sim clock at 08:10 and 03:00: Live (KLCC
opening, glance card, follow on request, layers panel, night), Ask (real OpenRouter answers),
Network, Plan, Busy times, Operations (operator, with and without a held train), sign in (wrong
password, success). No sideways scroll.
95 backend + 5 edge + 58 frontend tests, ruff, typecheck and production build passing.

Not checked: a real phone (GPS, Safari's location prompt, Mapbox Standard performance), Windows.

## 4. Backlog from this brainstorm (not built)

**Riders**
1. Leave-now alert for a saved ride (needs a service worker for push).
2. "On this train" mode: when location matches a train, the card becomes that train with stops left.
3. Walking time to the nearest station (needs a walking router; straight-line distance only now).
4. Bahasa Malaysia for everything except the crowding words (English, as decided).

**Operations**
5. Acknowledgements shared between staff (server-side, in the audit log) rather than per browser.
6. Platforms with many riders waiting as an alert (the estimate exists in disruption impact).
7. Extra-train suggestions from the two-hour forecast ("send one at 08:25 towards Gombak").
8. Export Trends tables as CSV; printable shift report.

**Staff accounts**
9. Self-service password reset by email and single sign-on, once a deployment has a mail
   service and an identity provider.
