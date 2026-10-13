/**
 * What needs an operator's attention now (CTRL-02), worst first. Pure, so the control room
 * and tests read the same list. Every alert names the train or place and says why.
 *
 *   packed     a train is packed now: riders may be left on the platform
 *   ahead      a train will be packed within the next few stops
 *   held       a train is held, or running five minutes or more late
 *   gap        a long wait between trains in one direction (bunching after a delay)
 *   other      another line's trains are usually packed at this hour
 */

import type { CrowdEngine, TrainRun } from "../crowd/model.ts";
import type { TrainState } from "../sim/trains.ts";
import type { LineData } from "../types";

export type AlertKind = "packed" | "ahead" | "held" | "gap" | "other";

export interface Alert {
  kind: AlertKind;
  /** 3 act now, 2 watch, 1 for information. */
  severity: 1 | 2 | 3;
  title: string;
  detail: string;
  /** The train to open on the map, when there is one. */
  trip?: string;
}

export interface RunningTrain {
  run: TrainRun;
  state: TrainState;
  loadPct: number;
}

const PACKED = 95;
const AHEAD_STOPS = 4;
const LATE_S = 300;
const GAP_FACTOR = 1.8;

export function lineAlerts(engine: CrowdEngine, line: LineData, trains: RunningTrain[],
  others: { name: string; max: number; from: string; to: string }[] = []): Alert[] {
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  const out: Alert[] = [];
  for (const tr of trains) {
    const dir = tr.state.directionId;
    const d = line.directions.find((x) => x.direction_id === dir)!;
    const k = tr.state.stopIndex;
    const here = names[d.stops[k]?.station_id] ?? "";
    const to = `To ${d.headsign}`;
    const trip = tr.run.trip.id;
    if (tr.loadPct >= PACKED) {
      out.push({ kind: "packed", severity: 3, trip, title: `${to}: packed leaving ${here}`, detail: `${Math.round(tr.loadPct)}% of capacity. Riders may be left on the platform; consider an extra train.` });
    } else {
      for (let j = k + 1; j < Math.min(k + 1 + AHEAD_STOPS, tr.run.legs.length); j++) {
        if (tr.run.legs[j] >= PACKED) {
          out.push({ kind: "ahead", severity: 2, trip, title: `${to}: packed from ${names[d.stops[j].station_id]}`,
            detail: `Now at ${here}; ${j - k} ${j - k === 1 ? "stop" : "stops"} until it is full.` });
          break;
        }
      }
    }
    const late = tr.run.times[k][0] - (tr.run.trip.start + d.stops[k].arr);
    if (tr.state.status === "held" || late >= LATE_S) {
      out.push({ kind: "held", severity: tr.state.status === "held" ? 3 : 2, trip,
        title: tr.state.status === "held" ? `${to}: held at ${here}` : `${to}: ${Math.round(late / 60)} min late at ${here}`,
        detail: "The trains behind it bunch up and the platforms ahead fill." });
    }
  }
  // Gaps: consecutive trains in one direction further apart than the timetable allows.
  // Each train's "virtual start" (when it would have left the terminal at its current delay)
  // spaces trains in time; compare with the timetable's headway when either one started.
  for (const d of line.directions) {
    const ahead = trains.filter((x) => x.state.directionId === d.direction_id)
      .map((x) => ({ x, at: x.run.times[x.state.stopIndex][0] - d.stops[x.state.stopIndex].arr }))
      .sort((a, b) => a.at - b.at);
    for (let i = 1; i < ahead.length; i++) {
      const gap = ahead[i].at - ahead[i - 1].at;
      const hw = Math.max(engine.headway(d.direction_id, ahead[i].x.run.trip.start) ?? 0, engine.headway(d.direction_id, ahead[i - 1].x.run.trip.start) ?? 0);
      if (hw && gap > hw * GAP_FACTOR) {
        const where = names[d.stops[ahead[i - 1].x.state.stopIndex].station_id];
        out.push({ kind: "gap", severity: 2, trip: ahead[i].x.run.trip.id, title: `${Math.round(gap / 60)} min gap towards ${d.headsign}`,
          detail: `Behind the train near ${where}; the timetable says every ${Math.round(hw / 60)} min.` });
      }
    }
  }
  for (const o of others) {
    if (o.max >= PACKED) out.push({ kind: "other", severity: 1, title: `${o.name}: usually packed now`, detail: `Between ${o.from} and ${o.to}, from the typical week.` });
  }
  return out.sort((a, b) => b.severity - a.severity);
}
