import type { LineData } from "../types";

/** Point and bearing at a distance along the line shape. */
export function pointAt(line: LineData, distanceM: number): { lon: number; lat: number; bearing: number } {
  const d = line.shape_distances;
  const pts = line.shape;
  const target = Math.max(0, Math.min(distanceM, d[d.length - 1]));
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = d[hi] - d[lo] || 1;
  const f = (target - d[lo]) / span;
  const [x0, y0] = pts[lo];
  const [x1, y1] = pts[hi];
  const lon = x0 + (x1 - x0) * f;
  const lat = y0 + (y1 - y0) * f;
  const bearing = (Math.atan2((x1 - x0) * Math.cos((lat * Math.PI) / 180), y1 - y0) * 180) / Math.PI;
  return { lon, lat, bearing };
}

export function lineBounds(line: LineData): [[number, number], [number, number]] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of line.shape) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [[minX, minY], [maxX, maxY]];
}
