/**
 * The rest of the Klang Valley network on the 3D map (TRAINS-02): every line other than the
 * Kelana Jaya Line drawn along its track, and its trains as simple coloured cars.
 *
 * Elevated lines (LRT, MRT, Monorail, BRT) get a slim viaduct with a stripe in the line colour;
 * KTM Komuter and ERL run at ground level as a coloured band; the MRT's tunnels are a
 * translucent ribbon like the Kelana Jaya tunnel. Shared corridors (Ampang and Sri Petaling,
 * KTM 1 and 2, the two airport lines) sit at slightly different heights so they never flicker.
 * Sizes follow the zoom like the Kelana Jaya geometry (geo3d.ts).
 */

import { type NetTrain, type SimLine, inTunnel } from "@/lib/network/trains";
import { type CarPose, type Dims, type Track, type TrackFrame, pathBetween, ribbon } from "./geo3d";

type Pos = [number, number];
type MultiPolygon = Pos[][][];
type Feature = GeoJSON.Feature<GeoJSON.MultiPolygon, Record<string, unknown>>;

/** Real rolling stock per line: cars per train and car length in metres. */
const ROLLING: Record<string, { cars: number; length: number }> = {
  AG: { cars: 6, length: 17 }, SP: { cars: 6, length: 17 }, KG: { cars: 4, length: 22 }, PY: { cars: 4, length: 22 },
  MR: { cars: 4, length: 12 }, SA: { cars: 3, length: 19 }, BRT: { cars: 1, length: 12 },
  K1: { cars: 6, length: 20 }, K2: { cars: 6, length: 20 }, E6: { cars: 4, length: 22 }, E7: { cars: 4, length: 22 },
};
export const asTrack = (l: SimLine): Track => ({ shape: l.shape, shape_distances: l.shape_d });

/**
 * Sizes for the other lines: real up close, and when zoomed out a fraction of the Kelana Jaya
 * Line's minimum on-screen size, so the line AERA predicts stays the one that stands out and
 * a hundred-odd other trains do not merge into one block. They shrink with the map below
 * STEADY_ZOOM like the Kelana Jaya geometry, down to a floor of a pixel or two so the line
 * colour still shows. `dp` is metres per design pixel, `px` per screen pixel.
 */
export function slim(dims: Dims) {
  const { px, dp } = dims;
  return {
    width: Math.max(2.8, 3.6 * dp, 2 * px),
    height: Math.max(3.6, 3 * dp, 1.6 * px),
    deckHalf: Math.max(4, 4 * dp, 1.3 * px),
    stripeHalf: Math.max(0.6, 1.2 * dp, 0.9 * px),
    platformHalf: Math.max(6, 5.5 * dp, 1.6 * px),
    platformHalfLength: Math.max(45, 6 * dp, 1.6 * px),
    /** Shortest a whole train is drawn, in metres. */
    minTrain: Math.max(14 * dp, 3 * px),
    trackOffset: Math.max(1.8, 2.6 * dp, 0.9 * px),
  };
}

function feature(coordinates: MultiPolygon, properties: Record<string, unknown>): Feature {
  return { type: "Feature", properties, geometry: { type: "MultiPolygon", coordinates } };
}

/** Pieces of the line in order, each above ground or in tunnel. */
function parts(line: SimLine): [number, number, boolean][] {
  const end = line.shape_d[line.shape_d.length - 1];
  const cuts = [0, ...line.tunnels.flat().filter((x) => x > 0 && x < end), end].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((a, i) => [a, cuts[i + 1], inTunnel(line, (a + cuts[i + 1]) / 2)]);
}

/** Height of the rails at a distance along a line, and whether it is in tunnel there. */
export function railAt(line: SimLine, d: number, dims: Dims): { z: number; ug: boolean } {
  if (inTunnel(line, d)) return { z: 0.4, ug: true };
  return { z: line.level === "elevated" ? dims.deckTop * 0.85 : 0.5, ug: false };
}

