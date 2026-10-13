"use client";

/**
 * Client copy of the twin state. The twin service is the single writer (section 11.3.2):
 * this store only applies what the service broadcasts.
 */

import { create } from "zustand";
import { setCrowdBounds } from "./crowd/levels";
import type { ObservedLoad } from "./crowd/observed";
import type {
  Alert, AuditEntry, Command, Device, EnvReading, Incident, LinkState, LiveFeedStatus, Notice, Ripple, SimState,
  StationSummary, TwinState, User, ZoneState,
} from "./types";

export type ConnStatus = "connecting" | "live" | "stale" | "offline";

interface TwinStore {
  status: ConnStatus;
  lastMessageAt: number;
  offsetMs: number;
  hasSnapshot: boolean;
  sim: SimState | null;
  settings: PublicSettings | null;
  stations: Record<string, StationSummary>;
  twins: Record<string, TwinState>;
  devices: Record<string, Device>;
  alerts: Record<string, Alert>;
  incidents: Incident[];
  audit: AuditEntry[];
  commands: Record<string, Command>;
  ingest: { accepted: number; rejected: Record<string, number>; rejected_total: number } | null;
  bus: { name: string; connected: boolean } | null;
  user: User | null;
  ripples: Ripple[];
  boarding: Record<string, { alighted: number; boarded: number; at: number }>;
  /** Crowding riders and train sensors observed, fused per trip by the service. */
  observed: Record<string, ObservedLoad>;
  liveFeed: LiveFeedStatus | null;
  setStatus: (s: ConnStatus) => void;
  apply: (msg: Record<string, unknown>) => void;
}

const MAX_RIPPLES = 40;

/** Stable empty values for selectors. A fresh [] each call makes zustand re-render forever. */
export const NO_DISRUPTIONS: SimState["disruptions"] = [];
export const NO_NOTICES: Notice[] = [];
export const NO_LINKS: LinkState[] = [];
export const NO_OBSERVED: Record<string, ObservedLoad> = {};

function upsertZones(twin: TwinState | undefined, zones: ZoneState[]): TwinState | undefined {
  if (!twin) return twin;
  const byId = new Map(twin.zones.map((z) => [z.id, z]));
  for (const z of zones) byId.set(z.id, z);
  return { ...twin, zones: Array.from(byId.values()) };
}

function upsertLinks(twin: TwinState | undefined, links: LinkState[]): TwinState | undefined {
  if (!twin) return twin;
  const byId = new Map(twin.links.map((l) => [l.id, l]));
  for (const l of links) byId.set(l.id, l);
  return { ...twin, links: Array.from(byId.values()) };
}

type PublicSettings = { thresholds: { moderate: number; busy: number; crowded: number }; train_capacity: number; heartbeat_s: number; crowd_levels?: number[] };

/** The crowding thresholds an admin set apply everywhere from the next render (ADM-03). */
function applySettings(s: PublicSettings | null): PublicSettings | null {
  setCrowdBounds(s?.crowd_levels);
  return s;
}

