"use client";

/**
 * Control room (ROLE-02 to ROLE-04, CTRL-01): the operator view's home. Line-wide figures, the
 * line at a glance with every train, what a disruption is doing to riders, the fullest trains,
 * an extra train with its predicted relief before it is sent, notices to riders, and how busy
 * the other lines are. Operators and admins only.
 */

import { ArrowRight, ChatCircleDots, CheckCircle, Info, Megaphone, Train, Trash, Warning } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { CrowdTag } from "@/components/Crowd";
import { Label, Select, Textarea } from "@/components/Field";
import { LineBadge } from "@/components/LineBadge";
import { Page, Section } from "@/components/Page";
import { ViewSwitch } from "@/components/ViewSwitch";
import { useLinesNow } from "@/features/insights/linesNow";
import { EmptyState, Skeleton } from "@/components/States";
import { blockText } from "@/features/advisor/RouteOptions";
import { blocksAt } from "@/lib/advisor/advisor";
import { api } from "@/lib/api";
import { pctText } from "@/lib/crowd/levels";
import type { CrowdEngine } from "@/lib/crowd/model";
import { klTime } from "@/lib/format";
import { useRequireRole } from "@/lib/guard";
import { useCrowd, useSimNow } from "@/lib/hooks";
import { NO_DISRUPTIONS, NO_NOTICES, useTwin } from "@/lib/store";
import type { Disruption, LineData } from "@/lib/types";
import { useUi } from "@/lib/ui";
import { type RunningTrain, lineAlerts } from "@/lib/control/alerts";
import { LineStrip } from "./LineStrip";

