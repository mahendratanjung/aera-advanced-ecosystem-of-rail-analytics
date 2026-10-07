"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageShell } from "@/components/AppNav";
import { useRequireRole } from "@/lib/guard";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/scenarios", label: "Scenario director" },
  { href: "/admin/devices", label: "Devices" },
  { href: "/admin/settings", label: "Settings and users" },
];

export function AdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { user, ready } = useRequireRole("admin");
  const path = usePathname();
  if (!ready || !user) return <div className="p-8 text-muted">Checking your session…</div>;
  if (user.role !== "admin") return <PageShell title="Admin"><p className="text-muted">This area is for admins only.</p></PageShell>;
  return (
    <PageShell title={title}>
      <nav aria-label="Admin sections" className="mb-6 flex flex-wrap gap-1 border-b border-subtle">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${path === t.href ? "border-cyan text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </PageShell>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "bad" | "ok" }) {
  return (
    <div className="panel p-4">
      <p className="eyebrow">{label}</p>
      <p className={`tabular mt-1 text-3xl font-medium ${tone === "bad" ? "text-lvl-crowded" : tone === "ok" ? "text-lvl-low" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
