/**
 * Geometry for the 3D map: viaduct, station slabs and four-car trains as extrudable
 * ribbons along the GTFS shape. Sizes are real at street zoom and grow to a minimum
 * on-screen size when zoomed out, so the line still reads at whole-network zoom.
 */

import type { LineData } from "@/lib/types";

type Pos = [number, number];
type MultiPolygon = Pos[][][];

/**
 * Tunnelled stretch, metres along the line. The portals sit between Damai and Ampang Park
 * and between Masjid Jamek and Pasar Seni; positions are approximate.
 */
export const TUNNEL_M: [number, number] = [10250, 14450];

const M_PER_DEG_LAT = 110574;

/** Real dimensions in metres (Innovia ART 200, four cars). */
const REAL = { carLength: 17, carWidth: 2.7, carHeight: 3.4, deck: 12, deckDepth: 1.6, platform: 90 };

export interface Dims {
  carLength: number;
  carGap: number;
  carWidth: number;
  carHeight: number;
  /** Centre of each running track from the line centre. */
  trackOffset: number;
  deckHalf: number;
  deckTop: number;
  deckDepth: number;
  platformHalf: number;
  platformLength: number;
}

/** Ground metres per screen pixel at a zoom (MapLibre uses 512 px tiles). */
export function metresPerPixel(zoom: number, lat: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

export function dimsAt(zoom: number, lat: number): Dims {
  const px = metresPerPixel(zoom, lat);
  const carWidth = Math.max(REAL.carWidth, 9 * px);
  const carLength = Math.max(REAL.carLength, 15 * px);
  const trackOffset = carWidth * 0.62;
  const deckHalf = trackOffset + carWidth * 0.62;
  return {
    carLength,
    carGap: Math.max(0.8, 0.6 * px),
    carWidth,
    carHeight: Math.max(REAL.carHeight, 7 * px),
    trackOffset,
    deckHalf,
    deckTop: Math.max(REAL.deck, 7 * px),
    deckDepth: Math.max(REAL.deckDepth, 2 * px),
    platformHalf: deckHalf + carWidth * 0.5,
    platformLength: Math.max(REAL.platform, 4 * carLength + 6 * px),
  };
}

export function totalLength(line: LineData): number {
  return line.shape_distances[line.shape_distances.length - 1];
}

export function underground(distanceM: number): boolean {
  return distanceM > TUNNEL_M[0] && distanceM < TUNNEL_M[1];
}

/** +1 when a direction runs towards higher distances (Gombak to Putra Heights), else -1. */
export function travelSign(line: LineData, directionId: number): number {
  const stops = line.directions.find((d) => d.direction_id === directionId)?.stops ?? [];
  const at = (i: number) => line.stations.find((s) => s.id === stops[i]?.station_id)?.distance_m ?? 0;
  return stops.length > 1 && at(stops.length - 1) < at(0) ? -1 : 1;
}

function indexAt(d: number[], x: number): number {
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

function lerpAt(line: LineData, x: number, i: number): Pos {
  const d = line.shape_distances;
  const [x0, y0] = line.shape[i];
  const [x1, y1] = line.shape[Math.min(i + 1, d.length - 1)];
  const f = (x - d[i]) / (d[Math.min(i + 1, d.length - 1)] - d[i] || 1);
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
}

/** The shape between two distances, including the shape vertices in between. */
export function pathBetween(line: LineData, from: number, to: number): Pos[] {
  const d = line.shape_distances;
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(d[d.length - 1], Math.max(from, to));
  const ia = indexAt(d, a);
  const ib = indexAt(d, b);
  const out: Pos[] = [lerpAt(line, a, ia)];
  for (let i = ia + 1; i <= ib; i++) if (d[i] > a && d[i] < b) out.push(line.shape[i]);
  out.push(lerpAt(line, b, ib));
  return out;
}

/**
 * A ribbon `halfWidth` either side of the path, shifted `offset` metres to the left of the
 * direction of increasing distance. Returned as one quad per segment with shared vertex
 * normals, which avoids the self-intersections a single outline gets on tight curves.
 */
export function ribbon(path: Pos[], offset: number, halfWidth: number): MultiPolygon {
  if (path.length < 2) return [];
  const lat0 = path[0][1];
  const kx = 1 / (M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180));
  const ky = 1 / M_PER_DEG_LAT;
  const xy = path.map(([lon, lat]) => [lon / kx, lat / ky]);
  const left: Pos[] = [];
  const right: Pos[] = [];
  for (let i = 0; i < xy.length; i++) {
    const p = xy[Math.max(0, i - 1)];
    const q = xy[Math.min(xy.length - 1, i + 1)];
    let tx = q[0] - p[0];
    let ty = q[1] - p[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    const [x, y] = xy[i];
    left.push([(x + nx * (offset + halfWidth)) * kx, (y + ny * (offset + halfWidth)) * ky]);
    right.push([(x + nx * (offset - halfWidth)) * kx, (y + ny * (offset - halfWidth)) * ky]);
  }
  const quads: MultiPolygon = [];
  for (let i = 0; i < xy.length - 1; i++) {
    quads.push([[left[i], left[i + 1], right[i + 1], right[i], left[i]]]);
  }
  return quads;
}

type Feature = GeoJSON.Feature<GeoJSON.MultiPolygon, Record<string, unknown>>;

function feature(coordinates: MultiPolygon, properties: Record<string, unknown>): Feature {
  return { type: "Feature", properties, geometry: { type: "MultiPolygon", coordinates } };
}

/**
 * Viaduct deck for elevated running and a flat ribbon marking the tunnel, each with a
 * stripe in the line colour between the two tracks (kind "stripe").
 */
export function trackFeatures(line: LineData, dims: Dims): GeoJSON.FeatureCollection {
  const end = totalLength(line);
  const [t0, t1] = TUNNEL_M;
  const stripeHalf = dims.carWidth * 0.18;
  const stripeH = Math.max(0.2, dims.carHeight * 0.06);
  const parts: [number, number, boolean][] = [[0, t0, false], [t1, end, false], [t0, t1, true]];
  return {
    type: "FeatureCollection",
    features: parts.flatMap(([a, b, ug]) => {
      const path = pathBetween(line, a, b);
      const top = ug ? 0.4 : dims.deckTop;
      return [
        feature(ribbon(path, 0, dims.deckHalf), { ug, kind: "deck", base: ug ? 0 : top - dims.deckDepth, top }),
        feature(ribbon(path, 0, stripeHalf), { ug, kind: "stripe", base: top, top: top + stripeH }),
      ];
    }),
  };
}

/** Station slabs: platforms either side of the tracks, at deck level or at ground for the tunnel. */
export function stationFeatures(line: LineData, dims: Dims): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: line.stations.map((s) => {
      const ug = underground(s.distance_m);
      const half = dims.platformLength / 2;
      const base = ug ? 0 : dims.deckTop - dims.deckDepth;
      const top = (ug ? 0 : dims.deckTop) + dims.carHeight * 0.3;
      return feature(ribbon(pathBetween(line, s.distance_m - half, s.distance_m + half), 0, dims.platformHalf),
        { id: s.id, name: s.name, ug, base, top });
    }),
  };
}

