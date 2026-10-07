/**
 * Trains as real 3D models on the map, drawn by three.js inside a custom map layer (the
 * technique Mini Tokyo 3D uses; works in Mapbox and MapLibre). Every car is the Kelana Jaya Line's Innovia Metro 300
 * (features/train3d/innovia.ts): silver body, blue doors and cab surround, red and blue
 * stripes, windscreen, bogies, head and tail lamps. The roof and skirt carry the car's own
 * predicted crowding, so the train keeps its livery and still reads at whole-line zoom.
 * Cars are instanced, so the whole line is a handful of draw calls, and the scene shares the
 * map's depth buffer, so the viaduct and buildings occlude trains correctly. Lighting
 * follows the sun at the sim time.
 */

import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from "maplibre-gl";
import * as THREE from "three";
import { type CarGeometries, type CarMaterials, carGeometries, carMaterials } from "@/features/train3d/innovia";
import type { Sun } from "@/lib/sim/sun";
import { CAR_MODEL, type CarPose, type Dims, type TrackFrame } from "./geo3d";

export interface TrainDraw {
  trip: string;
  cars: CarPose[];
  /** Crowding colour per car, front first. */
  colours: string[];
  /** Beacon colour above the train (selected or held), or null. */
  marker: string | null;
  selected: boolean;
}

const MAX_CARS = 4 * 96;
const MAX_MARKERS = 96;

type Part = "cabBody" | "midBody" | "cabLivery" | "midLivery" | "cabGlass" | "midGlass" | "cabCrowd" | "midCrowd" | "head" | "tail";

/** One set of instanced meshes: surface trains, or the ghosted ones in the tunnel. */
class CarSet {
  readonly meshes: Record<Part, THREE.InstancedMesh>;
  readonly materials: CarMaterials;

  constructor(scene: THREE.Scene, geo: CarGeometries) {
    this.materials = carMaterials();
    const m = this.materials;
    const make = (g: THREE.BufferGeometry, mat: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(g, mat, MAX_CARS);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      return mesh;
    };
    this.meshes = {
      cabBody: make(geo.cabBody, m.body), midBody: make(geo.midBody, m.body),
      cabLivery: make(geo.cabLivery, m.livery), midLivery: make(geo.midLivery, m.livery),
      cabGlass: make(geo.cabGlass, m.glass), midGlass: make(geo.midGlass, m.glass),
      cabCrowd: make(geo.cabCrowd, m.crowd), midCrowd: make(geo.midCrowd, m.crowd),
      head: make(geo.lamps, m.head), tail: make(geo.lamps, m.tail),
    };
    const white = new THREE.Color("#ffffff");
    for (const mesh of [this.meshes.cabCrowd, this.meshes.midCrowd]) {
      for (let i = 0; i < MAX_CARS; i++) mesh.setColorAt(i, white);
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    }
  }

