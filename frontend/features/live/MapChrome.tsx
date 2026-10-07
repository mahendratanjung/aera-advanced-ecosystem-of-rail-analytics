"use client";

/**
 * Everything that floats over the full-screen map, arranged as in Mini Tokyo 3D: search and
 * clock at the top left (FIND-01, MAP-03), service status under the clock (MAP-04), round
 * map buttons down the right edge (MAP-02), and a crowding key (MAP-07).
 */

import {
  ArrowsOutSimple, Compass, Crosshair, Cube, Gear, MagnifyingGlass, MapTrifold, Minus, Moon, Plus, Subway, Sun, SunHorizon,
  Warning, X,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { CrowdIcon, CrowdTag } from "@/components/Crowd";
import { Logo } from "@/components/TopBar";
import { NAV } from "@/components/nav";
import { Interchanges, StationCode } from "@/components/StationCode";
import { subscribe } from "@/lib/crowd/feed";
import { CROWD } from "@/lib/crowd/levels";
import { klDate, klTime } from "@/lib/format";
import { useSimNow } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { daylight, sunPosition } from "@/lib/sim/sun";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { Disruption, LineData } from "@/lib/types";
import { useUi } from "@/lib/ui";
import { mapApi } from "./GeoMap";
import { StationImage } from "./StationCard";

export const FLOAT = "bg-white/95 shadow-card backdrop-blur-md border border-rule";

// ---------------------------------------------------------------- search (FIND-01, FIND-02)

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return Math.hypot(x, y) * 6371;
}

