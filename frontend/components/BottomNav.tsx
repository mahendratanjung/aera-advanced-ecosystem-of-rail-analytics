"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useView } from "@/lib/view";
import { activeHref, navFor } from "./nav";

/**
 * Mobile tab bar: top-level destinations only, icon and label, safe-area aware. Riders get
 * Live, Network, Plan, Ask and You; the operator view swaps in Control, Map and Analytics and
 * turns navy, so staff can tell the two views apart at a glance (VIEW-02).
 */
export function BottomNav() {
  const path = usePathname();
  const view = useView();
  if (path.startsWith("/welcome")) return null;
  const ops = view === "operator";
  const items = navFor(view, true);
  const active = activeHref(path, items);
  return (
    <nav aria-label="Main" className={`safe-bottom fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-md lg:hidden ${ops ? "border-ops-2 bg-ops/95" : "border-rule bg-white/92"}`}>
      <ul className="mx-auto flex max-w-md">
        {items.map(({ href, label, icon: Icon }) => {
          const on = href === active;
          const pill = ops ? (on ? "bg-ops-2 text-ops-ink" : "text-ops-ink-2") : on ? "bg-accent-soft text-accent" : "text-ink-3";
          const text = ops ? (on ? "text-ops-ink" : "text-ops-ink-2") : on ? "text-accent" : "text-ink-3";
          return (
            <li key={href} className="flex-1">
              <Link href={href} aria-current={on ? "page" : undefined} className="pressable flex flex-col items-center gap-1 pb-2 pt-2.5">
                <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${pill}`}>
                  <Icon size={22} weight={on ? "fill" : "regular"} aria-hidden />
                </span>
                <span className={`text-[11px] font-semibold ${text}`}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
