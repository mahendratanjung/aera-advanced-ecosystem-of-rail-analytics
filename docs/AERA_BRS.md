# AERA Business Requirement Specification

**Advanced Ecosystem of Rail Analytics**
An IoT-enabled smart rail station digital twin for the Klang Valley

| Item | Detail |
| --- | --- |
| Document | Brainstorm and Business Requirement Specification, version 1.0 |
| Date | 7 October 2026 |
| Course | Technopreneurship Team Project (TFB2113/TEB2083), UTP, Semester Sept 2026 |
| Team | Group 2. Mahendra (CEO), Wina (CTO), Khal (CFO), Zidane (CMO) |
| Supervisor | Dr Farahida Hanim Binti Mausor |
| Intended reader | The development team and Claude Code |
| Basis | Endorsed Project Proposal, Progress Report 1, Technical Requirements 1st Progress, Business Draft, AERA Gantt Chart |

## 0. How to use this file in Claude Code

Place this file at the root of the repository as `docs/AERA_BRS.md` and ask Claude Code to read it in full before writing any code. The document is ordered so that the first half explains what we are building and why, and the second half gives the contracts that code must follow.

Three sections are binding and should be treated as the source of truth whenever a prompt is ambiguous. Section 8 defines the digital twin. Section 9 defines the IoT contract. Section 10 defines the visual language. Everything marked **Must** belongs to the minimum product that has to work on demo day. Items marked **Should** come next, and items marked **Could** are only attempted once the Must list is stable.

Requirement IDs such as `TWN-03` are stable. Please quote them in commits and prompts so that progress can be traced back to this file. Section 15 breaks the build into phases that each end in something visible, which is the safest way to vibe code a project of this size.

Where this document makes an assumption that the team has not confirmed, it is listed in Section 16 as an open decision. Claude Code should ask before building on top of one of those.

## 1. Product in one page

### 1.1 The problem

A passenger waiting at a Klang Valley rail station during the evening peak cannot tell whether the next train will have room, whether the platform ahead is congested, or whether the service is running normally. Station staff face a similar gap from the other side, because crowd levels, train movement, equipment status and incidents live in separate places or only in people's heads.

### 1.2 The product

AERA is a web platform that presents a living digital twin of a rail line and of one station on it. The line view shows every station and every train as a moving, glowing map. Selecting the hero station opens a three dimensional model of that station with its entrances, concourse and platforms, and each area is coloured by how full it is right now.

The hero station is connected to a physical scale model fitted with low-cost sensors. When someone passes the gate on the model, the twin on screen responds within a second. Trains follow simulated schedules built from Malaysia's open timetable data, and the system raises alerts when a zone becomes crowded, when train movement is disrupted, or when an area becomes unavailable.

### 1.3 The promise in one sentence

> See the whole line breathe, then step inside one station and watch it react to the real world.

### 1.4 Objectives carried over from the endorsed proposal

1. Develop an interactive digital representation of a public transport station that visualises station facilities, train movement, passenger flow and real-time congestion levels.
2. Design and integrate a low-cost IoT sensing system to estimate passenger occupancy and generate station congestion data for monitoring and analysis.
3. Evaluate commercial viability and scalability through stakeholder engagement and a supporting business model.

The software described here delivers objectives 1 and 2 directly and gives objective 3 a convincing demonstration to show to operators and sponsors.

### 1.5 What success looks like on demo day

A viewer opens the site and sees trains gliding along the line in real time. They click the hero station and the camera dives into a 3D station. A team member pushes figurines through the gate on the scale model and the concourse on screen fills, changes colour, and finally triggers a crowding alert that also lights the LED strip on the model. The whole sequence takes under a minute and needs no explanation.

## 2. Context and constraints

### 2.1 What the proposal commits us to

The endorsed scope is a working prototype for a single public transport station, demonstrated on a physical scale model rather than installed on the operating network, using simulated train schedules and sample passenger data. The system is positioned as monitoring and decision support and is explicitly not a replacement for existing station operations. Any feature that implies we are reading live data from Rapid Rail must be avoided or clearly labelled as simulated.

### 2.2 Reconciling the wider vision with the endorsed scope

The vision is a twin that visualises the whole LRT map, which is broader than a single station. The two fit together comfortably if the product has two levels of detail.

| Level | What it covers | Where the data comes from | Why it is safe for scope |
| --- | --- | --- | --- |
| Network twin | One full line with all stations and moving trains | Open timetable data plus simulation | Matches "simulated train schedules" in the proposal |
| Station twin | One hero station in 3D with zones, sensors and alerts | IoT sensors on the scale model, with simulation as fallback | Matches the single station and scale model commitment |

Only the hero station is sensor backed. Every other station on the line shows simulated congestion and is labelled as such in the interface. This honesty is a design feature in its own right, covered in requirement `UX-07`.

### 2.3 Timeline from the AERA Gantt chart

| Activity | Owner | Window |
| --- | --- | --- |
| System UI/UX Design | Wina | 28 Sep to 9 Oct |
| IoT Concept and Procurement | Wina | 28 Sep to 9 Oct |
| Core Platform Development | Mahendra | 12 Oct to 30 Oct |
| Physical Prototype | Wina | 12 Oct to 30 Oct |
| System Integration and Testing | Mahendra | 2 Nov to 6 Nov |
| User Testing | Wina | 9 Nov to 13 Nov |
| Product Sign-off | Mahendra | 16 Nov to 20 Nov |
| Pitch Video with product demo | Mahendra | due by 20 Nov |

Core development is three weeks. The Must list in this document has been sized for that window, and the build order in Section 15 assumes the hardware may arrive late, which Progress Report 1 already records as an open high risk.

### 2.4 Platform decisions already made

Production deployment is planned on Supabase, Render and Vercel. The product is built as a website first. The app-like experience the team wants is met by making the site responsive and installable as a Progressive Web App, which avoids a separate native codebase.

## 3. Benchmark of similar products

The aim of this section is to borrow proven ideas and to be clear about where AERA is different.

