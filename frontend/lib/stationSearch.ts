/** Station search for the picker (PLAN-05): forgiving about case, punctuation and codes. */

export interface PickStation {
  id: string;
  name: string;
  /** Line colour for the code plate; Kelana Jaya red when absent. */
  color?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Stations matching a query: names or words starting with it first, then names containing it, then codes. */
export function searchStations(stations: PickStation[], q: string): PickStation[] {
  const n = norm(q);
  if (!n) return stations;
  const starts = stations.filter((s) => norm(s.name).startsWith(n) || norm(s.name).split(" ").some((w) => w.startsWith(n)));
  const contains = stations.filter((s) => !starts.includes(s) && norm(s.name).includes(n));
  const code = stations.filter((s) => !starts.includes(s) && !contains.includes(s) && s.id.toLowerCase().startsWith(n.replace(/ /g, "")));
  return [...starts, ...contains, ...code];
}
