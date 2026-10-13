# AERA revision 4: the whole network, a front door, and a home for the rider

Status: built 12 October 2026. Requirement IDs are new and stable: `NETM-`, `ONB-`, `YOU-`,
`STAT-`, `LOGIN-`, and `ASK-06` onwards. Earlier IDs (BRS, `MAP-`, `ROUTE-`, `ASK-01..05`,
`ROLE-`) are unchanged.

## 1. Why

AERA could tell a rider a lot about one line, but the experience had gaps around it:

- **Only one line drawn.** Riders think in terms of the Klang Valley Integrated Transit Map (the
  APAD and Rapid KL poster). AERA already imports every Rapid Rail line for the route advisor
  (`data/network/rapid.json`), but nothing showed them, and KTM and ERL did not exist at all.
- **No front door.** A first visit dropped straight into a 3D map with no explanation of the
  crowding words, no way to pick a station and no consent step for location sharing.
- **Nowhere personal.** My station lived on the map card; saved rides did not exist; the
  location-sharing switch from Delivery 6 had no UI (open item in `docs/LIVE_DATA.md`).
- **No "is my line running?" page.** Disruptions and notices showed only in the map's status
  chip, and nothing said what was live and what was predicted.
- **Thin staff sign-in and AI screens.** Login was a bare form. Ask AERA had no empty state,
  so riders did not know what to ask; there was no voice input and no way to copy an answer.

## 2. Gap analysis

| Area | Before | Gap | Decision |
| --- | --- | --- | --- |
| Network map | KJ only, geographic | No view of the 12 other lines, interchanges or walkways | Build (NETM) |
| Welcome / onboarding | None | First-run explanation, station choice, consent | Build (ONB) |
| Rider settings ("You") | Home station on the map card | Saved rides, location sharing UI, clear data, More menu for the tab bar | Build (YOU) |
| Service status | Status chip on the map | A page for every line, notices, data sources | Build (STAT) |
| Staff login | Plain form | Branded split card, show password, clearer errors | Build (LOGIN) |
| Ask AERA | Chat with suggestion chips | Empty state, voice, copy, live context | Build (ASK-06..08) |
| Notifications (ALT-10) | None | Push alerts for my station | Later: needs a push service and consent design |
| Bahasa Malaysia (PAX-06) | English only | Second language | Later: team decision (crowding words must stay English) |
| Offline page (PWA) | Manifest only | Cached shell when offline | Later |
| Crowding on other lines | KJ only | Needs ridership models per line | Later: data.gov.my OD exists for Rapid Rail; model work |
| KTM / ERL times | None | Not in the Rapid Rail GTFS feed | Built (TRAINS): KTMB GTFS for KTM; ERL estimated. KTMB's realtime feed is a later step |
| Fares | None | Not in the data | Out of scope |

## 3. Requirements

### Network map (NETM)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| NETM-01 | Must | `/network` draws all 13 lines of the integrated transit map (KTM 1, 2 and 10, LRT 3, 4, 5 and 11, ERL 6 and 7, Monorail 8, MRT 9 and 12, BRT B1) in the poster's layout, colours and numbered badges, with interchanges as one outline, walkways as grey links and KL Sentral as the dark hub. | `lib/network/schematic.ts`, `layout.ts`, `features/network/NetworkMap.tsx` |
| NETM-02 | Must | Pan, pinch and wheel zoom; labels appear as you zoom in (interchanges and termini first); phones open on central Kuala Lumpur, desktop on the whole map. | `NetworkMap.tsx` |
| NETM-03 | Must | Kelana Jaya trains move on the map in their crowding colour, on their own side of the line; tapping one shows its crowding by car and links to the live map. Stretches trains cannot pass are dashed. | `NetworkMap.tsx`, `NetworkView.tsx` |
| NETM-04 | Must | Tapping a station shows every line there: KJ next trains with crowding, Rapid Rail timetable frequency, or a plain "no data" for KTM and ERL, plus walkways to nearby stations and actions (live map, plan, my station, ask). | `NetworkView.tsx` |
| NETM-05 | Must | Search every station by name, word or code; the line list picks out one line; selection, line and train are kept in the URL. | `searchPlaces`, `NetworkView.tsx` |
| NETM-06 | Must | Every Rapid Rail GTFS stop is on the map on its own line, the KJ order matches the timetable, and labels clear other stations (tested). | `lib/network/layout.test.ts` |

