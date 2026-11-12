"use client";

/**
 * Operations (OPS-01..10, revision 6): one simple screen for staff. A header with the service
 * state; six figures; every train now on a dark control-room panel (the hero); the next two
 * hours under it; and on the right what to do: needs attention (disruption impact and alerts to
 * acknowledge), notices to riders, and an extra train with its predicted relief. A Trends tab
 * holds the other lines and the charts behind the predictions; a shift summary copies the state
 * for handover. Operators and admins only; admin settings stay on their own pages.
 */

import { ArrowRight, ArrowSquareOut, ChatCircleDots, Check, CheckCircle, ClipboardText, Crosshair, Info, Megaphone, Train, Trash, Warning } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { CrowdTag } from "@/components/Crowd";
import { Label, Select, Textarea } from "@/components/Field";
import { LineBadge } from "@/components/LineBadge";
import { Page } from "@/components/Page";
import { Trends } from "@/features/insights/Analytics";
import { disruptionText } from "@/features/live/MapChrome";
import { useLinesNow } from "@/features/insights/linesNow";
import { EmptyState, Skeleton } from "@/components/States";
import { blockText } from "@/features/advisor/RouteOptions";
import { blocksAt } from "@/lib/advisor/advisor";
import { api } from "@/lib/api";
import { CROWD, crowdOf, crowdVar, pctText } from "@/lib/crowd/levels";
import type { CrowdEngine } from "@/lib/crowd/model";
import { klDate, klTime } from "@/lib/format";
import { useRequireRole } from "@/lib/guard";
import { useCrowd, useMediaQuery, useSimNow } from "@/lib/hooks";
import { NO_DISRUPTIONS, NO_NOTICES, useTwin } from "@/lib/store";
import type { Disruption, LineData } from "@/lib/types";
import { useUi } from "@/lib/ui";
import { type Alert, type RunningTrain, lineAlerts } from "@/lib/control/alerts";
import { LineStrip } from "./LineStrip";

const LATE_S = 120;

function Kpi({ label, value, tone, note }: { label: string; value: number | string; tone?: "bad" | "warn"; note?: string }) {
  const colour = tone === "bad" ? "var(--crowd-4-ink)" : tone === "warn" ? "var(--crowd-3-ink)" : "var(--ink)";
  return (
    <div className="card px-3 py-2.5 sm:px-4 sm:py-3">
      <p className="text-[11.5px] font-semibold leading-tight text-ink-3 sm:text-[12px]">{label}</p>
      <p className="num mt-1 text-[22px] font-extrabold leading-none sm:text-[28px]" style={{ color: colour }}>{value}</p>
      {note && <p className="mt-1 text-[10.5px] text-ink-3 sm:text-[11px]">{note}</p>}
    </div>
  );
}

/**
 * What an extra train does: the scheduled train behind it carries fewer riders, because they
 * share the wait with the extra one. Compares that train's busiest stretch with and without it.
 */
function relief(engine: CrowdEngine, dir: number, t: number, inMin: number, disruptions: Disruption[], mult: number) {
  const at = t + inMin * 60;
  const extra: Disruption = { id: "preview", kind: "insert", stop_id: engine.line.direction(dir).stops[0].station_id, to_stop_id: null,
    direction_id: dir, delay_s: 0, multiplier: 1, start_ms: at * 1000, end_ms: null, note: "" };
  const without = engine.runs(dir, at - 60, at + 3600, disruptions, mult);
  const next = without.find((r) => r.trip.start >= at && !r.trip.id.includes("-x"));
  if (!next) return null;
  const withIt = engine.runs(dir, at - 60, at + 3600, [...disruptions, extra], mult);
  const after = withIt.find((r) => r.trip.id === next.trip.id);
  const own = withIt.find((r) => r.trip.id.includes(`-x${Math.floor(at)}`));
  return { before: Math.max(...next.legs), after: after ? Math.max(...after.legs) : Math.max(...next.legs),
    own: own ? Math.max(...own.legs) : null, departs: next.trip.start };
}

