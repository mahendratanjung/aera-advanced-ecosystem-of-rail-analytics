"use client";

/**
 * Station twin in 3D (TWN-01 to TWN-09). The whole scene is generated from the station
 * definition file (section 8.3). Nothing is modelled by hand.
 *
 * Axes: definition x → three X, definition y → three Z, level elevation → three Y.
 * Loaded on demand with next/dynamic so the passenger view stays light (NFR-04).
 */

import { CameraControls, Edges } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { type ComponentRef, type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { LevelBars } from "@/components/Congestion";
import { simNowMs } from "@/lib/sim/clock";
import type { LineModel } from "@/lib/sim/trains";
import { useTwin } from "@/lib/store";
import { levelColor, motion, token } from "@/lib/theme";
import type { Ripple, SensorState, StationDefinition, TwinState, ZoneState } from "@/lib/types";
import { EXPLODE_FACTOR, type Pt, ZONE_HEIGHT, bbox, centroid, pointInPolygon, seeded, stationFrame } from "./geometry";

export type Preset = "overview" | "concourse" | "platform-1" | "platform-2" | "plan";
type Frame = ReturnType<typeof stationFrame>;
type FactorRef = MutableRefObject<number>;

export interface SceneProps {
  def: StationDefinition;
  twin: TwinState;
  model: LineModel | null;
  lineColor: string;
  stationDistance: number;
  selectedZone: string | null;
  onSelectZone: (id: string | null) => void;
  preset: Preset;
  presetNonce: number;
  exploded: boolean;
  particles: boolean;
  reducedMotion: boolean;
  dive: boolean;
}

// ---- helpers ---------------------------------------------------------------------------------

let hatchTexture: THREE.CanvasTexture | null = null;
function hatch(): THREE.CanvasTexture {
  if (hatchTexture) return hatchTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = token("--lvl-nodata");
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = token("--bg-deep");
  g.lineWidth = 10;
  for (let i = -64; i < 128; i += 22) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 64, 64);
    g.stroke();
  }
  hatchTexture = new THREE.CanvasTexture(c);
  hatchTexture.wrapS = hatchTexture.wrapT = THREE.RepeatWrapping;
  hatchTexture.repeat.set(0.15, 0.15);
  return hatchTexture;
}

function levelY(frame: Frame, levelId: string, factor: number) {
  return (frame.elevation[levelId] ?? 0) * factor;
}

function LevelGroup({ frame, levelId, factor, children }: { frame: Frame; levelId: string; factor: FactorRef; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.position.y = levelY(frame, levelId, factor.current);
  });
  return <group ref={ref}>{children}</group>;
}

// ---- level slabs and zones -------------------------------------------------------------------------

function LevelSlab({ def, levelId, frame }: { def: StationDefinition; levelId: string; frame: Frame }) {
  const zones = def.zones.filter((z) => z.level === levelId);
  const tracks = def.tracks.filter((t) => t.level === levelId);
  const pts: Pt[] = zones.flatMap((z) => z.polygon as Pt[]);
  for (const t of tracks) pts.push([frame.minX, t.y], [frame.maxX, t.y]);
  if (!pts.length) return null;
  const b = bbox(pts);
  const m = 3;
  const w = b.maxX - b.minX + m * 2;
  const d = b.maxY - b.minY + m * 2;
  return (
    <group>
      <mesh position={[(b.minX + b.maxX) / 2, -0.15, (b.minY + b.maxY) / 2]} receiveShadow>
        <boxGeometry args={[w, 0.2, d]} />
        <meshStandardMaterial color={token("--scene-slab")} transparent opacity={0.55} roughness={0.9} />
        <Edges color={token("--scene-edge")} />
      </mesh>
    </group>
  );
}

