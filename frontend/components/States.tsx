"use client";

import { WifiSlash } from "@phosphor-icons/react/dist/ssr";
import { useTwin } from "@/lib/store";

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-card bg-surface-2 p-5 text-sm">
      <p className="font-bold text-ink">{title}</p>
      {body && <p className="text-ink-2">{body}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-card bg-surface-2 ${className}`} />;
}

/** Say clearly when the live connection drops, and keep showing the last state. */
export function ConnectionBanner() {
  const status = useTwin((s) => s.status);
  const hasSnapshot = useTwin((s) => s.hasSnapshot);
  if (status === "live" || (status === "connecting" && !hasSnapshot)) return null;
  const text = hasSnapshot ? "Reconnecting. Times shown are from the last update." : "The live service is not responding. Retrying.";
  return (
    <div role="status" className="relative z-50 flex items-center justify-center gap-2 bg-highlight-soft px-4 py-2 text-[13px] font-medium text-[#9a3412]">
      <WifiSlash size={16} aria-hidden />
      {text}
    </div>
  );
}
