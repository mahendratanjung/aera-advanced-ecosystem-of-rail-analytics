import type { Level } from "./types";

/** Every congestion indication pairs colour with a word and a bar count (UX-03). */
export const LEVEL_META: Record<Level | "nodata", { label: string; bars: number; className: string; textClass: string }> = {
  low: { label: "Clear", bars: 1, className: "bg-lvl-low", textClass: "text-lvl-low" },
  moderate: { label: "Moderate", bars: 2, className: "bg-lvl-moderate", textClass: "text-lvl-moderate" },
  busy: { label: "Busy", bars: 3, className: "bg-lvl-busy", textClass: "text-lvl-busy" },
  crowded: { label: "Crowded", bars: 4, className: "bg-lvl-crowded", textClass: "text-lvl-crowded" },
  nodata: { label: "Estimated", bars: 0, className: "bg-lvl-nodata", textClass: "text-lvl-nodata" },
};

export const LEVEL_ORDER: Level[] = ["low", "moderate", "busy", "crowded"];