const LATE_S = 120;

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: "bad" | "warn" }) {
  const colour = tone === "bad" ? "var(--crowd-4-ink)" : tone === "warn" ? "var(--crowd-3-ink)" : "var(--ink)";
  return (
    <div className="card px-4 py-3">
      <p className="text-[12px] font-semibold text-ink-3">{label}</p>
      <p className="num mt-0.5 text-[28px] font-extrabold leading-none" style={{ color: colour }}>{value}</p>
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

function Impact({ engine, line, t }: { engine: CrowdEngine; line: LineData; t: number }) {
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const blocks = blocksAt(engine, disruptions, t);
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  if (!blocks.length) return <EmptyState title="Trains are running on the whole line" body="Disruptions show here with the riders they affect." />;
  return (
    <ul className="space-y-3">
      {blocks.map((b, i) => {
        const st = engine.data.stations;
        const since = (disruptions.find((d) => d.stop_id === b.stopId)?.start_ms ?? t * 1000) / 1000;
        // Riders waiting in this direction at the stations from the block's edge into it.
        const ids = st.slice(b.dir === 1 ? Math.max(0, b.lo - 1) : b.lo, b.dir === 1 ? b.hi : Math.min(st.length, b.hi + 2));
        const waiting = ids.reduce((sum, id) => sum + engine.waiting(id, b.dir, t, since, mult), 0);
        return (
          <li key={i} className="card p-4">
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
    <div className="card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
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
  const post = () => {
    setErr(null);
    api("/control/notices", { method: "POST", json: { text, severity, duration_min: duration } }).then(() => setText("")).catch((e) => setErr(e.message));
  };
  return (
    <div className="card p-4">
      <Label htmlFor="n-text">Message to riders</Label>
      <Textarea id="n-text" rows={2} maxLength={240} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Free shuttle buses run between Masjid Jamek and KLCC." />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="n-sev">Type</Label>
          <Select id="n-sev" value={severity} onChange={(e) => setSeverity(e.target.value as "info" | "warning")}><option value="info">Information</option><option value="warning">Warning</option></Select></div>
        <div><Label htmlFor="n-dur">Show for</Label>
          <Select id="n-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>{[15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}</Select></div>
        <div className="flex items-end"><Button variant="primary" onClick={post} disabled={text.trim().length < 3} className="w-full"><Megaphone size={16} weight="bold" aria-hidden />Publish</Button></div>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-critical">{err}</p>}
      {notices.length > 0 && (
        <ul className="mt-4 divide-y divide-rule border-t border-rule">
          {notices.map((n) => (
            <li key={n.id} className="flex items-start gap-3 py-2 text-[13px]">
              <span className="flex-1 text-ink-2"><strong className="text-ink">{n.severity === "warning" ? "Warning" : "Notice"}</strong> {n.text}
                <span className="block text-[11px] text-ink-3">{n.by}{n.end_ms ? ` · until ${klTime(n.end_ms)}` : ""}</span></span>
              <button type="button" aria-label="Remove notice" onClick={() => api(`/control/notices/${n.id}`, { method: "DELETE" }).catch((e) => setErr(e.message))}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2"><Trash size={15} aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** CTRL-02: what needs attention now, worst first, each with a way to the train. */
function NeedsAttention({ engine, line, trains, t }: { engine: CrowdEngine; line: LineData; trains: RunningTrain[]; t: number }) {
  const { rows } = useLinesNow(t);
  const selectTrain = useUi((s) => s.selectTrain);
  const others = useMemo(() => rows.filter((r) => r.def.id !== "KJ").map((r) => ({ name: r.def.name.replace(/ Line$/, ""), max: r.max, from: r.from, to: r.to })), [rows]);
  const alerts = useMemo(() => lineAlerts(engine, line, trains, others), [engine, line, trains, others]);
  if (!alerts.length) {
    return (
      <div className="flex items-center gap-3 rounded-card p-4" style={{ background: "var(--crowd-1-soft)", color: "var(--crowd-1-ink)" }}>
        <CheckCircle size={22} weight="fill" aria-hidden />
        <p className="text-[14px] font-semibold">All clear: no packed, held or bunched trains.</p>
      </div>
    );
  }
  const tone = { 3: "var(--status-critical)", 2: "var(--status-serious)", 1: "var(--ink-3)" } as const;
  return (
    <ul className="card divide-y divide-rule overflow-hidden" aria-live="polite">
      {alerts.slice(0, 6).map((a, i) => (
        <li key={`${a.kind}-${a.trip ?? a.title}-${i}`} className="flex items-start gap-3 px-4 py-3">
          {a.severity === 1 ? <Info size={20} className="mt-0.5 shrink-0" style={{ color: tone[1] }} aria-hidden />
            : <Warning size={20} weight="fill" className="mt-0.5 shrink-0" style={{ color: tone[a.severity] }} aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold text-ink">{a.title}</span>
            <span className="block text-[12.5px] text-ink-2">{a.detail}</span>
          </span>
          {a.trip && (
            <Link href={`/?train=${encodeURIComponent(a.trip)}`} onClick={() => selectTrain(a.trip!)}
              className="pressable shrink-0 rounded-full bg-accent-soft px-3 py-1.5 text-[12.5px] font-semibold text-accent">Show</Link>
          )}
        </li>
      ))}
      {alerts.length > 6 && <li className="px-4 py-2 text-[12px] text-ink-3">And {alerts.length - 6} more.</li>}
    </ul>
  );
}

/** NETC-03: the other lines' fullest trains now, with a way into Analytics. */
function OtherLines({ t }: { t: number }) {
  const { rows } = useLinesNow(t);
  const others = rows.filter((r) => r.def.id !== "KJ").slice(0, 5);
  if (!others.length) return <EmptyState title="Other lines are loading" />;
  return (
    <div className="card overflow-hidden">
      <ul className="divide-y divide-rule">
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
      <Link href="/control/analytics" className="flex items-center justify-between border-t border-rule px-4 py-2.5 text-[13px] font-semibold text-accent hover:bg-surface-2">
        Every line in Analytics <ArrowRight size={14} weight="bold" aria-hidden />
      </Link>
    </div>
  );
}

export function LineControl() {
  const { user, ready } = useRequireRole("operator");
  const { line, engine, error } = useCrowd("KJ");
  const now = useSimNow(5000);
  const t = now / 1000;
  const selectTrain = useUi((s) => s.selectTrain);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const trains = useMemo(() => (engine ? engine.live(t, disruptions, mult).sort((a, b) => b.loadPct - a.loadPct) : []), [engine, t, disruptions, mult]);
  if (!ready || !user) return <Page title="Control room"><p className="text-ink-2">Checking your session…</p></Page>;
  if (error) return <Page title="Control room"><EmptyState title="Line data is unavailable" body={error} /></Page>;
  if (!line || !engine) return <Page title="Control room"><Skeleton className="h-64" /></Page>;

  const lateOf = (tr: (typeof trains)[number]) => {
    const stops = line.directions.find((d) => d.direction_id === tr.state.directionId)!.stops;
    return tr.run.times[tr.state.stopIndex][0] - (tr.run.trip.start + stops[tr.state.stopIndex].arr);
  };
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  const crowded = trains.filter((x) => x.loadPct >= 75).length;
  const over = trains.filter((x) => x.loadPct >= 100).length;
  const late = trains.filter((x) => lateOf(x) > LATE_S).length;

  return (
    <Page wide title="Control room" eyebrow={`Operator view · ${user.display_name}`}
      intro={<>The Kelana Jaya Line at <span className="num font-semibold text-ink">{klTime(now)}</span>. Crowding is predicted from gate data and the timetable; use it to decide, not to count.</>}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitch className="lg:hidden" />
          <Link href="/?ask=1" className="pressable inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-4 py-2 text-[13px] font-semibold text-accent"><ChatCircleDots size={16} weight="fill" aria-hidden />Ask AERA</Link>
        </div>
      }>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Trains running" value={trains.length} />
        <Kpi label="Crowded or packed" value={crowded} tone={crowded ? "warn" : undefined} />
        <Kpi label="Over capacity" value={over} tone={over ? "bad" : undefined} />
        <Kpi label="Held" value={trains.filter((x) => x.state.status === "held").length} />
        <Kpi label="Late 2 min or more" value={late} tone={late ? "warn" : undefined} />
      </div>
      <Section title="Needs attention" note="Packed, held and bunched trains now and in the next few stops.">
        <NeedsAttention engine={engine} line={line} trains={trains} t={t} />
      </Section>
      <Section title="Line at a glance" note="Every train now, by crowding. Top: towards Gombak. Bottom: towards Putra Heights.">
        <LineStrip engine={engine} line={line} />
      </Section>
      <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
        <div>
          <Section title="Disruption impact"><Impact engine={engine} line={line} t={t} /></Section>
          <Section title="Send an extra train" note="See the predicted relief before you send it."><ExtraTrain engine={engine} line={line} t={t} /></Section>
          <Section title="Notices to riders" note="Shown on the map, in the planner and to the assistant, on every screen at once."><Notices /></Section>
        </div>
        <div>
          <Section title="Other lines now" note="Their fullest trains, from the typical week.">
            <OtherLines t={t} />
          </Section>
          <Section title="Fullest trains now">
            <ol className="card divide-y divide-rule overflow-hidden">
              {trains.slice(0, 10).map((tr) => {
                const d = line.directions.find((x) => x.direction_id === tr.state.directionId)!;
                const here = names[d.stops[tr.state.stopIndex]?.station_id];
                const lateS = lateOf(tr);
                return (
                  <li key={tr.run.trip.id}>
                    <Link href={`/?train=${encodeURIComponent(tr.run.trip.id)}`} onClick={() => selectTrain(tr.run.trip.id)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold text-ink">To {d.headsign}{tr.run.trip.id.includes("-x") ? " · extra" : ""}</span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {tr.state.status === "held" ? `Held at ${here}` : tr.state.status === "dwelling" ? `At ${here}` : `Leaving ${here}`}
                          {lateS > LATE_S ? ` · ${Math.round(lateS / 60)} min late` : ""}
                        </span>
                      </span>
                      <CrowdTag loadPct={tr.loadPct} size="sm" showPct />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Section>
        </div>
      </div>
    </Page>
  );
}
