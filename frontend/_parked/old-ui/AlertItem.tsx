"use client";

import { ago } from "@/lib/format";
import type { Alert } from "@/lib/types";
import { SeverityDot } from "./Badges";

const TYPE_LABEL: Record<Alert["type"], string> = {
  crowding: "Crowding",
  disruption: "Train disruption",
  unavailable: "Area unavailable",
  device_offline: "Device offline",
  abnormal: "Abnormal data",
};

export function AlertItem({ alert, actions, onSelect, compact = false }: {
  alert: Alert; actions?: React.ReactNode; onSelect?: () => void; compact?: boolean;
}) {
  const open = alert.state !== "resolved";
  return (
    <li className={`rounded-panel border p-3 ${open ? "border-subtle bg-raised" : "border-subtle/60 opacity-70"}`}>
      <div className="flex items-center justify-between gap-2">
        <SeverityDot severity={alert.severity} />
        <span className="text-[11px] text-faint">
          {alert.state === "acknowledged" ? `Acknowledged · ` : alert.state === "resolved" ? "Resolved · " : ""}
          {ago(alert.started_at_ms)}
        </span>
      </div>
      <button
        type="button"
        onClick={onSelect}
        disabled={!onSelect}
        className="mt-1 block w-full text-left disabled:cursor-default"
      >
        <p className="font-semibold text-ink">{alert.title ?? TYPE_LABEL[alert.type]}</p>
        {!compact && <p className="text-sm text-muted">{alert.message ?? alert.public_message}</p>}
      </button>
      {(alert.acked_by || alert.resolved_by) && !compact && (
        <p className="mt-1 text-[11px] text-faint">
          {alert.acked_by && `Ack ${alert.acked_by}`} {alert.resolved_by && `· Resolved by ${alert.resolved_by}`}
        </p>
      )}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </li>
  );
}
