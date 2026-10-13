"use client";

/**
 * A train on a line other than the Kelana Jaya Line (TRAINS-03): where it is, where it is going
 * and when it reaches the next stop, from the line's timetable, and how full it usually is
 * here at this time (NETC-02, typical-week model; ERL and BRT have no ridership data, so the
 * card says so rather than showing a guess). Used on the live map and the network map.
 */

import { Clock, Info, X } from "@phosphor-icons/react/dist/ssr";
import { type ReactNode, useEffect, useState } from "react";
import { CrowdIcon, CrowdTag } from "@/components/Crowd";
import { DataChip, LineBadge } from "@/components/LineBadge";
import { crowdOf, crowdVar } from "@/lib/crowd/levels";
import { latest, subscribe } from "@/lib/crowd/feed";
import { klTime } from "@/lib/format";
import { useNetCrowd, useSimNetwork } from "@/lib/hooks";
import { aheadLoads, netTrainLoad } from "@/lib/network/crowd";
import { LINES } from "@/lib/network/schematic";
import { type NetTrain, findTrain, sourceText } from "@/lib/network/trains";

/** The train, refreshed once a second from the shared clock. */
export function useNetTrain(id: string): { train: NetTrain | null; t: number; ready: boolean } {
  const { net } = useSimNetwork();
  const [state, setState] = useState<{ train: NetTrain | null; t: number }>({ train: null, t: latest.t });
  useEffect(() => {
    if (!net) return;
    setState({ train: findTrain(net, id, latest.t), t: latest.t });
    let last = 0;
    return subscribe((f) => {
      if (performance.now() - last < 1000) return;
      last = performance.now();
      setState({ train: findTrain(net, id, f.t), t: f.t });
    });
  }, [net, id]);
  return { ...state, ready: !!net };
}

export function NetTrainCard({ id, onClose, children }: { id: string; onClose: () => void; children?: ReactNode }) {
  const { train, t, ready } = useNetTrain(id);
  const model = useNetCrowd();
  const def = LINES.find((l) => l.id === id.split(":")[1]);
  const head = (
    <header className="flex items-start gap-3">
      {def && <LineBadge line={def} size={34} />}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-ink-3">{def?.name ?? "Train"}</p>
        <h2 className="text-[20px] font-extrabold leading-tight tracking-tight text-ink">{train ? `To ${train.headsign}` : "Train"}</h2>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:bg-surface-3">
        <X size={17} weight="bold" aria-hidden />
      </button>
    </header>
  );
  if (!train) {
    return <div>{head}<p className="mt-3 text-[14px] text-ink-2">{ready ? "This train has finished its trip." : "Loading the timetable…"}</p></div>;
  }
  const stops = train.line.stops;
  const mins = train.nextArrival === null ? null : Math.max(0, Math.round((train.nextArrival - t) / 60));
  const load = netTrainLoad(model, train, t);
  const ahead = load === null ? [] : aheadLoads(model, train);
  return (
    <div>
      {head}
      {load !== null && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl p-3" style={{ background: `var(--crowd-${crowdOf(load).level}-soft)` }}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/70"><CrowdIcon level={crowdOf(load).level} size={24} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-extrabold leading-tight" style={{ color: `var(--crowd-${crowdOf(load).level}-ink)` }}>{crowdOf(load).name}</p>
            <p className="text-[12.5px] text-ink-2">{crowdOf(load).hint}. How full this train usually is here at this time.</p>
          </div>
        </div>
      )}
      <div className="mt-3 rounded-2xl bg-surface-2 p-3">
        <p className="text-[15px] font-bold text-ink">
          {train.status === "dwelling" ? `At ${stops[train.at].name}` : train.next !== null ? `Next: ${stops[train.next].name}` : `Arriving at ${stops[train.at].name}`}
        </p>
        {train.next !== null && train.nextArrival !== null && (
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-2">
            <Clock size={14} aria-hidden />{mins === 0 ? "Arriving now" : `In ${mins} min`}, at {klTime(train.nextArrival * 1000)}
            {train.status === "dwelling" && ` (${stops[train.next].name})`}
          </p>
        )}
        <p className="mt-0.5 text-[12px] text-ink-3">Trip ends {klTime(train.ends * 1000)}</p>
      </div>
      {ahead.length > 1 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-ink-3">Ahead on this trip</p>
          <ol className="mt-1.5 space-y-1">
            {ahead.map((a) => (
              <li key={a.from + a.to} className="flex items-center gap-2 text-[13px]">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.load === null ? "var(--rule)" : crowdVar(crowdOf(a.load).level) }} />
                <span className="min-w-0 flex-1 truncate text-ink-2">{a.from} → {a.to}</span>
                {a.load !== null && <CrowdTag loadPct={a.load} size="sm" />}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-3 flex items-start gap-2 text-[12.5px] text-ink-2">
        <Info size={16} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
        <p>
          {def && <DataChip data={def.data} />}{" "}
          Position from {sourceText(train.line).replace(/\.$/, "")}.{" "}
          {load !== null
            ? "Crowding is a typical-week prediction from data.gov.my gate data; unlike the Kelana Jaya Line it does not react to delays."
            : "No ridership data is published for this line, so this train has no crowding level."}
        </p>
      </div>
      {children}
    </div>
  );
}