### Every line's trains (TRAINS), added 12 October 2026

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| TRAINS-01 | Must | Timetables for every line except the Kelana Jaya Line in one file: Rapid Rail from Prasarana GTFS (with track shapes and headways), KTM Komuter lines 1 and 2 from KTMB GTFS (every trip, holiday swaps), KLIA Ekspres and KLIA Transit estimated from ERL's published frequency and marked as estimates. The Skypark Link is listed with no trains (suspended since February 2023). | `backend/aera_twin/gtfs/trains.py` → `data/network/trains.json`, `/api/network/trains` |
| TRAINS-02 | Must | The 3D map draws every other line (slim viaduct with a line-colour stripe, ground band for KTM and ERL, MRT tunnels) with its stations and trains as plain cars in the line colour. Trains can be hovered, tapped and followed (Follow, Chase, Orbit). A map button hides the other lines. Kelana Jaya keeps its full model and crowding colours. | `features/live/network3d.ts`, `trainLayer.ts`, `GeoMap.tsx` |
| TRAINS-03 | Must | The network map shows every line's trains in its line colour; tapping one shows where it is, its next stop and arrival, and where the times come from. Other lines have no crowding level and say so. | `lib/network/trains.ts`, `features/network/NetTrainCard.tsx` |
| TRAINS-04 | Should | Station cards on the network map list the next KTM and ERL trains; the status page counts each line's trains running and today's hours. | `NetworkView.tsx`, `StatusPage.tsx` |

### Welcome (ONB)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| ONB-01 | Must | A first visit to `/` without a shared link opens `/welcome`; it is shown once and can be skipped. | `LiveView.tsx`, `lib/prefs.ts` |
| ONB-02 | Must | Four steps: what AERA does, the five crowding words, choose my station (search or near me), optional location sharing. | `features/welcome/Welcome.tsx` |
| ONB-03 | Should | Staff can go to sign in from the first step; the welcome can be replayed from You. | `Welcome.tsx`, `YouPage.tsx` |

### You (YOU)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| YOU-01 | Must | `/me` holds my station, saved rides, location sharing, links to Insights, Status, Network and About, staff sign in or line control, and "clear my AERA data". It is the fifth phone tab. | `features/you/YouPage.tsx`, `components/nav.ts` |
| YOU-02 | Must | The planner saves a ride with a star; saved rides open the planner. | `TripPlanner.tsx`, `lib/prefs.ts` |
| YOU-03 | Must | Location sharing is off by default; when on, the phone sends a position every 20 s while AERA is visible, and the page says whether it was matched to a train. | `lib/crowd/share.tsx` → `/api/crowd/pings` |

### Service status (STAT)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| STAT-01 | Must | `/status`: the Kelana Jaya Line's state in words (good service, delays, part not running), active disruptions with end times, operator notices, trains running and crowded. | `features/status/StatusPage.tsx` |
| STAT-02 | Must | Every other line: timetable frequency now and today's hours, or "not in the data AERA uses" for KTM and ERL. | `StatusPage.tsx` |
| STAT-03 | Must | What AERA can see: service connection, live feed state, crowding source, clock mode. | `StatusPage.tsx` |

### Staff sign in (LOGIN) and Ask AERA (ASK)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| LOGIN-01 | Must | Split card with what staff get, show/hide password, plain error for wrong details, signed-in state, development personas kept. | `app/login/LoginForm.tsx` |
| ASK-06 | Should | Voice input where the browser supports speech recognition; nothing is recorded by AERA. | `AssistantChat.tsx` |
| ASK-07 | Must | Empty state with a greeting and four things AERA answers, each a question to tap; copy any answer. | `AssistantChat.tsx` |
| ASK-08 | Should | On desktop, a "right now" panel beside the chat: line status and my station's next trains. | `features/assistant/AskPage.tsx` |

### Map polish and usability (POL), added 13 October 2026

