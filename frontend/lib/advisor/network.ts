/**
 * The Rapid Rail network around the Kelana Jaya Line (ROUTE-01), as built by
 * backend/aera_twin/gtfs/network.py from the GTFS feed: every line's stops, run times and
 * headways, plus estimated walking transfers between lines.
 */

const KL_OFFSET_S = 8 * 3600;
const DAY_S = 86400;

export interface NetStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface NetLine {
  id: string;
  route_id: string;
  name: string;
  mode: string;
  color: string | null;
  stops: NetStop[];
  directions: { direction_id: number; headsign: string; stops: { id: string; arr: number; dep: number }[] }[];
  /** service id → direction → [start, end, headway] in seconds after service-day midnight. */
  frequencies: Record<string, Record<string, [number, number, number][]>>;
  calendar: Record<string, number[]>;
}

export interface Transfer {
  from: string;
  to: string;
  distance_m: number;
  walk_s: number;
}

export interface Network {
  source: { name: string; url: string; imported_at: string; transfers: string };
  lines: NetLine[];
  transfers: Transfer[];
}

export interface NetIndex {
  net: Network;
  stop: Record<string, NetStop & { line: NetLine }>;
  line: Record<string, NetLine>;
}

const cache = new WeakMap<Network, NetIndex>();

export function indexNetwork(net: Network): NetIndex {
  let ix = cache.get(net);
  if (!ix) {
    const stop: NetIndex["stop"] = {};
    for (const line of net.lines) for (const s of line.stops) stop[s.id] = { ...s, line };
    ix = { net, stop, line: Object.fromEntries(net.lines.map((l) => [l.id, l])) };
    cache.set(net, ix);
  }
  return ix;
}

/** Scheduled seconds between trains of a line in one direction at time t, or null outside service. */
export function netHeadway(line: NetLine, dir: number, t: number): number | null {
  const local = (((t + KL_OFFSET_S) % DAY_S) + DAY_S) % DAY_S;
  const day = Math.floor((t + KL_OFFSET_S) / DAY_S);
  // A service day can run past midnight, so also look at yesterday's timetable.
  for (const [offset, sec] of [[0, local], [-1, local + DAY_S]] as const) {
    const weekday = (new Date((day + offset) * DAY_S * 1000).getUTCDay() + 6) % 7; // Monday = 0
    for (const [sid, days] of Object.entries(line.calendar)) {
      if (!days[weekday]) continue;
      for (const [start, end, headway] of line.frequencies[sid]?.[String(dir)] ?? []) {
        if (sec >= start && sec < end) return headway;
      }
    }
  }
  return null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A stop from a code or a name typed by a rider ("KJ15", "kl sentral", "klcc"). Kelana Jaya
 * Line stops win ties, then exact names, then names that start with the query.
 */
export function resolveStop(ix: NetIndex, query: string): (NetStop & { line: NetLine }) | null {
  const q = norm(query);
  if (!q) return null;
  const byId = ix.stop[query.trim().toUpperCase()];
  if (byId) return byId;
  const all = Object.values(ix.stop);
  const score = (s: NetStop & { line: NetLine }) => {
    const n = norm(s.name);
    const base = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : q.includes(n) && n.length > 3 ? 3 : 9;
    return base * 2 + (s.line.id === "KJ" ? 0 : 1);
  };
  const best = all.map((s) => [score(s), s] as const).filter(([v]) => v < 18).sort((a, b) => a[0] - b[0])[0];
  return best ? best[1] : null;
}
