# AERA revision 3: help when the line breaks, an assistant, and staff roles

Companion to [AERA_BRS.md](AERA_BRS.md) and [AERA_UX_V2.md](AERA_UX_V2.md). Written 8 October
2026 after a gap review of the BRS and UX v2 against the built app (IoT, testing and deployment
left out on purpose). Requirement IDs here (`ROUTE-`, `ASK-`, `MAPC-`, `INS-`, `ROLE-`) are
stable and can be quoted like the BRS ones.

## 1. Why

1. **No help when trains stop.** With a section suspended, the planner said "No trains in this
   window" and nothing else. That is when riders most need an answer.
2. **No assistant.** The BRS lists a chat assistant as a Could (§6.3). The team wants one that
   suggests a route when a train fails, on a free model.
3. **Roles were logins only.** Since IoT was parked, operators had no screen. Admins had the
   simulation page only, though the twin service already handles users, settings and audit.
4. **Crowding was hard to read on the map and in Insights.** Only trains carried colour
   (NET-04 asks for stations too), there was no list version of the map (NET-08, UX-06), and
   Insights opened with charts whose text shrank to about 6 px on a phone.

## 2. Scope changes against the BRS

- BRS §6.4 puts journey planning out of scope. Other ways round a disruption are a narrow
  exception: they only cover Rapid Rail lines and road bridges for a broken Kelana Jaya ride,
  and never fares or ticketing.
- BRS §4.3 rates a chatbot Could, "adds scope without strengthening the twin". This revision
  keeps it tied to the twin: the model may only repeat what the twin's own tools work out.

## 3. Requirements

### Other ways to travel (ROUTE)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| ROUTE-01 | Must | Every Rapid Rail line from the same GTFS feed, with run times, headways and walking transfers between lines (stops of different lines within 400 m, walking time estimated). | `backend/aera_twin/gtfs/network.py` → `data/network/rapid.json`, `/api/network` |
| ROUTE-02 | Must | When a hold or suspension breaks a Kelana Jaya ride, offer up to four options, fastest first: wait for the line to reopen, go round on other lines (two different ways), or bus/e-hailing across the gap. Kelana Jaya legs carry predicted crowding; other lines say they have none; estimates are marked. | `frontend/lib/advisor/`, `features/advisor/RouteOptions.tsx`, `/trip` |
| ROUTE-03 | Should | Station cards point to the other ways while trains cannot pass somewhere on the line. | `StationCard.tsx` |
| ROUTE-04 | Must | The advisor is deterministic and tested, so the assistant cannot invent a route. | `lib/advisor/advisor.test.ts` |

### Ask AERA (ASK)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| ASK-01 | Must | A chat assistant on `/ask` and, on desktop, as the map card. On the map, a disruption in the status line offers "Ask AERA what to do". | `features/assistant/` |
| ASK-02 | Must | The model only chooses tools; the browser runs them on the twin's engine and advisor (service status, find station, next trains, plan ride, other ways, best time, line overview). Tool results also show as cards. | `lib/assistant/tools.ts`, `chat.ts` |
| ASK-03 | Must | A free model through OpenRouter. The key stays in the twin service (NFR-08), which fixes the system prompt and tools, caps history and rate-limits each address. | `backend/aera_twin/assistant.py`, `/api/assistant` |
| ASK-04 | Must | Without a key, over the free limit or offline, the assistant answers from the same tools without a model (quick answers). It never goes blank. | `lib/assistant/local.ts` |
| ASK-05 | Must | English crowding words only; says crowding is predicted; tells riders not to type personal details. | system prompt, chat footer, About |

### Crowding on the map (MAPC)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| MAPC-01 | Must | Each running track carries a band in the crowding colour of the train on, or next on, each stretch. Stretches trains cannot pass have no band. A map button turns it off. | `geo3d.ts` `crowdFeatures`, `GeoMap.tsx`, `CrowdEngine.stretchLoads` |
| MAPC-02 | Must (NET-04) | Station labels add the crowding word of the next train leaving, in the level's text colour. | `GeoMap.tsx` |
| MAPC-03 | Must (NET-08, UX-06) | "Line as a list": every station with its next train each way, and every train with its crowding, as the card or sheet. | `features/live/LineList.tsx` |
| MAPC-04 | Should (TRAIN-04) | Trains two minutes or more behind the timetable carry an orange beacon; held trains keep the red one. | `GeoMap.tsx` |

### Insights that answer first (INS)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| INS-01 | Must | "Right now": the line compared with a usual day at this hour in one sentence, with trains running, how many are crowded, and the most crowded stretch. | `Insights.tsx` |
| INS-02 | Must | "When is my ride calmer?": for my station (or any pair) and a day, calmer and busier hours in words, plus an hour strip with level names. | `Insights.tsx` |
| INS-03 | Should | The three busiest stretches on a typical today, each with hourly bars. | `Insights.tsx` |
| INS-04 | Must | The charts move under "Explore the data" and work on phones: tap to read a value, a vertical heatmap below 640 px, the line profile in HTML. Screen-reader tables no longer widen the page. | `features/charts/` |

### Roles (ROLE)

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| ROLE-01 | Must | Three personas: rider (no account), operator, admin. Staff see Line control in the navigation; in development the login page opens each persona in one click. | `components/nav.ts`, `app/login/LoginForm.tsx` |
| ROLE-02 | Must | Line control for operators and admins: trains running, crowded, over capacity, held and late; the impact of each disruption (stations, an estimate of riders waiting); the fullest trains. | `features/control/LineControl.tsx`, `/control` |
| ROLE-03 | Must (ALT-07, ALT-08) | Operators publish plain-language notices with a type and a duration. They show on the map, and the assistant knows about them. | `/api/control/notices`, `MapChrome.tsx` |
| ROLE-04 | Should | What-if: send an extra train from a terminal, with the predicted relief for the train behind it shown first. The extra train is a new disruption kind, `insert`, kept in parity between Python and TypeScript. | `/api/control/trains`, `timetable.py`, `lib/sim/trains.ts` |
| ROLE-05 | Must (ADM-02, ADM-03, ADM-05) | Admin pages for users and roles, the crowding thresholds (sent to every browser) and the audit log. | `features/admin/AdminPages.tsx`, `/admin/*` |

### Phone polish

| ID | Priority | Requirement | Where |
| --- | --- | --- | --- |
| MAP-08a | Must | The bottom sheet drags by its content as well as its handle, with flick-to-snap; at full height the content scrolls. | `Sheet.tsx` |
| PAX-05a | Should | PWA manifest in the white look with PNG and maskable icons and an Apple touch icon; the favicon matches the logo. | `app/manifest.ts`, `public/icons/` |

## 4. Not in this revision

Browser notifications (ALT-10), one-tap rider reports, the time scrubber and CSV export
(ANA-04, ANA-05), Bahasa Malaysia (PAX-06 conflicts with the English-only crowding words; a
team decision), crowding on other lines, a check of Mapbox Standard on a real phone (NFR-02).

## 5. Decisions to confirm with the team

- The free OpenRouter model can change or be rate-limited without notice. Quick answers cover
  the demo, but a paid key (a few cents a day) would make the AI part dependable.
- Road times assume 22 km/h with an 8-minute wait. Rapid KL's shuttle buses are mentioned as
  "often run", not promised.
- The rider-waiting estimate on Line control comes from the boarding model, not counts.
- Admins can move the crowding thresholds. The wording riders see changes with them, so agree
  who may change them.
