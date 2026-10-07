"use client";

/**
 * One animation loop for every live view. Loads are recomputed twice a second, positions
 * every frame, and subscribers (strip map, map, panels) read the same frame so they never
 * disagree.
 */

import { simNowMs } from "../sim/clock";
import type { TrainState } from "../sim/trains";
import { useTwin } from "../store";
import type { CrowdEngine, TrainRun } from "./model";

export interface LiveTrain {
  run: TrainRun;
  state: TrainState;
  loadPct: number;
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
  const t = simNowMs(st.sim?.clock, st.offsetMs) / 1000;
  const disruptions = st.sim?.disruptions ?? [];
  const mult = st.sim?.scenario.demand_mult ?? 1;
  const key = JSON.stringify([disruptions, mult]);
  const now = performance.now();
  if (now - runsAt > 500 || key !== runsKey) {
    runsAt = now;
    runsKey = key;
    const lb = engine.lookback(t, disruptions);
    runs = engine.line.data.directions.flatMap((d) => engine!.runs(d.direction_id, t - lb, t + 60, disruptions, mult));
  }
  const trains: LiveTrain[] = [];
  for (const run of runs) {
    const state = engine.line.stateAt(run.trip, run.times, t);
    if (!state) continue;
    trains.push({ run, state, loadPct: run.legs[Math.min(state.stopIndex, run.legs.length - 1)] ?? 0 });
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