export function StationSearch({ line, onPick, className = "", leading }: {
  line: LineData; onPick: (id: string) => void; className?: string; leading?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const k = norm(q);
    if (!k) return line.stations.slice(0, 0);
    const scored = line.stations
      .map((s) => {
        const n = norm(s.name);
        const id = norm(s.id);
        const word = s.name.split(/\s+/).some((w) => norm(w).startsWith(k));
        const score = id === k ? 0 : n.startsWith(k) ? 1 : word ? 2 : n.includes(k) || id.startsWith(k) ? 3 : 9;
        return { s, score };
      })
      .filter((x) => x.score < 9)
      .sort((a, b) => a.score - b.score || a.s.sequence - b.s.sequence);
    return scored.slice(0, 7).map((x) => x.s);
  }, [q, line]);

  // "/" jumps to the search box, as on most map sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"))) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (id: string) => {
    onPick(id);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  const nearMe = () => {
    setNote(null);
    if (!navigator.geolocation) return setNote("Location is not available in this browser.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const near = [...line.stations].sort((a, b) =>
          distanceKm(p.coords.latitude, p.coords.longitude, a.lat, a.lon) - distanceKm(p.coords.latitude, p.coords.longitude, b.lat, b.lon))[0];
        const km = distanceKm(p.coords.latitude, p.coords.longitude, near.lat, near.lon);
        if (km > 25) setNote("You are far from the Kelana Jaya Line, so no station was picked.");
        else pick(near.id);
      },
      () => setNote("Location was not shared, so search by name instead."),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  };

  const show = open && (results.length > 0 || note);
  return (
    <div className={`relative ${className}`}>
      <div className={`flex h-12 items-center gap-2 rounded-full pl-2 pr-1.5 ${FLOAT}`}>
        {leading}
        <MagnifyingGlass size={18} className="ml-1 shrink-0 text-ink-3" aria-hidden />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={!!show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={show && results[active] ? `${listId}-${results[active].id}` : undefined}
          aria-label="Search stations"
          placeholder="Search stations"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
            setNote(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && results[active]) {
              pick(results[active].id);
            } else if (e.key === "Escape") {
              setQ("");
              input.current?.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink placeholder:text-ink-3 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2">
            <X size={16} weight="bold" aria-hidden />
          </button>
        ) : (
          <button type="button" onClick={nearMe} aria-label="Nearest station to me" title="Nearest station to me"
            className="flex h-9 w-9 items-center justify-center rounded-full text-accent hover:bg-accent-soft">
            <Crosshair size={19} weight="bold" aria-hidden />
          </button>
        )}
      </div>
      {show && (
        <div className={`absolute inset-x-0 top-13.5 z-30 overflow-hidden rounded-[18px] ${FLOAT}`}>
          {note && <p className="px-4 py-3 text-[13px] text-ink-2">{note}</p>}
          <ul id={listId} role="listbox" aria-label="Stations">
            {results.map((s, i) => (
              <li key={s.id} id={`${listId}-${s.id}`} role="option" aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s.id);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? "bg-accent-soft" : ""}`}>
                <StationImage id={s.id} className="h-10 w-14 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold text-ink">{s.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5"><StationCode id={s.id} size="sm" /><Interchanges id={s.id} /></span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- clock and status (MAP-03, MAP-04)

interface Busiest {
  dir: number;
  from: string;
  to: string;
  load: number;
}

/** Trains running and the most crowded stretch right now, refreshed every two seconds. */
export function useLineStatus(line: LineData) {
  const [state, setState] = useState<{ running: number; busiest: Busiest | null } | null>(null);
  useEffect(() => {
    let last = 0;
    return subscribe((f) => {
      if (performance.now() - last < 2000) return;
      last = performance.now();
      let top: Busiest | null = null;
      for (const tr of f.trains) {
        if (top && tr.loadPct <= top.load) continue;
        const dir = tr.run.trip.directionId;
        const stops = line.directions.find((d) => d.direction_id === dir)!.stops;
        const k = Math.min(tr.state.stopIndex, stops.length - 2);
        top = { dir, from: stops[k].station_id, to: stops[k + 1].station_id, load: tr.loadPct };
      }
      setState({ running: f.trains.length, busiest: top });
    });
  }, [line]);
  return state;
}

function disruptionText(d: Disruption, names: Record<string, string>): string {
  if (d.note) return d.note;
  const at = names[d.stop_id] ?? d.stop_id;
  const to = d.to_stop_id ? names[d.to_stop_id] ?? d.to_stop_id : null;
  if (d.kind === "suspend") return to ? `No trains between ${at} and ${to}` : `No trains at ${at}`;
  if (d.kind === "hold") return `Trains held at ${at}`;
  if (d.kind === "surge") return `Event crowds at ${at}`;
  return `Delays near ${at}`;
}

function useClock(line: LineData) {
  const now = useSimNow(1000);
  const sim = useTwin((s) => s.sim);
  const conn = useTwin((s) => s.status);
  const liveSky = useUi((s) => s.liveSky);
  const centre = line.stations[Math.floor(line.stations.length / 2)];
  const phase = liveSky ? daylight(sunPosition(now, centre.lat, centre.lon)).phase : "Day";
  const mode = !sim ? "" : sim.clock.paused ? "Paused" : sim.clock.speed !== 1 ? `${sim.clock.speed}× speed` : Math.abs(now - Date.now()) < 120_000 ? "Live time" : "Simulated";
  const Icon = phase === "Night" ? Moon : phase === "Day" ? Sun : SunHorizon;
  return { now, phase, mode, conn, Icon };
}

function StatusLine({ line, compact = false }: { line: LineData; compact?: boolean }) {
  const status = useLineStatus(line);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const selectStation = useUi((s) => s.selectStation);
  const names = useMemo(() => Object.fromEntries(line.stations.map((s) => [s.id, s.name])), [line]);
  const issue = disruptions[0];
  const b = status?.busiest;
  const goBusiest = () => {
    if (!b) return;
    mapApi.current?.showStretch(b.from, b.to);
  };
  if (compact) {
    return (
      <button type="button" onClick={issue ? () => selectStation(issue.stop_id) : goBusiest}
        className={`pressable flex h-9 min-w-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold ${FLOAT}`}>
        {issue ? <Warning size={15} weight="fill" className="shrink-0 text-critical" aria-hidden /> : <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-good" />}
        <span className="truncate text-ink">{issue ? disruptionText(issue, names) : b ? `Busiest: ${names[b.from]} → ${names[b.to]}` : "Good service"}</span>
      </button>
    );
  }
  return (
    <div className="border-t border-rule pt-2.5">
      {issue ? (
        <button type="button" onClick={() => selectStation(issue.stop_id)} className="flex w-full items-start gap-2 text-left text-[13px]">
          <Warning size={17} weight="fill" className="mt-px shrink-0 text-critical" aria-hidden />
          <span><span className="font-bold text-ink">Disruption</span> <span className="text-ink-2">{disruptionText(issue, names)}</span></span>
        </button>
      ) : (
        <p className="flex items-center gap-2 text-[13px]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-good" />
          <span className="font-bold text-ink">Good service</span>
          {status && <span className="text-ink-3">· <span className="num">{status.running}</span> trains running</span>}
        </p>
      )}
      {b && (
        <button type="button" onClick={goBusiest} title="Show this stretch on the map"
          className="pressable mt-2 flex w-full items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-left hover:bg-surface-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold text-ink-3">Most crowded now</span>
            <span className="block truncate text-[13px] font-bold text-ink">{names[b.from]} → {names[b.to]}</span>
          </span>
          <CrowdTag loadPct={b.load} size="sm" />
        </button>
      )}
    </div>
  );
}

export function ClockCard({ line }: { line: LineData }) {
  const { now, phase, mode, conn, Icon } = useClock(line);
  return (
    <section aria-label="Time and service" className={`rounded-[20px] px-4 py-3 ${FLOAT}`}>
      <div className="flex items-center gap-3">
        <Icon size={26} weight="fill" className="shrink-0 text-highlight" aria-hidden />
        <p className="num text-[30px] font-extrabold leading-none tracking-tight text-ink">{klTime(now)}</p>
        <div className="min-w-0 text-[12px] leading-tight">
          <p className="font-semibold text-ink-2">{klDate(now)}</p>
          <p className="flex items-center gap-1.5 text-ink-3">
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${conn === "live" ? "bg-good" : "bg-serious"}`} />
            {conn === "live" ? mode : "Reconnecting"} · {phase}
          </p>
        </div>
      </div>
      <div className="mt-2.5"><StatusLine line={line} /></div>
    </section>
  );
}

/** Phone version: two chips under the search bar. */
export function ClockChips({ line }: { line: LineData }) {
  const { now, Icon, conn } = useClock(line);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 ${FLOAT}`}>
        <Icon size={16} weight="fill" className="text-highlight" aria-hidden />
        <span className="num text-[14px] font-extrabold text-ink">{klTime(now)}</span>
        {conn !== "live" && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-serious" />}
      </span>
      <StatusLine line={line} compact />
    </div>
  );
}

// ---------------------------------------------------------------- map buttons (MAP-02)

function RoundButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed}
      className={`pressable flex h-11 w-11 items-center justify-center ${pressed ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
      {children}
    </button>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className={`flex flex-col overflow-hidden rounded-2xl divide-y divide-rule ${FLOAT}`}>{children}</div>;
}

export function MapButtons({ bearing, compact = false, keyOpen, onKey }: { bearing: number; compact?: boolean; keyOpen?: boolean; onKey?: () => void }) {
  const { is3d, underground, liveSky, setIs3d, setUnderground, setLiveSky } = useUi();
  return (
    <div className="flex flex-col gap-2.5">
      {!compact && (
        <Group>
          <RoundButton label="Zoom in" onClick={() => mapApi.current?.zoomBy(1)}><Plus size={19} weight="bold" aria-hidden /></RoundButton>
          <RoundButton label="Zoom out" onClick={() => mapApi.current?.zoomBy(-1)}><Minus size={19} weight="bold" aria-hidden /></RoundButton>
        </Group>
      )}
      <Group>
        <RoundButton label="Point north" onClick={() => mapApi.current?.resetNorth()}>
          <Compass size={21} weight="bold" aria-hidden style={{ transform: `rotate(${-bearing - 45}deg)` }} />
        </RoundButton>
        <RoundButton label="Show the whole line" onClick={() => mapApi.current?.wholeLine()}><ArrowsOutSimple size={19} weight="bold" aria-hidden /></RoundButton>
      </Group>
      <Group>
        <RoundButton label={is3d ? "Flat map" : "3D map"} onClick={() => setIs3d(!is3d)}>
          {is3d ? <MapTrifold size={20} weight="bold" aria-hidden /> : <Cube size={20} weight="bold" aria-hidden />}
        </RoundButton>
        <RoundButton label="Underground view" pressed={underground} onClick={() => setUnderground(!underground)}><Subway size={20} weight="bold" aria-hidden /></RoundButton>
        <RoundButton label={liveSky ? "Lighting follows the clock (press for daylight)" : "Always daylight (press to follow the clock)"} pressed={liveSky} onClick={() => setLiveSky(!liveSky)}>
          <SunHorizon size={20} weight="bold" aria-hidden />
        </RoundButton>
      </Group>
      {onKey && (
        <Group>
          <RoundButton label="Crowding key" pressed={keyOpen} onClick={onKey}><CrowdIcon level={3} size={20} color="currentColor" /></RoundButton>
        </Group>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- crowding key (MAP-07)

export function CrowdKey({ onClose }: { onClose?: () => void }) {
  return (
    <section aria-label="Crowding key" className={`rounded-[18px] px-3 py-2.5 ${FLOAT}`}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 className="text-[12px] font-bold text-ink">How full trains are</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Hide crowding key" className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2">
            <X size={13} weight="bold" aria-hidden />
          </button>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {CROWD.map((s) => (
          <li key={s.level}><CrowdTag loadPct={s.from + 0.1} size="sm" /></li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-ink-3">Each car&apos;s roof shows its own level.</p>
    </section>
  );
}

// ---------------------------------------------------------------- navigation

export function NavPill() {
  const user = useSession((s) => s.user);
  return (
    <nav aria-label="Main" className={`flex items-center gap-1 rounded-full p-1 ${FLOAT}`}>
      {NAV.filter((n) => n.href !== "/").map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="pressable flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Icon size={17} aria-hidden />{label}
        </Link>
      ))}
      {user?.role === "admin" ? (
        <Link href="/admin" aria-label="Simulation controls" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"><Gear size={18} aria-hidden /></Link>
      ) : (
        <Link href="/login" className="rounded-full px-3.5 py-2 text-[13px] font-semibold text-ink-3 hover:bg-surface-2">Staff</Link>
      )}
    </nav>
  );
}

export function BrandPill() {
  return (
    <Link href="/about" aria-label="About AERA" className={`flex h-12 shrink-0 items-center rounded-full px-3 ${FLOAT}`}>
      <Logo />
    </Link>
  );
}
