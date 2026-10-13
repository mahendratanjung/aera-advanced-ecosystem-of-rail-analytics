"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { simNowMs } from "./sim/clock";
import { CrowdEngine, type CrowdModelData } from "./crowd/model";
import { LineModel } from "./sim/trains";
import { type NetIndex, type Network, indexNetwork } from "./advisor/network";
import { layout, withMapNames } from "./network/layout";
import type { NetCrowdModel } from "./network/crowd";
import type { SimNetwork } from "./network/trains";
import { useTwin } from "./store";
import type { LineData, StationDefinition } from "./types";

const lineCache = new Map<string, Promise<LineData>>();
const defCache = new Map<string, Promise<StationDefinition>>();

function useAsync<T>(key: string | null, load: () => Promise<T>): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    load()
      .then((data) => alive && setState({ key, data, error: null }))
      .catch((e: Error) => alive && setState({ key, data: null, error: e.message || "Could not load" }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { data: null, error: null };
}

export function useLine(lineId = "KJ") {
  const res = useAsync(lineId, () => {
    if (!lineCache.has(lineId)) {
      const p = api<LineData>(`/lines/${lineId}`);
      p.catch(() => lineCache.delete(lineId));
      lineCache.set(lineId, p);
    }
    return lineCache.get(lineId)!;
  });
  const model = useMemo(() => (res.data ? new LineModel(res.data) : null), [res.data]);
  return { line: res.data, model, error: res.error };
}

const modelCache = new Map<string, Promise<CrowdModelData>>();

/** The line, its timetable model and the crowding engine built on recent gate data. */
export function useCrowd(lineId = "KJ") {
  const { line, model, error: lineError } = useLine(lineId);
  const res = useAsync(lineId, () => {
    if (!modelCache.has(lineId)) {
      const p = api<CrowdModelData>(`/lines/${lineId}/model`);
      p.catch(() => modelCache.delete(lineId));
      modelCache.set(lineId, p);
    }
    return modelCache.get(lineId)!;
  });
  const engine = useMemo(() => (model && res.data ? new CrowdEngine(model, res.data) : null), [model, res.data]);
  return { line, model, engine, error: lineError ?? res.error };
}

let netCache: Promise<Network> | null = null;

/** Every Rapid Rail line, for the route advisor. Indexed once. */
export function useNetwork(): { ix: NetIndex | null; error: string | null } {
  const res = useAsync("rapid", () => {
    if (!netCache) {
      netCache = api<Network>("/network");
      netCache.catch(() => (netCache = null));
    }
    return netCache;
  });
  const ix = useMemo(() => (res.data ? indexNetwork(res.data) : null), [res.data]);
  return { ix, error: res.error };
}

export function useStationDefinition(stationId: string | null) {
  const res = useAsync(stationId, () => {
    const id = stationId!;
    if (!defCache.has(id)) {
      const p = api<StationDefinition>(`/stations/${id}/definition`);
      p.catch(() => defCache.delete(id));
      defCache.set(id, p);
    }
    return defCache.get(id)!;
  });
  return { def: res.data, error: res.error };
}

/** Simulated time that re-renders on an interval. Use requestAnimationFrame code for motion. */
export function useSimNow(intervalMs = 1000): number {
  const clock = useTwin((s) => s.sim?.clock);
  const offset = useTwin((s) => s.offsetMs);
  const tick = useSyncExternalStore(
    (cb) => {
      const id = setInterval(cb, intervalMs);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs),
    () => 0,
  );
  return useMemo(() => simNowMs(clock, offset), [clock, offset, tick]);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

let trainsCache: Promise<SimNetwork> | null = null;

/** Timetables for every line other than the Kelana Jaya Line (TRAINS-01). Loaded once. */
export function useSimNetwork(): { net: SimNetwork | null; error: string | null } {
  const res = useAsync("trains", () => {
    if (!trainsCache) {
      trainsCache = api<SimNetwork>("/network/trains").then((n) => withMapNames(layout(), n));
      trainsCache.catch(() => (trainsCache = null));
    }
    return trainsCache;
  });
  return { net: res.data, error: res.error };
}

let netCrowdCache: Promise<NetCrowdModel> | null = null;

/** Typical-week crowding on every other line (NETC-01). Loaded once; null until it arrives or if it is missing. */
export function useNetCrowd(): NetCrowdModel | null {
  const res = useAsync("net-crowd", () => {
    if (!netCrowdCache) {
      netCrowdCache = api<NetCrowdModel>("/network/model");
      netCrowdCache.catch(() => (netCrowdCache = null));
    }
    return netCrowdCache;
  });
  return res.data;
}
