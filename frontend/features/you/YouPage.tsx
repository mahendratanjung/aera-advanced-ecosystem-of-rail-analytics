"use client";

/**
 * You (YOU-01 to YOU-05): everything personal, without an account. My station, saved rides,
 * location sharing, the welcome tour again, clearing this browser's data, and the pages that
 * do not fit in the phone tab bar (Busy times, Service status, About, staff sign in and the view switch).
 */

import {
  ArrowRight, ArrowsLeftRight, Broadcast, CaretRight, ChartBar, Clock, Gauge, Gear, Info, MapPin, MapTrifold, Pulse, SignIn, SignOut, Sparkle, Star, Trash,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Page, Section } from "@/components/Page";
import { ViewSwitch } from "@/components/ViewSwitch";
import { useShareStatus } from "@/lib/crowd/share";
import { ago } from "@/lib/format";
import { useHome } from "@/lib/home";
import { useLine, useNetwork } from "@/lib/hooks";
import { usePrefs } from "@/lib/prefs";
import { useSession } from "@/lib/session";
import { useChat } from "@/lib/assistant/chat";

function Row({ href, icon: Icon, title, note }: { href: string; icon: typeof Info; title: string; note?: string }) {
  return (
    <li>
      <Link href={href} className="pressable flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon size={18} weight="fill" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{title}</span>
          {note && <span className="block text-[12.5px] text-ink-3">{note}</span>}
        </span>
        <CaretRight size={16} className="text-ink-3" aria-hidden />
      </Link>
    </li>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-rule-strong"}`}>
      <span className={`absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-5.5" : "translate-x-0.5"}`} />
    </button>
  );
}

const SHARE_TEXT: Record<string, string> = {
  off: "Off. Nothing about your location leaves this phone.",
  waiting: "On. Waiting for your phone's location…",
  sharing: "On. Sending your position every 20 seconds while AERA is open.",
  denied: "Location permission was refused. Allow it in your browser settings, or switch this off.",
  unavailable: "This browser cannot share a location.",
  error: "On, but the last position could not be sent. AERA will keep trying.",
};

