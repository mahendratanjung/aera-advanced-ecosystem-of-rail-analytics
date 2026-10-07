"use client";

import { SourceBadge } from "@/components/Badges";
import { CongestionPill } from "@/components/Congestion";
import { ago } from "@/lib/format";
import type { TwinState, ZoneState } from "@/lib/types";

/** TWN-03 on selection: count, capacity and percentage. */
export function ZoneCard({ zone, twin, children }: { zone: ZoneState; twin: TwinState; children?: React.ReactNode }) {
  const flows = twin.links.filter((l) => l.from === zone.id || l.to === zone.id);
  return (
    <article aria-label={`${zone.name} details`} className="rounded-panel border border-cyan/40 bg-raised p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="eyebrow">{zone.type} · {zone.level_id}</p>
          <h3 className="text-lg font-bold text-ink">{zone.name}</h3>
        </div>
        <SourceBadge source={zone.source} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CongestionPill level={zone.level} estimated={zone.estimated} />
        {!zone.available && <span className="rounded bg-lvl-crowded/15 px-2 py-0.5 text-xs font-semibold text-lvl-crowded">Closed · {zone.reason}</span>}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-sunken p-2"><dt className="eyebrow">Count</dt><dd className="tabular text-xl text-ink">{zone.count}</dd></div>
        <div className="rounded bg-sunken p-2"><dt className="eyebrow">Capacity</dt><dd className="tabular text-xl text-ink">{zone.capacity}</dd></div>
        <div className="rounded bg-sunken p-2"><dt className="eyebrow">Full</dt><dd className="tabular text-xl text-ink">{Math.round(zone.percent)}%</dd></div>
      </dl>
      {flows.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {flows.map((l) => (
            <li key={l.id} className="flex justify-between">
              <span>{l.name}{!l.available && <span className="text-lvl-crowded"> · closed</span>}</span>
              <span className="tabular">↑{l.to === zone.id ? l.flow_in_per_min : l.flow_out_per_min} ↓{l.to === zone.id ? l.flow_out_per_min : l.flow_in_per_min} /min</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-faint">
        Updated {ago(zone.updated_at_ms)}{zone.estimated && " · sensor offline, last known count frozen"}{zone.drift > 0 && ` · drift ${zone.drift}`}
      </p>
      {children}
    </article>
  );
}

/** UX-06: the table equivalent of the 3D view. */
export function ZoneTable({ twin, onSelect, selected, publicOnly = false }: {
  twin: TwinState; onSelect?: (id: string) => void; selected?: string | null; publicOnly?: boolean;
}) {
  const zones = twin.zones.filter((z) => !publicOnly || z.public);
  return (
    <table className="w-full text-sm">
      <caption className="eyebrow mb-1 text-left">Zones</caption>
      <thead className="sr-only">
        <tr><th scope="col">Zone</th><th scope="col">Level</th><th scope="col">Count</th></tr>
      </thead>
      <tbody className="divide-y divide-subtle">
        {zones.map((z) => (
          <tr key={z.id} className={selected === z.id ? "bg-raised" : ""}>
            <th scope="row" className="py-1.5 text-left font-normal">
              {onSelect ? (
                <button type="button" onClick={() => onSelect(z.id)} className="text-left text-ink hover:text-cyan">{z.name}</button>
              ) : (
                <span className="text-ink">{z.name}</span>
              )}
              {!z.available && <span className="ml-1 text-xs text-lvl-crowded">closed</span>}
            </th>
            <td className="py-1.5"><CongestionPill level={z.level} estimated={z.estimated} size="sm" /></td>
            <td className="tabular py-1.5 text-right text-muted">{z.count}/{z.capacity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
