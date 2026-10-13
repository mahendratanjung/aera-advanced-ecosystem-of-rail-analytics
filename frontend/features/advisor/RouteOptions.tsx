"use client";

/**
 * Route options from the advisor (ROUTE-02): each option leads with when you arrive, then its
 * legs as a small timeline. Used by the ride planner and by the assistant.
 */

import { Bus, Hourglass, PersonSimpleWalk, Warning } from "@phosphor-icons/react/dist/ssr";
import { CrowdTag } from "@/components/Crowd";
import type { Advice, Block, Leg, RouteOption } from "@/lib/advisor/advisor";
import { klTime } from "@/lib/format";

const mins = (s: number) => Math.max(1, Math.round(s / 60));

function LegRow({ leg }: { leg: Leg }) {
  const span = `${klTime(leg.depart * 1000)}–${klTime(leg.arrive * 1000)}`;
  if (leg.kind === "walk") {
    const same = leg.fromName === leg.toName;
    return (
      <li className="flex items-start gap-3 py-1.5 text-[13px] text-ink-2">
        <span className="flex w-6 justify-center pt-0.5"><PersonSimpleWalk size={15} aria-hidden /></span>
        <span>{same ? `Change at ${leg.fromName}` : `Walk from ${leg.fromName} to ${leg.toName}`}, about {mins(leg.arrive - leg.depart)} min</span>
      </li>
    );
  }
  if (leg.kind === "road") {
    return (
      <li className="flex items-start gap-3 py-1.5 text-[13px] text-ink-2">
        <span className="flex w-6 justify-center pt-0.5"><Bus size={15} aria-hidden /></span>
        <span>Bus or e-hailing from <strong className="font-semibold text-ink">{leg.fromName}</strong> to <strong className="font-semibold text-ink">{leg.toName}</strong>, about {mins(leg.arrive - leg.depart)} min</span>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-3 py-1.5">
      <span className="flex w-6 justify-center pt-1">
        <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: leg.color ?? "var(--ink-3)" }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink">
          {leg.lineName} <span className="font-normal text-ink-3">towards {leg.headsign}</span>
        </span>
        <span className="block text-[13px] text-ink-2">
          {leg.fromName} → {leg.toName} · <span className="num">{leg.estimate ? `about ${mins(leg.arrive - leg.depart)} min` : span}</span>
          {leg.stops ? <> · {leg.stops} {leg.stops === 1 ? "stop" : "stops"}</> : null}
        </span>
        <span className="mt-1 block">
          {typeof leg.crowd === "number" ? <CrowdTag loadPct={leg.crowd} size="sm" /> : <span className="text-[11px] text-ink-3">No ridership data for this line</span>}
        </span>
      </span>
    </li>
  );
}

export function RouteOptionCard({ o, best, now }: { o: RouteOption; best?: boolean; now: number }) {
  const estimate = o.legs.some((l) => l.estimate);
  const Icon = o.kind === "wait" ? Hourglass : o.kind === "road" ? Bus : null;
  return (
    <li className={`card overflow-hidden ${best ? "border-2 border-highlight/40" : ""}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            {Icon && <Icon size={15} weight="bold" aria-hidden className="text-ink-3" />}
            {o.title}
            {best && <span className="rounded-full bg-highlight px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Fastest</span>}
          </p>
          <p className="mt-1 text-[13px] text-ink-2">
            Arrive <span className="num text-xl font-extrabold text-ink">{estimate ? "~" : ""}{klTime(o.arrive * 1000)}</span>
            <span className="ml-1.5">· {mins(o.arrive - now)} min from now</span>
          </p>
        </div>
        {o.peak !== null && <CrowdTag loadPct={o.peak} size="sm" />}
      </div>
      <ol className="px-4 pb-2 pt-1.5">
        {o.legs.map((l, i) => <LegRow key={i} leg={l} />)}
      </ol>
      {o.note && <p className="border-t border-rule bg-surface-2 px-4 py-2 text-xs text-ink-3">{o.note}</p>}
    </li>
  );
}

export function blockText(b: Block, names: Record<string, string>): string {
  const where = b.toStopId && b.toStopId !== b.stopId
    ? `between ${names[b.stopId] ?? b.stopId} and ${names[b.toStopId] ?? b.toStopId}`
    : `at ${names[b.stopId] ?? b.stopId}`;
  const what = b.kind === "suspend" ? `No trains ${where}` : `A train is held ${where}`;
  return b.until === null ? `${what}, with no time given for trains to run again.` : `${what} until about ${klTime(b.until * 1000)}.`;
}

/** The disruption in one line, then every way round it, fastest first. */
export function OtherWays({ advice, names, now }: { advice: Advice; names: Record<string, string>; now: number }) {
  if (!advice.block || !advice.options.length) return null;
  const fastest = advice.options[0];
  return (
    <section aria-label="Other ways to travel" className="mt-5">
      <div className="mb-3 flex gap-3 rounded-2xl p-3.5 text-[13px] leading-snug" style={{ background: "var(--highlight-soft)", color: "var(--crowd-3-ink)" }}>
        <Warning size={20} weight="fill" className="mt-[1px] shrink-0" aria-hidden />
        <span>
          <span className="font-bold">Your ride is disrupted</span>
          <span className="block opacity-90">{blockText(advice.block, names)} Here are other ways to get there.</span>
        </span>
      </div>
      <ol className="space-y-3">
        {advice.options.map((o) => <RouteOptionCard key={o.id} o={o} best={o === fastest && advice.options.length > 1} now={now} />)}
      </ol>
      <p className="mt-2 text-xs text-ink-3">Times on other lines, walks and roads are estimates from the timetable. Crowding on other lines is what their trains usually carry at this hour.</p>
    </section>
  );
}