| Product | What it does well | What AERA borrows | Where AERA differs |
| --- | --- | --- | --- |
| Mini Tokyo 3D | A real-time 3D map of Tokyo's public transport. Trains run to actual timetables with delay data, lines use official colours, the sky follows the real day and night cycle, and there is an underground view. It is open source under the MIT licence. | The network twin concept, official line colours, smooth train animation, day and night sky, click a train to follow it | Mini Tokyo 3D stops at the map. AERA goes inside a station and connects to physical sensors. |
| Haskoning PedCast at Napoli Centrale | A station twin fed by 166 sensors (Bluetooth, infrared and 3D cameras) processed anonymously. Shows passenger counts per zone, minute by minute occupancy, heatmaps of the busiest areas and dwell time. | Zone based occupancy, heatmap of busiest areas, dwell time, anonymous by design | PedCast is an enterprise deployment. AERA shows the same idea working with low-cost parts on a model. |
| Hitachi 3D Lidar pilot at Manchester Piccadilly | Automated platform crowding monitoring with two interfaces, a mobile app for shift supervisors and a strategic dashboard for reviews, planning and trends. | The split between a live operator view and an analytics view | AERA uses inexpensive counting sensors instead of lidar and adds a public passenger view. |
| TfL Go station busyness | Shows passengers how busy a Tube station is, using aggregated and depersonalised WiFi data together with ticketing history. | A simple passenger facing busyness indicator and the privacy wording | AERA shows busyness per zone and per platform rather than one figure per station. |
| Google Maps busyness | Familiar live and typical busyness bars for places and transit. | The "live compared with usual" pattern for the passenger view | AERA is operator grade and spatial instead of a single bar. |
| Asia Mobiliti, UPTIME PRO, Hitachi Rail (from the team's competitor analysis) | Malaysian and regional rail digitalisation covering track condition, equipment monitoring and large scale operations. | Credibility that rail IoT and twins are an active local market | These focus on track, equipment and network operations. AERA focuses on station level passenger flow. |

### 3.1 What the benchmark tells us

Nobody in the list combines a beautiful network map, an explorable station interior and a visible link to physical sensors in one experience. That combination is AERA's position. It also explains the two products that should be open in a browser tab while building, Mini Tokyo 3D for the feel of the network view and PedCast screenshots for the logic of the station view.

One practical finding shapes the architecture. Malaysia's open data portal publishes a static GTFS timetable feed for Rapid Rail KL, yet it states that this category does not yet have stable realtime feeds. Train movement in AERA therefore has to be schedule driven simulation, which is exactly what the endorsed proposal describes.

## 4. Brainstorm

### 4.1 Experience pillars

1. **A map that feels alive.** The first screen is the product itself, with trains already moving. No hero banner, no stock photo, no explainer above the fold.
2. **Dive in, do not navigate away.** Going from line to station is a continuous camera move so the user keeps their sense of place.
3. **The physical link is always visible.** Every reading on screen says whether it is live from a sensor or simulated, and every incoming sensor event produces a small ripple at the place it happened.
4. **Calm by default, loud only when needed.** The interface is quiet navy and cyan until something needs attention, and then colour and motion are used with intent.
5. **One twin, three audiences.** Passengers, station operators and admins look at the same twin with different amounts of detail and control.

### 4.2 Signature moments worth building

| Moment | Description | Why it matters |
| --- | --- | --- |
| The dive | Clicking the hero station flies the camera from the line map into the 3D station while the map fades to a dim backdrop | It is the single most memorable transition and fits a short pitch video |
| The ripple | A sensor event from the model appears as an expanding ring at that gate in the twin, with a small latency badge such as "0.4 s" | It proves the twin is connected and makes latency a selling point |
| The exploded station | A toggle lifts the levels apart so entrance, concourse and platforms can all be seen at once | It solves occlusion and looks striking |
| Living sky | Background and lighting follow Kuala Lumpur time, with dawn, day, dusk and night palettes | Borrowed from Mini Tokyo 3D and inexpensive to build |
| Crowd as light | People are shown as soft drifting dots whose number follows occupancy, never as figures or faces | Beautiful, light to render and private by design |
| The loop closes | When a zone turns red in the twin, the LED strip on the physical model turns red too | It makes the system a true twin with two-way flow rather than a display |
| Scenario director | A hidden panel lets the presenter trigger evening peak, a train fault or a platform closure on cue | It makes demos repeatable |
| Time scrubber | A timeline at the bottom replays the last hour of the station | It turns a live view into a tool for review |

### 4.3 Ideas considered and where they landed

| Idea | Decision | Reason |
| --- | --- | --- |
| Whole line as a network twin | Must | Central to the vision and feasible with open timetable data |
| One hero station in 3D | Must | Core of the endorsed proposal |
| Gate counting sensors on the model | Must | Agreed data foundation in the technical requirements |
| Two-way control of LEDs and a small display on the model | Should | High impact for little hardware |
| Operator incident log | Must | Required by the station operator workflow |
| Sensor health monitoring | Must | Required by the admin workflow |
| Analytics and ridership trends | Should | Supports the data-driven objective |
| Short horizon crowd forecast | Could | Valuable, yet only after live data is flowing |
| Passenger push notifications | Could | Needs service worker setup and consent flows |
| Conversational chatbot | Could | Listed in the technical requirements, but adds scope without strengthening the twin |
| Crowdsourced GPS location sharing | Will not do in this release | Privacy and consent burden is too high for nine weeks |
| Journey planner and fares | Will not do | Existing apps already serve this |
| Live operator data from Rapid Rail | Will not do | No stable realtime rail feed is published |
| Native mobile app | Will not do | A responsive installable web app covers the need |

## 5. Users and roles

| Role | Who they are | What they need | Access |
| --- | --- | --- | --- |
| Passenger | Everyday riders and the general public | Next trains, how crowded the station and platforms are, any disruption | Public, no login, read only |
| Station Operator | On-the-ground staff at one station | Live crowd levels and sensor status for their station, alerts, a way to log incidents | Login, scoped to assigned station |
| Admin | Central monitoring and system owner | Status of all sensors, system-wide metrics, thresholds, user accounts, scenarios | Login, full access |

A fourth informal audience is the examiner or sponsor watching a demonstration. They use the passenger view and the scenario director, and Section 14 is written for them.

### 5.1 Core user journeys

1. **Passenger checks before travelling.** Opens the site on a phone, sees the line, taps the hero station, reads "Platform 1 is busy, next train in 3 minutes, concourse is clear" and decides when to leave.
2. **Operator handles a crowding event.** Sees the platform zone turn red on the console, receives an alert, acknowledges it, logs an incident and marks one entrance as closed. The twin and the passenger view update immediately.
3. **Admin spots a failing sensor.** The device list shows one sensor has stopped reporting. The related zone is flagged as running on estimated data. The admin investigates and notes the resolution.
4. **Presenter runs a scenario.** Opens the scenario director, starts "Evening peak", lets the simulation fill the station, then switches to live sensors on the model.

## 6. Scope

### 6.1 Must have for sign-off

1. Network twin of one line with stations and animated trains from timetable simulation
2. Station twin of the hero station in 3D with named zones coloured by occupancy
3. IoT ingestion from the scale model with a software simulator that speaks the identical contract
4. Occupancy estimation per zone and congestion levels against configurable thresholds
5. Alerts for crowding, train disruption, unavailable area and sensor fault
6. Operator console with alert handling and incident logging
7. Admin area for devices, thresholds and users
8. Passenger view that works well on a phone
9. Scenario director for demonstrations
10. Clear labelling of live versus simulated data everywhere

### 6.2 Should have

1. Two-way actuation to LEDs and a display on the model
2. Analytics page with occupancy history and peak periods
3. Time scrubber with replay of recent history
4. Day and night sky tied to Kuala Lumpur time
5. Bahasa Malaysia and English interface

### 6.3 Could have

1. Short horizon crowd forecast
2. Web push notifications for a chosen station
3. Chat style assistant answering questions about the next train and crowd level
4. Additional lines on the network twin

### 6.4 Out of scope

Journey planning, fares and ticketing, crowdsourced location sharing, live operator integrations, native mobile apps, and anything that controls real station equipment.

## 7. Functional requirements

Priority codes are M for Must, S for Should and C for Could.

### 7.1 Network twin

| ID | Requirement | Pri |
| --- | --- | --- |
| NET-01 | The system shall render the chosen rail line on an interactive map using geometry and station positions from the GTFS static feed. | M |
| NET-02 | The system shall draw the line in its official colour taken from `route_color` in the feed and never from a hard-coded value. | M |
| NET-03 | The system shall animate trains along the line at positions computed from the timetable and the shared simulation clock. | M |
| NET-04 | Each station shall display a compact congestion indicator that reflects its current level. | M |
| NET-05 | Selecting a station shall open a summary card with name, level, next trains in each direction and a button to enter the station twin where one exists. | M |
| NET-06 | Selecting a train shall show its direction, next stop, estimated arrival and simulated load, and offer a follow camera. | S |
| NET-07 | The map shall support pan, zoom, tilt and rotate with mouse, touch and keyboard. | M |
| NET-08 | The system shall show the full list of stations as an accessible alternative to the map. | M |
| NET-09 | The network twin shall be able to display more than one line without structural changes. | C |

### 7.2 Station twin

| ID | Requirement | Pri |
| --- | --- | --- |
| TWN-01 | The system shall render the hero station as a 3D model generated from a station definition file as described in Section 8.3. | M |
| TWN-02 | The model shall include entrances, fare gates, concourse, vertical circulation and platforms as distinct selectable zones. | M |
| TWN-03 | Each zone shall be coloured by its congestion level and shall show its count, capacity and percentage on selection. | M |
| TWN-04 | The twin shall show trains arriving, dwelling and departing at the platforms in step with the network twin. | M |
| TWN-05 | The twin shall offer an exploded view that separates levels vertically. | S |
| TWN-06 | The twin shall display passenger presence as animated particles whose density follows zone occupancy. | S |
| TWN-07 | Zones marked unavailable shall be visibly hatched and labelled with the reason. | M |
| TWN-08 | Sensor positions shall be shown as markers that pulse when an event arrives and turn grey when the device is offline. | M |
| TWN-09 | The camera shall offer preset views for overview, concourse, each platform and top down plan. | M |
| TWN-10 | A flat 2D plan view shall be available as a fallback on devices that cannot run the 3D scene smoothly. | M |

### 7.3 Train simulation

| ID | Requirement | Pri |
| --- | --- | --- |
| SIM-01 | The system shall import the Rapid Rail KL GTFS static feed and store the chosen line's stops, shapes, trips and stop times. | M |
| SIM-02 | Train positions shall be a deterministic function of timetable, simulation clock and active disruptions, so that every client shows the same picture. | M |
| SIM-03 | The simulation clock shall support real time, accelerated time, pause and jump to a chosen time of day. | M |
| SIM-04 | An admin shall be able to inject a disruption such as a delay on a segment, a train held at a station or a suspended section. | M |
| SIM-05 | Each simulated train shall carry a load value that changes as passengers board and alight under the rules in Section 13. | S |
| SIM-06 | If the feed lacks shapes or usable stop times for the line, the importer shall fall back to straight segments between stations and a configurable headway. | M |

### 7.4 Occupancy and congestion

| ID | Requirement | Pri |
| --- | --- | --- |
| OCC-01 | The system shall maintain a current passenger count for every zone of the hero station. | M |
| OCC-02 | Counts shall be derived from directional crossing events between adjacent zones as defined in Section 9.6. | M |
| OCC-03 | Each zone shall have a capacity and the system shall compute occupancy as a percentage of it. | M |
| OCC-04 | Occupancy shall map to four congestion levels using thresholds an admin can change. | M |
| OCC-05 | The system shall store occupancy history in one minute buckets. | M |
| OCC-06 | An operator shall be able to recalibrate a zone count to a stated value, and the action shall be logged. | M |
| OCC-07 | For stations without sensors, occupancy shall be produced by the simulator and labelled as simulated. | M |
| OCC-08 | The system shall produce a forecast for each zone for the next fifteen minutes. | C |

### 7.5 Alerts and incidents

| ID | Requirement | Pri |
| --- | --- | --- |
| ALT-01 | The system shall raise an alert when a zone stays at or above the crowded threshold for a configurable hold time. | M |
| ALT-02 | The system shall raise an alert when a train disruption is active. | M |
| ALT-03 | The system shall raise an alert when a zone or facility is marked unavailable. | M |
| ALT-04 | The system shall raise an alert when a device goes offline or reports abnormal data. | M |
| ALT-05 | Alerts shall carry severity, location, start time, current state and the person who acknowledged or resolved them. | M |
| ALT-06 | Operators shall be able to acknowledge and resolve alerts for their station. | M |
| ALT-07 | Operators shall be able to log an incident with type, zone, description and optional link to an alert, and admins shall see it immediately. | M |
| ALT-08 | Passenger-safe alerts shall appear on the public view in plain language. | M |
| ALT-09 | Selecting an alert shall move the camera to the affected place in the twin. | S |
| ALT-10 | Passengers shall be able to opt in to browser notifications for a station. | C |

### 7.6 IoT integration

| ID | Requirement | Pri |
| --- | --- | --- |
| IOT-01 | The system shall ingest sensor messages over MQTT following the topic and payload contract in Section 9. | M |
| IOT-02 | The system shall accept the same contract from the built-in simulator so that hardware and simulation are interchangeable. | M |
| IOT-03 | Every stored reading shall record its source as `device` or `sim`. | M |
| IOT-04 | The system shall track device status, last seen time, signal strength and firmware version. | M |
| IOT-05 | A device shall be marked offline when no heartbeat is received within a configurable window. | M |
| IOT-06 | Readings that are malformed, duplicated or out of range shall be rejected and counted. | M |
| IOT-07 | A sensor event shall be reflected in the twin within one second on a normal connection. | M |
| IOT-08 | The system shall publish commands to the model for LED state and display text. | S |
| IOT-09 | The system shall ingest environmental readings such as temperature and humidity and show them as station conditions. | S |
| IOT-10 | An admin shall be able to register a device, assign it to a station and sensor position, and retire it. | M |

### 7.7 Operator console

| ID | Requirement | Pri |
| --- | --- | --- |
| OPS-01 | The console shall show the station twin, a live alert queue, zone statistics and device status on one screen. | M |
| OPS-02 | An operator shall see only their assigned station. | M |
| OPS-03 | An operator shall be able to mark a zone or facility unavailable and restore it. | M |
| OPS-04 | The console shall keep a timeline of alerts, incidents and operator actions. | M |
| OPS-05 | The console shall offer a full screen wall mode suited to a large display. | S |

### 7.8 Admin

| ID | Requirement | Pri |
| --- | --- | --- |
| ADM-01 | An admin shall see a system overview with device health, active alerts and network-wide metrics. | M |
| ADM-02 | An admin shall manage user accounts and assign roles and stations. | M |
| ADM-03 | An admin shall configure congestion thresholds, alert hold times and zone capacities. | M |
| ADM-04 | An admin shall operate the scenario director and the simulation clock. | M |
| ADM-05 | An admin shall view an audit log of configuration changes. | S |

### 7.9 Passenger view

| ID | Requirement | Pri |
| --- | --- | --- |
| PAX-01 | The public view shall open without login and show the network twin immediately. | M |
| PAX-02 | For a station it shall show next trains per direction, overall busyness and busyness per platform. | M |
| PAX-03 | It shall show the simulated load of the next train where available. | S |
| PAX-04 | It shall be fully usable on a phone held in one hand. | M |
| PAX-05 | It shall be installable as a Progressive Web App. | S |
| PAX-06 | It shall offer English and Bahasa Malaysia. | S |

### 7.10 Analytics

| ID | Requirement | Pri |
| --- | --- | --- |
| ANA-01 | The system shall chart occupancy over time per zone for a chosen date range. | S |
| ANA-02 | The system shall show peak periods as a heatmap of hour against day. | S |
| ANA-03 | The system shall summarise alerts and incidents by type and time to resolve. | S |
| ANA-04 | The system shall export a selected dataset as CSV. | S |
| ANA-05 | The time scrubber shall replay stored history in the twin. | S |

## 8. Digital twin specification

### 8.1 What "twin" means in this project

A display of sensor numbers is a dashboard. A twin has three properties that the build must respect.

1. **Structure.** It has a spatial model of the real thing, with zones that correspond to places on the scale model.
2. **State.** It holds a current state for every zone, train and device that is updated by events rather than redrawn from scratch.
3. **Loop.** Data flows from the physical model to the twin, and decisions flow from the twin back to the physical model.

### 8.2 Two levels of detail

| Aspect | Network twin | Station twin |
| --- | --- | --- |
| Rendering | 2D vector basemap with tilt, trains drawn as a GPU layer | Stylised low-poly 3D scene |
| Entities | Line, stations, trains | Levels, zones, gates, sensors, trains at platform |
| Update source | Shared simulation clock | Sensor events and simulation |
| Interaction | Pan, zoom, select station or train | Orbit, presets, select zone or sensor |

The transition between them is a single continuous camera move. Technically the map and the 3D scene can be separate canvases that crossfade, as long as the user perceives one motion.

### 8.3 Station definition as data

The station is never modelled by hand in a 3D tool. It is described in a JSON file and the scene is generated from it. This keeps the model editable by the whole team and makes adding a second station a matter of writing a new file.

```json
{
  "id": "hero-station",
  "name": "To be confirmed",
  "line_id": "KJ",
  "levels": [
    { "id": "L0", "name": "Street", "elevation": 0 },
    { "id": "L1", "name": "Concourse", "elevation": 6 },
    { "id": "L2", "name": "Platform", "elevation": 12 }
  ],
  "zones": [
    {
      "id": "concourse",
      "name": "Concourse",
      "level": "L1",
      "type": "concourse",
      "polygon": [[0, 0], [40, 0], [40, 18], [0, 18]],
      "capacity": 300
    },
    {
      "id": "platform-1",
      "name": "Platform 1",
      "level": "L2",
      "type": "platform",
      "polygon": [[0, 0], [80, 0], [80, 5], [0, 5]],
      "capacity": 400,
      "direction_id": 0
    }
  ],
  "links": [
    { "id": "gate-main", "type": "faregate", "from": "outside", "to": "concourse", "position": [4, 9] },
    { "id": "stairs-p1", "type": "stairs", "from": "concourse", "to": "platform-1", "position": [20, 4] }
  ],
  "sensors": [
    { "device_id": "esp32-01", "sensor_id": "gate-main", "kind": "crossing", "link": "gate-main" },
    { "device_id": "esp32-01", "sensor_id": "env-concourse", "kind": "environment", "zone": "concourse" }
  ]
}
```

Units are metres at full scale. Zones are extruded into low platforms, links are drawn as connectors, and sensors are placed at their link or zone. The zone graph formed by `links` is also what the occupancy engine uses, so geometry and logic can never drift apart.

### 8.4 Twin state model

| Entity | State held | Changed by |
| --- | --- | --- |
| Zone | count, capacity, percent, level, availability, data source, last update | Crossing events, simulator, recalibration, operator action |
| Link | availability, flow rate in each direction over the last minute | Crossing events, operator action |
| Device | status, last seen, signal, firmware | Heartbeat, status messages |
| Train | trip, position along shape, next stop, load, delay | Clock, disruptions, boarding rules |
| Alert | type, severity, location, state, timestamps, handler | Rules engine, operator action |
| Simulation | clock time, speed, active scenario, disruptions | Admin |

### 8.5 The twin loop

1. A figurine crosses the gate on the scale model and the sensor emits a crossing event.
2. The twin service validates the event and updates the two zones on either side of that link.
3. The new zone state is written to the database and broadcast to every browser.
4. The 3D scene animates the change, recolours the zone and pulses the sensor marker.
5. The rules engine checks thresholds and raises an alert if needed.
6. The twin service publishes a command back to the model, which sets its LED strip and display.

Steps 1 to 4 must complete within one second. Step 6 is what turns a digital shadow into a digital twin and is worth protecting even if other Should items are dropped.

## 9. IoT integration specification

### 9.1 Sensing concept

The agreed data foundation is counting passengers as they pass through gates, which behaves like fare collection data rather than area scanning. On the scale model this becomes directional crossing sensors placed at every link between zones. Occupancy of a zone is then the running total of people who entered minus people who left.

The known weakness of this approach is drift, because a missed crossing is never corrected. The specification handles it in three ways, with a floor at zero, with operator recalibration, and with an automatic reset when the simulation reaches end of service.

### 9.2 Suggested hardware

This list is a proposal to help Wina's procurement task and is not a confirmed bill of materials.

| Purpose | Suggested part | Notes |
| --- | --- | --- |
| Controller | ESP32 development board | Built-in WiFi, widely stocked by local maker suppliers |
| Directional crossing | Two infrared break beam pairs per link, or two time-of-flight sensors | The order in which the two beams break gives direction |
| Train at platform | Infrared reflective or hall effect sensor under the track | Lets a model train trigger arrival in the twin |
| Station conditions | Temperature and humidity sensor | Feeds `IOT-09` |
| Facility status | Toggle switch or reed switch | Represents an escalator or entrance being out of service |
| Crowd light | Addressable RGB LED strip segments per zone | Driven by commands from the twin |
| Platform display | Small OLED module | Shows next train and crowd level |

### 9.3 Connectivity

Devices publish JSON over MQTT with TLS to a managed broker. MQTT is chosen because it is the common standard for IoT, it gives presence detection through last will messages, and it lets the twin send commands back to devices on the same connection. If WiFi at the demonstration venue blocks MQTT ports, the firmware should be able to fall back to MQTT over WebSockets on port 443.

### 9.4 Topic structure

```
aera/v1/{station_id}/{device_id}/event       device to cloud, crossing and switch events
aera/v1/{station_id}/{device_id}/telemetry   device to cloud, periodic readings
aera/v1/{station_id}/{device_id}/status      device to cloud, retained, last will sets offline
aera/v1/{station_id}/{device_id}/cmd         cloud to device, LED and display commands
```

### 9.5 Payload contract

Every message carries a schema version, a device timestamp and a sequence number. The sequence number lets the service drop duplicates and detect gaps.

Crossing event, published the moment it happens with quality of service 1.

```json
{
  "v": 1,
  "seq": 1042,
  "ts": "2026-10-20T10:15:03.120Z",
  "sensor_id": "gate-main",
  "type": "crossing",
  "direction": "in",
  "count": 1
}
```

Telemetry, published every ten seconds.

```json
{
  "v": 1,
  "seq": 1043,
  "ts": "2026-10-20T10:15:10.000Z",
  "readings": [
    { "sensor_id": "env-concourse", "type": "temperature_c", "value": 27.4 },
    { "sensor_id": "env-concourse", "type": "humidity_pct", "value": 68 }
  ],
  "rssi": -58,
  "uptime_s": 5321
}
```

Status, retained. The broker publishes the offline form automatically as the last will.

```json
{ "v": 1, "state": "online", "fw": "0.3.1", "ts": "2026-10-20T10:00:00.000Z" }
```

Command from the twin to the model.

```json
{
  "v": 1,
  "ts": "2026-10-20T10:15:04.000Z",
  "leds": [ { "zone": "concourse", "level": "crowded" } ],
  "display": { "line1": "Next train 3 min", "line2": "Platform 1 busy" }
}
```

`direction` is `in` when movement follows the link from its `from` zone to its `to` zone and `out` for the reverse. `level` is one of `low`, `moderate`, `busy`, `crowded`.

### 9.6 Occupancy engine

1. For a crossing with direction `in` on a link, add `count × scale_factor` to the `to` zone and subtract the same from the `from` zone. Direction `out` does the reverse.
2. The pseudo zone `outside` has no count and absorbs any value.
3. A zone count never goes below zero. When a subtraction would do so, clamp to zero and increment a drift counter for that zone.
4. `scale_factor` is configurable per station so that one figurine on the model can stand for several passengers. The default is 1.
5. When a train dwells at a platform, apply the boarding rule in Section 13 to move people between the platform zone and the train.
6. After each change, recompute percentage and level, then persist and broadcast.

All of this logic lives in one module so that both hardware events and simulated events pass through the same code.

### 9.7 Device health

A device is online while its retained status says so and a telemetry message has arrived within the last 30 seconds. When a device is offline, every zone that depends on it is flagged as estimated, its last known count is frozen, and alert `ALT-04` is raised. A reading is abnormal when it falls outside the configured range for its type, when the sequence number goes backwards, or when a crossing sensor fires faster than is physically plausible.

### 9.8 Simulator

The simulator is a first-class component and not a test helper. It publishes to the same topics with the same payloads, identified by device IDs that begin with `sim-`. It can drive any station, it follows a time-of-day demand curve with morning and evening peaks, and it responds to scenarios. During development it stands in for hardware, and during a demonstration it is the fallback named in Progress Report 1 if a sensor fails.

A source switch per station chooses between `device`, `sim` and `mixed`. In mixed mode, real sensors are used wherever they are online and the simulator fills the gaps.

## 10. Experience and visual design

The team's UI and UX design is being prepared separately in Canva and takes precedence where it gives a specific layout. This section gives the principles and tokens so that code written before that design is finished will still look consistent with it.

### 10.1 Design direction

The working name for the look is **Night Line**. Picture a rail control room at night crossed with an architectural light model. Deep navy space, tracks drawn as thin lines of cyan light, stations as small lanterns, and colour reserved for meaning. It should feel precise and calm, closer to an instrument than to a marketing site.

Things to avoid are purple gradients, glassmorphism on every surface, generic dashboard card grids, emoji as icons and decorative charts that carry no information.

### 10.2 Colour

The four brand colours come from the team's colour suggestion. The remaining values are proposals that extend them and can be tuned.

| Token | Value | Use |
| --- | --- | --- |
| `--brand-navy` | `#0B3D91` | Primary brand, headers on light theme, key buttons |
| `--brand-cyan` | `#00AEEF` | Tracks, focus, live indicators, links |
| `--brand-green` | `#00B894` | Positive state, low congestion |
| `--brand-mist` | `#E5E7EB` | Borders and text on dark, surfaces on light |
| `--bg-deep` | `#050E1F` | Canvas behind the twin on dark theme (proposed) |
| `--bg-panel` | `#0A1930` | Panels on dark theme (proposed) |
| `--text-strong` | `#F5F7FA` | Primary text on dark (proposed) |
| `--text-muted` | `#8FA3BF` | Secondary text on dark (proposed) |

Congestion uses its own semantic scale that is never reused for decoration.

| Level | Range by default | Colour | Paired cue |
| --- | --- | --- | --- |
| Low | under 40% | `#00B894` | One bar, label "Clear" |
| Moderate | 40% to under 60% | `#F2C94C` | Two bars, label "Moderate" |
| Busy | 60% to under 80% | `#F2994A` | Three bars, label "Busy" |
| Crowded | 80% and above | `#EB5757` | Four bars, label "Crowded", slow pulse |
| No data | device offline | `#6B7A90` | Hatched fill, label "Estimated" |

Colour is never the only signal. Every level is also shown with a bar count and a word, which keeps the interface usable for people with colour vision deficiency. The 80% boundary matches the example threshold in the technical requirements.

The operator console and the twin default to the dark theme. The passenger view follows the device setting and has a light theme built on navy text over a near white background.

### 10.3 Typography

| Role | Typeface | Reason |
| --- | --- | --- |
| Interface and headings | Barlow | Drawn from transport signage and reads well at small sizes |
| Numbers and data | IBM Plex Mono or Barlow with tabular figures | Counts and timers must not shift as digits change |

Both are free on Google Fonts. Use a small set of sizes, generous letter spacing on uppercase labels, and large confident numerals for the key figures such as minutes to next train.

### 10.4 Motion

| Element | Behaviour |
| --- | --- |
| Trains | Continuous movement with easing into and out of stations, never teleporting |
| Camera dive | About 1.2 seconds with ease in and out |
| Zone colour change | Blend over about 600 milliseconds so that levels do not flicker |
| Sensor ripple | A ring expanding and fading over about 800 milliseconds |
| Crowded alert | A slow pulse at roughly one cycle per two seconds, and nothing faster |
| Numbers | Count up or down to the new value over a short interval |

All non-essential motion is disabled when the user has asked for reduced motion, and the twin remains fully readable without it.

### 10.5 Layout

The twin always fills the viewport and panels float over it. On a desktop, the left edge carries navigation, the right edge carries a context panel for the selected station, zone or train, and the bottom carries the time scrubber. On a phone, the context panel becomes a bottom sheet that can be dragged between a peek, half and full height, with the twin still visible above it.

### 10.6 Components to build once and reuse

Congestion pill, zone card, next train row, alert item, device row, source badge (Live or Simulated), latency badge, level legend, scenario button, bottom sheet, command palette for operators.

### 10.7 Experience requirements

| ID | Requirement | Pri |
| --- | --- | --- |
| UX-01 | The first meaningful view shall be the live network twin with no intermediate landing page. | M |
| UX-02 | The interface shall follow the tokens in Section 10.2 and 10.3 through a single theme file. | M |
| UX-03 | Every congestion indication shall combine colour with a text label and a bar count. | M |
| UX-04 | The transition between network and station shall be a continuous animated camera move. | M |
| UX-05 | The interface shall be responsive from 360 pixels wide to large wall displays. | M |
| UX-06 | All interactive elements shall be reachable by keyboard and labelled for screen readers, and every map or 3D view shall have a list or table equivalent. | M |
| UX-07 | Every data point shall show whether it is live from a sensor or simulated. | M |
| UX-08 | The interface shall respect the reduced motion preference. | M |
| UX-09 | The background and lighting shall follow Kuala Lumpur time of day. | S |
| UX-10 | Empty, loading and error states shall be designed and shall never show a blank canvas. | M |

## 11. Architecture and technology

### 11.1 Overview

```
 Scale model                Cloud                                   Users
+-------------+     +----------------+     +------------------+     +-------------+
| ESP32       | --> | MQTT broker    | --> | Twin service     | --> | Supabase    |
| sensors     | <-- | (managed, TLS) | <-- | on Render        |     | Postgres    |
| LEDs, OLED  |     +----------------+     | ingest, engine,  |     | Auth        |
+-------------+             ^              | rules, simulator |     | Realtime    |
                            |              +------------------+     +------+------+
                     +------+------+                                       |
                     | Simulator   |                                       v
                     | same topics |                                +-------------+
                     +-------------+                                | Web app on  |
                                                                    | Vercel      |
                                                                    +-------------+
```

### 11.2 Proposed stack

The Gantt chart shows that tech stack identification is already complete. The table below is this document's working assumption based on the planned hosting, and should be corrected if the team's chosen stack differs.

| Layer | Choice | Reason |
| --- | --- | --- |
| Web app | Next.js with TypeScript on Vercel | First-class Vercel support, server and client rendering |
| Styling | Tailwind CSS with CSS variables for tokens | One theme file, fast iteration |
| Network twin | MapLibre GL JS with deck.gl layers | Open source, no map token required, GPU animation for trains |
| Station twin | three.js through React Three Fiber | Declarative 3D that fits a React codebase |
| Charts | A lightweight chart library such as Recharts or visx | Analytics only |
| State | Zustand for client state, Supabase client for data | Small and simple |
| Database and auth | Supabase Postgres, Auth and Row Level Security | Already chosen |
| Live updates | Supabase Realtime | Pushes zone, alert and device changes to browsers |
| Twin service | Python with FastAPI on Render | Hosts ingestion, occupancy engine, rules and simulator |
| Messaging | Managed MQTT broker with TLS | Standard IoT transport with two-way messaging |
| Firmware | Arduino framework or MicroPython on ESP32 | Team's choice |

### 11.3 Design decisions that matter

1. **Trains are computed in the browser.** The server broadcasts only the simulation clock, speed and disruptions. Each browser calculates train positions from the timetable every frame, which gives smooth motion without streaming positions.
2. **The twin service is the single writer of zone state.** Browsers never compute occupancy themselves. They render what the service publishes.
3. **Sensor and simulator share one path.** Both publish to the broker and both pass through the same engine.
4. **Station geometry is data.** The same JSON file drives the 3D scene, the 2D fallback, the zone graph and the device registry.
5. **Public data is exposed through safe views.** Passengers read from database views that contain no operator notes or user information.

### 11.4 Hosting cautions

Render's free web services spin down after 15 minutes without inbound traffic and take about a minute to start again, and background workers are not offered on the free tier. An MQTT subscriber needs to stay connected, so the twin service must either run on a paid instance during integration and demonstration weeks or be kept awake by a scheduled ping. This should be decided before integration week.

### 11.5 Suggested repository layout

```
aera/
  apps/
    web/                 Next.js application
      app/               routes
      components/        shared UI
      features/
        network-twin/
        station-twin/
        alerts/
        console/
        admin/
        analytics/
      lib/               supabase client, simulation clock, gtfs helpers
      styles/            theme tokens
    twin-service/        FastAPI service
      ingest/            mqtt client and validation
      engine/            occupancy and boarding rules
      rules/             alert rules
      simulator/         demand model and scenarios
      gtfs/              feed importer
  firmware/              ESP32 code
  packages/
    contracts/           JSON schemas for payloads and station definition
  supabase/
    migrations/
    seed/
  data/
    stations/            station definition files
  docs/
    AERA_BRS.md
```

### 11.6 Routes

| Route | Audience | Content |
| --- | --- | --- |
| `/` | Public | Network twin |
| `/station/[id]` | Public | Station twin and passenger panel |
| `/console` | Operator | Operator console for the assigned station |
| `/admin` | Admin | Overview |
| `/admin/devices` | Admin | Device registry and health |
| `/admin/settings` | Admin | Thresholds, capacities, users |
| `/admin/scenarios` | Admin | Scenario director and simulation clock |
| `/analytics` | Operator and Admin | History, heatmaps, exports |
| `/about` | Public | Project, team, data sources and privacy statement |

### 11.7 Data model

| Table | Purpose | Key columns |
| --- | --- | --- |
| `lines` | Rail lines | id, name, color, shape |
| `stations` | Stations on a line | id, line_id, name, lat, lon, sequence, has_twin, source_mode |
| `gtfs_trips`, `gtfs_stop_times` | Timetable used by the simulation | trip_id, direction_id, stop_id, arrival, departure |
| `zones` | Zones of a station | id, station_id, name, type, level, capacity, available |
| `links` | Connections between zones | id, station_id, from_zone, to_zone, type, available |
| `devices` | Registered devices | id, station_id, name, status, last_seen, rssi, firmware |
| `sensors` | Sensors on a device | id, device_id, kind, link_id, zone_id |
| `sensor_events` | Raw accepted events | id, sensor_id, ts, type, direction, value, source, seq |
| `zone_state` | Current state, one row per zone | zone_id, count, percent, level, source, updated_at |
| `zone_history` | One minute buckets | zone_id, bucket, avg_count, max_count, level |
| `alert_rules` | Thresholds and hold times | id, station_id, type, params |
| `alerts` | Raised alerts | id, station_id, zone_id, type, severity, state, started_at, acked_by, resolved_at |
| `incidents` | Operator incident log | id, station_id, zone_id, type, description, alert_id, created_by |
| `sim_state` | Clock and scenario | id, clock_time, speed, scenario, disruptions |
| `profiles` | Users | id, role, station_id, display_name |
| `audit_log` | Configuration changes | id, actor, action, target, before, after, ts |

Row Level Security rules. Anonymous users can read lines, stations, zones, `zone_state`, public alerts and `sim_state`. Operators can read everything for their station and write alerts, incidents and availability for it. Admins can read and write everything. Only the twin service, using the service role key, writes `sensor_events`, `zone_state` and `zone_history`.

### 11.8 Open data source

The timetable comes from the GTFS static endpoint `https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl`, which returns a ZIP with agency, stops, routes, trips, stop times and calendar, plus frequencies and shapes when available. The importer runs as a script and stores the result, so the application does not depend on the portal at run time. The portal's terms of use should be read and the source credited on the About page.

## 12. Non-functional requirements

| ID | Requirement | Pri |
| --- | --- | --- |
| NFR-01 | End-to-end latency from sensor event to visible change shall be under one second at the 95th percentile on a normal connection. | M |
| NFR-02 | The network twin shall hold 60 frames per second on a recent laptop and at least 30 on a mid-range phone. | M |
| NFR-03 | The first view shall be interactive within three seconds on a broadband connection. | M |
| NFR-04 | The 3D scene shall load on demand so that the passenger view stays light. | M |
| NFR-05 | If live updates disconnect, the interface shall show a clear stale indicator and reconnect automatically. | M |
| NFR-06 | The system shall continue to work with the simulator when no hardware is present. | M |
| NFR-07 | No personal data about passengers shall be collected. Sensors count crossings and nothing else. | M |
| NFR-08 | Secrets shall never be committed, and the service role key shall exist only in the twin service. | M |
| NFR-09 | MQTT connections shall use TLS and per-device credentials. | M |
| NFR-10 | All tables shall have Row Level Security enabled. | M |
| NFR-11 | The interface shall meet WCAG 2.1 AA contrast for text and controls. | M |
| NFR-12 | The latest two versions of Chrome, Edge, Safari and Firefox shall be supported. | M |
| NFR-13 | The occupancy engine, boarding rule and alert rules shall have automated tests. | M |
| NFR-14 | Payloads shall be validated against shared JSON schemas in both firmware tests and the service. | S |
| NFR-15 | The codebase shall include a one-command local setup with seeded data and the simulator running. | M |

## 13. Business rules

| Rule | Default | Configurable by |
| --- | --- | --- |
| Congestion thresholds | 40, 60 and 80 percent | Admin |
| Crowding alert hold time | 30 seconds at or above crowded | Admin |
| Crowding alert clears | After 60 seconds below the busy threshold | Admin |
| Device heartbeat window | 30 seconds | Admin |
| Scale factor | 1 passenger per crossing | Admin, per station |
| Train capacity | To be confirmed for the chosen line's rolling stock | Admin |
| Train dwell time | From the timetable, or 30 seconds if absent | Admin |
| Boarding rule | On dwell, alighting equals a share of train load set by the scenario and moves to the platform then drains to the concourse. Boarding equals the lesser of platform count and spare train capacity. | Admin |
| End of service reset | All zone counts return to zero when the simulated service day ends | Fixed |
| Alert severity | Crowded and train suspended are high. Area unavailable and device offline are medium. Abnormal reading is low. | Admin |

## 14. Acceptance and demonstration

### 14.1 Acceptance criteria for sign-off

1. With the simulator running and no hardware attached, a new visitor sees trains moving on the line within three seconds of opening the site.
2. Selecting the hero station plays the camera dive and shows every zone with a level, a count and a source badge.
3. Passing an object through the model's gate ten times in the inward direction raises the concourse count by ten times the scale factor, and each crossing shows a ripple within one second.
4. Driving a zone above 80 percent for the hold time raises a crowding alert that appears in the operator console, on the passenger view in plain words, and on the model's LED strip.
5. Unplugging a device marks it offline within the heartbeat window, flags dependent zones as estimated and raises a device alert.
6. An operator can acknowledge the alert, log an incident and mark an entrance unavailable, and an admin sees all three without refreshing.
7. An operator account cannot see or change another station.
8. An admin can change the crowded threshold and the twin recolours accordingly.
9. The scenario director can start evening peak and inject a train delay, and both are visible on the network twin and the station twin.
10. The passenger view is usable on a 360 pixel wide phone and passes an automated accessibility check with no critical issues.

### 14.2 Suggested ninety second demo for the pitch video

1. Open on the network twin at dusk with trains moving. Ten seconds of silence lets it land.
2. Click the hero station and let the dive play.
3. Show the scale model beside the screen. Push figurines through the gate and let the ripples and the rising count speak.
4. Keep going until the platform turns red, the alert fires and the model's LEDs change.
5. Switch to the operator console, acknowledge and log the incident.
6. Cut to a phone showing the passenger view with the same alert in plain language.
7. Close on the analytics heatmap and the line "one station today, a whole network tomorrow".

## 15. Build plan for Claude Code

Each phase ends with something that can be shown to the supervisor. The phases follow the Gantt windows and assume hardware may not be ready until late October.

| Phase | Target window | Outcome | Requirements |
| --- | --- | --- | --- |
| 0. Foundation | by 12 Oct | Repository, theme tokens, Supabase schema and seed, auth with three roles, deployment pipeline | UX-02, NFR-08, NFR-10, NFR-15 |
| 1. Network twin | 12 to 16 Oct | GTFS import, line and stations on the map, trains moving from the simulation clock | NET-01 to NET-08, SIM-01 to SIM-03, SIM-06 |
| 2. Station twin | 16 to 21 Oct | Station generated from JSON, zones, presets, 2D fallback, camera dive | TWN-01 to TWN-04, TWN-07 to TWN-10, UX-04 |
| 3. Data spine | 19 to 23 Oct | Broker, twin service, occupancy engine, simulator, realtime to browser, source badges | IOT-01 to IOT-07, OCC-01 to OCC-07, UX-07 |
| 4. Alerts and roles | 23 to 28 Oct | Rules engine, operator console, incident log, admin settings, scenario director | ALT-01 to ALT-08, OPS-01 to OPS-04, ADM-01 to ADM-04, SIM-04 |
| 5. Passenger polish | 28 to 30 Oct | Mobile bottom sheet, light theme, accessibility pass, empty and error states | PAX-01 to PAX-04, UX-05, UX-06, UX-08, UX-10 |
| 6. Hardware integration | 2 to 6 Nov | Real ESP32 on the contract, latency badge, LED and display commands | IOT-08 to IOT-10, NFR-01 |
| 7. Should items | 2 to 13 Nov | Analytics, time scrubber, living sky, particles, exploded view, bilingual | ANA, TWN-05, TWN-06, UX-09, PAX-05, PAX-06 |
| 8. Hardening | 9 to 20 Nov | Fixes from user testing, demo rehearsal, video capture | Section 14 |

### 15.1 Working agreements for vibe coding

1. Begin each session by naming the phase and the requirement IDs being worked on.
2. Build the simulator before the hardware arrives and never special-case simulated data in the interface beyond the source badge.
3. Keep the payload schemas and the station definition schema in `packages/contracts` and change them only together with this document.
4. Keep all colours, fonts and motion timings in the theme file. No raw hex values in components.
5. Write tests for the occupancy engine and alert rules before wiring them to the interface.
6. After each phase, deploy and check the result on a real phone.

## 16. Risks, assumptions and open decisions

### 16.1 Risks

| Risk | Effect | Response |
| --- | --- | --- |
| Hardware arrives late | Integration week slips | Simulator is a full stand-in from phase 3, already agreed as fallback in Progress Report 1 |
| Integration is harder than expected | Live demo fails | Fixed contract in Section 9 and an early proof of concept with one sensor |
| 3D is slow on phones | Poor passenger experience | 2D fallback in TWN-10 and on-demand loading |
| Venue WiFi blocks MQTT | Model cannot connect | WebSocket transport on port 443 and a phone hotspot as backup |
| Free hosting sleeps mid demo | Twin stops updating | Paid instance or keep-alive during demo weeks |
| Count drift on the model | Numbers look wrong | Clamp at zero, recalibrate button, scenario reset |
| Scope creep from chatbot and notifications | Core twin unfinished | Both held at Could until the Must list is signed off |
| GTFS feed lacks shapes or stop times for the line | Trains cannot follow the track | Fallback in SIM-06 |

### 16.2 Assumptions

1. The stack is Next.js on Vercel, FastAPI on Render and Supabase, as inferred from the planned hosting.
2. The hero station sits on the Kelana Jaya Line, since that line appears in the proposal's figures.
3. The scale model represents three zones at minimum, an entrance and gate area, a concourse and at least one platform.
4. Sensors count crossings only, and no cameras are used.
5. Wina's Canva design will be reconciled with the tokens in Section 10 before phase 5.

### 16.3 Decisions the team still needs to make

| Decision | Options | Suggestion |
| --- | --- | --- |
| Which station is the hero | Any station on the chosen line | Pick one with a simple layout of one concourse and two platforms so the model and the twin stay faithful to each other |
| Product name shown in the interface | AERA, or RailVista from the business draft | AERA, since it is already used on the Gantt chart |
| MQTT broker | Any managed broker with a free or student tier | Choose the one with the simplest TLS setup for ESP32 and confirm current limits |
| Twin service language | Python or Node | Python with FastAPI, to match the team's strengths |
| Firmware framework | Arduino or MicroPython | Whichever Wina is most comfortable with |
| Hosting during demo weeks | Free tier with keep-alive, or lowest paid instance | Paid for the final three weeks to remove the risk |
| Chatbot in scope | Build, defer or drop | Defer to Could |

## 17. Sources

1. Endorsed Project Proposal, Progress Report 1, Technical Requirements 1st Progress, TTP Business Draft, Colour code suggestion and AERA Gantt Chart, from the team's project files
2. [Mini Tokyo 3D overview](https://minitokyo3d.com/docs/master/user-guide/overview.html) and [repository](https://github.com/nagix/mini-tokyo-3d)
3. [Haskoning, pedestrian safety and comfort at Napoli Centrale using a digital twin](https://www.haskoning.com/en/projects/pedestrian-safety-and-comfort-at-napoli-centrale-using-digital-twin)
4. [Hitachi, Network Rail pilots Hitachi 3D Lidar](https://community.hitachivantara.com/s/article/Network-Rail-pilots-Hitachi-3D-Lidar-Harnessing-digital-solutions-to-power-smarter-and-more-seamless-passenger-journeys)
5. [Transport for London, improved real-time Tube station information added to TfL Go](https://tigris.tfl.gov.uk/info-for/media/press-releases/2021/june/improved-real-time-tube-station-information-added-to-tfl-go)
6. [data.gov.my GTFS Static API](https://developer.data.gov.my/realtime-api/gtfs-static) and [GTFS Realtime API](https://developer.data.gov.my/realtime-api/gtfs-realtime)
7. [Render free instance documentation](https://render.com/docs/free)
8. [Supabase Realtime documentation](https://supabase.com/docs/guides/realtime)
