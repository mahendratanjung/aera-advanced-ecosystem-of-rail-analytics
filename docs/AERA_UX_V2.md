# AERA experience, revision 2: the map is the app

Companion to [AERA_BRS.md](AERA_BRS.md). Written 7 October 2026 after a second benchmark
against Mini Tokyo 3D. It replaces the three-column live page (station list, map, panel) with
a full-screen map. The crowding model, levels and data sources do not change.

Requirement IDs in this file (`MAP-`, `CARD-`, `FIND-`, `PIC-`, `TRAIN-`) are stable and can
be quoted like the BRS ones.

## 1. What the research says

| Source | What it does well | What AERA takes |
| --- | --- | --- |
| [Mini Tokyo 3D](https://minitokyo3d.com) ([screen guide](https://minitokyo3d.com/docs/master/user-guide/screen-and-operations.html), [code](https://github.com/nagix/mini-tokyo-3d), MIT) | The map fills the screen. Clock at top left, station search, round buttons on the right edge (zoom, compass, underground, playback, layers, fullscreen). Hovering a train shows destination, previous and next stop with times, and delay. Tapping a station shows its **photo**, name and connecting lines; the station panel slides up from the bottom with a departures board. Tapping a train starts tracking mode: its timetable at the bottom and eight camera viewpoints. Delayed trains get an orange sphere. Share link for a tracked train or station. Trains are three.js instanced meshes in a custom layer. | Everything in this list except playback, weather and aircraft. |
| Google Maps transit crowding ([London TravelWatch review](https://www.londontravelwatch.org.uk/news/google-maps-is-streets-ahead-of-tfl-when-it-comes-to-crowding-information-on-the-go-says-london-travelwatch/)) | Crowding sits inside the departure and the journey plan, not on a separate screen. Hourly bars for "usually busy". | Crowding is shown on every departure and every train, never only in a legend. |
| TfL Go | Station busyness in plain words and when it is usually quieter. | "Wait 4 min for a quieter train" advice. |
| Transit app crowding | One-tap rider reports, shown on the next rider's trip. | Later: rider reports would let AERA check its own predictions (not in this revision). |
| [Waterloo transit crowding visualisation research](https://uwaterloo.ca/safe-interactions-lab/projects/transit-crowding-visualisations) | Riders read crowding faster from people icons and words than from colour or percentages alone. | Keep icon + word + colour on every crowding reading (already in `levels.ts`). |
| Kelana Jaya Line rolling stock ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Innovia_Metro_200_MLR_and_300_at_KL_Sentral.jpg)) | Innovia Metro 300: silver-white body, large rounded windscreen in a dark-blue frame, blue doors, thin red and blue stripe low on the side, four cars. | The 3D train is modelled on this livery. Crowding goes on the roof and skirt, so the train still looks like a KJ train. |
| Wikipedia / Wikimedia Commons station articles | Every KJ station article has a CC-licensed lead photo. | Station photos, stored locally with author and licence credited. |

## 2. Where the current app falls short

1. **The map is a box in the middle.** On a 1440 px screen it gets about 40% of the width.
   The station list on the left repeats what the map already shows, and the right panel shows
   a static legend until something is picked.
2. **Two ways to see the line** (strip list and map) split attention. On phones the map is a
   tab nobody opens, and the home card overflows sideways at 390 px.
3. **The answer is three taps away.** To learn "how full is my next train" a rider must find
   the station in a list, open it, and scroll.
4. **The train does not look like a KJ train.** The map train is a white box tinted entirely
   by crowding; the station view uses Kenney's generic toy subway.
5. **No sense of place.** Stations are names only. No photos, no search, no shareable link.

## 3. Who uses it and what they need to know

| Job | Rider question | Target |
| --- | --- | --- |
| J1 | "How full is the next train at my station, and which car should I stand at?" | Visible on first load for the saved station, otherwise within one search or one tap. |
| J2 | "Where is that train, where is it going, how full will it be at my stop?" | One tap on a train. |
| J3 | "Is the line OK right now? Where is it crowded?" | Readable from the map without reading text: train colours, plus one status line. |
| J4 | "When is a better time to go?" | One tap from a station: hourly bars, and the planner. |
| J5 | Demo-day viewer: "Wow, it is alive." | First screen is the moving 3D map, full bleed. |

## 4. Principles

1. **The map is the app.** Full screen on every device. Everything else floats on it and can
   be dismissed.
2. **One thing in focus.** Nothing selected: a small "My station" card. A station or train
   selected: one card about it. Never three panels at once.
3. **Answer first, detail on demand.** Each card leads with the answer (minutes + crowding
   level + best car) and expands for departures, hourly bars and next stops.
4. **Crowding is never colour alone.** Icon + word + colour, everywhere, including the map
   hover cards.
5. **Looks like the real line.** Real livery, real station photos, official line colours.

## 5. Requirements

### Map (MAP)

| ID | Priority | Requirement |
| --- | --- | --- |
| MAP-01 | Must | The live page is a full-screen 3D map (100% width and height under the app chrome). No station list beside it. |
| MAP-02 | Must | Floating controls in the Mini Tokyo 3D arrangement: clock and service status top left, search beside it, round map buttons on the right edge (zoom in, zoom out, compass/reset north, 2D/3D, underground, live sky, whole line). |
| MAP-03 | Must | The clock card shows sim time large with tabular figures, the date, day/dusk/night, and says "Simulated" or the speed when not real time. |
| MAP-04 | Must | One service status line under the clock: "Good service" or the active disruption, plus the most crowded stretch now (e.g. "Busiest: Pasar Seni → KL Sentral, Crowded"). Tapping it flies to that stretch. |
| MAP-05 | Must | When a card is open, the map's visible centre moves so the selected station or train is not hidden behind it. |
| MAP-06 | Should | URL reflects the selection (`/?station=KJ10`, `/?train=<trip>`) so a view can be shared and reloaded. A Share button copies it. |
| MAP-07 | Should | A compact crowding key on the map (five icons and words) that can be collapsed. |
| MAP-08 | Must | Phones: the map fills the space above the tab bar; cards are a bottom sheet with peek, half and full heights, dragged by a handle. |

### Cards (CARD)

| ID | Priority | Requirement |
| --- | --- | --- |
| CARD-01 | Must | Nothing selected: a "My station" card (saved in the browser, default Taman Jaya) with the next train each way: minutes, crowding tag, car diagram. Tapping it opens the station card. |
| CARD-02 | Must | Station card: photo header, code plate, name, interchange lines; for each direction the next train (minutes, crowding tag, per-car diagram, "board at car N" hint, advice) and the following three trains. |
| CARD-03 | Must | Station card expands to: typical crowding through the day (hourly bars), "Set as my station", "Plan a ride from here", Share. |
| CARD-04 | Must | Train card: destination, status (at / next stop and minutes, held, late), crowding tag with percentage and range, 3D train with per-car readout, best car to board, next stops with crowding, camera buttons (Follow, Chase, Orbit). |
| CARD-05 | Must | Desktop: cards float on the left at 400 px, scroll inside, close with a button or Esc. |
| CARD-06 | Must | Hover (desktop) on a station shows a small photo, name and next train each way with crowding. Hover on a train shows destination, next stop and crowding. |

### Finding things (FIND)

| ID | Priority | Requirement |
| --- | --- | --- |
| FIND-01 | Must | Station search box with type-ahead over names and codes (e.g. "kl", "KJ15", "sentral"), keyboard navigable, opens the station card and flies to it. |
| FIND-02 | Should | "Near me": with the rider's permission, pick the nearest KJ station. Location is used once in the browser and never sent anywhere. |

### Station pictures (PIC)

| ID | Priority | Requirement |
| --- | --- | --- |
| PIC-01 | Must | Every station has a photo from Wikimedia Commons, stored in the app (works offline on demo day), with author and licence shown on the card. |
| PIC-02 | Must | A script refreshes the photos and credits (`npm run photos`). Stations without a usable photo fall back to a line-coloured illustration. |

### Train model (TRAIN)

| ID | Priority | Requirement |
| --- | --- | --- |
| TRAIN-01 | Must | Map trains are modelled on the Innovia Metro 300: rounded silver-white body, large windscreen with a dark-blue frame, blue doors, red and blue side stripe, bogies, head and tail lights, window glow at night. |
| TRAIN-02 | Must | Each car shows its own crowding on the roof and skirt (the faces seen from the tilted camera), at a size readable at whole-line zoom. |
| TRAIN-03 | Must | The train in the cards uses the same model, so the map and the card match. |
| TRAIN-04 | Should | Delayed or held trains carry a visible beacon (Mini Tokyo 3D's orange sphere idea) in the status colour. |

### Unchanged

Crowding levels and colours (`levels.ts`), the model, the planner, insights, simulation admin
and the IoT parking decision stay as they are. Accessibility rules from BRS §10 still apply:
keyboard access to every control, visible focus, reduced motion respected, a text equivalent
for every visual reading.

## 6. Layout

Desktop (1024 px and wider):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [AERA] [Search stations…        ]                 Plan  Insights  About  │
│ ┌─────────────┐                                                      (+) │
│ │ 08:17  Day  │                                                      (-) │
│ │ Wed 7 Oct   │                      full-screen 3D map              (N) │
│ │ Good service│                                                      (3D)│
│ └─────────────┘                                                      (UG)│
│ ┌──────────────────┐                                                 (☀) │
│ │ station / train  │                                                 (⤢) │
│ │ card (400 px)    │                                                     │
│ │ photo, next      │                                                     │
│ │ trains, cars     │                     [Quiet Comfortable Busy …]      │
│ └──────────────────┘                                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

Phone (390 px):

```
┌───────────────────────────┐
│ [≡ AERA] [Search…     ]   │
│ 08:17 · Good service  (+) │
│                       (-) │
│      full-screen map  (3D)│
│                       (UG)│
│ ┌───────────────────────┐ │
│ │ ── handle ──          │ │  bottom sheet: peek shows My station
│ │ Taman Jaya  2 min Busy│ │  or the selected station / train;
│ └───────────────────────┘ │  drag up for detail
│ [Live] [Plan] [Insights]  │
└───────────────────────────┘
```

## 7. Not in this revision

Playback mode and time scrubbing, rider crowding reports, other lines (BRS NET-09),
Bahasa Malaysia UI, station interiors.

## 8. Status (7 October 2026)

Built and checked in headless Chrome at 1440 × 900 and an emulated 390 × 844 phone: MAP-01 to
MAP-08, CARD-01 to CARD-06, FIND-01, FIND-02, PIC-01, PIC-02, TRAIN-01 to TRAIN-03. TRAIN-04
covers held trains only; delayed trains need a per-train delay in the live feed.

## 9. Decisions to confirm with the team

- Crowding colour on roof and skirt only (train keeps its livery) versus whole-car tint.
- Station photos are from Wikimedia Commons under CC licences; credits are shown on the card.
  Check the pitch video's use of them against each licence.
- The `/station/[id]` page now opens the map with that station selected.