Zoomed out, the 3D map used to keep every train and slab at a fixed size on screen, so 46
Kelana Jaya trains merged into one solid band and white platforms dotted every line. Mini Tokyo
3D holds line widths steady from zoom 12 to 19 and lets them shrink with the map below that;
AERA now does the same.

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| POL-01 | Must | Line, platforms and trains hold a steady on-screen size from zoom 13.5 up (real size from about zoom 18) and keep their size in metres below that, so they shrink with the map. Trains never get smaller than about 3 px, so they can still be seen and tapped. Other lines follow the same rule and stay slimmer than Kelana Jaya. | `features/live/geo3d.ts` (`STEADY_ZOOM`, `dimsAt`), `network3d.ts` (`slim`), `geo3d.test.ts` |
| POL-02 | Must | Zoomed out, each line reads in its own colour (the stripe widens over the grey deck), stations shrink to square marks, and the crowding bands fade in between zoom 11.6 and 12.6 instead of chopping the line into dashes. Trains carry crowding at every zoom. | `geo3d.ts`, `network3d.ts`, `GeoMap.tsx` |
| POL-03 | Must | Kelana Jaya station names show from zoom 10.2, termini and interchanges first, on whichever side has room; the crowding word joins the name from zoom 12.3. | `GeoMap.tsx` |
| POL-04 | Should | The map switches (3D, underground, live sky, crowding band, other lines) are remembered in this browser. | `lib/ui.ts` (`restoreMapView`) |
| POL-05 | Should | Keyboard shortcuts for every map button, listed in a panel (`?` or the keyboard button). On desktop each map button shows a label and its key on hover and keyboard focus. Full screen button and `F`. | `features/live/Shortcuts.tsx`, `MapChrome.tsx` |
| POL-06 | Should | Before anything is typed, search offers my station and the last five stations picked. The focus ring goes round the whole search pill. | `MapChrome.tsx`, `lib/recent.ts` |
| POL-07 | Should | "Tour the line" (desktop, `T`): the camera flies end to end through 13 stations (termini, interchanges, city centre), with a chip naming where it is heading and a Stop button. A hand on the map, Esc, or picking a station or train ends it. Made for pitch demos. | `GeoMap.tsx` (`TOUR`), `MapChrome.tsx` (`TourChip`) |
| POL-08 | Should | The clock card shows trains by crowding: a stacked bar of the five levels, a count per level with its icon, and how many are crowded or packed. | `MapChrome.tsx` (`LineGlance`) |
| POL-09 | Could | "Loading the 3D map" shows until the basemap is ready. | `GeoMap.tsx` |

Ideas from the same review, not built yet:

- **Crowding ahead for riders:** a time slider on the station card to preview the next hour.
  The model is a function of time, so this needs no new data.
- **Arrival alerts** for my station (ALT-10): needs a push service and a consent design.
- **Search every line on the live map:** fly to an MRT or LRT station without leaving the map.
  Today, other lines' stations open the network map.
- **Train labels up close,** like Mini Tokyo 3D: headsign and next stop on the train from about
  zoom 16.
- **Best car to board** drawn on the platform slab at close zoom, from the per-car split.
- **Low-detail mode for older phones:** fewer other-line trains and no buildings when the frame
  rate drops. Still not checked on a real phone.
- **Offline shell** (PWA), **Bahasa Malaysia** (crowding words stay English) and **dark mode**
  remain team decisions.

## 4. Navigation

Desktop top bar: Live, Network, Plan, Ask, Insights, Status, and You at the right (staff also
get Control). Phone tabs: Live, Network, Plan, Ask, You; staff swap Plan for Control. About
moved into You. The map's nav pill shows icons only below 1280 px.

## 5. Decisions to confirm with the team

- The schematic copies the poster's layout and line numbers; the footer says it is not an
  official map. Check that this is acceptable for the pitch video, or ask APAD.
- Station names follow the poster where it differs from GTFS (SA6 "SS 7" for "Subang",
  SA20 "Pasar Jawa" for "Jambatan Kota").
- KTM trains follow KTMB's timetable; KLIA Ekspres and KLIA Transit are estimates from ERL's
  published frequency (every 20 minutes; 15 to 30 minutes), with approximate airport station
  positions. KTMB also publishes a realtime feed that could replace KTM's timetable positions.
- The Skypark Link shows no trains because news reports say KTMB suspended it in February
  2023. Confirm with KTMB before the pitch.
- The first-visit welcome also appears once for people who used AERA before this revision.