function Impact({ engine, line, t, quiet = false }: { engine: CrowdEngine; line: LineData; t: number; quiet?: boolean }) {
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const blocks = blocksAt(engine, disruptions, t);
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  if (!blocks.length) return quiet ? null : <EmptyState title="Trains are running on the whole line" body="Disruptions show here with the riders they affect." />;
  return (
    <ul className="space-y-3">
      {blocks.map((b, i) => {
        const st = engine.data.stations;
        const since = (disruptions.find((d) => d.stop_id === b.stopId)?.start_ms ?? t * 1000) / 1000;
        // Riders waiting in this direction at the stations from the block's edge into it.
        const ids = st.slice(b.dir === 1 ? Math.max(0, b.lo - 1) : b.lo, b.dir === 1 ? b.hi : Math.min(st.length, b.hi + 2));
        const waiting = ids.reduce((sum, id) => sum + engine.waiting(id, b.dir, t, since, mult), 0);
        return (
          <li key={i} className="rounded-2xl p-4" style={{ background: "var(--crowd-4-soft)" }}>
            <p className="flex items-start gap-2 text-[14px] font-bold text-ink">
              <Warning size={18} weight="fill" className="mt-px shrink-0 text-critical" aria-hidden />
              {blockText(b, names)}
            </p>
            <p className="mt-1 text-[13px] text-ink-2">Towards {engine.line.direction(b.dir).headsign}. Stations affected: {ids.map((id) => names[id]).join(", ")}.</p>
            <p className="mt-2 text-[13px] text-ink-2">About <strong className="num text-ink">{waiting.toLocaleString("en-GB")}</strong> riders are likely waiting on those platforms (estimate).</p>
            <Link href={`/trip?from=${ids[0]}&to=${ids[ids.length - 1]}`} className="mt-2 inline-block text-[13px] font-semibold text-accent hover:underline">See the other ways riders are offered →</Link>
          </li>
        );
      })}
    </ul>
  );
}

