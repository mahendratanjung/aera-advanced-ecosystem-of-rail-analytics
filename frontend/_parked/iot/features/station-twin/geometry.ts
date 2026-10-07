import type { StationDefinition } from "@/lib/types";

export type Pt = [number, number];
export type ZoneDef = StationDefinition["zones"][number];

export function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  return [x / poly.length, y / poly.length];
}

export function bbox(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministic pseudo random so particles do not jump between renders. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export function stationFrame(def: StationDefinition) {
  const all = def.zones.flatMap((z) => z.polygon as Pt[]);
  const b = bbox(all);
  const elevation = Object.fromEntries(def.levels.map((l) => [l.id, l.elevation]));
  const zoneLevel = Object.fromEntries(def.zones.map((z) => [z.id, z.level]));
  return {
    ...b,
    cx: (b.minX + b.maxX) / 2,
    cy: (b.minY + b.maxY) / 2,
    span: Math.max(b.maxX - b.minX, b.maxY - b.minY),
    elevation,
    zoneLevel,
    topElevation: Math.max(...def.levels.map((l) => l.elevation)),
  };
}

export const EXPLODE_FACTOR = 2.4;
export const ZONE_HEIGHT = 0.5;