/** Track for every timetabled line: kind "deck" (grey viaduct or bed) or "stripe" (line colour). */
export function netTrackFeatures(lines: SimLine[], dims: Dims, colours: Record<string, string>): GeoJSON.FeatureCollection {
  const features: Feature[] = [];
  lines.forEach((line, i) => {
    const colour = colours[line.id] ?? line.color ?? "#888888";
    const track = asTrack(line);
    const lift = i * 0.03;
    const sz = slim(dims);
    const stripeH = Math.max(0.2, sz.height * 0.06);
    // Zoomed out the stripe covers the deck, so each line shows in its own colour (as geo3d's trackFeatures).
    const low = Math.min(1, (1 - dims.dp / dims.px) * 1.6);
    const stripeHalf = sz.stripeHalf + (sz.deckHalf * 1.1 - sz.stripeHalf) * low;
    for (const [a, b, ug] of parts(line)) {
      const path = pathBetween(track, a, b);
      if (ug) {
        features.push(feature(ribbon(path, 0, sz.stripeHalf * 1.6), { kind: "stripe", color: colour, ug: true, base: 0, top: 0.35 + lift }));
      } else if (line.level === "elevated") {
        const top = dims.deckTop * 0.85 + lift;
        features.push(feature(ribbon(path, 0, sz.deckHalf), { kind: "deck", color: colour, ug: false, base: top - dims.deckDepth * 0.7, top }));
        features.push(feature(ribbon(path, 0, stripeHalf), { kind: "stripe", color: colour, ug: false, base: top, top: top + stripeH }));
      } else {
        features.push(feature(ribbon(path, 0, sz.deckHalf * 0.9), { kind: "deck", color: colour, ug: false, base: 0, top: 0.2 + lift }));
        features.push(feature(ribbon(path, 0, Math.max(sz.stripeHalf * 1.2, stripeHalf)), { kind: "stripe", color: colour, ug: false, base: 0.2 + lift, top: 0.2 + lift + stripeH }));
      }
    }
  });
  return { type: "FeatureCollection", features };
}

/** Platform slabs at every stop. `mapId` gives the network-map station for a stop. */
export function netStationFeatures(lines: SimLine[], dims: Dims, mapId: (line: SimLine, stopIndex: number) => string | null): GeoJSON.FeatureCollection {
  const features: Feature[] = [];
  const sz = slim(dims);
  for (const line of lines) {
    const track = asTrack(line);
    line.stops.forEach((s, k) => {
      const { z, ug } = railAt(line, s.d, dims);
      const half = sz.platformHalfLength;
      const top = z + sz.height * 0.3;
      features.push(feature(ribbon(pathBetween(track, s.d - half, s.d + half), 0, sz.platformHalf),
        { id: mapId(line, k) ?? "", name: s.name, line: line.id, ug, base: Math.max(0, z - dims.deckDepth), top }));
    });
  }
  return { type: "FeatureCollection", features };
}

/** One label point per station, interchanges merged (stops of the same name within 400 m). */
export function netStationPoints(lines: SimLine[], skip: Set<string>): GeoJSON.FeatureCollection {
  const seen: { name: string; lat: number; lon: number }[] = [];
  const features: GeoJSON.Feature[] = [];
  for (const line of lines) {
    for (const s of line.stops) {
      if (skip.has(s.name)) continue;
      const near = seen.some((x) => x.name === s.name && Math.abs(x.lat - s.lat) < 0.004 && Math.abs(x.lon - s.lon) < 0.004);
      if (near) continue;
      seen.push(s);
      features.push({ type: "Feature", properties: { name: s.name }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } });
    }
  }
  return { type: "FeatureCollection", features };
}

/**
 * The cars of a timetabled train on its own running track (left-hand running). Real lengths
 * up close; in the middle zooms a whole train is about 14 px long (a Kelana Jaya train is
 * about 60), so it can still be seen and tapped without swamping the map.
 */
export function netCarPoses(frame: TrackFrame, line: SimLine, dims: Dims, tr: NetTrain): { cars: CarPose[]; carLength: number; width: number; height: number } {
  const r = ROLLING[line.id] ?? { cars: 4, length: 20 };
  const sz = slim(dims);
  const gap = dims.carGap;
  const len = Math.max(r.length, (sz.minTrain - (r.cars - 1) * gap) / r.cars);
  const total = r.cars * len + (r.cars - 1) * gap;
  const off = tr.sign * sz.trackOffset;
  const out: CarPose[] = [];
  for (let c = 0; c < r.cars; c++) {
    const a = tr.d + tr.sign * (total / 2 - c * (len + gap));
    const b = a - tr.sign * len;
    const pa = frame.at(a);
    const pb = frame.at(b);
    const fx = pa.x - pa.ty * off;
    const fy = pa.y + pa.tx * off;
    const rx = pb.x - pb.ty * off;
    const ry = pb.y + pb.tx * off;
    const { z, ug } = railAt(line, (a + b) / 2, dims);
    out.push({
      car: c, kind: c === 0 ? "front" : c === r.cars - 1 ? "rear" : "mid",
      x: (fx + rx) / 2, y: (fy + ry) / 2, z, heading: Math.atan2(fy - ry, fx - rx), ug,
    });
  }
  return { cars: out, carLength: len, width: sz.width, height: sz.height };
}

/** Longitude and latitude at a distance along a line, for the camera. */
export function lonLatAt(line: SimLine, d: number): Pos {
  return pathBetween(asTrack(line), d, d)[0];
}
