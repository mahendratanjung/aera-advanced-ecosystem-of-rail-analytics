/**
 * Crowding levels: how full a train is, in five steps. Load is passengers as a share of the
 * 800-person capacity of a four-car Kelana Jaya train (seated plus standing).
 *
 * The thresholds and wording are a product decision, not a data fact. Change them here only.
 */

export type CrowdLevel = 1 | 2 | 3 | 4 | 5;

export interface CrowdInfo {
  level: CrowdLevel;
  name: string;
  hint: string; // what it means for the rider
  from: number; // lower bound in percent of capacity
}

export const CROWD: CrowdInfo[] = [
  { level: 1, name: "Quiet", hint: "Plenty of seats", from: 0 },
  { level: 2, name: "Comfortable", hint: "Room to stand", from: 20 },
  { level: 3, name: "Busy", hint: "Standing, some contact", from: 50 },
  { level: 4, name: "Crowded", hint: "Shoulder to shoulder", from: 75 },
  { level: 5, name: "Packed", hint: "You may not get on", from: 95 },
];

export function crowdOf(loadPct: number): CrowdInfo {
  for (let i = CROWD.length - 1; i >= 0; i--) if (loadPct >= CROWD[i].from) return CROWD[i];
  return CROWD[0];
}

/**
 * Load as text. Above 100% the model says more people want this train than fit, so some
 * wait for the next one; a figure like "140% full" would read as nonsense.
 */
export function pctShort(loadPct: number): string {
  return loadPct >= 100 ? "100%+" : `${Math.floor(loadPct)}%`; // floor, so the number never contradicts the level
}

export function pctText(loadPct: number): string {
  return loadPct >= 100 ? "over capacity" : `${Math.floor(loadPct)}% full`;
}

export const crowdVar = (level: CrowdLevel) => `var(--crowd-${level})`;
export const crowdSoftVar = (level: CrowdLevel) => `var(--crowd-${level}-soft)`;
export const crowdInkVar = (level: CrowdLevel) => `var(--crowd-${level}-ink)`;
