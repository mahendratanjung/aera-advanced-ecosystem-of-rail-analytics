export type Level = "low" | "moderate" | "busy" | "crowded";
export type Source = "device" | "sim" | "mixed";
export type SourceMode = "device" | "sim" | "mixed";
export type Role = "operator" | "admin";

export interface LineStation {
  id: string;
  name: string;
  full_name: string;
  lat: number;
  lon: number;
  sequence: number;
  distance_m: number;
}

export interface StopTime {
  station_id: string;
  arr: number;
  dep: number;
}

export interface FrequencyWindow {
  start: number;
  end: number;
  headway: number;
}

export interface LineData {
  id: string;
  name: string;
  short_name: string;
  color: string | null;
  text_color: string;
  timezone: string;
  source: { name: string; url: string; imported_at: string; fallbacks: Record<string, boolean> };
  stations: LineStation[];
  shape: [number, number][];
  shape_distances: number[];
  directions: { direction_id: number; headsign: string; stops: StopTime[] }[];
  frequencies: Record<string, Record<string, FrequencyWindow[]>>;
  calendar: Record<string, number[]>;
  twin_stations: string[];
}

export interface Disruption {
  id: string;
  kind: "delay" | "hold" | "suspend" | "surge";
  stop_id: string;
  to_stop_id: string | null;
  direction_id: number | null;
  delay_s: number;
  multiplier: number;
  start_ms: number;
  end_ms: number | null;
  note: string;
}

export interface ClockState {
  anchor_real_ms: number;
  anchor_sim_ms: number;
  speed: number;
  paused: boolean;
  server_now_ms: number;
}

export interface SimState {
  clock: ClockState;
  scenario: { id: string; name: string; started_ms: number; demand_mult: number };
  disruptions: Disruption[];
}

export interface StationSummary {
  id: string;
  percent: number;
  level: Level;
  source: Source;
  has_twin: boolean;
  count?: number;
  capacity?: number;
}

export interface ZoneState {
  id: string;
  station_id: string;
  name: string;
  type: string;
  level_id: string;
  capacity: number;
  public: boolean;
  count: number;
  percent: number;
  level: Level;
  available: boolean;
  reason: string | null;
  source: "device" | "sim";
  estimated: boolean;
  drift: number;
  updated_at_ms: number;
}

export interface LinkState {
  id: string;
  station_id: string;
  name: string;
  type: string;
  from: string;
  to: string;
  available: boolean;
  reason: string | null;
  flow_in_per_min: number;
  flow_out_per_min: number;
}

export interface SensorState {
  sensor_id: string;
  device_id: string;
  kind: "crossing" | "environment" | "switch" | "train";
  link: string | null;
  zone: string | null;
  state: "live" | "sim" | "offline";
}

export interface EnvReading {
  value: number;
  sensor_id: string;
  source: "device" | "sim";
  ts_ms: number;
}

export interface TwinState {
  station_id: string;
  source_mode: SourceMode;
  scale_factor: number;
  zones: ZoneState[];
  links: LinkState[];
  sensors: SensorState[];
  environment: Record<string, EnvReading>;
}

export interface Device {
  id: string;
  station_id: string;
  name: string;
  kind: "esp32" | "sim" | "other";
  position: string | null;
  retired: boolean;
  registered_at_ms: number;
  status: "online" | "offline" | "unknown";
  reported_state: "online" | "offline" | null;
  last_seen_ms: number | null;
  rssi: number | null;
  firmware: string | null;
  uptime_s: number | null;
  ever_online: boolean;
}

export interface Alert {
  id: string;
  station_id: string;
  type: "crowding" | "disruption" | "unavailable" | "device_offline" | "abnormal";
  severity: "high" | "medium" | "low";
  state: "active" | "acknowledged" | "resolved";
  message: string | null;
  title?: string;
  public_message?: string | null;
  zone_id: string | null;
  link_id: string | null;
  device_id?: string | null;
  started_at_ms: number;
  resolved_at_ms: number | null;
  acked_by?: string | null;
  acked_at_ms?: number | null;
  resolved_by?: string | null;
  occurrences?: number;
}

export interface Incident {
  id: string;
  station_id: string;
  zone_id: string | null;
  type: string;
  description: string;
  alert_id: string | null;
  created_by: string;
  created_at_ms: number;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  station_id: string | null;
  active: boolean;
}

export interface Command {
  v: number;
  ts: string;
  leds: { zone: string; level: string }[];
  display: { line1: string; line2: string } | null;
  sent_ms: number;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  station_id: string | null;
  before: unknown;
  after: unknown;
  ts_ms: number;
}

export interface Ripple {
  key: string;
  station_id: string;
  sensor_id: string;
  link_id: string | null;
  direction: "in" | "out";
  count: number;
  source: "device" | "sim";
  latency_ms: number | null;
  at: number;
}

export interface Settings {
  thresholds: { moderate: number; busy: number; crowded: number };
  alerts: { crowd_hold_s: number; crowd_clear_s: number; heartbeat_s: number; severity: Record<string, string> };
  ingest: { max_crossings_per_s: number; ranges: Record<string, [number, number]> };
  train: { capacity: number; default_dwell_s: number };
  stations: Record<string, { source_mode: SourceMode; scale_factor: number; boarding_enabled: boolean }>;
  zone_capacity: Record<string, number>;
}

export interface StationDefinition {
  id: string;
  name: string;
  line_id: string;
  stop_id: string;
  levels: { id: string; name: string; elevation: number }[];
  zones: {
    id: string;
    name: string;
    level: string;
    type: string;
    polygon: [number, number][];
    capacity: number;
    direction_id?: number | null;
    public?: boolean;
  }[];
  links: { id: string; name?: string; type: string; from: string; to: string; position: [number, number]; level?: string }[];
  sensors: { device_id: string; sensor_id: string; kind: string; link?: string; zone?: string }[];
  tracks: { direction_id: number; y: number; level: string; x_from: number; x_to: number }[];
}
