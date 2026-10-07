"use client";

import { Warning, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { useTwin } from "@/lib/store";

/** Service notices from disruptions, in plain language. */
export function ServiceNotices() {
  const alerts = useTwin((s) => s.alerts);
  const open = Object.values(alerts)
    .filter((a) => a.state !== "resolved" && a.type === "disruption" && (a.message || a.public_message))
    .sort((a, b) => b.started_at_ms - a.started_at_ms);
  if (!open.length) return null;
  return (
    <ul className="space-y-2" aria-label="Service notices">
      {open.map((a) => {
        const high = a.severity === "high";
        const Icon = high ? Warning : WarningCircle;
        return (
          <li key={a.id} className="flex gap-3 rounded-2xl p-3.5 text-[13px] leading-snug"
            style={{ background: high ? "#fef2f2" : "var(--highlight-soft)", color: high ? "#991b1b" : "#9a3412" }}>
            <Icon size={20} weight="fill" className="mt-[1px] shrink-0" aria-hidden />
            <span>
              <span className="font-bold">{high ? "Disruption" : "Service notice"}</span>
              <span className="block opacity-90">{a.public_message ?? a.message}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