export function YouPage() {
  const router = useRouter();
  const { line } = useLine("KJ");
  const home = useHome((s) => s.id);
  const setHome = useHome((s) => s.set);
  const loadHome = useHome((s) => s.load);
  const { rides, toggleRide, share, setShare, reset, load } = usePrefs();
  const status = useShareStatus();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const clearChat = useChat((s) => s.clear);
  const [cleared, setCleared] = useState(false);

  useEffect(() => load(), [load]);
  useEffect(() => {
    if (line) loadHome(line.stations.map((s) => s.id));
  }, [line, loadHome]);

  const { ix } = useNetwork();
  const names: Record<string, string> = {
    ...(ix ? Object.fromEntries(Object.values(ix.stop).map((s) => [s.id, s.name])) : {}),
    ...Object.fromEntries((line?.stations ?? []).map((s) => [s.id, s.name])),
  };

  const clearAll = () => {
    reset();
    setHome("KJ20");
    clearChat();
    try {
      localStorage.removeItem("aera.home");
    } catch {}
    setCleared(true);
  };

  const staffSection = (
  <Section title="Staff">
    <ul className="card divide-y divide-rule overflow-hidden">
      {user ? (
        <>
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-ink">View</span>
              <span className="block text-[12.5px] text-ink-3">Rider: what passengers see. Operator: control room and analytics.</span>
            </span>
            <ViewSwitch />
          </li>
          <Row href="/control" icon={Gauge} title="Control room" note="Every train, disruption impact, extra trains, notices" />
          <Row href="/control/analytics" icon={ChartBar} title="Analytics" note="Every line now, the week, demand and method" />
          {user.role === "admin" && <Row href="/admin" icon={Gear} title="Admin" note="Simulation, users, crowding levels, audit log" />}
          <li>
            <button type="button" onClick={() => { signOut(); router.refresh(); }} className="pressable flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2"><SignOut size={18} aria-hidden /></span>
              <span className="flex-1 text-[15px] font-semibold text-ink">Sign out</span>
            </button>
          </li>
        </>
      ) : (
        <Row href="/login" icon={SignIn} title="Staff sign in" note="For Rapid KL operators and AERA admins" />
      )}
    </ul>
  </Section>
  );

  return (
    <Page title="You" eyebrow={user ? `Signed in as ${user.email}` : "No account needed"}
      intro="Your station, your rides and how you help AERA. Everything here stays in this browser.">
      {user && staffSection}

      <Section title="My station" note="Shown first on the live map, and used for quick questions to Ask AERA.">
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-highlight-soft text-highlight"><Star size={20} weight="fill" aria-hidden /></span>
          <label className="min-w-0 flex-1">
            <span className="sr-only">My station</span>
            <select value={home} onChange={(e) => setHome(e.target.value)} disabled={!line}
              className="h-11 w-full rounded-xl border border-rule bg-white px-3 text-[15px] font-semibold text-ink">
              {(line?.stations ?? [{ id: home, name: "Loading…" }]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <Link href={`/?station=${home}`} className="pressable flex h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-bold text-white">
            <MapPin size={16} weight="fill" aria-hidden />Open
          </Link>
        </div>
      </Section>

      <Section title="Saved rides" note="Save a ride from the planner with the star. Tap one to see its next trains and crowding.">
        {rides.length === 0 ? (
          <div className="card p-4 text-[14px] text-ink-2">
            No saved rides yet. <Link href="/trip" className="font-semibold text-accent">Plan a ride</Link> and tap <Star size={13} weight="fill" className="inline text-highlight" aria-label="the star" /> to keep it here.
          </div>
        ) : (
          <ul className="card divide-y divide-rule overflow-hidden">
            {rides.map((r) => (
              <li key={`${r.from}-${r.to}`} className="flex items-center gap-3 px-4 py-3">
                <ArrowsLeftRight size={18} className="shrink-0 text-ink-3" aria-hidden />
                <Link href={`/trip?from=${r.from}&to=${r.to}`} className="min-w-0 flex-1 text-[15px] font-semibold text-ink hover:text-accent">
                  {names[r.from] ?? r.from} <ArrowRight size={13} className="inline text-ink-3" aria-label="to" /> {names[r.to] ?? r.to}
                </Link>
                <button type="button" onClick={() => toggleRide(r)} aria-label={`Remove ${names[r.from] ?? r.from} to ${names[r.to] ?? r.to}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-critical">
                  <Trash size={17} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Help count crowding" note="AERA's crowding is a prediction. Riders who share their location while on a train let it check that prediction.">
        <div className="card p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-2-soft text-accent-2"><Broadcast size={20} weight="fill" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">Share my location while AERA is open</p>
              <p className="mt-0.5 text-[13px] text-ink-2" aria-live="polite">{SHARE_TEXT[status.state]}</p>
              {status.state === "sharing" && (
                <p className="mt-1 text-[12px] text-ink-3">
                  Last sent {ago(status.lastSent)}. {status.onTrain ? "You were matched to a Kelana Jaya train. Thank you." : "Not on a Kelana Jaya train right now."}
                </p>
              )}
            </div>
            <Switch on={share} onChange={setShare} label="Share my location while AERA is open" />
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[12.5px] text-ink-3">
            <li>Only a distance along the line is kept, for a few minutes. Your phone gets a new anonymous code every day.</li>
            <li>A train's count is shown only once several phones are on it, so no one can be singled out.</li>
            <li>Nothing is sent when AERA is in the background or closed.</li>
          </ul>
        </div>
      </Section>

      <Section title="More">
        <ul className="card divide-y divide-rule overflow-hidden">
          <Row href="/insights" icon={Clock} title="Busy times" note="When your ride is calmer, and how busy every line is now" />
          <Row href="/status" icon={Pulse} title="Service status" note="Every line, notices and what AERA can see" />
          <Row href="/network" icon={MapTrifold} title="Network map" note="All 13 Klang Valley rail lines" />
          <Row href="/about" icon={Info} title="About AERA" note="Data sources, privacy and the team" />
        </ul>
      </Section>

      {!user && staffSection}

      <Section title="This browser">
        <div className="flex flex-wrap gap-2">
          <Link href="/welcome" className="pressable inline-flex h-11 items-center gap-1.5 rounded-full border border-rule bg-white px-4 text-[14px] font-semibold text-ink hover:bg-surface-2">
            <Sparkle size={16} weight="fill" className="text-accent" aria-hidden />See the welcome again
          </Link>
          <button type="button" onClick={clearAll}
            className="pressable inline-flex h-11 items-center gap-1.5 rounded-full border border-critical/40 bg-white px-4 text-[14px] font-semibold text-critical hover:bg-critical/5">
            <Trash size={16} aria-hidden />Clear my AERA data
          </button>
        </div>
        {cleared && <p role="status" className="mt-2 text-[13px] text-ink-2">Cleared: my station, saved rides, location sharing and the chat.</p>}
      </Section>
    </Page>
  );
}
