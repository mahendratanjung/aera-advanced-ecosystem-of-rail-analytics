"use client";

import { klHour } from "@/lib/format";
import { useSimNow } from "@/lib/hooks";

/** Living sky (UX-09): a light wash over the map that follows Kuala Lumpur time. */
export function SkyTint() {
  const now = useSimNow(30_000);
  const h = klHour(now);
  const phase = h < 5.5 || h >= 20 ? "night" : h < 7.5 ? "dawn" : h < 17.5 ? "day" : "dusk";
  return (
    <div
      aria-hidden
      data-sky={phase}
      className="pointer-events-none absolute inset-0"
      style={{
        background: `radial-gradient(120% 70% at 50% -10%, var(--sky-${phase}), transparent 70%)`,
        transition: "background 3s linear",
      }}
    />
  );
}