function ExtraTrain({ engine, line, t }: { engine: CrowdEngine; line: LineData; t: number }) {
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const [dir, setDir] = useState(0);
  const [inMin, setInMin] = useState(5);
  const [msg, setMsg] = useState<string | null>(null);
  const r = useMemo(() => relief(engine, dir, Math.floor(t / 30) * 30, inMin, disruptions, mult), [engine, dir, t, inMin, disruptions, mult]);
  const extras = disruptions.filter((d) => d.kind === "insert" && d.start_ms / 1000 > t - 2 * 3600);
  const send = () => {
    setMsg(null);
    api("/control/trains", { method: "POST", json: { direction_id: dir, in_min: inMin } })
      .then(() => setMsg(`Extra train sent towards ${line.directions.find((d) => d.direction_id === dir)?.headsign}.`))
      .catch((e) => setMsg(e.message));
  };
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="x-dir">Towards</Label>
          <Select id="x-dir" value={dir} onChange={(e) => setDir(Number(e.target.value))}>
            {line.directions.map((d) => <option key={d.direction_id} value={d.direction_id}>{d.headsign} (from {line.stations.find((s) => s.id === d.stops[0].station_id)?.name})</option>)}
          </Select></div>
        <div><Label htmlFor="x-in">Leaves in</Label>
          <Select id="x-in" value={inMin} onChange={(e) => setInMin(Number(e.target.value))}>
            {[0, 5, 10, 15, 20].map((m) => <option key={m} value={m}>{m === 0 ? "Now" : `${m} min`}</option>)}
          </Select></div>
      </div>
      <div className="mt-4 rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">
        {!r ? <p>No scheduled train follows in the next hour.</p> : (
          <>
            <p className="font-semibold text-ink">Predicted effect</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-2">
              The <span className="num">{klTime(r.departs * 1000)}</span> train behind it, at its busiest: <CrowdTag loadPct={r.before} size="sm" showPct />
              → <CrowdTag loadPct={r.after} size="sm" showPct />
            </p>
            {r.own !== null && <p className="mt-1 flex flex-wrap items-center gap-2">The extra train itself: <CrowdTag loadPct={r.own} size="sm" showPct /></p>}
            <p className="mt-1 text-xs text-ink-3">
              {r.after < r.before - 3 ? `Riders spread over one more train, so it drops from ${pctText(r.before)} to ${pctText(r.after)}.` : "Little change: trains are not full enough here for an extra one to help."}
            </p>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={send}><Train size={16} weight="bold" aria-hidden />Send extra train</Button>
        {msg && <p role="status" className="text-[13px] text-ink-2">{msg}</p>}
      </div>
      {extras.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-ink-3">
          {extras.map((d) => <li key={d.id}>Extra train towards {engine.line.direction(d.direction_id ?? 0).headsign}, leaves {klTime(d.start_ms)}</li>)}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-3">A what-if in the twin: the extra train runs the timetable from the terminal and shares the riders waiting with the train behind it.</p>
    </div>
  );
}

function Notices() {
  const notices = useTwin((s) => s.sim?.notices ?? NO_NOTICES);
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState<"info" | "warning">("info");
  const [duration, setDuration] = useState(60);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const post = () => {
    setErr(null);
    setBusy(true);
    api("/control/notices", { method: "POST", json: { text, severity, duration_min: duration } })
      .then(() => setText("")).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  };
  return (
    <div>
      {notices.length > 0 ? (
        <ul className="mb-3 space-y-2">
          {notices.map((n) => (
            <li key={n.id} className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[13px]"
              style={{ background: n.severity === "warning" ? "var(--highlight-soft)" : "var(--accent-soft)" }}>
              <Megaphone size={16} weight="fill" className="mt-0.5 shrink-0" style={{ color: n.severity === "warning" ? "var(--crowd-3-ink)" : "var(--accent)" }} aria-hidden />
              <span className="min-w-0 flex-1 text-ink">{n.text}
                <span className="block text-[11px] text-ink-3">{n.severity === "warning" ? "Warning" : "Information"} · {n.by}{n.end_ms ? ` · Until ${klTime(n.end_ms)}` : ""}</span></span>
              <button type="button" aria-label="Remove notice" onClick={() => api(`/control/notices/${n.id}`, { method: "DELETE" }).catch((e) => setErr(e.message))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-white/70"><Trash size={14} aria-hidden /></button>
            </li>
          ))}
        </ul>
      ) : <p className="mb-3 text-[13px] text-ink-3">No notices are showing to riders.</p>}
      <label htmlFor="n-text" className="sr-only">Message to riders</label>
      <Textarea id="n-text" rows={2} maxLength={240} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a notice, e.g. Free shuttle buses between Masjid Jamek and KLCC." />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="n-sev" className="sr-only">Type</label>
        <select id="n-sev" value={severity} onChange={(e) => setSeverity(e.target.value as "info" | "warning")}
          className="h-9 rounded-full border border-rule bg-white px-3 text-[13px] font-semibold text-ink-2"><option value="info">Information</option><option value="warning">Warning</option></select>
        <label htmlFor="n-dur" className="sr-only">Show for</label>
        <select id="n-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}
          className="h-9 rounded-full border border-rule bg-white px-3 text-[13px] font-semibold text-ink-2">{[15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}</select>
        <Button variant="primary" size="sm" onClick={post} disabled={text.trim().length < 3 || busy} className="ml-auto"><Megaphone size={15} weight="bold" aria-hidden />Publish</Button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-critical">{err}</p>}
      <p className="mt-2 text-[11.5px] text-ink-3">Shown on the map, in the planner and to Ask AERA, on every rider&apos;s screen at once.</p>
    </div>
  );
}

const ACK_KEY = "aera.acked";
const alertKey = (a: Alert) => `${a.kind}:${a.trip ?? a.title}`;

/** OPS-03: alerts a controller has seen, kept for this shift (this browser tab). */
function useAcked() {
  const [acked, setAcked] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setAcked(new Set(JSON.parse(sessionStorage.getItem(ACK_KEY) ?? "[]")));
    } catch {}
  }, []);
  const toggle = (k: string) => setAcked((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    try {
      sessionStorage.setItem(ACK_KEY, JSON.stringify([...next]));
    } catch {}
    return next;
  });
  return { acked, toggle };
}

/** CTRL-02, OPS-03: what needs attention now, worst first, each with a way to the train and an acknowledge. */
function NeedsAttention({ alerts, incident = false }: { alerts: Alert[]; incident?: boolean }) {
  const selectTrain = useUi((s) => s.selectTrain);
  const { acked, toggle } = useAcked();
  const [showAcked, setShowAcked] = useState(false);
  if (!alerts.length) {
    // With an incident on the line, "all clear" would contradict the card above it.
    if (incident) return null;
    return (
      <div className="flex items-center gap-3 rounded-card p-4" style={{ background: "var(--crowd-1-soft)", color: "var(--crowd-1-ink)" }}>
        <CheckCircle size={22} weight="fill" aria-hidden />
        <p className="text-[14px] font-semibold">All clear: no packed, held or bunched trains.</p>
      </div>
    );
  }
  const open = alerts.filter((a) => !acked.has(alertKey(a)));
  const seen = alerts.filter((a) => acked.has(alertKey(a)));
  const tone = { 3: "var(--status-critical)", 2: "var(--status-serious)", 1: "var(--ink-3)" } as const;
  const row = (a: Alert, i: number, done: boolean) => (
    <li key={`${alertKey(a)}-${i}`} className={`flex items-start gap-2.5 px-3 py-2.5 ${done ? "opacity-60" : ""}`}>
      {a.severity === 1 ? <Info size={20} className="mt-0.5 shrink-0" style={{ color: tone[1] }} aria-hidden />
        : <Warning size={20} weight="fill" className="mt-0.5 shrink-0" style={{ color: tone[a.severity] }} aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-bold leading-snug text-ink">{a.title}</span>
        <span className="block text-[12px] leading-snug text-ink-2">{a.detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {a.trip && (
          <Link href={`/?train=${encodeURIComponent(a.trip)}`} onClick={() => selectTrain(a.trip!)} aria-label="Show this train on the map" title="Show on the map"
            className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent"><Crosshair size={15} weight="bold" aria-hidden /></Link>
        )}
        <button type="button" onClick={() => toggle(alertKey(a))} aria-pressed={done} aria-label={done ? "Mark as not seen" : "Acknowledge"} title={done ? "Seen" : "Acknowledge"}
          className={`pressable flex h-8 w-8 items-center justify-center rounded-full border ${done ? "border-transparent bg-surface-2 text-good" : "border-rule bg-white text-ink-2 hover:bg-surface-2"}`}>
          <Check size={15} weight="bold" aria-hidden />
        </button>
      </span>
    </li>
  );
  return (
    <div className="overflow-hidden rounded-xl border border-rule">
      {open.length ? (
        <ul className="divide-y divide-rule" aria-live="polite">
          {open.slice(0, 8).map((a, i) => row(a, i, false))}
          {open.length > 8 && <li className="px-4 py-2 text-[12px] text-ink-3">And {open.length - 8} more.</li>}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-4 py-3 text-[14px] font-semibold" style={{ color: "var(--crowd-1-ink)" }}>
          <CheckCircle size={20} weight="fill" aria-hidden />Every alert acknowledged.
        </p>
      )}
      {seen.length > 0 && (
        <div className="border-t border-rule">
          <button type="button" onClick={() => setShowAcked(!showAcked)} aria-expanded={showAcked}
            className="w-full px-4 py-2 text-left text-[12.5px] font-semibold text-ink-3 hover:bg-surface-2">
            {showAcked ? "Hide" : "Show"} {seen.length} acknowledged
          </button>
          {showAcked && <ul className="divide-y divide-rule border-t border-rule">{seen.map((a, i) => row(a, i, true))}</ul>}
        </div>
      )}
    </div>
  );
}

/** NETC-03: the other lines' fullest trains now, with a way into Analytics. */
function OtherLines({ t }: { t: number }) {
  const { rows } = useLinesNow(t);
  const others = rows.filter((r) => r.def.id !== "KJ").slice(0, 5);
  if (!others.length) return <EmptyState title="Other lines are loading" />;
  return (
    <div className="-mx-4 -mb-4 sm:-mx-5 sm:-mb-5">
      <ul className="divide-y divide-rule border-t border-rule">
        {others.map((r) => (
          <li key={r.def.id} className="flex items-center gap-3 px-4 py-2.5">
            <LineBadge line={r.def} size={26} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold text-ink">{r.def.name.replace(/ Line$/, "")}</span>
              <span className="block truncate text-[11.5px] text-ink-3">{r.from} → {r.to}</span>
            </span>
            <CrowdTag loadPct={r.max} size="sm" showPct />
          </li>
        ))}
      </ul>
      <Link href="/network" className="flex items-center justify-between border-t border-rule px-4 py-2.5 text-[13px] font-semibold text-accent hover:bg-surface-2 sm:px-5">
        Network map <ArrowRight size={14} weight="bold" aria-hidden />
      </Link>
    </div>
  );
}


// ---------------------------------------------------------------- next two hours (OPS-05)

interface Slot {
  t: number;
  crowded: number;
  running: number;
  worst: { load: number; from: string; to: string; dir: number } | null;
}

const STEP_MIN = 10;
const SLOTS = 13; // now to two hours ahead

/** Trains crowded or packed every ten minutes for two hours, and the fullest one in each slot. */
function forecast(engine: CrowdEngine, line: LineData, t: number, disruptions: Disruption[], mult: number): Slot[] {
  return Array.from({ length: SLOTS }, (_, i) => {
    const at = t + i * STEP_MIN * 60;
    const trains = engine.live(at, disruptions, mult);
    let worst: Slot["worst"] = null;
    for (const tr of trains) {
      if (worst && tr.loadPct <= worst.load) continue;
      const dir = tr.state.directionId;
      const stops = line.directions.find((d) => d.direction_id === dir)!.stops;
      const k = Math.min(tr.state.stopIndex, stops.length - 2);
      worst = { load: tr.loadPct, from: stops[k].station_id, to: stops[k + 1].station_id, dir };
    }
    return { t: at, crowded: trains.filter((x) => x.loadPct >= CROWD[3].from).length, running: trains.length, worst };
  });
}

function Forecast({ slots, names }: { slots: Slot[]; names: Record<string, string> }) {
  const load = (x: Slot) => x.worst?.load ?? 0;
  const peak = slots.reduce((a, b) => (load(b) > load(a) ? b : a), slots[0]);
  const top = Math.max(110, ...slots.map(load));
  const y = (pct: number) => `${(Math.min(pct, top) / top) * 100}%`;
  const trains = (n: number) => `${n} train${n === 1 ? "" : "s"}`;
  const later = peak.t > slots[0].t;
  return (
    <div>
      <p className="text-[14px] font-bold text-ink">
        {!peak.running ? "No trains in the next two hours."
          : <>Fullest at <span className="num">{later ? klTime(peak.t * 1000) : "now"}</span>: {names[peak.worst!.from]} → {names[peak.worst!.to]}{" "}
            <CrowdTag loadPct={load(peak)} size="sm" showPct className="align-middle" /></>}
      </p>
      <p className="mt-0.5 text-[12.5px] text-ink-3">
        {peak.crowded ? `${trains(peak.crowded)} crowded or packed then.` : "No train expected to be crowded."}
      </p>
      <div role="img" aria-label={slots.map((x) => `${klTime(x.t * 1000)}: fullest train ${Math.round(load(x))}%, ${trains(x.crowded)} crowded`).join("; ")}
        className="relative mt-3 h-28">
        {/* The Crowded line */}
        <div aria-hidden className="absolute inset-x-0 border-t border-dashed" style={{ bottom: y(CROWD[3].from), borderColor: "var(--crowd-4)" }}>
          <span className="absolute -top-4 right-0 text-[10px] font-bold" style={{ color: "var(--crowd-4-ink)" }}>Crowded</span>
        </div>
        <div aria-hidden className="absolute inset-0 flex items-end gap-1 sm:gap-1.5">
          {slots.map((x) => (
            <div key={x.t} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className={`w-full rounded-t-md ${x === peak ? "ring-2 ring-ink ring-offset-1" : ""}`}
                style={{ height: y(Math.max(4, load(x))), background: x.worst ? crowdVar(crowdOf(load(x)).level) : "var(--surface-3)" }} />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="mt-1.5 flex gap-1 sm:gap-1.5">
        {slots.map((x, i) => (
          <span key={x.t} className={`num min-w-0 flex-1 text-center text-[10px] ${i % 3 === 0 ? "text-ink-3" : "text-transparent"}`}>{i === 0 ? "Now" : klTime(x.t * 1000)}</span>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Each bar: the fullest train in that 10 minutes, predicted from the timetable, gate data and the disruptions in force now.</p>
    </div>
  );
}

function shiftSummary(o: { now: number; line: LineData; trains: RunningTrain[]; alerts: Alert[]; slots: Slot[]; disruptions: Disruption[]; notices: { text: string }[]; late: number; user: string }): string {
  const names = Object.fromEntries(o.line.stations.map((s) => [s.id, s.name]));
  const active = o.disruptions.filter((d) => d.kind !== "insert" && d.start_ms <= o.now && (d.end_ms === null || d.end_ms > o.now));
  const extras = o.disruptions.filter((d) => d.kind === "insert");
  const peak = o.slots.reduce((a, b) => ((b.worst?.load ?? 0) > (a.worst?.load ?? 0) ? b : a), o.slots[0]);
  const crowded = o.trains.filter((x) => x.loadPct >= 75).length;
  return [
    `AERA shift summary · Kelana Jaya Line · ${klDate(o.now)} ${klTime(o.now)} · ${o.user}`,
    `Service: ${active.length ? active.map((d) => disruptionText(d, names)).join("; ") : "good service"}.`,
    `Trains running ${o.trains.length}; crowded or packed ${crowded}; over capacity ${o.trains.filter((x) => x.loadPct >= 100).length}; held ${o.trains.filter((x) => x.state.status === "held").length}; late 2 min or more ${o.late}.`,
    o.alerts.length ? `Needs attention:\n${o.alerts.slice(0, 5).map((a) => `- ${a.title}`).join("\n")}` : "Needs attention: none.",
    peak?.worst ? `Next 2 hours: fullest at ${klTime(peak.t * 1000)}, ${names[peak.worst.from]} to ${names[peak.worst.to]} (${crowdOf(peak.worst.load).name}); ${peak.crowded} trains crowded or packed then.` : "Next 2 hours: no trains.",
    o.notices.length ? `Notices live: ${o.notices.map((n) => n.text).join(" | ")}` : "Notices live: none.",
    `Extra trains sent this session: ${extras.length}.`,
    "Crowding is predicted from gate data and the timetable (AERA digital twin).",
  ].join("\n");
}

function CopySummary({ text }: { text: () => string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={done ? "Shift summary copied" : "Copy shift summary"} title="Copy a shift summary for handover" onClick={() => {
      navigator.clipboard?.writeText(text()).then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }).catch(() => {});
    }}
      className="pressable flex h-10 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-ink shadow-sm hover:bg-surface-2 sm:px-4">
      {done ? <Check size={16} weight="bold" aria-hidden /> : <ClipboardText size={16} aria-hidden />}<span className="hidden sm:inline">{done ? "Copied" : "Shift summary"}</span>
    </button>
  );
}

// ---------------------------------------------------------------- page

function Panel({ title, note, action, children, className = "" }: { title: string; note?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`card p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold tracking-tight text-ink">{title}</h2>
          {note && <p className="mt-0.5 text-[12.5px] text-ink-3">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "bad" | "warn" }) {
  const colour = tone === "bad" ? "var(--crowd-4-ink)" : tone === "warn" ? "var(--crowd-3-ink)" : "var(--ink)";
  return (
    <div className="min-w-0 px-3 py-3 sm:px-5">
      <p className="text-[11.5px] font-semibold leading-tight text-ink-3">{label}</p>
      <p className="num mt-1 text-[24px] font-extrabold leading-none tracking-tight sm:text-[28px]" style={{ color: colour }}>{value}</p>
    </div>
  );
}

/** OPS-10: the hero. Every train on the line now, on a dark control-room panel. */
function EveryTrain({ engine, line, trains }: { engine: CrowdEngine; line: LineData; trains: RunningTrain[] }) {
  const counts = CROWD.map((c) => trains.filter((x) => crowdOf(x.loadPct).level === c.level).length);
  return (
    <section aria-label="Every train now" className="overflow-hidden rounded-card text-white shadow-card" style={{ background: "linear-gradient(160deg, var(--ops-2) 0%, var(--ops) 65%)" }}>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <h2 className="text-[15px] font-extrabold tracking-tight">Every train now</h2>
          <p className="text-[12.5px] text-white/65"><span className="num">{trains.length}</span> running · Tap a train to follow it on the map</p>
        </div>
        <ul aria-label="Trains by crowding" className="flex flex-wrap gap-1.5">
          {CROWD.map((c, i) => (
            <li key={c.level} className={`flex items-center gap-1.5 rounded-full bg-white/10 py-1 pl-1.5 pr-2.5 text-[12px] font-semibold ${counts[i] ? "" : "opacity-45"}`}>
              <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: crowdVar(c.level) }} />{c.name}<span className="num font-extrabold">{counts[i]}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="px-1 pb-1 pt-2 sm:px-3"><LineStrip engine={engine} line={line} bare /></div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 px-4 py-2.5 text-[11.5px] text-white/60 sm:px-5">
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-critical" />Held</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-serious" />Late 2 min+</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-2 w-4 rounded-sm" style={{ background: "repeating-linear-gradient(45deg, var(--status-critical) 0 2px, transparent 2px 4px)" }} />Not running</span>
        <Link href="/" className="ml-auto flex items-center gap-1 font-semibold text-white/85 hover:text-white"><ArrowSquareOut size={14} aria-hidden />Live map</Link>
      </p>
    </section>
  );
}

export function LineControl() {
  const { user, ready } = useRequireRole("operator");
  const { line, engine, error } = useCrowd("KJ");
  const now = useSimNow(5000);
  const t = now / 1000;
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const notices = useTwin((s) => s.sim?.notices ?? NO_NOTICES);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const [tab, setTab] = useState<"now" | "trends">("now");
  const wide = useMediaQuery("(min-width: 1024px)");
  useEffect(() => {
    if (window.location.hash === "#trends") setTab("trends");
  }, []);
  const trains = useMemo(() => (engine ? engine.live(t, disruptions, mult).sort((a, b) => b.loadPct - a.loadPct) : []), [engine, t, disruptions, mult]);
  const minute = Math.floor(t / 60) * 60;
  const slots = useMemo(() => (engine && line ? forecast(engine, line, minute, disruptions, mult) : []), [engine, line, minute, disruptions, mult]);
  const { rows } = useLinesNow(t);
  const others = useMemo(() => rows.filter((r) => r.def.id !== "KJ").map((r) => ({ name: r.def.name.replace(/ Line$/, ""), max: r.max, from: r.from, to: r.to })), [rows]);
  const alerts = useMemo(() => (engine && line ? lineAlerts(engine, line, trains, others) : []), [engine, line, trains, others]);

  const frame = (body: React.ReactNode) => <div className="min-h-dvh bg-[var(--ops-soft)]"><Page wide title="Operations">{body}</Page></div>;
  if (!ready || !user) return frame(<p className="text-ink-2">Checking your session…</p>);
  if (error) return frame(<EmptyState title="Line data is unavailable" body={error} />);
  if (!line || !engine) return frame(<Skeleton className="h-64" />);

  const lateOf = (tr: (typeof trains)[number]) => {
    const stops = line.directions.find((d) => d.direction_id === tr.state.directionId)!.stops;
    return tr.run.times[tr.state.stopIndex][0] - (tr.run.trip.start + stops[tr.state.stopIndex].arr);
  };
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  const crowded = trains.filter((x) => x.loadPct >= 75).length;
  const over = trains.filter((x) => x.loadPct >= 100).length;
  const late = trains.filter((x) => lateOf(x) > LATE_S).length;
  const held = trains.filter((x) => x.state.status === "held").length;
  const onBoard = Math.round(trains.reduce((sum, x) => sum + (Math.min(x.loadPct, 130) / 100) * engine.capacity, 0));
  const active = disruptions.filter((d) => d.kind !== "insert" && d.start_ms <= now && (d.end_ms === null || d.end_ms > now));
  const broken = active.some((d) => d.kind === "suspend" || d.kind === "hold");
  const service = !active.length ? { text: "Good service", dot: "var(--status-good)" }
    : broken ? { text: "Part of the line not running", dot: "var(--status-critical)" } : { text: "Delays", dot: "var(--status-serious)" };
  const open = alerts.filter((a) => a.severity >= 2).length;
  const needs = (
    <Panel title="Needs attention" note={open ? `${open} to act on or watch` : "Packed, held, late or bunched trains"}>
      <div className="space-y-3">
        <Impact engine={engine} line={line} t={t} quiet />
        <NeedsAttention alerts={alerts} incident={blocksAt(engine, disruptions, t).length > 0} />
      </div>
    </Panel>
  );

  return (
    <div className="min-h-dvh bg-[var(--ops-soft)]">
      <main className="enter mx-auto max-w-[1360px] px-4 pb-16 pt-4 sm:px-6 lg:pt-6">
        {/* Header: where, when, how the line is, and the two views of this page */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <p className="text-[12.5px] font-semibold text-ink-3">Kelana Jaya Line · <span className="num">{klDate(now)}, {klTime(now)}</span></p>
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[24px] font-extrabold leading-tight tracking-tight text-ink sm:text-[28px]">
              Operations
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[13px] font-bold shadow-sm">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: service.dot }} />{service.text}
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div role="tablist" aria-label="Operations view" className="flex flex-1 rounded-full bg-white p-1 shadow-sm sm:flex-none">
              {(["now", "trends"] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
                  className={`pressable flex-1 rounded-full px-4 py-1.5 text-[13px] font-bold sm:flex-none ${tab === v ? "bg-ops text-white" : "text-ink-3 hover:text-ink"}`}>
                  {v === "now" ? "Now" : "Trends"}
                </button>
              ))}
            </div>
            <CopySummary text={() => shiftSummary({ now, line, trains, alerts, slots, disruptions, notices, late, user: user.display_name })} />
            <Link href="/?ask=1" aria-label="Ask AERA" className="pressable flex h-10 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[13px] font-semibold text-white sm:px-4">
              <ChatCircleDots size={17} weight="fill" aria-hidden /><span className="hidden sm:inline">Ask AERA</span>
            </Link>
          </div>
        </header>

        {tab === "trends" ? (
          <div className="mt-5 space-y-6">
            <Panel title="Other lines now" note="Their fullest trains, from the typical week. AERA does not see their disruptions."><OtherLines t={t} /></Panel>
            <Trends />
          </div>
        ) : (
          <>
            {/* Figures */}
            <div className="card mt-4 grid grid-cols-3 divide-x divide-y divide-rule overflow-hidden sm:grid-cols-6 sm:divide-y-0">
              <Stat label="Trains running" value={trains.length} />
              <Stat label="Riders on trains" value={onBoard >= 1000 ? `${(onBoard / 1000).toFixed(1)}k` : onBoard} />
              <Stat label="Crowded or packed" value={crowded} tone={crowded ? "warn" : undefined} />
              <Stat label="Over capacity" value={over} tone={over ? "bad" : undefined} />
              <Stat label="Held" value={held} tone={held ? "bad" : undefined} />
              <Stat label="Late 2+ min" value={late} tone={late ? "warn" : undefined} />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
              {/* Left: the line */}
              <div className="flex min-w-0 flex-col gap-4">
                {/* Phones read top to bottom, so what needs doing comes first. */}
                {!wide && needs}
                <EveryTrain engine={engine} line={line} trains={trains} />
                <Panel title="Next 2 hours" note="How full the fullest train gets, so extra trains and staff are in place before the peak.">
                  {slots.length ? <Forecast slots={slots} names={names} /> : <Skeleton className="h-32" />}
                </Panel>
              </div>

              {/* Right: what to do */}
              <div className="flex min-w-0 flex-col gap-4">
                {wide && needs}
                <Panel title="Notices to riders"><Notices /></Panel>
                <details className="card group p-4 sm:p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                    <span>
                      <span className="block text-[15px] font-extrabold tracking-tight text-ink">Send an extra train</span>
                      <span className="block text-[12.5px] text-ink-3">See the predicted relief first</span>
                    </span>
                    <Train size={20} weight="fill" className="shrink-0 text-accent transition-transform group-open:rotate-12" aria-hidden />
                  </summary>
                  <div className="mt-3"><ExtraTrain engine={engine} line={line} t={t} /></div>
                </details>
              </div>
            </div>
            {user.role === "admin" && (
              <p className="mt-6 text-[13px] text-ink-2">Simulation, users, crowding levels and the audit log are on the <Link href="/admin" className="font-semibold text-accent hover:underline">Admin</Link> pages.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
