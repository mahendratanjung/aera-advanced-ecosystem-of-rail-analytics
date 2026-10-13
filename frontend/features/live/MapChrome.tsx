"use client";

/**
 * Everything that floats over the full-screen map, arranged as in Mini Tokyo 3D: search and
 * clock at the top left (FIND-01, MAP-03), service status under the clock (MAP-04), round
 * map buttons down the right edge (MAP-02), and a crowding key (MAP-07).
 */

import {
  ArrowsOutSimple, ChatCircleDots, ClockClockwise, Compass, CornersIn, CornersOut, Graph, Crosshair, Cube, Gear, Keyboard, ListBullets, Pause, Play, Stop, MagnifyingGlass, Megaphone, MapTrifold, Minus, Moon, Path, Plus, Subway, Sun, SunHorizon,
  UserCircle, Warning, X,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { CrowdIcon, CrowdTag } from "@/components/Crowd";
import { Logo } from "@/components/TopBar";
import { navFor } from "@/components/nav";
import { useView } from "@/lib/view";
import { Interchanges, StationCode } from "@/components/StationCode";
import { subscribe } from "@/lib/crowd/feed";
import { CROWD, crowdOf } from "@/lib/crowd/levels";
import { klDate, klTime } from "@/lib/format";
import { useSimNow } from "@/lib/hooks";
import { useHome } from "@/lib/home";
import { recentStations, rememberStation } from "@/lib/recent";
import { useSession } from "@/lib/session";
import { daylight, sunPosition } from "@/lib/sim/sun";
import { NO_DISRUPTIONS, NO_NOTICES, useTwin } from "@/lib/store";
import type { Disruption, LineData } from "@/lib/types";
import { MAX_AHEAD_MIN, useUi } from "@/lib/ui";
import { mapApi } from "./GeoMap";
import { type ShortcutId, Kbd, canFullscreen, shortcutKey, toggleFullscreen } from "./Shortcuts";
import { StationImage } from "./StationCard";

export const FLOAT = "bg-white/95 shadow-card backdrop-blur-md border border-rule";

// ---------------------------------------------------------------- search (FIND-01, FIND-02)

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
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

  const home = useHome((s) => s.id);
  const [recent, setRecent] = useState<string[]>([]);
  const results = useMemo(() => {
    const k = norm(q);
    if (!k) {
      // Before anything is typed: my station, then the stations picked lately.
      const ids = [home, ...recent.filter((x) => x !== home)];
      return ids.map((id) => line.stations.find((s) => s.id === id)).filter((s): s is LineData["stations"][number] => !!s);
    }
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
    rememberStation(id);
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
      {/* The ring goes round the whole pill rather than the bare input inside it. */}
      <div className={`flex h-12 items-center gap-2 rounded-full pl-2 pr-1.5 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-(--focus) ${FLOAT}`}>
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
          onFocus={() => {
            setRecent(recentStations());
            setOpen(true);
          }}
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
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink placeholder:text-ink-3 ring-on-parent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
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
          {!q && results.length > 0 && <p className="px-4 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">Your stations</p>}
          <ul id={listId} role="listbox" aria-label={q ? "Stations" : "Your stations"}>
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
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <StationCode id={s.id} size="sm" /><Interchanges id={s.id} />
                    {!q && <span className="text-[11px] font-semibold text-ink-3">{s.id === home ? "My station" : "Recent"}</span>}
                  </span>
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
  const [state, setState] = useState<{ running: number; busiest: Busiest | null; levels: number[] } | null>(null);
  useEffect(() => {
    let last = 0;
    return subscribe((f) => {
      if (performance.now() - last < 2000) return;
      last = performance.now();
      let top: Busiest | null = null;
      const levels = CROWD.map(() => 0);
      for (const tr of f.trains) levels[crowdOf(tr.loadPct).level - 1]++;
      for (const tr of f.trains) {
        if (top && tr.loadPct <= top.load) continue;
        const dir = tr.run.trip.directionId;
        const stops = line.directions.find((d) => d.direction_id === dir)!.stops;
        const k = Math.min(tr.state.stopIndex, stops.length - 2);
        top = { dir, from: stops[k].station_id, to: stops[k + 1].station_id, load: tr.loadPct };
      }
      setState({ running: f.trains.length, busiest: top, levels });
    });
  }, [line]);
  return state;
}

export function disruptionText(d: Disruption, names: Record<string, string>): string {
  if (d.note) return d.note;
  const at = names[d.stop_id] ?? d.stop_id;
  const to = d.to_stop_id ? names[d.to_stop_id] ?? d.to_stop_id : null;
  if (d.kind === "suspend") return to ? `No trains between ${at} and ${to}` : `No trains at ${at}`;
  if (d.kind === "hold") return `Trains held at ${at}`;
  if (d.kind === "surge") return `Event crowds at ${at}`;
  if (d.kind === "insert") return `Extra train from ${at}`;
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

/** "Ask AERA what to do": the card on desktop, the Ask page on phones. */
function AskWhatToDo({ issue, names, compact = false }: { issue: Disruption; names: Record<string, string>; compact?: boolean }) {
  const setAsking = useUi((s) => s.setAsking);
  const home = useHome((s) => s.id);
  const q = `${disruptionText(issue, names)}. What should I do to travel from ${names[home] ?? "my station"}?`;
  if (compact) {
    return (
      <Link href={`/ask?q=${encodeURIComponent(q)}`} aria-label="Ask AERA what to do"
        className={`pressable flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-bold text-accent ${FLOAT}`}>
        <ChatCircleDots size={15} weight="fill" aria-hidden />Ask
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => setAsking(true, q)}
      className="pressable mt-2 flex w-full items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-left text-[13px] font-bold text-accent hover:brightness-95">
      <ChatCircleDots size={16} weight="fill" aria-hidden />
      <span className="flex-1">Ask AERA what to do</span>
    </button>
  );
}

function StatusLine({ line, compact = false }: { line: LineData; compact?: boolean }) {
  const status = useLineStatus(line);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const selectStation = useUi((s) => s.selectStation);
  const names = useMemo(() => Object.fromEntries(line.stations.map((s) => [s.id, s.name])), [line]);
  const now = useSimNow(5000);
  // Only disruptions in force now; scenario ones can stay listed after their end time.
  const issue = disruptions.find((d) => d.kind !== "insert" && d.start_ms <= now && (d.end_ms === null || d.end_ms > now));
  const notices = useTwin((s) => s.sim?.notices ?? NO_NOTICES);
  const b = status?.busiest;
  const goBusiest = () => {
    if (!b) return;
    mapApi.current?.showStretch(b.from, b.to);
  };
  const blocking = issue && (issue.kind === "suspend" || issue.kind === "hold");
  if (compact) {
    return (
      <>
      <button type="button" onClick={issue ? () => selectStation(issue.stop_id) : goBusiest}
        className={`pressable flex h-9 min-w-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold ${FLOAT}`}>
        {issue ? <Warning size={15} weight="fill" className="shrink-0 text-critical" aria-hidden /> : <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-good" />}
        <span className="truncate text-ink">{issue ? disruptionText(issue, names) : notices[0] ? notices[0].text : b ? `Busiest: ${names[b.from]} → ${names[b.to]}` : "Good service"}</span>
      </button>
      {blocking && <AskWhatToDo issue={issue} names={names} compact />}
      </>
    );
  }
  const ask = blocking ? <AskWhatToDo issue={issue} names={names} /> : null;
  return (
    <div className="border-t border-rule pt-2.5">
      {issue ? (
        <button type="button" onClick={() => selectStation(issue.stop_id)} className="flex w-full items-start gap-2 text-left text-[13px]">
          <Warning size={17} weight="fill" className="mt-px shrink-0 text-critical" aria-hidden />
          <span><span className="font-bold text-ink">Disruption</span> <span className="text-ink-2">{disruptionText(issue, names)}</span></span>
        </button>
      ) : null}
      {ask}
      {issue ? null : (
        <p className="flex items-center gap-2 text-[13px]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-good" />
          <span className="font-bold text-ink">Good service</span>
          {status && <span className="text-ink-3">· <span className="num">{status.running}</span> trains running</span>}
        </p>
      )}
      {notices.map((n) => (
        <p key={n.id} className="mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-snug"
          style={{ background: n.severity === "warning" ? "var(--highlight-soft)" : "var(--accent-soft)", color: n.severity === "warning" ? "var(--crowd-3-ink)" : "var(--accent)" }}>
          <Megaphone size={16} weight="fill" className="mt-px shrink-0" aria-hidden />
          <span><span className="font-bold">Notice</span> <span className="text-ink-2">{n.text}</span></span>
        </p>
      ))}
      {status && status.running > 0 && <LineGlance levels={status.levels} running={status.running} />}
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

/** How many trains are at each crowding level right now, as one stacked bar. */
function LineGlance({ levels, running }: { levels: number[]; running: number }) {
  const full = levels[3] + levels[4];
  return (
    <div className="mt-2.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold text-ink-3">Trains by crowding</span>
        <span className="font-semibold text-ink-2">{full ? <><span className="num">{full}</span> crowded or packed</> : "None crowded"}</span>
      </div>
      <div role="img" aria-label={CROWD.map((c, i) => `${levels[i]} ${c.name}`).join(", ")} className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full">
        {CROWD.map((c, i) => levels[i] > 0 && (
          <span key={c.level} title={`${levels[i]} ${c.name}`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flexGrow: levels[i] / running, background: `var(--crowd-${c.level})` }} />
        ))}
      </div>
      {/* Each level has its own icon, so the counts read without colour or names. */}
      <ul aria-hidden className="mt-1.5 flex flex-wrap gap-x-3 text-[11px]">
        {CROWD.map((c, i) => levels[i] > 0 && (
          <li key={c.level} title={c.name} className="flex items-center gap-1">
            <CrowdIcon level={c.level} size={12} /><span className="num font-bold text-ink-2">{levels[i]}</span>
          </li>
        ))}
      </ul>
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

// ---------------------------------------------------------------- crowding ahead (MAPC-05)

/**
 * Look up to two hours ahead: the whole map (trains, crowding bands, other lines, light) moves
 * to that time. Play runs the next two hours in about twelve seconds. Cards keep showing now.
 */
export function AheadBar() {
  const ahead = useUi((s) => s.ahead);
  const open = useUi((s) => s.aheadOpen);
  const setAhead = useUi((s) => s.setAhead);
  const setOpen = useUi((s) => s.setAheadOpen);
  const now = useSimNow(1000);
  const [playing, setPlaying] = useState(false);
  const [crowded, setCrowded] = useState<{ n: number; of: number } | null>(null);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const a = useUi.getState().ahead;
      if (a >= MAX_AHEAD_MIN) return setPlaying(false);
      useUi.getState().setAhead(a + 1);
    }, 100);
    return () => clearInterval(id);
  }, [playing]);
  useEffect(() => {
    if (!open) return;
    let last = 0;
    return subscribe((f) => {
      if (performance.now() - last < 400) return;
      last = performance.now();
      setCrowded({ n: f.trains.filter((x) => x.loadPct >= 75).length, of: f.trains.length });
    });
  }, [open]);
  useEffect(() => () => setOpen(false), [setOpen]);
  if (!open) return null;
  const at = now + ahead * 60_000;
  return (
    <section aria-label="Crowding ahead" className={`w-full rounded-[20px] px-4 py-3 sm:w-[420px] ${FLOAT} ${ahead ? "ring-2 ring-accent" : ""}`}>
      <div className="flex items-center gap-2">
        <ClockClockwise size={18} weight="bold" className="shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 flex-1 text-[13px] font-bold text-ink" aria-live="polite">
          {ahead ? <>Showing <span className="num">{klTime(at)}</span> <span className="font-semibold text-ink-3">· in {ahead} min, predicted</span></> : "Now. Slide to see the next 2 hours"}
        </p>
        <button type="button" onClick={() => {
          if (playing) return setPlaying(false);
          if (ahead >= MAX_AHEAD_MIN) setAhead(0);
          setPlaying(true);
        }}
          aria-label={playing ? "Pause" : "Play the next two hours"} aria-pressed={playing}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          {playing ? <Pause size={16} weight="fill" aria-hidden /> : <Play size={16} weight="fill" aria-hidden />}
        </button>
        <button type="button" onClick={() => { setPlaying(false); setOpen(false); }} aria-label="Back to now and close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2">
          <X size={16} weight="bold" aria-hidden />
        </button>
      </div>
      <input type="range" min={0} max={MAX_AHEAD_MIN} step={5} value={ahead} onChange={(e) => { setPlaying(false); setAhead(Number(e.target.value)); }}
        aria-label="Minutes ahead" aria-valuetext={ahead ? `${ahead} minutes ahead, ${klTime(at)}` : "Now"}
        className="mt-2 w-full accent-[var(--accent)]" />
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex gap-1">
          {[0, 15, 30, 60, 120].map((m) => (
            <button key={m} type="button" aria-pressed={ahead === m} onClick={() => { setPlaying(false); setAhead(m); }}
              className={`pressable rounded-full px-2.5 py-1 text-[12px] font-semibold ${ahead === m ? "bg-ink text-white" : "bg-surface-2 text-ink-2"}`}>
              {m === 0 ? "Now" : m < 60 ? `+${m}m` : `+${m / 60}h`}
            </button>
          ))}
        </div>
        {crowded && <span className="whitespace-nowrap text-[12px] text-ink-3"><span className="num font-bold" style={{ color: crowded.n ? "var(--crowd-4-ink)" : "var(--crowd-1-ink)" }}>{crowded.n}</span> of {crowded.of} crowded</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- map buttons (MAP-02)

function RoundButton({ label, onClick, pressed, shortcut, tip = false, children }: {
  label: string; onClick: () => void; pressed?: boolean; shortcut?: ShortcutId;
  /** Show a label beside the button on hover and keyboard focus (desktop). */
  tip?: boolean; children: ReactNode;
}) {
  const key = shortcut ? shortcutKey(shortcut) : "";
  return (
    <div className="group relative first:rounded-t-2xl last:rounded-b-2xl">
      <button type="button" onClick={onClick} aria-label={label} title={tip ? undefined : label} aria-pressed={pressed} aria-keyshortcuts={key || undefined}
        className={`pressable flex h-11 w-11 items-center justify-center rounded-[inherit] ${pressed ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
        {children}
      </button>
      {tip && (
        <span aria-hidden className="pointer-events-none absolute right-full top-1/2 mr-2.5 flex -translate-y-1/2 translate-x-1 items-center gap-2 whitespace-nowrap rounded-full bg-ink py-1.5 pl-3 pr-1.5 text-[12px] font-semibold text-white opacity-0 shadow-card transition group-hover:translate-x-0 group-hover:opacity-100 group-has-[:focus-visible]:translate-x-0 group-has-[:focus-visible]:opacity-100">
          {label}{key && <Kbd dark>{key}</Kbd>}
        </span>
      )}
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className={`flex flex-col rounded-2xl divide-y divide-rule ${FLOAT}`}>{children}</div>;
}

function useFullscreen() {
  const [on, setOn] = useState(false);
  const [can, setCan] = useState(false);
  useEffect(() => {
    setCan(canFullscreen());
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  return { on, can };
}

export function MapButtons({ bearing, compact = false, keyOpen, onKey }: { bearing: number; compact?: boolean; keyOpen?: boolean; onKey?: () => void }) {
  const { is3d, underground, liveSky, setIs3d, setUnderground, setLiveSky, crowdLayer, setCrowdLayer, listing, setListing, otherLines, setOtherLines, keysOpen, setKeysOpen, touring, setTouring, aheadOpen, setAheadOpen } = useUi();
  const full = useFullscreen();
  const tip = !compact;
  return (
    <div className="flex flex-col gap-2.5">
      {!compact && (
        <Group>
          <RoundButton tip={tip} shortcut="zoomIn" label="Zoom in" onClick={() => mapApi.current?.zoomBy(1)}><Plus size={19} weight="bold" aria-hidden /></RoundButton>
          <RoundButton tip={tip} shortcut="zoomOut" label="Zoom out" onClick={() => mapApi.current?.zoomBy(-1)}><Minus size={19} weight="bold" aria-hidden /></RoundButton>
        </Group>
      )}
      <Group>
        <RoundButton tip={tip} shortcut="north" label="Point north" onClick={() => mapApi.current?.resetNorth()}>
          <Compass size={21} weight="bold" aria-hidden style={{ transform: `rotate(${-bearing - 45}deg)` }} />
        </RoundButton>
        <RoundButton tip={tip} shortcut="whole" label="Show the whole line" onClick={() => mapApi.current?.wholeLine()}><ArrowsOutSimple size={19} weight="bold" aria-hidden /></RoundButton>
        {/* The phone column is full; a tour is for the big screen (pitch demos). */}
        {!compact && (
          <RoundButton tip={tip} shortcut="tour" label={touring ? "Stop the tour" : "Tour the line"} pressed={touring} onClick={() => setTouring(!touring)}>
            {touring ? <Stop size={18} weight="fill" aria-hidden /> : <Play size={18} weight="fill" aria-hidden />}
          </RoundButton>
        )}
        {!compact && full.can && (
          <RoundButton tip={tip} shortcut="fullscreen" label={full.on ? "Leave full screen" : "Full screen"} pressed={full.on} onClick={toggleFullscreen}>
            {full.on ? <CornersIn size={19} weight="bold" aria-hidden /> : <CornersOut size={19} weight="bold" aria-hidden />}
          </RoundButton>
        )}
      </Group>
      <Group>
        <RoundButton tip={tip} shortcut="3d" label={is3d ? "Flat map" : "3D map"} onClick={() => setIs3d(!is3d)}>
          {is3d ? <MapTrifold size={20} weight="bold" aria-hidden /> : <Cube size={20} weight="bold" aria-hidden />}
        </RoundButton>
        <RoundButton tip={tip} shortcut="underground" label="Underground view" pressed={underground} onClick={() => setUnderground(!underground)}><Subway size={20} weight="bold" aria-hidden /></RoundButton>
        <RoundButton tip={tip} shortcut="sky" label={liveSky ? "Lighting follows the clock" : "Always daylight"} pressed={liveSky} onClick={() => setLiveSky(!liveSky)}>
          <SunHorizon size={20} weight="bold" aria-hidden />
        </RoundButton>
      </Group>
      <Group>
        <RoundButton tip={tip} shortcut="crowd" label={crowdLayer ? "Hide crowding on the track" : "Show crowding on the track"} pressed={crowdLayer} onClick={() => setCrowdLayer(!crowdLayer)}>
          <Path size={20} weight="bold" aria-hidden />
        </RoundButton>
        <RoundButton tip={tip} shortcut="ahead" label={aheadOpen ? "Back to now" : "Crowding ahead (next 2 hours)"} pressed={aheadOpen} onClick={() => setAheadOpen(!aheadOpen)}>
          <ClockClockwise size={20} weight="bold" aria-hidden />
        </RoundButton>
        <RoundButton tip={tip} shortcut="lines" label={otherLines ? "Hide the other lines" : "Show every line and its trains"} pressed={otherLines} onClick={() => setOtherLines(!otherLines)}>
          <Graph size={20} weight="bold" aria-hidden />
        </RoundButton>
        {onKey && <RoundButton tip={tip} shortcut="key" label="Crowding key" pressed={keyOpen} onClick={onKey}><CrowdIcon level={3} size={20} color="currentColor" /></RoundButton>}
        <RoundButton tip={tip} shortcut="list" label="Line as a list" pressed={listing} onClick={() => setListing(!listing)}><ListBullets size={20} weight="bold" aria-hidden /></RoundButton>
      </Group>
      {!compact && (
        <Group>
          <RoundButton tip={tip} shortcut="help" label="Keyboard shortcuts" pressed={keysOpen} onClick={() => setKeysOpen(!keysOpen)}><Keyboard size={20} weight="bold" aria-hidden /></RoundButton>
        </Group>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- tour (POL-07)

/** While the camera tours the line: where it is heading, and a way to stop. */
export function TourChip({ line }: { line: LineData }) {
  const touring = useUi((s) => s.touring);
  const at = useUi((s) => s.tourAt);
  const setTouring = useUi((s) => s.setTouring);
  const selectStation = useUi((s) => s.selectStation);
  if (!touring) return null;
  const s = line.stations.find((x) => x.id === at);
  return (
    <div role="status" className={`enter flex h-11 items-center gap-2 rounded-full pl-4 pr-1.5 ${FLOAT}`}>
      <Play size={14} weight="fill" className="shrink-0 text-accent" aria-hidden />
      <span className="truncate text-[13px] text-ink-2">Touring the line{s && <> · <button type="button" onClick={() => selectStation(s.id)} className="font-bold text-ink hover:underline">{s.name}</button></>}</span>
      <button type="button" onClick={() => setTouring(false)} className="pressable ml-1 flex h-8 shrink-0 items-center gap-1 rounded-full bg-surface-2 px-3 text-[12px] font-bold text-ink hover:bg-surface-3">
        <Stop size={12} weight="fill" aria-hidden />Stop
      </button>
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
      <p className="mt-1.5 text-[11px] text-ink-3">Each car&apos;s roof shows its own level. The band on the track shows the train on, or next on, each stretch; station names show the next train leaving.</p>
    </section>
  );
}

// ---------------------------------------------------------------- navigation

export function NavPill() {
  const user = useSession((s) => s.user);
  const view = useView();
  const asking = useUi((s) => s.asking);
  const setAsking = useUi((s) => s.setAsking);
  const item = "pressable flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold";
  return (
    <nav aria-label="Main" className={`flex items-center gap-1 rounded-full p-1 ${FLOAT}`}>
      {view === "operator" && <span className="rounded-full bg-ops px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-ops-ink">Operator</span>}
      {navFor(view).filter((n) => n.href !== "/" && n.href !== "/admin").map(({ href, label, icon: Icon }) => href === "/ask" ? (
        // On the map, Ask opens as the card instead of leaving the map.
        <button key={href} type="button" onClick={() => setAsking(!asking)} aria-pressed={asking} aria-label={label} title={label}
          className={`${item} ${asking ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
          <Icon size={17} weight={asking ? "fill" : "regular"} aria-hidden /><span className="hidden xl:inline">{label}</span>
        </button>
      ) : (
        <Link key={href} href={href} aria-label={label} title={label} className={`${item} text-ink-2 hover:bg-surface-2 hover:text-ink`}>
          <Icon size={17} aria-hidden /><span className="hidden xl:inline">{label}</span>
        </Link>
      ))}
      {user?.role === "admin" && (
        <Link href="/admin" aria-label="Simulation controls" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"><Gear size={18} aria-hidden /></Link>
      )}
      <Link href="/me" aria-label="You: your station, saved rides and settings" title="You" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2">
        <UserCircle size={22} aria-hidden />
      </Link>
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
