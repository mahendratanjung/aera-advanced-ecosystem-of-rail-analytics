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

/**
 * The AERA mark ("Express", brand guideline v1.0): a white "A" with a light-blue bullet train
 * running through it as the crossbar, trailed by two speed lines. Geometry from brand/build.mjs.
 */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  const id = `aera-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const train = { fill: "var(--brand-train)" };
  return (
    <svg aria-hidden viewBox="0 0 64 64" className={`shrink-0 text-white ${className}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--brand-tile)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-tile-2)" }} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <rect x="8.5" y="31" width="7" height="2" rx="1" opacity=".7" style={train} />
      <rect x="5" y="35" width="9.5" height="2" rx="1" opacity=".4" style={train} />
      <path
        fillRule="evenodd"
        style={train}
        d="M17 31H41C49.25 31 54.8 33.8 56 38H17ZM40.4 32.54H45.5C48.5 32.54 50.9 33.66 52.1 34.64H40.4ZM25.4 32.6H28.8A.8.8 0 0 1 29.6 33.4V34A.8.8 0 0 1 28.8 34.8H25.4A.8.8 0 0 1 24.6 34V33.4A.8.8 0 0 1 25.4 32.6Z"
      />
      <path d="M12 48L24 15H31L43 48H36L27.5 24.63L19 48Z" fill="currentColor" />
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