export const useTwin = create<TwinStore>((set, get) => ({
  status: "connecting",
  lastMessageAt: 0,
  offsetMs: 0,
  hasSnapshot: false,
  sim: null,
  settings: null,
  stations: {},
  twins: {},
  devices: {},
  alerts: {},
  incidents: [],
  audit: [],
  commands: {},
  ingest: null,
  bus: null,
  user: null,
  ripples: [],
  boarding: {},
  observed: NO_OBSERVED,
  liveFeed: null,
  setStatus: (status) => set({ status }),
  apply: (msg) => {
    const now = Date.now();
    const base = { lastMessageAt: now, status: "live" as ConnStatus };
    switch (msg.type) {
      case "snapshot": {
        const m = msg as any;
        set({
          ...base,
          hasSnapshot: true,
          offsetMs: m.server_now_ms - now,
          sim: m.sim,
          settings: applySettings(m.settings),
          stations: Object.fromEntries(m.stations.map((s: StationSummary) => [s.id, s])),
          twins: m.twins,
          devices: Object.fromEntries(m.devices.map((d: Device) => [d.id, d])),
          alerts: Object.fromEntries(m.alerts.map((a: Alert) => [a.id, a])),
          incidents: m.incidents ?? [],
          commands: m.commands ?? {},
          ingest: m.ingest ?? null,
          bus: m.bus,
          user: m.user,
          observed: m.crowd_observed ?? NO_OBSERVED,
          liveFeed: m.live_feed ?? null,
        });
        return;
      }
      case "zones": {
        const { station_id, zones } = msg as { station_id: string; zones: ZoneState[] };
        set((s) => ({ ...base, twins: { ...s.twins, [station_id]: upsertZones(s.twins[station_id], zones)! } }));
        return;
      }
      case "links": {
        const { station_id, links } = msg as { station_id: string; links: LinkState[] };
        set((s) => ({ ...base, twins: { ...s.twins, [station_id]: upsertLinks(s.twins[station_id], links)! } }));
        return;
      }
      case "twin": {
        const twin = (msg as { twin: TwinState }).twin;
        set((s) => ({ ...base, twins: { ...s.twins, [twin.station_id]: twin } }));
        return;
      }
      case "sensor_event": {
        const m = msg as any;
        const deviceTs = Date.parse(m.device_ts);
        const serverNow = now + get().offsetMs;
        const latency = Number.isFinite(deviceTs) ? serverNow - deviceTs : null;
        const ripple: Ripple = {
          key: `${m.sensor_id}-${m.received_ms}-${Math.random().toString(36).slice(2, 6)}`,
          station_id: m.station_id, sensor_id: m.sensor_id, link_id: m.link_id, direction: m.direction,
          count: m.count, source: m.source, at: now,
          latency_ms: latency !== null && latency >= 0 && latency < 60_000 ? latency : null,
        };
        set((s) => ({ ...base, ripples: [...s.ripples.filter((r) => now - r.at < 5000), ripple].slice(-MAX_RIPPLES) }));
        return;
      }
      case "stations": {
        const list = (msg as { stations: StationSummary[] }).stations;
        set({ ...base, stations: Object.fromEntries(list.map((s) => [s.id, s])) });
        return;
      }
      case "sim": {
        const sim = (msg as { sim: SimState }).sim;
        set({ ...base, sim, offsetMs: sim.clock.server_now_ms - now });
        return;
      }
      case "clock": {
        const clock = (msg as any).clock;
        set((s) => ({ ...base, offsetMs: clock.server_now_ms - now, sim: s.sim ? { ...s.sim, clock } : s.sim }));
        return;
      }
      case "settings":
        set({ ...base, settings: applySettings((msg as any).settings) });
        return;
      case "alert": {
        const a = (msg as { alert: Alert }).alert;
        set((s) => ({ ...base, alerts: { ...s.alerts, [a.id]: { ...s.alerts[a.id], ...a } } }));
        return;
      }
      case "incident": {
        const i = (msg as { incident: Incident }).incident;
        set((s) => ({ ...base, incidents: [i, ...s.incidents.filter((x) => x.id !== i.id)] }));
        return;
      }
      case "audit": {
        const e = (msg as { entry: AuditEntry }).entry;
        set((s) => ({ ...base, audit: [e, ...s.audit].slice(0, 200) }));
        return;
      }
      case "device": {
        const d = (msg as { device: Device }).device;
        set((s) => ({ ...base, devices: { ...s.devices, [d.id]: d } }));
        return;
      }
      case "environment": {
        const { station_id, readings } = msg as { station_id: string; readings: Record<string, EnvReading> };
        set((s) => {
          const twin = s.twins[station_id];
          return twin ? { ...base, twins: { ...s.twins, [station_id]: { ...twin, environment: readings } } } : base;
        });
        return;
      }
      case "command": {
        const { station_id, command } = msg as { station_id: string; command: Command };
        set((s) => ({ ...base, commands: { ...s.commands, [station_id]: command } }));
        return;
      }
      case "boarding": {
        const m = msg as any;
        set((s) => ({ ...base, boarding: { ...s.boarding, [m.zone_id]: { alighted: m.alighted, boarded: m.boarded, at: now } } }));
        return;
      }
      case "crowd_observed":
        set({ ...base, observed: (msg as { trips: Record<string, ObservedLoad> }).trips });
        return;
      case "live_feed":
        set({ ...base, liveFeed: (msg as { feed: LiveFeedStatus }).feed });
        return;
      default:
        set(base);
    }
  },
}));
