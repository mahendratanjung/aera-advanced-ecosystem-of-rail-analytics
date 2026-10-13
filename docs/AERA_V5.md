# AERA revision 5: crowding on every line, two clear views, simpler rider pages

Status: built 14 October 2026. New stable IDs: `NETC-` (network crowding), `VIEW-` (rider and
operator views), `CTRL-` (control room), `PLAN-` (planner). Earlier IDs are unchanged.

## 1. Why

- **"Where is the congestion for other trains?"** Since revision 4 every line's trains ran on the
  maps, but only Kelana Jaya had crowding. Riders changing to the MRT or Monorail had no answer.
- **Staff and riders shared one app with no clear line between them.** Operators found Control
  through the You page; riders saw staff words.
- **Insights and Plan were too busy.** Insights opened with three sections and a drawer of charts;
  Plan showed a chart, a strip per train and a best-train card that could suggest waiting 50
  minutes. Riders asked for "only what is needed".

## 2. Built

| ID | What | Where |
| --- | --- | --- |
| NETC-01 | Typical-week crowding for AG, SP, KG, PY, MR, SA, K1, K2: Rapid Rail daily OD routed across the network (shared track shared by both lines), Komuter hourly OD, load = riders per hour / (trains per hour x capacity) | `backend/aera_twin/ridership/network.py` → `data/models/network.json`, `/api/network/model`, `npm run model:network` |
| NETC-02 | Other lines' trains coloured by crowding: roof on the 3D map, dot on the network map, hover card, train card (now + stretches ahead), per-direction crowding on network station cards | `lib/network/crowd.ts`, `GeoMap.tsx`, `trainLayer.ts`, `NetworkMap.tsx`, `NetTrainCard.tsx`, `NetworkView.tsx` |
| NETC-03 | "Every line now": fullest train per line, Kelana Jaya live, others typical | `features/insights/linesNow.ts` (Busy times, Control, Analytics) |
| NETC-04 | Ask AERA `other_lines` tool and a no-key quick answer ("How busy is the MRT?") | `lib/assistant/{tools,local}.ts`, `backend/aera_twin/assistant.py` |
| VIEW-01 | Rider / Operator switch for staff, remembered; sign-in lands in the operator view | `lib/view.ts`, `components/ViewSwitch.tsx` |
| VIEW-02 | Separate tabs per view. Rider phone: Live, Network, Plan, Ask, You. Operator phone: Control, Map, Analytics, Ask, You. Operator chrome is navy (`--ops-*`) | `components/nav.ts`, `TopBar.tsx`, `BottomNav.tsx` |
| VIEW-03 | Analytics (operator): every line now, week heatmap, along the line, demand, method | `/control/analytics` |
| CTRL-01 | Control room: line-at-a-glance strip with every train, held/late rings, closed stretches; other lines now | `features/control/{LineControl,LineStrip}.tsx` |
| PLAN-01..04 | Plan rebuilt phone first: one answer card (take the next train, or wait at most 20 min for a calmer one, and when it gets calmer later), next 5 trains with tap-to-expand stretches, saved-ride chips, one-line calmer-hours tip | `features/trip/TripPlanner.tsx` |
| NETC-05 | Route choice in the network model: riders split between the quickest route and close alternatives (logit on travel time, up to 3 routes within 15 min), so the Monorail and parallel lines are no longer under-counted. Advisor legs on other lines carry typical crowding | `ridership/network.py` (`routes`), `lib/advisor/advisor.ts` (`legCrowd`) |
| PLAN-05 | Station picker: full-screen search on phones, panel on desktop; My station and recent first; names, words or codes | `components/StationPicker.tsx`, `lib/stationSearch.ts` |
| PLAN-06 | Plan any Rapid Rail station: rides off the Kelana Jaya Line list each way there, fastest first, crowding on every leg | `TripPlanner.tsx` (`CrossLine`) |
| MAPC-05 | Crowding ahead: slider, quick steps and play for the next 2 hours; the whole map moves to that time (rider reports left out); map button and key A | `AheadBar` in `MapChrome.tsx`, `lib/crowd/feed.ts`, `lib/ui.ts` |
| CTRL-02 | Needs attention: packed now, packed within 4 stops, held or 5+ min late, gaps over 1.8x the headway, other lines usually packed; each with Show on map | `lib/control/alerts.ts`, Control room |
| INS-01..03 | Insights became **Busy times**: right now, your ride (a tappable row of coloured hours), every line now | `features/insights/Insights.tsx` |

Limits: other lines' crowding is a typical week (no delays, no per-car split); route choice is a
simple logit, not calibrated against counts; capacities are approximate published figures.

## 3. Backlog from the brainstorm (not built)

Ranked by value for the pitch and for riders.

**Wow**
1. ~~Crowding time machine~~ built (MAPC-05).
2. **Leave-now alerts**: "Your 08:27 is Comfortable, leave in 5 min" push notification for a
   saved ride (PWA push; needs a service worker).
3. **Car-level boarding hint on the platform**: "Stand at the back, car 4 is quietest" as a
   lock-screen style card when location says you are at the station.
4. **Whole-network crowding replay** for the pitch video: a day of the network in 60 seconds.
5. **Operator what-if for other lines** (extra MRT train) once those lines have the live engine.

**Phone usability**
6. ~~Station picker with search~~ built (PLAN-05).
7. ~~Plan rides across lines with crowding per leg~~ built (PLAN-06).
8. Home-screen widget style card on Live for the saved ride (next 3 trains and crowding).
9. Haptic and larger targets on the sheet; one-hand reachability for map buttons.
10. Bahasa Malaysia (keep English crowding words as the user decided, translate the rest).

**Operator**
11. ~~Alerts~~ built as Needs attention (CTRL-02); still to add: platforms with many waiting, acknowledging an alert.
12. Shift handover summary generated from the audit log.
13. Export Analytics tables as CSV.
