"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Simulation" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/settings", label: "Crowding levels" },
  { href: "/admin/audit", label: "Audit log" },
];

/** Admin sections (ADM-02 to ADM-05). */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Admin" className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
      <ul className="flex gap-1 overflow-x-auto rounded-full bg-surface-2 p-1">
        {TABS.map((t) => {
          const on = path === t.href;
          return (
            <li key={t.href} className="shrink-0">
              <Link href={t.href} aria-current={on ? "page" : undefined}
                className={`pressable block rounded-full px-4 py-2 text-[13px] font-semibold ${on ? "bg-white text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
