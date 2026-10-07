"use client";

import { Gear } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { klDate, klTime } from "@/lib/format";
import { useSimNow } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useTwin } from "@/lib/store";
import { NAV, isActive } from "./nav";

export function Logo({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M4 17c3.5 0 4-10 8-10s4.5 10 8 10" />
        </svg>
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-highlight" />
      </span>
      {!markOnly && <span className="text-lg font-extrabold tracking-tight text-ink">{BRAND.name}</span>}
    </span>
  );
}

function SimClock() {
  const now = useSimNow(1000);
  const sim = useTwin((s) => s.sim);
  const status = useTwin((s) => s.status);
  if (!sim) return null;
  const live = sim.clock.speed === 1 && !sim.clock.paused && Math.abs(now - Date.now()) < 120_000;
  return (
    <span className="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5" title="Trains follow the timetable on a shared simulated clock">
      <span aria-hidden className={`h-2 w-2 rounded-full ${status === "live" ? "bg-good" : "bg-serious"} ${status === "live" ? "animate-pulse" : ""}`} />
      <span className="num text-[13px] font-semibold text-ink">{klTime(now)}</span>
      <span className="hidden text-xs text-ink-3 sm:inline">
        {klDate(now)}{!live && ` · ${sim.clock.paused ? "paused" : sim.clock.speed === 1 ? "simulated" : `${sim.clock.speed}× speed`}`}
      </span>
    </span>
  );
}

export function TopBar() {
  const path = usePathname();
  const user = useSession((s) => s.user);
  // The live map is full screen and floats its own controls (MAP-01).
  if (path === "/") return null;
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 items-center gap-6 px-4 lg:px-6">
        <Link href="/" aria-label={`${BRAND.name} home`}><Logo /></Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map(({ href, label, icon: Icon }) => {
            const on = isActive(path, href);
            return (
              <Link key={href} href={href} aria-current={on ? "page" : undefined}
                className={`pressable flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold ${on ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
                <Icon size={18} weight={on ? "fill" : "regular"} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <SimClock />
          {user?.role === "admin" ? (
            <Link href="/admin" aria-label="Simulation controls" className={`flex h-10 w-10 items-center justify-center rounded-full ${path.startsWith("/admin") ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2"}`}>
              <Gear size={20} aria-hidden />
            </Link>
          ) : (
            <Link href="/login" className="hidden rounded-full px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 sm:inline">Staff</Link>
          )}
        </div>
      </div>
    </header>
  );
}
