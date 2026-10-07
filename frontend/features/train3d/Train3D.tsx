"use client";

/**
 * A four-car Kelana Jaya Line train in 3D (TRAIN-03): the same Innovia Metro 300 model the
 * map draws (innovia.ts), with each car's roof and skirt tinted by its predicted crowding.
 * Loaded on demand; the 2D car diagram is the fallback and the accessible equivalent.
 */

import { ContactShadows } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { crowdOf } from "@/lib/crowd/levels";
import { token } from "@/lib/theme";
import { CAR, carGeometries, carMaterials } from "./innovia";

const GAP = 0.7;
const SCALE = 0.1;

function Car({ index, cab, flip, x, load, reduced }: { index: number; cab: boolean; flip: boolean; x: number; load: number; reduced: boolean }) {
  const geo = useMemo(() => carGeometries(), []);
  const mats = useMemo(() => carMaterials(), []);
  const group = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Color(), []);
  useEffect(() => () => {
    for (const g of Object.values(geo)) g.dispose();
    for (const m of Object.values(mats)) m.dispose();
  }, [geo, mats]);

  useFrame(({ clock }, dt) => {
    target.set(token(`--crowd-${crowdOf(load).level}`) || "#10b981");
    mats.crowd.color.lerp(target, reduced ? 1 : 1 - Math.exp(-dt * 6));
    if (group.current && !reduced) {
      // A soft sway along the train so it feels alive without going anywhere.
      group.current.position.z = Math.sin(clock.elapsedTime * 1.6 - index * 0.6) * 0.012 / SCALE;
    }
  });

  return (
    <group position={[x, 0, 0]} rotation={[0, 0, flip ? Math.PI : 0]}>
      <group ref={group}>
        <mesh geometry={cab ? geo.cabBody : geo.midBody} material={mats.body} />
        <mesh geometry={cab ? geo.cabLivery : geo.midLivery} material={mats.livery} />
        <mesh geometry={cab ? geo.cabGlass : geo.midGlass} material={mats.glass} />
        <mesh geometry={cab ? geo.cabCrowd : geo.midCrowd} material={mats.crowd} />
        {cab && <mesh geometry={geo.lamps} material={flip ? mats.tail : mats.head} />}
      </group>
    </group>
  );
}

function Track({ length }: { length: number }) {
  const steel = token("--rule-strong") || "#cfd6e3";
  const deck = token("--map-viaduct") || "#c3ccd8";
  return (
    <group>
      <mesh position={[0, 0, -0.35]}>
        <boxGeometry args={[length, 4.2, 0.5]} />
        <meshStandardMaterial color={deck} roughness={0.9} />
      </mesh>
      {[-0.72, 0.72].map((y) => (
        <mesh key={y} position={[0, y, -0.05]}>
          <boxGeometry args={[length, 0.12, 0.12]} />
          <meshStandardMaterial color={steel} metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

/** Front three-quarter view: the cab fills the left of the frame, the train runs away right. */
function Aim() {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    camera.lookAt(-2.3, -0.2, 0.15);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

export default function Train3D({ cars, reduced = false, height = 220, label }: { cars: number[]; reduced?: boolean; height?: number; label: string }) {
  const n = cars.length;
  const pitch = CAR.length + GAP;
  const total = n * pitch - GAP;
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={label}>
      <Canvas flat dpr={[1, 2]} camera={{ position: [-5.3, 0.95, 2.1], fov: 34 }} gl={{ antialias: true, alpha: true }}>
        <Aim />
        <hemisphereLight args={["#ffffff", "#c9d3e3", 1.5]} />
        <directionalLight position={[-6, 7, 5]} intensity={1.6} />
        <directionalLight position={[6, 3, -4]} intensity={0.5} />
        {/* Car space is z-up and faces +x; turn it so the cab leads on the left. */}
        <group scale={SCALE} rotation={[-Math.PI / 2, 0, Math.PI]} position={[0, -0.4, 0]}>
          {cars.map((load, i) => (
            <Car key={i} index={i} cab={i === 0 || i === n - 1} flip={i === n - 1} load={load} reduced={reduced}
              x={total / 2 - CAR.length / 2 - i * pitch} />
          ))}
          <Track length={total + 12} />
        </group>
        <ContactShadows position={[0, -0.46, 0]} opacity={0.3} scale={14} blur={2.4} far={1.5} />
      </Canvas>
    </div>
  );
}
