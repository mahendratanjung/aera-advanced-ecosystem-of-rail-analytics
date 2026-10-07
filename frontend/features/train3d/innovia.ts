/**
 * The Kelana Jaya Line's Innovia Metro 300 car as three.js geometry (TRAIN-01). One model is
 * used on the map (instanced, trainLayer.ts) and in the cards (Train3D.tsx), so both match.
 *
 * Car space, metres: x forward (the cab faces +x), y left, z up from the rail top. Parts are
 * split by material so the map can instance each one:
 *   body    silver-white shell with rounded edges
 *   livery  blue doors, blue cab surround, red and blue side stripes, underframe, bogies
 *   glass   side windows, door windows and windscreen (glows at night)
 *   crowd   roof panel and skirt, tinted by the car's predicted crowding (TRAIN-02)
 *   lights  head or tail lamps on the cab face
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { token } from "@/lib/theme";

export const CAR = { length: 17, width: 2.7, height: 3.4 };

const L = CAR.length;
const W = CAR.width;
/**
 * The shell is a side profile extruded across the car with a deep bevel, which rounds the
 * roof edges and cab corners like the real car. The bevel grows the profile outwards, so the
 * profile is drawn that much inside the finished body (bottom 0.55 m, roof 3.3 m).
 */
const BEVEL = 0.3;
const FLOOR = 0.85;
const ROOF = 3.0;
const X0 = -L / 2 + 0.25 + BEVEL;
const X1_CAB = L / 2 - 0.1 - BEVEL;
const X1_MID = L / 2 - 0.25 - BEVEL;
/** Raked windscreen, bottom and top corners of the cab face in x, z. */
const SCREEN: [[number, number], [number, number]] = [[X1_CAB, 1.3], [X1_CAB - 0.28, 2.9]];
const SIDE = W / 2;

export interface Livery {
  body: string;
  blue: string;
  red: string;
  glass: string;
  glow: string;
  under: string;
  head: string;
  tail: string;
}

/** Livery colours from the theme, with the real ones as fallbacks outside the browser. */
export function livery(): Livery {
  const t = (name: string, fallback: string) => token(name) || fallback;
  return {
    body: t("--train-body", "#eef1f5"),
    blue: t("--train-blue", "#22348f"),
    red: t("--train-red", "#d6202e"),
    glass: t("--train-glass", "#16202f"),
    glow: t("--train-glow", "#ffe2a8"),
    under: t("--train-under", "#2a303b"),
    head: t("--train-head", "#fffbe6"),
    tail: t("--train-tail", "#ff3347"),
  };
}

function profile(cab: boolean): THREE.Shape {
  const r = 0.35;
  const s = new THREE.Shape();
  s.moveTo(X0 + r, FLOOR);
  if (cab) {
    s.lineTo(X1_CAB - 0.2, FLOOR);
    s.quadraticCurveTo(X1_CAB, FLOOR, X1_CAB, FLOOR + 0.2);
    s.lineTo(...SCREEN[0]);
    s.lineTo(...SCREEN[1]);
    s.quadraticCurveTo(X1_CAB - 0.32, ROOF, X1_CAB - 0.6, ROOF);
  } else {
    s.lineTo(X1_MID - r, FLOOR);
    s.quadraticCurveTo(X1_MID, FLOOR, X1_MID, FLOOR + r);
    s.lineTo(X1_MID, ROOF - r);
    s.quadraticCurveTo(X1_MID, ROOF, X1_MID - r, ROOF);
  }
  s.lineTo(X0 + r, ROOF);
  s.quadraticCurveTo(X0, ROOF, X0, ROOF - r);
  s.lineTo(X0, FLOOR + r);
  s.quadraticCurveTo(X0, FLOOR, X0 + r, FLOOR);
  return s;
}

function shell(cab: boolean): THREE.BufferGeometry {
  const depth = W - 2 * BEVEL;
  const g = new THREE.ExtrudeGeometry(profile(cab), {
    depth, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 5, curveSegments: 6,
  });
  g.rotateX(Math.PI / 2); // profile height becomes z, the extrusion runs across the car
  g.translate(0, depth / 2, 0);
  g.deleteAttribute("uv");
  return g;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour?: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.deleteAttribute("uv");
  if (colour) paint(g, colour);
  return g;
}

function paint(g: THREE.BufferGeometry, colour: string) {
  const c = new THREE.Color(colour);
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
}

/** A thin plate on both sides of the car, `out` metres proud of the body side. */
function sides(x0: number, x1: number, z0: number, z1: number, out: number, colour?: string): THREE.BufferGeometry[] {
  const t = 0.03;
  return [
    box(x0, x1, SIDE + out - t / 2, SIDE + out + t / 2, z0, z1, colour),
    box(x0, x1, -SIDE - out - t / 2, -SIDE - out + t / 2, z0, z1, colour),
  ];
}

/** A plate lying on the raked cab face, `out` metres in front of it. */
function onScreen(width: number, along: number, out: number, colour?: string): THREE.BufferGeometry {
  const [[ax, az], [bx, bz]] = SCREEN;
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  const g = new THREE.BoxGeometry(0.03, width, len * along);
  g.rotateY(Math.atan2(dx, dz));
  g.translate((ax + bx) / 2 + dz * (BEVEL + out), 0, (az + bz) / 2 - dx * (BEVEL + out));
  g.deleteAttribute("uv");
  if (colour) paint(g, colour);
  return g;
}

