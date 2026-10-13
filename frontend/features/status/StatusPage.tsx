"use client";

/**
 * Service status (STAT-01 to STAT-03): one page that answers "is my line running?" for every
 * Klang Valley line. The Kelana Jaya Line shows its disruptions, operator notices and how
 * crowded its trains are now; other Rapid Rail lines show their timetable frequency and
 * hours; KTM and ERL say plainly that AERA has no data for them. The data sources section
 * says what is live and what is predicted (docs/LIVE_DATA.md).
 */

import { CheckCircle, Info, MapTrifold, Megaphone, Warning, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LineBadge } from "@/components/LineBadge";
import { Page, Section } from "@/components/Page";
import { Skeleton } from "@/components/States";
import { disruptionText } from "@/features/live/MapChrome";
import { netHeadway } from "@/lib/advisor/network";
import { attachEngine, subscribe } from "@/lib/crowd/feed";
import { CROWD } from "@/lib/crowd/levels";
import { ago, klDate, klTime } from "@/lib/format";
import { useCrowd, useNetwork, useSimNetwork, useSimNow } from "@/lib/hooks";
import { hoursOn, trainsAt } from "@/lib/network/trains";
import { LINES } from "@/lib/network/schematic";
import { NO_DISRUPTIONS, NO_NOTICES, useTwin } from "@/lib/store";

const hm = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;

type Tone = "good" | "warn" | "bad";
const TONE: Record<Tone, { icon: typeof CheckCircle; cls: string }> = {
  good: { icon: CheckCircle, cls: "text-good" },
  warn: { icon: Warning, cls: "text-serious" },
  bad: { icon: WarningOctagon, cls: "text-critical" },
};

