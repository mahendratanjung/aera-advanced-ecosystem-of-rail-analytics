"use client";

/**
 * One animation loop for every live view. Loads are recomputed twice a second, positions
 * every frame, and subscribers (strip map, map, panels) read the same frame so they never
 * disagree.
 */

import { simNowMs } from "../sim/clock";
import type { TrainState } from "../sim/trains";
import { useTwin } from "../store";
import { useUi } from "../ui";
import type { CrowdEngine, TrainRun } from "./model";
import { type ObservedLoad, blendLegs } from "./observed";

export interface LiveTrain {
  run: TrainRun;
  state: TrainState;
  loadPct: number;
  /** What riders and sensors reported, already blended into run.legs and loadPct. */
  observed?: ObservedLoad;
}

export interface LiveFrame {
  t: number;
  trains: LiveTrain[];
}

type Listener = (f: LiveFrame) => void;

const listeners = new Set<Listener>();
let engine: CrowdEngine | null = null;
let raf = 0;
let runs: TrainRun[] = [];
let runsAt = 0;
let runsKey = "";
export let latest: LiveFrame = { t: 0, trains: [] };

function frame() {
  raf = requestAnimationFrame(frame);
  if (!engine) return;
  const st = useTwin.getState();
  // MAPC-05: the map can look up to two hours ahead; everything drawn follows this one time.
  const ahead = useUi.getState().ahead * 60;
  const t = simNowMs(st.sim?.clock, st.offsetMs) / 1000 + ahead;
  const disruptions = st.sim?.disruptions ?? [];
  const mult = st.sim?.scenario.demand_mult ?? 1;
  const key = JSON.stringify([disruptions, mult, ahead]);
  const now = performance.now();
  if (now - runsAt > 500 || key !== runsKey) {
    runsAt = now;
    runsKey = key;
    const lb = engine.lookback(t, disruptions);
    runs = engine.line.data.directions.flatMap((d) => engine!.runs(d.direction_id, t - lb, t + 60, disruptions, mult));
  }
  const trains: LiveTrain[] = [];
  for (const predicted of runs) {
    const state = engine.line.stateAt(predicted.trip, predicted.times, t);
    if (!state) continue;
    // What riders report is about now, so it is left out of a look ahead.
    const observed = ahead ? undefined : st.observed[predicted.trip.id];
    const run = observed ? { ...predicted, legs: blendLegs(predicted.legs, observed, t * 1000) } : predicted;
    trains.push({ run, state, loadPct: run.legs[Math.min(state.stopIndex, run.legs.length - 1)] ?? 0, observed });
  }
  latest = { t, trains };
  for (const fn of listeners) fn(latest);
}

export function attachEngine(e: CrowdEngine) {
  engine = e;
  runsAt = 0;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  if (!raf) raf = requestAnimationFrame(frame);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
