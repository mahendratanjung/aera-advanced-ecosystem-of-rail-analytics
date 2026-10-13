"use client";

/**
 * The network page (NETM): the whole Klang Valley rail map, drawn like the official integrated
 * transit poster, with the Kelana Jaya Line's trains running on it live. Tap a station for its
 * lines, next trains or service frequency, and the walkways to other lines; tap a line in the
 * list to pick it out. Desktop shows the card in a left column; phones use a bottom sheet. The
 * selection is kept in the URL (/network?station=KJ15, ?line=PY, ?train=...).
 */

import {
  ArrowsOut, ChatCircleDots, Crosshair, MagnifyingGlass, MapPin, Minus, NavigationArrow, PersonSimpleWalk, Plus, Star, Train, X,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CarDiagram, CrowdTag } from "@/components/Crowd";
import { DataChip, LineBadge } from "@/components/LineBadge";
import { StationCode } from "@/components/StationCode";
import { FLOAT } from "@/features/live/MapChrome";
import { Sheet } from "@/features/live/Sheet";
import { netHeadway } from "@/lib/advisor/network";
import { type LiveTrain, attachEngine, latest, subscribe } from "@/lib/crowd/feed";
import { pctText } from "@/lib/crowd/levels";
import type { CrowdEngine } from "@/lib/crowd/model";
import { klTime, minutesUntil } from "@/lib/format";
import { useHome } from "@/lib/home";
import { useCrowd, useMediaQuery, useNetCrowd, useNetwork, useSimNetwork, useSimNow } from "@/lib/hooks";
import { hasCrowding, leavingLoads } from "@/lib/network/crowd";
import { type Layout, type Place, layout, linkedPlaces, searchPlaces, stationFor } from "@/lib/network/layout";
import { LINES, type LineDef } from "@/lib/network/schematic";
import { departuresAt, isNetTrain } from "@/lib/network/trains";
import { NetTrainCard } from "./NetTrainCard";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";
import { type Inset, type MapHandle, NetworkMap } from "./NetworkMap";

const STATION_COUNT = new Set(layout().places.map((p) => p.key)).size;

function lineOfPlace(p: Place): LineDef[] {
  const out: LineDef[] = [];
  for (const s of p.stations) if (!out.includes(s.line)) out.push(s.line);
  return out;
}

// ---------------------------------------------------------------- search