function StatusLine({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const { icon: Icon, cls } = TONE[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink">
      <Icon size={18} weight="fill" className={cls} aria-hidden />{children}
    </span>
  );
}

function useTrainCounts() {
  const [c, setC] = useState<{ running: number; crowded: number } | null>(null);
  useEffect(() => {
    let last = 0;
    return subscribe((f) => {
      if (performance.now() - last < 2000) return;
      last = performance.now();
      setC({ running: f.trains.length, crowded: f.trains.filter((t) => t.loadPct >= CROWD[3].from).length });
    });
  }, []);
  return c;
}

function KelanaJaya() {
  const { line, engine } = useCrowd("KJ");
  const now = useSimNow(5000);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const notices = useTwin((s) => s.sim?.notices ?? NO_NOTICES);
  const counts = useTrainCounts();
  useEffect(() => {
    if (engine) attachEngine(engine);
  }, [engine]);
  const names = useMemo(() => Object.fromEntries((line?.stations ?? []).map((s) => [s.id, s.name])), [line]);
  const kj = LINES.find((l) => l.id === "KJ")!;
  if (!line) return <Skeleton className="h-40" />;

  const active = disruptions.filter((d) => d.start_ms <= now && (d.end_ms === null || d.end_ms > now) && d.kind !== "insert");
  const live = notices.filter((n) => n.start_ms <= now && (n.end_ms === null || n.end_ms > now));
  const tone: Tone = active.some((d) => d.kind === "suspend" || d.kind === "hold") ? "bad" : active.length ? "warn" : "good";
  const headline = tone === "bad" ? "Part of the line is not running" : tone === "warn" ? "Running with delays" : counts?.running === 0 ? "No trains now (outside service hours)" : "Good service";

  return (
    <article className="card-raised overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <LineBadge line={kj} size={34} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-extrabold text-ink">{kj.name}</h3>
          <StatusLine tone={tone}>{headline}</StatusLine>
          {counts && counts.running > 0 && (
            <p className="mt-1 text-[13px] text-ink-2">
              {counts.running} trains running, {counts.crowded === 0 ? "none" : counts.crowded} crowded or packed. Crowding is predicted.
            </p>
          )}
        </div>
      </div>
      {(active.length > 0 || live.length > 0) && (
        <ul className="space-y-2 border-t border-rule bg-surface-2/60 p-4">
          {active.map((d) => (
            <li key={d.id} className="flex gap-2 text-[14px] text-ink">
              <Warning size={17} weight="fill" className={`mt-0.5 shrink-0 ${d.kind === "suspend" || d.kind === "hold" ? "text-critical" : "text-serious"}`} aria-hidden />
              <span>
                {disruptionText(d, names)}
                {d.end_ms && <span className="text-ink-3"> · until {klTime(d.end_ms)}</span>}
              </span>
            </li>
          ))}
          {live.map((n) => (
            <li key={n.id} className="flex gap-2 text-[14px] text-ink">
              <Megaphone size={17} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>{n.text}<span className="text-ink-3"> · notice from Rapid KL</span></span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 border-t border-rule p-3">
        <Link href="/" className="pressable rounded-full bg-accent px-4 py-2 text-[13px] font-bold text-white">Live map</Link>
        <Link href="/network?line=KJ" className="pressable rounded-full border border-rule px-4 py-2 text-[13px] font-bold text-ink hover:bg-surface-2">On the network map</Link>
        {tone === "bad" && <Link href="/trip" className="pressable rounded-full border border-rule px-4 py-2 text-[13px] font-bold text-accent hover:bg-accent-soft">Other ways to travel</Link>}
      </div>
    </article>
  );
}

function OtherLines() {
  const { ix } = useNetwork();
  const { net } = useSimNetwork();
  const now = useSimNow(30_000);
  const t = now / 1000;
  return (
    <ul className="card divide-y divide-rule overflow-hidden">
      {LINES.filter((l) => l.id !== "KJ").map((l) => {
        const sl = net?.lines.find((x) => x.id === l.id);
        const nl = ix?.line[l.id];
        const headways = nl ? nl.directions.map((d) => netHeadway(nl, d.direction_id, t)).filter((h): h is number => h !== null) : [];
        const running = sl ? trainsAt(sl, t).length : null;
        const hours = sl ? hoursOn(sl, t) : null;
        const today = hours ? ` · today ${hm(hours[0])} to ${hm(hours[1])}` : "";
        const text = l.data === "suspended" ? (sl?.note ?? "Suspended: no trains run")
          : running === null ? "Loading the timetable…"
          : running === 0 ? `No trains now${today}`
          : `${running} trains running${headways.length ? `, every ${Math.round(Math.min(...headways) / 60)} min` : ""}${today}`;
        return (
          <li key={l.id} className="flex items-center gap-3 px-4 py-3">
            <LineBadge line={l} size={28} />
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold leading-snug text-ink">{l.name}</p>
              <p className="text-[12.5px] text-ink-3">{text}{l.data === "estimate" && running ? " (estimated)" : ""}</p>
            </div>
            {l.data === "suspended" ? (
              <span className="shrink-0 rounded-full bg-critical/5 px-2 py-0.5 text-[11px] font-semibold text-critical">Suspended</span>
            ) : running !== null && (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${running ? "bg-good/10 text-good" : "bg-surface-2 text-ink-3"}`}>
                {running ? "Running" : "Closed"}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Sources() {
  const status = useTwin((s) => s.status);
  const feed = useTwin((s) => s.liveFeed);
  const sim = useTwin((s) => s.sim);
  const rows: [string, string][] = [
    ["Twin service", status === "live" ? "Connected" : status === "connecting" ? "Connecting…" : "Not connected: times may be out of date"],
    ["Train positions", feed?.state === "live" ? `Live from the operator's feed (${feed.vehicles} trains)` : "Every line's timetable on a shared clock. Rapid Rail publishes no live train feed yet."],
    ["Live feed last checked", feed?.checked_ms ? ago(feed.checked_ms) : "not yet"],
    ["Crowding", "Predicted from data.gov.my ridership, blended with rider reports and train sensors when there are any"],
    ["Clock", !sim ? "…" : sim.clock.paused ? "Paused by an admin" : sim.clock.speed !== 1 ? `Running ${sim.clock.speed}× faster (demo)` : "Real Kuala Lumpur time"],
  ];
  return (
    <dl className="card divide-y divide-rule overflow-hidden">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr]">
          <dt className="text-[13px] font-semibold text-ink-3">{k}</dt>
          <dd className="text-[14px] text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusPage() {
  const now = useSimNow(30_000);
  return (
    <Page title="Service status" eyebrow={now ? `${klDate(now)}, ${klTime(now)}` : undefined}
      intro="Is my line running? The Kelana Jaya Line in full, and every other line in the Klang Valley."
      actions={<Link href="/network" className="pressable inline-flex h-10 items-center gap-1.5 rounded-full border border-rule bg-white px-4 text-[14px] font-semibold text-ink hover:bg-surface-2"><MapTrifold size={16} aria-hidden />Network map</Link>}>
      <Section title="Kelana Jaya Line"><KelanaJaya /></Section>
      <Section title="Other lines" note="From Rapid KL's and KTMB's published timetables; KLIA Ekspres and KLIA Transit are estimated. AERA does not see disruptions on these lines yet; check Rapid KL, KTM or ERL for them.">
        <OtherLines />
      </Section>
      <Section title="What AERA can see">
        <Sources />
        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-ink-3"><Info size={15} className="mt-0.5 shrink-0" aria-hidden />AERA is a decision aid. For official announcements, follow Rapid KL.</p>
      </Section>
    </Page>
  );
}
