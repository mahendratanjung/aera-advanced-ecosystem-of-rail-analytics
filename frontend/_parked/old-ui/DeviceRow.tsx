import { ago } from "@/lib/format";
import type { Device } from "@/lib/types";

export function DeviceRow({ device, actions }: { device: Device; actions?: React.ReactNode }) {
  const colour = device.retired ? "bg-offline" : device.status === "online" ? (device.kind === "sim" ? "bg-sim" : "bg-live") : "bg-offline";
  const status = device.retired ? "Retired" : device.status === "online" ? "Online" : device.status === "offline" ? "Offline" : "Never seen";
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${colour} ${device.status === "online" && !device.retired ? "pulse-slow" : ""}`} />
          <span className="tabular truncate">{device.id}</span>
          {device.kind === "sim" && <span className="rounded border border-dashed border-sim/60 px-1 text-[9px] uppercase tracking-[0.14em] text-sim">Sim</span>}
        </p>
        <p className="truncate text-xs text-muted">{device.position ?? device.name}</p>
      </div>
      <div className="shrink-0 text-right text-xs">
        <p className={device.status === "online" && !device.retired ? "text-ink" : "text-muted"}>{status}</p>
        <p className="tabular text-faint">
          {ago(device.last_seen_ms)}{device.rssi !== null && ` · ${device.rssi} dBm`}{device.firmware && ` · ${device.firmware}`}
        </p>
      </div>
      {actions}
    </li>
  );
}
