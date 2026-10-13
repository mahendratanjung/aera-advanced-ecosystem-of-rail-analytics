"use client";

import { UserCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { BRAND } from "@/lib/brand";
import { klDate, klTime } from "@/lib/format";
import { useSimNow } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useTwin } from "@/lib/store";
import { useView } from "@/lib/view";
import { activeHref, navFor } from "./nav";
import { ViewSwitch } from "./ViewSwitch";

/** The AERA mark: a white "A" with a light-blue bullet train running through it as the crossbar. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  const id = `aera-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tile = { fill: "var(--brand-tile-2)" };
  return (
    <svg aria-hidden viewBox="0 0 64 64" className={`shrink-0 text-white ${className}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--brand-tile)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-tile-2)" }} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <path d="M19 30.5h18.5c6.5 0 12.5 2.4 17 6.5H19z" style={{ fill: "var(--brand-train)" }} />
      <path d="M38.6 32.2h4.8c2.2.1 4.2.9 5.8 2.3H38.6z" style={tile} />
      <rect x="24.4" y="32.3" width="4.6" height="2.2" rx=".7" style={tile} />
      <path d="M13 46 23.5 17h7L41 46h-6.6L27 24.5 19.6 46z" fill="currentColor" />
    </svg>
  );
}

export function Logo({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark className="h-8 w-8 drop-shadow-sm" />
      {!markOnly && <span className="text-lg font-extrabold tracking-tight text-ink">{BRAND.name}</span>}
    </span>
  );
}

function SimClock({ dark = false }: { dark?: boolean }) {
  const now = useSimNow(1000);
  const sim = useTwin((s) => s.sim);
  const status = useTwin((s) => s.status);
  if (!sim) return null;
  const live = sim.clock.speed === 1 && !sim.clock.paused && Math.abs(now - Date.now()) < 120_000;
  return (
    <span className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${dark ? "bg-ops-2" : "bg-surface-2"}`} title="Trains follow the timetable on a shared simulated clock">
      <span aria-hidden className={`h-2 w-2 rounded-full ${status === "live" ? "bg-good" : "bg-serious"} ${status === "live" ? "animate-pulse" : ""}`} />
      <span className={`num text-[13px] font-semibold ${dark ? "text-ops-ink" : "text-ink"}`}>{klTime(now)}</span>
      <span className={`hidden text-xs sm:inline ${dark ? "text-ops-ink-2" : "text-ink-3"}`}>
        {klDate(now)}{!live && ` · ${sim.clock.paused ? "paused" : sim.clock.speed === 1 ? "simulated" : `${sim.clock.speed}× speed`}`}
      </span>
    </span>
  );
}

export function TopBar() {
  const path = usePathname();
  const user = useSession((s) => s.user);
  const view = useView();
  const ops = view === "operator";
  // The live map is full screen and floats its own controls (MAP-01); the welcome screen
  // has no chrome at all.
  if (path === "/" || path.startsWith("/welcome")) return null;
  const items = navFor(view, false, user?.role === "admin");
  const active = activeHref(path, items);
  return (
    <header className={`sticky top-0 z-40 border-b backdrop-blur-md ${ops ? "border-ops-2 bg-ops/95 text-ops-ink" : "border-rule bg-white/85"}`}>
      <div className="mx-auto flex h-14 items-center gap-4 px-4 lg:h-16 lg:gap-6 lg:px-6">
        <Link href={ops ? "/control" : "/"} aria-label={`${BRAND.name} home`} className="flex items-center gap-2">
          <Logo markOnly={ops} />
          {ops && <span className="text-lg font-extrabold tracking-tight">{BRAND.name}</span>}
          {ops && <span className="rounded-full bg-ops-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ops-ink-2">Operator</span>}
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {items.map(({ href, label, icon: Icon }) => {
            const on = href === active;
            const tone = ops
              ? on ? "bg-ops-2 text-ops-ink" : "text-ops-ink-2 hover:bg-ops-2/60 hover:text-ops-ink"
              : on ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink";
            return (
              <Link key={href} href={href} aria-current={on ? "page" : undefined}
                className={`pressable flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold ${tone}`}>
                <Icon size={18} weight={on ? "fill" : "regular"} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ViewSwitch dark={ops} className="hidden lg:flex" />
          <SimClock dark={ops} />
          <Link href="/me" aria-label={user ? `You, signed in as ${user.email}` : "You: your station, saved rides and settings"}
            aria-current={path.startsWith("/me") ? "page" : undefined}
            className={`hidden h-10 items-center gap-1.5 rounded-full pl-1.5 pr-3 text-sm font-semibold lg:flex ${ops ? "text-ops-ink-2 hover:bg-ops-2" : path.startsWith("/me") ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2"}`}>
            <UserCircle size={26} weight={path.startsWith("/me") ? "fill" : "regular"} aria-hidden />
            {user ? user.role === "admin" ? "Admin" : "Operator" : "You"}
          </Link>
        </div>
      </div>
    </header>
  );
}