function NetworkSearch({ lay, onPick, className = "" }: { lay: Layout; onPick: (p: Place) => void; className?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => searchPlaces(lay, q), [lay, q]);

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

  const pick = (p: Place) => {
    onPick(p);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className={`relative ${className}`}>
      <div className={`flex h-12 items-center gap-2 rounded-full pl-4 pr-2 ${FLOAT}`}>
        <MagnifyingGlass size={18} className="shrink-0 text-ink-3" aria-hidden />
        <input ref={input} value={q} role="combobox" aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-label="Search all stations" placeholder="Search any station or code"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && results[active]) pick(results[active]);
            else if (e.key === "Escape") { setQ(""); input.current?.blur(); }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-3 focus:outline-none" />
        {q && (
          <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2">
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Stations" className={`absolute inset-x-0 top-14 z-30 max-h-[60vh] overflow-y-auto rounded-2xl p-1.5 ${FLOAT}`}>
          {results.map((p, i) => (
            <li key={p.key} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === active ? "bg-accent-soft" : "hover:bg-surface-2"}`}>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{p.name}</span>
                <span className="flex shrink-0 gap-1">{lineOfPlace(p).map((l) => <LineBadge key={l.id} line={l} size={20} />)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the line list (legend)

function LinesPanel({ focusLine, onFocus, trainsOn, onTrains }: { focusLine: string | null; onFocus: (id: string | null) => void; trainsOn: boolean; onTrains: (v: boolean) => void }) {
  return (
    <div>
      <h2 className="text-[19px] font-extrabold leading-tight tracking-tight text-ink">Klang Valley rail network</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        {LINES.length} lines and {STATION_COUNT} stations, drawn like the integrated transit map. Every train runs to its timetable, coloured by how full it is predicted to be (ERL and BRT, with no public ridership, in their line colour).
      </p>
      <ul className="mt-3 space-y-1" aria-label="Lines">
        {LINES.map((l) => {
          const on = focusLine === l.id;
          return (
            <li key={l.id}>
              <button type="button" aria-pressed={on} onClick={() => onFocus(on ? null : l.id)}
                className={`pressable flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left ${on ? "bg-accent-soft" : "hover:bg-surface-2"}`}>
                <LineBadge line={l} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold leading-snug text-ink">{l.name}</span>
                  <span className="block text-[11px] text-ink-3">{l.operator}</span>
                </span>
                <DataChip data={l.data} />
              </button>
            </li>
          );
        })}
      </ul>
      <label className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] font-semibold text-ink">
        <span className="flex items-center gap-2"><Train size={17} weight="fill" className="text-line" aria-hidden />Show live trains</span>
        <input type="checkbox" checked={trainsOn} onChange={(e) => onTrains(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
      </label>
      <MapKey />
    </div>
  );
}

function MapKey() {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] text-ink-2">
      <div className="flex items-center gap-2">
        <svg width="26" height="12" aria-hidden><rect x="1" y="1" width="24" height="10" rx="5" fill="white" stroke="var(--net-ink)" strokeWidth="1.4" /></svg>
        <dt>Interchange</dt>
      </div>
      <div className="flex items-center gap-2">
        <svg width="26" height="12" aria-hidden><line x1="2" y1="6" x2="24" y2="6" stroke="var(--net-link)" strokeWidth="3" strokeLinecap="round" /></svg>
        <dt>Walkway to another line</dt>
      </div>
      <div className="flex items-center gap-2">
        <svg width="26" height="12" aria-hidden><circle cx="13" cy="6" r="5" fill="var(--crowd-2)" stroke="white" strokeWidth="1.5" /></svg>
        <dt>Train, by crowding</dt>
      </div>
      <div className="flex items-center gap-2">
        <svg width="26" height="12" aria-hidden><circle cx="13" cy="6" r="4.3" fill="var(--line-kg)" stroke="white" strokeWidth="1.5" /></svg>
        <dt>Train without crowding data (ERL, BRT)</dt>
      </div>
      <div className="flex items-center gap-2">
        <svg width="26" height="12" aria-hidden><line x1="2" y1="6" x2="24" y2="6" stroke="var(--line-kj)" strokeWidth="4" /><line x1="3" y1="6" x2="23" y2="6" stroke="white" strokeWidth="1.5" strokeDasharray="2 2" /></svg>
        <dt>No trains for now</dt>
      </div>
    </dl>
  );
}

// ---------------------------------------------------------------- a station

function PanelHead({ title, onClose, children }: { title: string; onClose: () => void; children?: ReactNode }) {
  return (
    <header className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-[20px] font-extrabold leading-tight tracking-tight text-ink">{title}</h2>
        {children}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:bg-surface-3">
        <X size={17} weight="bold" aria-hidden />
      </button>
    </header>
  );
}

export function KjTimes({ engine, line, stationId }: { engine: CrowdEngine; line: LineData; stationId: string }) {
  const now = useSimNow(10_000);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const rows = line.directions.map((d) => ({ d, deps: engine.departures(stationId, d.direction_id, now / 1000, disruptions, mult, 2) }))
    .filter((r) => r.deps.length > 0);
  if (!rows.length) return <p className="text-[13px] text-ink-3">No more trains from here today.</p>;
  return (
    <ul className="space-y-2">
      {rows.map(({ d, deps }) => (
        <li key={d.direction_id}>
          <p className="text-[12px] font-semibold text-ink-3">To {d.headsign}</p>
          <ul className="mt-1 space-y-1">
            {deps.map((dep) => {
              const m = minutesUntil(dep.departure, now);
              return (
                <li key={dep.run.trip.id} className="flex items-center gap-2">
                  <span className="num w-14 text-[14px] font-bold text-ink">{m <= 0 ? "Now" : `${m} min`}</span>
                  <CrowdTag loadPct={dep.loadPct} size="sm" />
                  {dep.delayS >= 120 && <span className="text-[11px] font-semibold text-serious">{Math.round(dep.delayS / 60)} min late</span>}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Frequency({ lineId }: { lineId: string }) {
  const { ix } = useNetwork();
  const now = useSimNow(30_000);
  const nl = ix?.line[lineId];
  if (!nl) return <p className="text-[12px] text-ink-3">Loading the timetable…</p>;
  return (
    <ul className="space-y-0.5 text-[13px] text-ink-2">
      {nl.directions.map((d) => {
        const h = netHeadway(nl, d.direction_id, now / 1000);
        return (
          <li key={d.direction_id} className="flex justify-between gap-2">
            <span className="truncate">To {d.headsign}</span>
            <span className="num shrink-0 font-semibold text-ink">{h ? `every ${Math.round(h / 60)} min` : "no trains now"}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Next trains at a KTM or ERL stop, from its timetable (TRAINS-04). */
function NetTimes({ lay, lineId, stationId }: { lay: Layout; lineId: string; stationId: string }) {
  const { net } = useSimNetwork();
  const now = useSimNow(15_000);
  const sl = net?.lines.find((l) => l.id === lineId);
  if (!sl) return <p className="text-[12px] text-ink-3">Loading the timetable…</p>;
  const k = sl.stops.findIndex((st) => stationFor(lay, lineId, st)?.id === stationId);
  const deps = k < 0 ? [] : departuresAt(sl, k, now / 1000, 12);
  const byHead = new Map<string, number[]>();
  for (const d of deps) {
    const list = byHead.get(d.headsign) ?? [];
    if (list.length < 3) byHead.set(d.headsign, [...list, d.at]);
  }
  if (!byHead.size) return <p className="text-[13px] text-ink-3">No more trains in the next three hours.</p>;
  return (
    <ul className="space-y-1 text-[13px] text-ink-2">
      {[...byHead].map(([head, times]) => (
        <li key={head} className="flex justify-between gap-2">
          <span className="truncate">To {head}</span>
          <span className="num shrink-0 font-semibold text-ink">{times.map((x) => {
            const m = minutesUntil(x, now);
            return m <= 0 ? "now" : m < 60 ? `${m} min` : klTime(x * 1000);
          }).join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

/** NETC-02: how full trains leaving here usually are at this time, per direction. */
function NetCrowdHere({ lay, lineId, stationId }: { lay: Layout; lineId: string; stationId: string }) {
  const { net } = useSimNetwork();
  const model = useNetCrowd();
  const now = useSimNow(60_000);
  const sl = net?.lines.find((l) => l.id === lineId);
  if (!sl || !model) return null;
  const k = sl.stops.findIndex((st) => stationFor(lay, lineId, st)?.id === stationId);
  const rows = k < 0 ? [] : leavingLoads(model, sl, k, now / 1000);
  if (!rows.length) return null;
  return (
    <ul className="mt-2 space-y-1.5 border-t border-rule pt-2 text-[13px] text-ink-2">
      {rows.map((r) => (
        <li key={r.headsign} className="flex items-center justify-between gap-2">
          <span className="truncate">Trains to {r.headsign}</span>
          <CrowdTag loadPct={r.load} size="sm" />
        </li>
      ))}
    </ul>
  );
}

function PlacePanel({ place, lay, engine, line, onClose, onPick }: {
  place: Place; lay: Layout; engine: CrowdEngine | null; line: LineData | null; onClose: () => void; onPick: (p: Place) => void;
}) {
  const home = useHome((s) => s.id);
  const setHome = useHome((s) => s.set);
  const kj = place.stations.find((s) => s.line.id === "KJ");
  const walks = linkedPlaces(lay, place);
  const codes = place.stations.filter((s) => !s.id.includes("-")); // Rapid Rail codes; KTM and ERL ids are AERA's own
  const askName = place.name;
  const netCrowd = useNetCrowd();
  return (
    <div>
      <PanelHead title={place.name} onClose={onClose}>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {lineOfPlace(place).map((l) => <LineBadge key={l.id} line={l} size={22} />)}
          {codes.map((s) => (
            <span key={s.id} className="num rounded-md px-1.5 py-0.5 text-[11px] font-bold"
              style={{ background: `var(${s.line.color})`, color: s.line.inkBadge ? "var(--ink)" : "#fff" }}>{s.id}</span>
          ))}
          {place.stations.length > 1 && <span className="text-[12px] font-semibold text-ink-3">Interchange</span>}
        </div>
      </PanelHead>

      <ul className="mt-4 space-y-3">
        {place.stations.map((s) => (
          <li key={s.id} className="rounded-2xl border border-rule p-3">
            <div className="flex items-center gap-2">
              <LineBadge line={s.line} size={22} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{s.line.name}</span>
              <DataChip data={s.line.data} />
            </div>
            <div className="mt-2">
              {s.line.id === "KJ" && engine && line ? (
                <KjTimes engine={engine} line={line} stationId={s.id} />
              ) : s.line.data === "suspended" ? (
                <p className="text-[12px] text-ink-3">KTMB suspended this service in February 2023, so no trains run.</p>
              ) : (
                <>
                  {codes.includes(s) ? <Frequency lineId={s.line.id} /> : <NetTimes lay={lay} lineId={s.line.id} stationId={s.id} />}
                  <NetCrowdHere lay={lay} lineId={s.line.id} stationId={s.id} />
                  <p className="mt-1.5 text-[11px] text-ink-3">
                    {s.line.data === "estimate" ? "Estimated from the operator's published frequency." : "From the published timetable."}{" "}
                    {hasCrowding(netCrowd, s.line.id) ? "Crowding is what trains usually carry at this hour, from gate data." : "No ridership data is published for this line, so no crowding."}
                  </p>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {walks.length > 0 && (
        <section className="mt-4">
          <h3 className="text-[13px] font-bold text-ink">Walk to</h3>
          <ul className="mt-1.5 space-y-1">
            {walks.map((w) => (
              <li key={w.key}>
                <button type="button" onClick={() => onPick(w)} className="pressable flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2">
                  <PersonSimpleWalk size={17} className="text-ink-3" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{w.name}</span>
                  <span className="flex gap-1">{lineOfPlace(w).map((l) => <LineBadge key={l.id} line={l} size={18} />)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {kj && (
          <>
            <Link href={`/?station=${kj.id}`} className="pressable flex items-center justify-center gap-1.5 rounded-full bg-accent px-3 py-2.5 text-[13px] font-bold text-white">
              <MapPin size={16} weight="fill" aria-hidden />Live map
            </Link>
            <Link href={`/trip?from=${kj.id}&to=${kj.id === "KJ15" ? "KJ10" : "KJ15"}`} className="pressable flex items-center justify-center gap-1.5 rounded-full border border-rule bg-white px-3 py-2.5 text-[13px] font-bold text-ink hover:bg-surface-2">
              <NavigationArrow size={16} weight="fill" aria-hidden />Plan a ride
            </Link>
            <button type="button" onClick={() => setHome(kj.id)} disabled={home === kj.id}
              className="pressable flex items-center justify-center gap-1.5 rounded-full border border-rule bg-white px-3 py-2.5 text-[13px] font-bold text-ink hover:bg-surface-2 disabled:opacity-60">
              <Star size={16} weight={home === kj.id ? "fill" : "regular"} aria-hidden />{home === kj.id ? "My station" : "Make my station"}
            </button>
          </>
        )}
        {codes.length > 0 && (
          <Link href={`/ask?q=${encodeURIComponent(`How do I get from ${lay.station[home]?.plain ?? "Taman Jaya"} to ${askName}?`)}`}
            className={`pressable flex items-center justify-center gap-1.5 rounded-full border border-rule bg-white px-3 py-2.5 text-[13px] font-bold text-accent hover:bg-accent-soft ${kj ? "" : "col-span-2"}`}>
            <ChatCircleDots size={16} weight="fill" aria-hidden />How do I get here?
          </Link>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a train

function TrainPanel({ tripId, engine, line, onClose }: { tripId: string; engine: CrowdEngine; line: LineData; onClose: () => void }) {
  const find = useCallback((f: typeof latest) => f.trains.find((t) => t.run.trip.id === tripId) ?? null, [tripId]);
  const [tr, setTr] = useState<LiveTrain | null>(() => find(latest));
  useEffect(() => {
    let last = 0;
    return subscribe((f) => {
      if (performance.now() - last < 1000) return;
      last = performance.now();
      setTr(find(f));
    });
  }, [find]);
  const names = useMemo(() => Object.fromEntries(line.stations.map((s) => [s.id, s.name])), [line]);
  if (!tr) {
    return (
      <div>
        <PanelHead title="Train" onClose={onClose} />
        <p className="mt-2 text-[14px] text-ink-2">This train has finished its trip.</p>
      </div>
    );
  }
  const dir = tr.run.trip.directionId;
  const d = line.directions.find((x) => x.direction_id === dir)!;
  const next = tr.state.nextIndex !== null ? d.stops[tr.state.nextIndex]?.station_id : null;
  const at = d.stops[tr.state.stopIndex]?.station_id;
  const where = tr.state.status === "moving" && next ? `Next: ${names[next]}` : `At ${names[at]}${tr.state.status === "held" ? " (held)" : ""}`;
  return (
    <div>
      <PanelHead title={`To ${d.headsign}`} onClose={onClose}>
        <p className="mt-0.5 text-[13px] text-ink-2">Kelana Jaya Line · {where}</p>
      </PanelHead>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <CrowdTag loadPct={tr.loadPct} size="lg" />
        <span className="text-[13px] text-ink-3">{pctText(tr.loadPct)}, predicted{tr.observed ? " and reported by riders" : ""}</span>
      </div>
      <div className="mt-3">
        <p className="mb-1 text-[12px] font-semibold text-ink-3">By car, front first</p>
        <CarDiagram cars={engine.carLoads(tr.loadPct, dir)} size="md" />
      </div>
      <Link href={`/?train=${encodeURIComponent(tripId)}`} className="pressable mt-4 flex items-center justify-center gap-1.5 rounded-full bg-accent px-3 py-2.5 text-[13px] font-bold text-white">
        <Crosshair size={16} weight="bold" aria-hidden />Follow on the live map
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------- page

function MapControls({ map, trainsOn, onTrains, vertical = true }: { map: React.RefObject<MapHandle | null>; trainsOn: boolean; onTrains: () => void; vertical?: boolean }) {
  const btn = `pressable flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:text-ink ${FLOAT}`;
  return (
    <div className={`flex gap-2 ${vertical ? "flex-col" : ""}`}>
      <button type="button" className={btn} aria-label="Zoom in" onClick={() => map.current?.zoom(1.6)}><Plus size={18} weight="bold" aria-hidden /></button>
      <button type="button" className={btn} aria-label="Zoom out" onClick={() => map.current?.zoom(1 / 1.6)}><Minus size={18} weight="bold" aria-hidden /></button>
      <button type="button" className={btn} aria-label="Show the whole map" onClick={() => map.current?.fit()}><ArrowsOut size={18} weight="bold" aria-hidden /></button>
      <button type="button" className={`${btn} ${trainsOn ? "!text-line" : ""}`} aria-pressed={trainsOn} aria-label="Live trains" onClick={onTrains}>
        <Train size={18} weight={trainsOn ? "fill" : "regular"} aria-hidden />
      </button>
    </div>
  );
}

export function NetworkView() {
  const lay = layout();
  const { line, engine } = useCrowd("KJ");
  const { net } = useSimNetwork();
  const wide = useMediaQuery("(min-width: 1024px)");
  const map = useRef<MapHandle>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [train, setTrain] = useState<string | null>(null);
  const [focusLine, setFocusLine] = useState<string | null>(null);
  const [trainsOn, setTrainsOn] = useState(true);
  const [sheetH, setSheetH] = useState(0);
  const restored = useRef(false);
  const [start, setStart] = useState<{ at: [number, number]; k: number } | null | undefined>(undefined);

  useEffect(() => {
    if (engine) attachEngine(engine);
  }, [engine]);

  // Restore the selection from the link, and choose the first view: the whole map on wide
  // screens, central Kuala Lumpur on phones (the whole poster is too small to read there).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const p = new URLSearchParams(window.location.search);
    const st = p.get("station");
    const ln = p.get("line");
    const tr = p.get("train");
    const place = st ? lay.placeOf[st] : null;
    if (place) setSelected(place.key);
    if (ln && lay.line[ln]) setFocusLine(ln);
    if (tr) setTrain(tr);
    const phone = !window.matchMedia("(min-width: 1024px)").matches;
    setStart(place ? { at: place.center, k: phone ? 2.2 : 2.6 } : phone ? { at: [372, 400], k: 1.45 } : null);
  }, [lay]);

  useEffect(() => {
    if (!restored.current) return;
    const place = selected ? lay.places.find((p) => p.key === selected) : null;
    const q = new URLSearchParams();
    if (place) q.set("station", place.stations[0].id);
    else if (train) q.set("train", train);
    if (focusLine) q.set("line", focusLine);
    const s = q.toString() ? `?${q}` : "";
    if (window.location.search !== s) window.history.replaceState(null, "", `${window.location.pathname}${s}`);
  }, [selected, train, focusLine, lay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "Escape" && !(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"))) {
        setSelected(null);
        setTrain(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = useCallback((p: Place) => {
    setTrain(null);
    setSelected(p.key);
    map.current?.focus(p.center);
  }, []);
  const onSelect = useCallback((key: string | null) => {
    setTrain(null);
    setSelected(key);
  }, []);
  const onTrain = useCallback((trip: string) => {
    setSelected(null);
    setTrain(trip);
  }, []);

  const place = selected ? lay.places.find((p) => p.key === selected) ?? null : null;
  const card = train && isNetTrain(train) ? (
    <NetTrainCard id={train} onClose={() => setTrain(null)} />
  ) : train && engine && line ? (
    <TrainPanel tripId={train} engine={engine} line={line} onClose={() => setTrain(null)} />
  ) : place ? (
    <PlacePanel place={place} lay={lay} engine={engine} line={line} onClose={() => setSelected(null)} onPick={pick} />
  ) : (
    <LinesPanel focusLine={focusLine} onFocus={setFocusLine} trainsOn={trainsOn} onTrains={setTrainsOn} />
  );
  const cardKey = train ? `t:${train}` : place ? `s:${place.key}` : "lines";
  const inset: Inset = wide ? { top: 16, left: 416, right: 72, bottom: 34 } : { top: 72, left: 8, right: 60, bottom: sheetH + 8 };

  return (
    <div className="fixed inset-x-0 top-16 bottom-[calc(70px+env(safe-area-inset-bottom))] overflow-hidden bg-[var(--net-paper)] lg:bottom-0">
      <h1 className="sr-only">Klang Valley rail network map</h1>
      {start !== undefined && (
        <NetworkMap ref={map} lay={lay} focusLine={focusLine} selected={selected} onSelect={onSelect} selectedTrain={train} onTrain={onTrain}
          engine={engine} line={line} net={net} showTrains={trainsOn} inset={inset} start={start} />
      )}

      {wide ? (
        <>
          <div className="pointer-events-none absolute bottom-4 left-4 top-4 z-10 flex w-[384px] flex-col gap-3">
            <div className="pointer-events-auto"><NetworkSearch lay={lay} onPick={pick} /></div>
            <section key={cardKey} aria-label="Details" className={`enter pointer-events-auto min-h-0 overflow-y-auto overscroll-contain rounded-[20px] p-4 ${FLOAT}`}>
              {card}
            </section>
          </div>
          <div className="absolute right-4 top-1/2 z-10 -translate-y-1/2">
            <MapControls map={map} trainsOn={trainsOn} onTrains={() => setTrainsOn(!trainsOn)} />
          </div>
          <p className="pointer-events-none absolute bottom-3 right-4 z-10 rounded-full bg-white/85 px-2.5 py-1 text-[10.5px] text-ink-3">
            Layout after the Klang Valley Integrated Transit Map (APAD, Rapid KL). Not an official map.
          </p>
        </>
      ) : (
        <>
          <div className="absolute inset-x-3 top-3 z-20"><NetworkSearch lay={lay} onPick={pick} /></div>
          <div className="absolute right-3 top-18 z-10"><MapControls map={map} trainsOn={trainsOn} onTrains={() => setTrainsOn(!trainsOn)} /></div>
          <Sheet peek={train ? 250 : place ? 300 : 210} label="Details" onHeight={setSheetH} resetKey={cardKey}>
            <div key={cardKey} className="enter">{card}</div>
          </Sheet>
        </>
      )}
    </div>
  );
}
