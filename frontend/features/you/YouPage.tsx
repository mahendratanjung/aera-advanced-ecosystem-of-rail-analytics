"use client";

/**
 * You (YOU-01 to YOU-05): everything personal, without an account. My station, saved rides,
 * location sharing, the welcome tour again, clearing this browser's data, and the pages that
 * do not fit in the phone tab bar (About, staff sign in and the view switch). Reached from the avatar at the top.
 */

import {
  ArrowRight, ArrowsLeftRight, Broadcast, CaretRight, ChatCircleDots, Gauge, Gear, Info, MapPin, MapTrifold, NavigationArrow, SignIn, SignOut, Star, Trash, UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
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
      <Link href={href} className="pressable flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon size={18} weight="fill" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{title}</span>
          {note && <span className="block text-[13px] text-ink-3">{note}</span>}
        </span>
        <CaretRight size={16} className="text-ink-3" aria-hidden />
      </Link>
    </li>
  );
}

/** A settings group: a small heading over one card of rows, as in phone settings. */
function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mb-7" aria-label={title}>
      <h2 className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-3">{title}</h2>
      <ul className="card divide-y divide-rule overflow-hidden">{children}</ul>
      {note && <p className="mt-2 px-1 text-[12.5px] leading-relaxed text-ink-3">{note}</p>}
    </section>
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
  off: "Off. Your location is not shared with AERA.",
  waiting: "On. Waiting for your device's location…",
  sharing: "On. An anonymous position is sent every 20 seconds while AERA is open.",
  denied: "Location access is blocked. Allow it in your browser settings, or turn this off.",
  unavailable: "This browser does not support location sharing.",
  // A failed send is retried quietly; the rider sees the normal "on" text (user request).
  error: "On. An anonymous position is sent every 20 seconds while AERA is open.",
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
    <Group title="Staff">
      {user ? (
        <>
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-ink">View</span>
              <span className="block text-[13px] text-ink-3">Rider shows the passenger app; Operator shows Operations and the staff map.</span>
            </span>
            <ViewSwitch />
          </li>
          <Row href="/control" icon={Gauge} title="Operations" note="Alerts, every train, actions, forecast and trends" />
          {user.role === "admin" && <Row href="/admin" icon={Gear} title="Administration" note="Simulation, users, crowding levels and audit log" />}
          <li>
            <button type="button" onClick={() => { signOut(); router.push("/"); }} className="pressable flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-ink-2"><SignOut size={18} aria-hidden /></span>
              <span className="flex-1 text-[15px] font-semibold text-ink">Sign out</span>
            </button>
          </li>
        </>
      ) : (
        <Row href="/login" icon={SignIn} title="Staff sign in" note="For line operators and administrators" />
      )}
    </Group>
  );

  return (
    <main className="enter mx-auto max-w-2xl px-4 pb-16 pt-6 sm:px-6 lg:pt-10">
      <header className="mb-8 flex items-center gap-4">
        <span aria-hidden className="hero-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-full">
          {user ? <span className="text-[20px] font-extrabold">{user.display_name?.[0] ?? "S"}</span> : <UserCircle size={30} weight="fill" />}
        </span>
        <div className="min-w-0">
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-ink sm:text-[30px]">{user ? user.display_name : "Your settings"}</h1>
          <p className="text-[14px] leading-snug text-ink-3 [overflow-wrap:anywhere]">{user ? `${user.email} · ${user.role === "admin" ? "Administrator" : "Operator"}` : "No account needed. Settings are saved in this browser."}</p>
        </div>
      </header>

      {user && staffSection}

      <Group title="Preferences">
        <li className="px-4 py-3.5">
          <label htmlFor="home-station" className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-highlight-soft text-highlight"><Star size={18} weight="fill" aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-ink">My station</span>
              <span className="block text-[13px] text-ink-3">Shown first on the live map and used by Ask AERA</span>
            </span>
          </label>
          <div className="mt-3 flex gap-2 sm:pl-12">
            <select id="home-station" value={home} onChange={(e) => setHome(e.target.value)} disabled={!line}
              className="h-11 min-w-0 flex-1 rounded-xl border border-rule-strong bg-white px-3 text-[15px] font-semibold text-ink focus:border-accent focus:outline-none">
              {(line?.stations ?? [{ id: home, name: "Loading…" }]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Link href={`/?station=${home}`} className="pressable flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 text-[14px] font-bold text-white hover:brightness-110">
              <MapPin size={16} weight="fill" aria-hidden />View
            </Link>
          </div>
        </li>
      </Group>

      <Group title="Saved journeys" note="Save a journey in the planner with the star to see its next trains and crowding here.">
        {rides.length === 0 ? (
          <li className="flex items-center gap-3 px-4 py-4 text-[14px] text-ink-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-3"><Star size={18} aria-hidden /></span>
            <span className="flex-1">No saved journeys yet.</span>
            <Link href="/trip" className="text-[14px] font-semibold text-accent hover:underline">Plan a journey</Link>
          </li>
        ) : rides.map((r) => (
          <li key={`${r.from}-${r.to}`} className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><ArrowsLeftRight size={18} aria-hidden /></span>
            <Link href={`/trip?from=${r.from}&to=${r.to}`} className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink hover:text-accent">
              {names[r.from] ?? r.from} <ArrowRight size={13} className="inline text-ink-3" aria-label="to" /> {names[r.to] ?? r.to}
            </Link>
            <button type="button" onClick={() => toggleRide(r)} aria-label={`Remove ${names[r.from] ?? r.from} to ${names[r.to] ?? r.to}`}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-critical">
              <Trash size={17} aria-hidden />
            </button>
          </li>
        ))}
      </Group>

      <Group title="Privacy and data">
        <li className="px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-2-soft text-accent-2"><Broadcast size={18} weight="fill" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">Contribute crowding data</p>
              <p className="mt-0.5 text-[13px] text-ink-3" aria-live="polite">{SHARE_TEXT[status.state]}</p>
              {status.state === "sharing" && (
                <p className="mt-1 text-[12.5px] text-ink-3">
                  Last sent {ago(status.lastSent)}. {status.onTrain ? "Matched to a Kelana Jaya Line train. Thank you." : "Not on a Kelana Jaya Line train right now."}
                </p>
              )}
            </div>
            <Switch on={share} onChange={setShare} label="Contribute crowding data" />
          </div>
          <details className="group mt-2 sm:pl-12">
            <summary className="cursor-pointer list-none text-[13px] font-semibold text-accent hover:underline">How your data is protected</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-2">
              <li>Only your distance along the line is kept, for a few minutes, under an anonymous code that changes every day.</li>
              <li>A train&apos;s reported crowding is shown only when several riders are on it, so no one can be identified.</li>
              <li>Nothing is sent while AERA is in the background or closed.</li>
            </ul>
          </details>
        </li>
        <li>
          <button type="button" onClick={clearAll} className="pressable flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-critical/5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-critical/10 text-critical"><Trash size={18} aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-critical">Clear data on this device</span>
              <span className="block text-[13px] text-ink-3">{cleared ? "Cleared. Settings, saved journeys and chat history were removed." : "My station, saved journeys, sharing and chat history"}</span>
            </span>
          </button>
        </li>
      </Group>

      {!user && staffSection}

      <Group title="More">
        <Row href="/trip" icon={NavigationArrow} title="Plan a journey" note="The next trains and the least crowded one to board" />
        <Row href="/ask" icon={ChatCircleDots} title="Ask AERA" note="Questions about trains, crowding and routes" />
        <Row href="/network" icon={MapTrifold} title="Network map" note="All 13 Klang Valley rail lines" />
      </Group>

    </main>
  );
}
