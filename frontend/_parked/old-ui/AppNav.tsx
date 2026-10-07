"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { useSession } from "@/lib/session";
import { IconAdmin, IconChart, IconConsole, IconInfo, IconLine, IconStation, IconUser } from "./Icons";

const HERO = "KJ20";

export function AppNav() {
  const path = usePathname();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const items = [
    { href: "/", label: "Line", icon: IconLine, show: true },
    { href: `/station/${HERO}`, label: "Station", icon: IconStation, show: true },
    { href: "/console", label: "Console", icon: IconConsole, show: !!user },
    { href: "/analytics", label: "Analytics", icon: IconChart, show: !!user },
    { href: "/admin", label: "Admin", icon: IconAdmin, show: user?.role === "admin" },
    { href: "/about", label: "About", icon: IconInfo, show: true },
  ].filter((i) => i.show);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <nav
      aria-label="Main"
      className="fixed left-0 top-0 z-40 flex w-full items-center gap-1 border-b border-subtle bg-panel/95 px-2 py-1.5 md:h-full md:w-[72px] md:flex-col md:border-b-0 md:border-r md:px-0 md:py-3"
    >
      <Link href="/" className="mr-2 flex items-center gap-2 px-2 md:mb-4 md:mr-0 md:flex-col md:gap-0.5 md:px-0" aria-label={`${BRAND.name} home`}>
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-cyan shadow-[0_0_12px_var(--brand-cyan)]" />
        <span className="text-sm font-bold tracking-[0.2em] text-ink">{BRAND.name}</span>
      </Link>
      <ul className="flex flex-1 items-center gap-0.5 overflow-x-auto md:w-full md:flex-col md:overflow-visible">
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href} className="md:w-full">
            <Link
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold md:mx-2 md:flex-col md:gap-1 md:px-0 md:py-2 ${
                active(href) ? "bg-raised text-cyan" : "text-muted hover:text-ink"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="md:mt-auto md:w-full">
        {user ? (
          <button
            type="button"
            onClick={signOut}
            title={`Signed in as ${user.email}`}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-ink md:mx-2 md:w-[56px] md:flex-col md:px-0"
          >
            <IconUser className="h-5 w-5" />
            <span>Sign out</span>
          </button>
        ) : (
          <Link href="/login" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-ink md:mx-2 md:flex-col md:px-0">
            <IconUser className="h-5 w-5" />
            <span>Staff</span>
          </Link>
        )}
      </div>
    </nav>
  );
}

/** Standard scrolling shell for console, admin and content pages. */
export function PageShell({ children, title, actions, wide = false }: {
  children: React.ReactNode; title: string; actions?: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="page-scroll">
      <AppNav />
      <main className={`px-4 pb-16 pt-16 md:pl-[96px] md:pr-8 md:pt-8 ${wide ? "" : "max-w-6xl"}`}>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{title}</h1>
          {actions}
        </header>
        {children}
      </main>
    </div>
  );
}