/** Web Mercator position in MapLibre world units (0..1 across the world). */
export function mercator(lon: number, lat: number): Pos {
  const x = (lon + 180) / 360;
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
  return [x, y];
}

/**
 * The line shape in local metres (x east, y north) around an origin mid-line, built from
 * the same Mercator projection the map uses, so 3D trains sit exactly on the extruded track.
 */
export class TrackFrame {
  /** Mercator position of the local origin. */
  readonly origin: Pos;
  /** Mercator units per local metre. */
  readonly unit: number;
  private readonly xy: Pos[];
  private readonly d: number[];

  constructor(line: LineData) {
    const mid = line.stations[Math.floor(line.stations.length / 2)];
    this.origin = mercator(mid.lon, mid.lat);
    this.unit = 1 / (40075016.686 * Math.cos((mid.lat * Math.PI) / 180));
    this.d = line.shape_distances;
    this.xy = line.shape.map(([lon, lat]) => this.local(lon, lat));
  }

  local(lon: number, lat: number): Pos {
    const [mx, my] = mercator(lon, lat);
    return [(mx - this.origin[0]) / this.unit, -(my - this.origin[1]) / this.unit];
  }

  /** Point and unit tangent (towards increasing distance) at a distance along the line. */
  at(distanceM: number): { x: number; y: number; tx: number; ty: number } {
    const d = this.d;
    const x = Math.max(0, Math.min(distanceM, d[d.length - 1]));
    const i = Math.min(indexAt(d, x), d.length - 2);
    const [x0, y0] = this.xy[i];
    const [x1, y1] = this.xy[i + 1];
    const f = (x - d[i]) / (d[i + 1] - d[i] || 1);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, tx: (x1 - x0) / len, ty: (y1 - y0) / len };
  }
}

/** Real car dimensions the 3D car model is built to, in metres. */
export const CAR_MODEL = { length: REAL.carLength, width: REAL.carWidth, height: REAL.carHeight };

export interface CarPose {
  /** 0 is the leading car. */
  car: number;
  kind: "front" | "mid" | "rear";
  x: number;
  y: number;
  /** Rail level in metres above ground. */
  z: number;
  /** Direction of travel, radians anticlockwise from east. */
  heading: number;
  ug: boolean;
}

/**
 * Four cars on the train's own running track (left-hand running). Each car sits on the
 * chord between its two ends, as a real car does between its bogies, so long cars follow
 * curves. `distanceM` is the middle of the train.
 */
export function carPoses(frame: TrackFrame, dims: Dims, distanceM: number, sign: number): CarPose[] {
  const total = 4 * dims.carLength + 3 * dims.carGap;
  const off = sign * dims.trackOffset;
  const out: CarPose[] = [];
  for (let c = 0; c < 4; c++) {
    const a = distanceM + sign * (total / 2 - c * (dims.carLength + dims.carGap));
    const b = a - sign * dims.carLength;
    const pa = frame.at(a);
    const pb = frame.at(b);
    const fx = pa.x - pa.ty * off;
    const fy = pa.y + pa.tx * off;
    const rx = pb.x - pb.ty * off;
    const ry = pb.y + pb.tx * off;
    const ug = underground((a + b) / 2);
    out.push({
      car: c,
      kind: c === 0 ? "front" : c === 3 ? "rear" : "mid",
      x: (fx + rx) / 2,
      y: (fy + ry) / 2,
      z: ug ? 0.4 : dims.deckTop,
      heading: Math.atan2(fy - ry, fx - rx),
      ug,
    });
  }
  return out;
}