function ZoneMesh({ zone, state, selected, onSelect, reduced }: {
  zone: StationDefinition["zones"][number]; state: ZoneState | undefined; selected: boolean; onSelect: (id: string) => void; reduced: boolean;
}) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape(zone.polygon.map(([x, y]) => new THREE.Vector2(x, -y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: ZONE_HEIGHT, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [zone.polygon]);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const target = useMemo(() => new THREE.Color(), []);
  const level = state?.level ?? "low";
  const shaded = !state || !state.available || state.estimated;
  const pulse = useRef(0);

  useFrame((_, dt) => {
    const m = mat.current;
    if (!m) return;
    target.set(shaded ? token("--lvl-nodata") : levelColor(level));
    const k = reduced ? 1 : 1 - Math.exp(-dt / (motion.zone() / 4000));
    m.color.lerp(target, k);
    m.emissive.copy(m.color);
    // Crowded zones breathe slowly, one cycle per two seconds and nothing faster (section 10.4).
    pulse.current += dt;
    const breathe = level === "crowded" && !shaded && !reduced ? 0.25 + 0.2 * Math.sin((pulse.current * Math.PI * 2) / 2) : 0.22;
    m.emissiveIntensity = selected ? 0.55 : breathe;
  });

  return (
    <group>
      <mesh
        geometry={geom}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(zone.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        {/* Remount on change: adding or removing a texture map needs a new shader program. */}
        <meshStandardMaterial key={shaded ? "hatched" : "solid"} ref={mat} transparent opacity={0.88} roughness={0.6} map={shaded ? hatch() : null} />
        {selected && <Edges color={token("--brand-cyan")} lineWidth={2} />}
      </mesh>
    </group>
  );
}

// ---- links, tracks and trains ---------------------------------------------------------------------

function Links({ def, twin, frame, factor }: { def: StationDefinition; twin: TwinState; frame: Frame; factor: FactorRef }) {
  const available = Object.fromEntries(twin.links.map((l) => [l.id, l.available]));
  return (
    <group>
      {def.links.map((lk) => {
        const fromLevel = lk.from === "outside" ? (lk.level ?? frame.zoneLevel[lk.to]) : frame.zoneLevel[lk.from];
        const toLevel = frame.zoneLevel[lk.to] ?? fromLevel;
        const ok = available[lk.id] !== false;
        if (fromLevel !== toLevel) {
          return <Ramp key={lk.id} frame={frame} at={lk.position as Pt} fromLevel={fromLevel} toLevel={toLevel} ok={ok} factor={factor} kind={lk.type} />;
        }
        const [x, y] = lk.position;
        return (
          <LevelGroup key={lk.id} frame={frame} levelId={fromLevel} factor={factor}>
            <mesh position={[x, ZONE_HEIGHT + 0.6, y]}>
              <boxGeometry args={[0.35, 1.2, lk.type === "entrance" ? 4 : 6]} />
              <meshStandardMaterial color={ok ? token("--brand-mist") : token("--lvl-crowded")} emissive={ok ? token("--brand-cyan") : token("--lvl-crowded")} emissiveIntensity={0.25} />
            </mesh>
          </LevelGroup>
        );
      })}
    </group>
  );
}

function Ramp({ frame, at, fromLevel, toLevel, ok, factor, kind }: {
  frame: Frame; at: Pt; fromLevel: string; toLevel: string; ok: boolean; factor: FactorRef; kind: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const run = 9;
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const y0 = levelY(frame, fromLevel, factor.current) + ZONE_HEIGHT;
    const y1 = levelY(frame, toLevel, factor.current) + ZONE_HEIGHT;
    const rise = y1 - y0;
    const len = Math.hypot(run, rise);
    m.position.set(at[0] + run / 2, (y0 + y1) / 2, at[1]);
    m.scale.set(len, 1, 1);
    m.rotation.set(0, 0, Math.atan2(rise, run));
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 0.25, kind === "lift" ? 2 : 2.4]} />
      <meshStandardMaterial
        color={ok ? token("--brand-mist") : token("--lvl-crowded")}
        emissive={ok ? token("--brand-cyan") : token("--lvl-crowded")}
        emissiveIntensity={0.2}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}

function Tracks({ def, frame, factor }: { def: StationDefinition; frame: Frame; factor: FactorRef }) {
  return (
    <group>
      {def.tracks.map((t) => (
        <LevelGroup key={t.direction_id} frame={frame} levelId={t.level} factor={factor}>
          {[-0.75, 0.75].map((o) => (
            <mesh key={o} position={[(t.x_from + t.x_to) / 2, 0.05, t.y + o]}>
              <boxGeometry args={[t.x_to - t.x_from, 0.12, 0.12]} />
              <meshStandardMaterial color={token("--brand-cyan")} emissive={token("--brand-cyan")} emissiveIntensity={0.6} />
            </mesh>
          ))}
        </LevelGroup>
      ))}
    </group>
  );
}

const TRAIN_LEN = 70;
const POOL = 3;

/** TWN-04: trains arriving, dwelling and departing, in step with the network twin. */
function TrainsAtStation({ def, frame, factor, model, stationDistance, lineColor }: {
  def: StationDefinition; frame: Frame; factor: FactorRef; model: LineModel | null; stationDistance: number; lineColor: string;
}) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const platformX = useMemo(() => {
    const ps = def.zones.filter((z) => z.type === "platform").map((z) => centroid(z.polygon as Pt[])[0]);
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : frame.cx;
  }, [def, frame.cx]);
  useFrame(() => {
    if (!model) return;
    const st = useTwin.getState();
    const t = simNowMs(st.sim?.clock, st.offsetMs) / 1000;
    const near = model.activeTrains(t, st.sim?.disruptions ?? []).filter((tr) => Math.abs(tr.distanceM - stationDistance) < 160);
    for (const track of def.tracks) {
      const mine = near.filter((tr) => tr.directionId === track.direction_id);
      for (let i = 0; i < POOL; i++) {
        const g = refs.current[track.direction_id * POOL + i];
        if (!g) continue;
        const tr = mine[i];
        if (!tr) {
          g.visible = false;
          continue;
        }
        const x = platformX + (tr.distanceM - stationDistance);
        const half = TRAIN_LEN / 2;
        g.visible = x + half > track.x_from && x - half < track.x_to;
        g.position.set(x, levelY(frame, track.level, factor.current) + 1.8, track.y);
      }
    }
  });
  const body = token("--scene-train-window");
  return (
    <group>
      {def.tracks.flatMap((track) =>
        Array.from({ length: POOL }, (_, i) => (
          <group key={`${track.direction_id}-${i}`} ref={(el) => { refs.current[track.direction_id * POOL + i] = el; }} visible={false}>
            <mesh>
              <boxGeometry args={[TRAIN_LEN, 3.2, 2.8]} />
              <meshStandardMaterial color={lineColor} roughness={0.4} metalness={0.2} />
            </mesh>
            <mesh position={[0, 0.5, 0]}>
              <boxGeometry args={[TRAIN_LEN - 2, 0.8, 2.86]} />
              <meshStandardMaterial color={body} emissive={body} emissiveIntensity={0.6} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

// ---- sensors and ripples ------------------------------------------------------------------------

function sensorPosition(def: StationDefinition, frame: Frame, s: SensorState): { at: Pt; level: string } | null {
  if (s.link) {
    const lk = def.links.find((l) => l.id === s.link);
    if (!lk) return null;
    const level = lk.level ?? (lk.from === "outside" ? frame.zoneLevel[lk.to] : frame.zoneLevel[lk.from]);
    const shift = s.kind === "switch" ? 2.2 : 0;
    return { at: [lk.position[0] + shift, lk.position[1]], level };
  }
  if (s.zone) {
    const z = def.zones.find((zz) => zz.id === s.zone);
    if (!z) return null;
    const [cx, cy] = centroid(z.polygon as Pt[]);
    const offset = s.kind === "train" ? 6 : -6;
    return { at: [cx + offset, cy], level: z.level };
  }
  return null;
}

function RippleRing({ ripple }: { ripple: Ripple }) {
  const ref = useRef<THREE.Mesh>(null);
  const [done, setDone] = useState(false);
  const dur = Math.max(1, motion.ripple());
  useEffect(() => {
    const id = setTimeout(() => setDone(true), Math.max(dur, 1500));
    return () => clearTimeout(id);
  }, [dur]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const p = Math.min(1, (Date.now() - ripple.at) / dur);
    m.scale.setScalar(0.5 + p * 5);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - p);
  });
  if (done) return null;
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.8, 1, 40]} />
      <meshBasicMaterial color={token(ripple.source === "device" ? "--state-live" : "--state-sim")} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}

function Sensors({ def, twin, frame, factor }: { def: StationDefinition; twin: TwinState; frame: Frame; factor: FactorRef }) {
  const ripples = useTwin((s) => s.ripples);
  return (
    <group>
      {twin.sensors.map((s) => {
        const pos = sensorPosition(def, frame, s);
        if (!pos) return null;
        const colour = token(s.state === "live" ? "--state-live" : s.state === "sim" ? "--state-sim" : "--state-offline");
        const mine = ripples.filter((r) => r.station_id === twin.station_id && r.sensor_id === s.sensor_id && Date.now() - r.at < 1500);
        return (
          <LevelGroup key={s.sensor_id} frame={frame} levelId={pos.level} factor={factor}>
            <group position={[pos.at[0], ZONE_HEIGHT + 2.2, pos.at[1]]}>
              <mesh>
                <octahedronGeometry args={[0.55]} />
                <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={s.state === "offline" ? 0 : 0.8} />
              </mesh>
              <group position={[0, -1.6, 0]}>{mine.map((r) => <RippleRing key={r.key} ripple={r} />)}</group>
            </group>
          </LevelGroup>
        );
      })}
    </group>
  );
}

// ---- crowd as light (TWN-06) ------------------------------------------------------------------------

const MAX_DOTS_PER_ZONE = 140;

function Crowd({ def, twin, frame, factor, reduced }: { def: StationDefinition; twin: TwinState; frame: Frame; factor: FactorRef; reduced: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const total = def.zones.length * MAX_DOTS_PER_ZONE;
  const homes = useMemo(() => {
    return def.zones.map((z, zi) => {
      const rnd = seeded(zi * 7919 + 17);
      const poly = z.polygon as Pt[];
      const b = bbox(poly);
      const out: { x: number; z: number; phase: number; speed: number }[] = [];
      while (out.length < MAX_DOTS_PER_ZONE) {
        const p: Pt = [b.minX + 1 + rnd() * (b.maxX - b.minX - 2), b.minY + 1 + rnd() * (b.maxY - b.minY - 2)];
        if (pointInPolygon(p, poly)) out.push({ x: p[0], z: p[1], phase: rnd() * Math.PI * 2, speed: 0.2 + rnd() * 0.5 });
      }
      return out;
    });
  }, [def]);
  const counts = useMemo(() => {
    const byId = Object.fromEntries(twin.zones.map((z) => [z.id, z]));
    return def.zones.map((z) => {
      const s = byId[z.id];
      return s ? Math.min(MAX_DOTS_PER_ZONE, Math.round((s.count / Math.max(1, s.capacity)) * MAX_DOTS_PER_ZONE * 0.9)) : 0;
    });
  }, [def, twin.zones]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = reduced ? 0 : clock.elapsedTime;
    let i = 0;
    def.zones.forEach((z, zi) => {
      const y = levelY(frame, z.level, factor.current) + ZONE_HEIGHT + 0.45;
      for (let k = 0; k < MAX_DOTS_PER_ZONE; k++, i++) {
        const h = homes[zi][k];
        if (k < counts[zi]) {
          tmp.position.set(h.x + Math.sin(t * h.speed + h.phase) * 0.9, y, h.z + Math.cos(t * h.speed * 0.8 + h.phase) * 0.7);
          tmp.scale.setScalar(1);
        } else {
          tmp.scale.setScalar(0);
        }
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
      }
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, total]} frustumCulled={false}>
      <sphereGeometry args={[0.28, 8, 6]} />
      <meshBasicMaterial color={token("--text-strong")} transparent opacity={0.75} />
    </instancedMesh>
  );
}

// ---- labels ----------------------------------------------------------------------------------------
// Labels are plain DOM over the canvas, positioned each frame by projecting an anchor point.
// This avoids nested React roots inside the canvas, which break on unmount.

type Anchor = { get: (factor: number) => [number, number, number]; el: HTMLElement };
type Anchors = MutableRefObject<Map<string, Anchor>>;

function LabelProjector({ anchors, factor }: { anchors: Anchors; factor: FactorRef }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const a of anchors.current.values()) {
      const [x, y, z] = a.get(factor.current);
      v.set(x, y, z).project(camera);
      if (v.z > 1 || v.z < -1) {
        a.el.style.visibility = "hidden";
        continue;
      }
      a.el.style.visibility = "visible";
      a.el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`;
    }
  });
  return null;
}

function Label({ id, anchors, get, interactive = false, children }: {
  id: string; anchors: Anchors; get: Anchor["get"]; interactive?: boolean; children: React.ReactNode;
}) {
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) anchors.current.set(id, { get, el });
      else anchors.current.delete(id);
    },
    [id, anchors, get],
  );
  return (
    <div ref={ref} className={`absolute left-0 top-0 whitespace-nowrap ${interactive ? "pointer-events-auto" : ""}`} style={{ visibility: "hidden" }}>
      {children}
    </div>
  );
}

function SceneLabels({ def, twin, frame, anchors, selectedZone, onSelectZone }: {
  def: StationDefinition; twin: TwinState; frame: Frame; anchors: Anchors; selectedZone: string | null; onSelectZone: (id: string) => void;
}) {
  const ripples = useTwin((s) => s.ripples);
  const [, setTick] = useState(0);
  const now = Date.now();
  const recent = ripples.filter((r) => r.station_id === twin.station_id && r.source === "device" && r.latency_ms !== null && now - r.at < 1500);
  useEffect(() => {
    if (!recent.length) return;
    const id = setTimeout(() => setTick((t) => t + 1), 1500);
    return () => clearTimeout(id);
  }, [recent.length, ripples]);

  const zoneState = Object.fromEntries(twin.zones.map((z) => [z.id, z]));
  const levelAnchors = useMemo(
    () =>
      def.levels.map((lv) => {
        const pts: Pt[] = def.zones.filter((z) => z.level === lv.id).flatMap((z) => z.polygon as Pt[]);
        if (!pts.length) return null;
        const b = bbox(pts);
        const e = frame.elevation[lv.id] ?? 0;
        return { lv, get: (f: number): [number, number, number] => [b.minX - 2, e * f + 0.2, b.maxY + 4] };
      }),
    [def, frame],
  );
  const zoneAnchors = useMemo(
    () =>
      Object.fromEntries(
        def.zones.map((z) => {
          const [cx, cy] = centroid(z.polygon as Pt[]);
          const e = frame.elevation[z.level] ?? 0;
          return [z.id, (f: number): [number, number, number] => [cx, e * f + ZONE_HEIGHT + 1.2, cy]];
        }),
      ),
    [def, frame],
  );
  const sensorAnchor = useCallback(
    (sensorId: string) => {
      const s = twin.sensors.find((x) => x.sensor_id === sensorId);
      const pos = s ? sensorPosition(def, frame, s) : null;
      if (!pos) return null;
      const e = frame.elevation[pos.level] ?? 0;
      return (f: number): [number, number, number] => [pos.at[0], e * f + ZONE_HEIGHT + 3.4, pos.at[1]];
    },
    [def, frame, twin.sensors],
  );

  return (
    <>
      {levelAnchors.map((la) => la && (
        <Label key={`lv-${la.lv.id}`} id={`lv-${la.lv.id}`} anchors={anchors} get={la.get}>
          <span className="eyebrow">{la.lv.id} · {la.lv.name}</span>
        </Label>
      ))}
      {def.zones.map((z) => {
        const st = zoneState[z.id];
        const shaded = !st || !st.available || st.estimated;
        return (
          <Label key={`z-${z.id}`} id={`z-${z.id}`} anchors={anchors} get={zoneAnchors[z.id]} interactive>
            <button
              type="button"
              onClick={() => onSelectZone(z.id)}
              aria-pressed={selectedZone === z.id}
              className={`flex flex-col items-center rounded-md border px-2 py-1 text-center shadow-lg ${selectedZone === z.id ? "border-cyan bg-panel" : "border-subtle bg-panel/90"}`}
            >
              <span className="text-[11px] font-semibold text-ink">{z.name}</span>
              {st && (
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  <LevelBars level={shaded ? "nodata" : st.level} size="sm" />
                  <span className="tabular">{st.count}/{st.capacity}</span>
                  {!st.available && <span className="text-lvl-crowded">closed</span>}
                </span>
              )}
            </button>
          </Label>
        );
      })}
      {recent.map((r) => {
        const get = sensorAnchor(r.sensor_id);
        return get ? (
          <Label key={`r-${r.key}`} id={`r-${r.key}`} anchors={anchors} get={get}>
            <span className="tabular rounded bg-panel px-1.5 py-[1px] text-[10px] text-live">{((r.latency_ms ?? 0) / 1000).toFixed(1)} s</span>
          </Label>
        ) : null;
      })}
    </>
  );
}

// ---- camera ----------------------------------------------------------------------------------------

function presetLookAt(def: StationDefinition, frame: Frame, preset: Preset, factor: number): [number, number, number, number, number, number] {
  const top = frame.topElevation * factor;
  if (preset === "plan") return [frame.cx, 150 + top, frame.cy + 0.01, frame.cx, 0, frame.cy];
  if (preset === "overview") return [frame.cx - 60, 55 + top, frame.cy + 85, frame.cx, top * 0.45, frame.cy];
  const zone = def.zones.find((z) => z.id === preset) ?? def.zones.find((z) => z.type === preset);
  if (!zone) return presetLookAt(def, frame, "overview", factor);
  const [x, y] = centroid(zone.polygon as Pt[]);
  const e = (frame.elevation[zone.level] ?? 0) * factor;
  const side = y < frame.cy ? -1 : 1;
  return [x - 18, e + 26, y + side * 40, x, e, y];
}

function CameraRig({ def, frame, preset, presetNonce, focusZone, exploded, dive, reduced }: {
  def: StationDefinition; frame: Frame; preset: Preset; presetNonce: number; focusZone: string | null; exploded: boolean; dive: boolean; reduced: boolean;
}) {
  const controls = useRef<ComponentRef<typeof CameraControls>>(null);
  const first = useRef(true);
  const factor = exploded ? EXPLODE_FACTOR : 1;

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.smoothTime = reduced ? 0 : first.current && dive ? motion.dive() / 4000 : 0.3;
    if (first.current) {
      first.current = false;
      if (dive && !reduced) {
        c.setLookAt(frame.cx, 320, frame.cy + 260, frame.cx, 0, frame.cy, false);
      }
    }
    c.setLookAt(...presetLookAt(def, frame, preset, factor), !reduced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, presetNonce, exploded]);

  useEffect(() => {
    const c = controls.current;
    if (!c || !focusZone) return;
    c.smoothTime = reduced ? 0 : 0.3;
    c.setLookAt(...presetLookAt(def, frame, focusZone as Preset, factor), !reduced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusZone]);

  return <CameraControls ref={controls} makeDefault minDistance={15} maxDistance={400} maxPolarAngle={Math.PI / 2.05} />;
}

function ExplodeDriver({ factor, exploded, reduced }: { factor: FactorRef; exploded: boolean; reduced: boolean }) {
  useFrame((_, dt) => {
    const target = exploded ? EXPLODE_FACTOR : 1;
    factor.current = reduced ? target : factor.current + (target - factor.current) * (1 - Math.exp(-dt * 5));
  });
  return null;
}

// ---- scene -----------------------------------------------------------------------------------------

export default function Scene3D(props: SceneProps) {
  const { def, twin, selectedZone, onSelectZone, exploded, particles, reducedMotion, model, stationDistance, lineColor } = props;
  const frame = useMemo(() => stationFrame(def), [def]);
  const factor = useRef(1);
  const zoneState = useMemo(() => Object.fromEntries(twin.zones.map((z) => [z.id, z])), [twin.zones]);
  const zoneName = def.zones.find((z) => z.id === selectedZone)?.name;
  const anchors = useRef(new Map<string, Anchor>());

  return (
    <div className="relative h-full w-full">
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ fov: 38, near: 0.5, far: 3000, position: [frame.cx - 60, 70, frame.cy + 90] }}
      onPointerMissed={() => onSelectZone(null)}
      aria-label={`3D model of ${def.name} station${zoneName ? `, ${zoneName} selected` : ""}. A table with the same information follows.`}
      role="img"
    >
      <ambientLight intensity={0.55} color={token("--scene-light")} />
      <directionalLight position={[-40, 90, 60]} intensity={1.1} color={token("--scene-light")} />
      <hemisphereLight args={[token("--brand-cyan"), token("--bg-deep"), 0.25]} />
      <ExplodeDriver factor={factor} exploded={exploded} reduced={reducedMotion} />
      {def.levels.map((lv) => (
        <LevelGroup key={lv.id} frame={frame} levelId={lv.id} factor={factor}>
          <LevelSlab def={def} levelId={lv.id} frame={frame} />
          {def.zones.filter((z) => z.level === lv.id).map((z) => (
            <ZoneMesh key={z.id} zone={z} state={zoneState[z.id]} selected={selectedZone === z.id} onSelect={onSelectZone} reduced={reducedMotion} />
          ))}
        </LevelGroup>
      ))}
      <Links def={def} twin={twin} frame={frame} factor={factor} />
      <Tracks def={def} frame={frame} factor={factor} />
      <TrainsAtStation def={def} frame={frame} factor={factor} model={model} stationDistance={stationDistance} lineColor={lineColor} />
      <Sensors def={def} twin={twin} frame={frame} factor={factor} />
      {particles && <Crowd def={def} twin={twin} frame={frame} factor={factor} reduced={reducedMotion} />}
      <CameraRig def={def} frame={frame} preset={props.preset} presetNonce={props.presetNonce} focusZone={selectedZone}
        exploded={exploded} dive={props.dive} reduced={reducedMotion} />
      <LabelProjector anchors={anchors} factor={factor} />
    </Canvas>
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <SceneLabels def={def} twin={twin} frame={frame} anchors={anchors} selectedZone={selectedZone} onSelectZone={onSelectZone} />
    </div>
    </div>
  );
}