function doorsAt(cab: boolean): number[] {
  return cab ? [-4.6, 2.4] : [-4.2, 4.2];
}

function liveryGeometry(cab: boolean, c: Livery): THREE.BufferGeometry {
  const x1 = cab ? X1_CAB : X1_MID;
  const parts: THREE.BufferGeometry[] = [];
  for (const x of doorsAt(cab)) parts.push(...sides(x - 0.68, x + 0.68, 1.12, 2.96, 0.025, c.blue));
  // Red over blue pinstripes low on the body side.
  const stripeEnd = cab ? x1 - 1.0 : x1;
  parts.push(...sides(X0, stripeEnd, 1.21, 1.28, 0.012, c.red));
  parts.push(...sides(X0, stripeEnd, 1.13, 1.19, 0.012, c.blue));
  parts.push(box(-L / 2 + 1, L / 2 - 1, -W / 2 + 0.3, W / 2 - 0.3, 0.3, 0.58, c.under));
  for (const x of [-L / 2 + 3, L / 2 - 3]) parts.push(box(x - 1.2, x + 1.2, -W / 2 + 0.35, W / 2 - 0.35, 0.06, 0.48, c.under));
  // Gangway bellows at every end that couples to another car.
  parts.push(box(-L / 2 - 0.05, X0 - BEVEL + 0.1, -W / 2 + 0.45, W / 2 - 0.45, 0.75, 3.0, c.under));
  if (cab) {
    // Dark-blue surround of the windscreen, wrapping round the cab corners.
    parts.push(onScreen(W - 0.5, 1.1, 0.012, c.blue));
    parts.push(...sides(x1 - 1.0, x1, 1.12, 2.98, 0.02, c.blue));
    parts.push(box(x1 + BEVEL - 0.05, x1 + BEVEL + 0.28, -0.42, 0.42, 0.42, 0.78, c.under));
  } else {
    parts.push(box(X1_MID + BEVEL - 0.1, L / 2 + 0.05, -W / 2 + 0.45, W / 2 - 0.45, 0.75, 3.0, c.under));
  }
  return mergeGeometries(parts)!;
}

function glassGeometry(cab: boolean): THREE.BufferGeometry {
  const x1 = cab ? X1_CAB - 1.1 : X1_MID - 0.3;
  const parts = [...sides(X0 + 0.3, x1, 1.74, 2.66, 0.008)];
  for (const x of doorsAt(cab)) parts.push(...sides(x - 0.5, x + 0.5, 1.55, 2.7, 0.045));
  if (cab) parts.push(onScreen(W - 0.8, 0.9, 0.035));
  return mergeGeometries(parts)!;
}

function crowdGeometry(cab: boolean): THREE.BufferGeometry {
  const x1 = cab ? X1_CAB - 0.6 : X1_MID;
  const top = ROOF + BEVEL;
  const half = W / 2 - BEVEL - 0.05;
  return mergeGeometries([
    box(X0, x1, -half, half, top - 0.02, top + 0.07),
    ...sides(X0, cab ? X1_CAB : X1_MID, 0.88, 1.1, 0.02),
  ])!;
}

function lampGeometry(): THREE.BufferGeometry {
  const x = X1_CAB + BEVEL + 0.01;
  return mergeGeometries([box(x - 0.05, x + 0.05, 0.5, 0.92, 0.98, 1.2), box(x - 0.05, x + 0.05, -0.92, -0.5, 0.98, 1.2)])!;
}

export interface CarGeometries {
  cabBody: THREE.BufferGeometry;
  midBody: THREE.BufferGeometry;
  cabLivery: THREE.BufferGeometry;
  midLivery: THREE.BufferGeometry;
  cabGlass: THREE.BufferGeometry;
  midGlass: THREE.BufferGeometry;
  cabCrowd: THREE.BufferGeometry;
  midCrowd: THREE.BufferGeometry;
  lamps: THREE.BufferGeometry;
}

export function carGeometries(c: Livery = livery()): CarGeometries {
  return {
    cabBody: shell(true), midBody: shell(false),
    cabLivery: liveryGeometry(true, c), midLivery: liveryGeometry(false, c),
    cabGlass: glassGeometry(true), midGlass: glassGeometry(false),
    cabCrowd: crowdGeometry(true), midCrowd: crowdGeometry(false),
    lamps: lampGeometry(),
  };
}

export interface CarMaterials {
  body: THREE.MeshStandardMaterial;
  livery: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  crowd: THREE.MeshStandardMaterial;
  head: THREE.MeshBasicMaterial;
  tail: THREE.MeshBasicMaterial;
}

export function carMaterials(c: Livery = livery()): CarMaterials {
  return {
    body: new THREE.MeshStandardMaterial({ color: c.body, roughness: 0.42, metalness: 0.18 }),
    livery: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 }),
    glass: new THREE.MeshStandardMaterial({ color: c.glass, roughness: 0.15, metalness: 0.35, emissive: c.glow, emissiveIntensity: 0 }),
    crowd: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.55 }),
    head: new THREE.MeshBasicMaterial({ color: c.head }),
    tail: new THREE.MeshBasicMaterial({ color: c.tail }),
  };
}
