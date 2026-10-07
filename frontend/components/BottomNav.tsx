"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isActive } from "./nav";

/** Mobile tab bar: top-level destinations only, icon and label, safe-area aware. */
export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-white/92 backdrop-blur-md lg:hidden">
      <ul className="mx-auto flex max-w-md">
        {NAV.map(({ href, label, icon: Icon }) => {
          const on = isActive(path, href);
          return (
            <li key={href} className="flex-1">
              <Link href={href} aria-current={on ? "page" : undefined} className="pressable flex flex-col items-center gap-1 pb-2 pt-2.5">
                <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${on ? "bg-accent-soft text-accent" : "text-ink-3"}`}>
                  <Icon size={22} weight={on ? "fill" : "regular"} aria-hidden />
                </span>
                <span className={`text-[11px] font-semibold ${on ? "text-accent" : "text-ink-3"}`}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