  setOpacity(opacity: number) {
    for (const m of Object.values(this.materials) as THREE.Material[]) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity >= 1;
      m.needsUpdate = true;
    }
  }

  begin() {
    for (const m of Object.values(this.meshes)) m.count = 0;
  }

  push(part: Part, matrix: THREE.Matrix4, colour?: THREE.Color) {
    const m = this.meshes[part];
    if (m.count >= MAX_CARS) return;
    m.setMatrixAt(m.count, matrix);
    if (colour) m.setColorAt(m.count, colour);
    m.count++;
  }

  end() {
    for (const m of Object.values(this.meshes)) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

export class TrainLayer implements CustomLayerInterface {
  readonly id = "aera-trains-3d";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map: MlMap | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly local: THREE.Matrix4;
  private readonly surface: CarSet;
  private readonly tunnel: CarSet;
  private readonly markers: THREE.InstancedMesh;
  private readonly halo: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly hemi = new THREE.HemisphereLight("#ffffff", "#9aa3b5", 2);
  private readonly sunLight = new THREE.DirectionalLight("#ffffff", 1);
  private readonly colours = new Map<string, THREE.Color>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly ms = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private trains: TrainDraw[] = [];
  private dims: Dims | null = null;

  constructor(frame: TrackFrame) {
    const [ox, oy] = frame.origin;
    const u = frame.unit;
    // Local metres (x east, y north, z up) to Mercator world units.
    this.local = new THREE.Matrix4().makeTranslation(ox, oy, 0).scale(new THREE.Vector3(u, -u, u));
    const geo = carGeometries();
    this.surface = new CarSet(this.scene, geo);
    this.tunnel = new CarSet(this.scene, geo);
    this.tunnel.setOpacity(0.55);
    this.markers = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: "#ffffff" }), MAX_MARKERS);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.markers.setColorAt(0, new THREE.Color("#ffffff"));
    this.scene.add(this.markers);
    this.halo = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }));
    this.halo.frustumCulled = false;
    this.halo.visible = false;
    this.scene.add(this.halo, this.hemi, this.sunLight);
    this.setSun({ altitude: 60, azimuth: 120 }, 0);
  }

  onAdd(map: MlMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.renderer?.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of [o.material].flat()) m.dispose();
      }
    });
    this.renderer = null;
    this.map = null;
  }

  /** MapLibre passes its projection data; Mapbox passes the Mercator matrix itself. */
  render(gl: WebGL2RenderingContext | WebGLRenderingContext, args: CustomRenderMethodInput | ArrayLike<number>) {
    const r = this.renderer;
    if (!r) return;
    const matrix = "defaultProjectionData" in args ? args.defaultProjectionData.mainMatrix : args;
    this.camera.projectionMatrix.fromArray(Array.from(matrix as ArrayLike<number>)).multiply(this.local);
    r.resetState();
    r.setViewport(0, 0, gl.drawingBufferWidth / r.getPixelRatio(), gl.drawingBufferHeight / r.getPixelRatio());
    r.render(this.scene, this.camera);
  }

  private colour(hex: string): THREE.Color {
    let c = this.colours.get(hex);
    if (!c) {
      c = new THREE.Color(hex);
      this.colours.set(hex, c);
    }
    return c;
  }

  /** Lights the cars like the sky over the line: the sun by day, a low cool light at night. */
  setSun(sun: Sun, night: number) {
    const alt = (Math.max(8, sun.altitude) * Math.PI) / 180;
    const az = (sun.azimuth * Math.PI) / 180;
    const day = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt));
    const moon = new THREE.Vector3(0.35, -0.45, 0.82);
    this.sunLight.position.copy(day.lerp(moon, night).normalize());
    this.sunLight.color.set("#fff4e0").lerp(this.colour("#9fb4ff"), night);
    this.sunLight.intensity = 1.05 - 0.7 * night;
    this.hemi.color.set("#ffffff").lerp(this.colour("#d4dcff"), night);
    this.hemi.intensity = 2 - 0.35 * night;
    // Interior lighting shows through the windows at night, and always in the tunnel.
    this.surface.materials.glass.emissiveIntensity = 0.9 * night;
    this.tunnel.materials.glass.emissiveIntensity = 0.75;
  }

  setUnderground(on: boolean) {
    this.surface.setOpacity(on ? 0.22 : 1);
    this.tunnel.setOpacity(on ? 1 : 0.55);
  }

  update(trains: TrainDraw[], dims: Dims, timeS: number, animate: boolean) {
    this.trains = trains;
    this.dims = dims;
    const kL = dims.carLength / CAR_MODEL.length;
    const kW = dims.carWidth / CAR_MODEL.width;
    const kH = dims.carHeight / CAR_MODEL.height;
    this.s.set(kL, kW, kH);
    this.surface.begin();
    this.tunnel.begin();
    let markers = 0;
    this.halo.visible = false;
    for (const tr of trains) {
      tr.cars.forEach((car, i) => {
        const set = car.ug ? this.tunnel : this.surface;
        const flip = car.kind === "rear";
        this.q.setFromAxisAngle(this.zAxis, car.heading + (flip ? Math.PI : 0));
        this.m4.compose(this.v.set(car.x, car.y, car.z), this.q, this.s);
        const cab = car.kind !== "mid";
        set.push(cab ? "cabBody" : "midBody", this.m4);
        set.push(cab ? "cabLivery" : "midLivery", this.m4);
        set.push(cab ? "cabGlass" : "midGlass", this.m4);
        set.push(cab ? "cabCrowd" : "midCrowd", this.m4, this.colour(tr.colours[i] ?? "#ffffff"));
        if (car.kind === "front") set.push("head", this.m4);
        if (car.kind === "rear") set.push("tail", this.m4);
      });
      const mid = this.middle(tr);
      if (tr.marker && markers < MAX_MARKERS) {
        const bob = animate ? Math.sin(timeS * 2.4 + markers) * 0.5 : 0;
        const size = 2.4 * kW;
        this.q.setFromAxisAngle(this.zAxis, animate ? timeS * 1.5 : 0);
        this.m4.compose(this.v.set(mid.x, mid.y, mid.z + (CAR_MODEL.height + 5 + bob) * kH), this.q, this.ms.set(size, size, size * 1.5));
        this.markers.setMatrixAt(markers, this.m4);
        this.markers.setColorAt(markers, this.colour(tr.marker));
        markers++;
      }
      if (tr.selected) {
        const span = 2 * dims.carLength + 1.5 * dims.carGap;
        this.halo.position.set(mid.x, mid.y, mid.z + 0.08 * kH);
        this.halo.rotation.set(0, 0, tr.cars[1].heading);
        this.halo.scale.set(span * 1.25, dims.carWidth * 2.6, 1);
        this.halo.material.color.copy(this.colour(tr.marker ?? "#2563eb"));
        this.halo.material.opacity = animate ? 0.28 + 0.12 * Math.sin(timeS * 3) : 0.32;
        this.halo.visible = true;
      }
    }
    this.markers.count = markers;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
    this.surface.end();
    this.tunnel.end();
  }

  private middle(tr: TrainDraw): { x: number; y: number; z: number } {
    const a = tr.cars[1];
    const b = tr.cars[2];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }

  /** Screen position (CSS pixels) of a local point, from the last rendered camera. */
  project(x: number, y: number, z: number): [number, number] | null {
    const map = this.map;
    if (!map) return null;
    const p = new THREE.Vector4(x, y, z, 1).applyMatrix4(this.camera.projectionMatrix);
    if (p.w <= 0) return null;
    const c = map.getCanvas();
    return [((p.x / p.w + 1) / 2) * c.clientWidth, ((1 - p.y / p.w) / 2) * c.clientHeight];
  }

  /** Where a train's roof is on screen, for a hover card. */
  anchor(trip: string): [number, number] | null {
    const tr = this.trains.find((t) => t.trip === trip);
    if (!tr || !this.dims) return null;
    const m = this.middle(tr);
    return this.project(m.x, m.y, m.z + this.dims.carHeight * 1.1);
  }

  /** The train nearest a screen point, within `radius` CSS pixels of its body. */
  pick(px: number, py: number, radius: number): string | null {
    const dims = this.dims;
    if (!dims) return null;
    let best: string | null = null;
    let bestD = Infinity;
    for (const tr of this.trains) {
      const a = tr.cars[0];
      const b = tr.cars[3];
      const ex = (a.x - b.x) / 6;
      const ey = (a.y - b.y) / 6;
      const z = (a.z + b.z) / 2 + dims.carHeight / 2;
      const p = this.project(a.x + ex, a.y + ey, z);
      const q = this.project(b.x - ex, b.y - ey, z);
      if (!p || !q) continue;
      const d = segmentDistance(px, py, p, q);
      if (d < bestD) {
        bestD = d;
        best = tr.trip;
      }
    }
    return bestD <= radius ? best : null;
  }
}

function segmentDistance(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}
