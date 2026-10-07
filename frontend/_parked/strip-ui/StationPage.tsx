"use client";

import Link from "next/link";
import { EmptyState, Skeleton } from "@/components/States";
import { useCrowd } from "@/lib/hooks";
import { StationBoard } from "./StationBoard";

export function StationPage({ id }: { id: string }) {
  const { line, engine, error } = useCrowd("KJ");
  const i = line?.stations.findIndex((s) => s.id === id) ?? -1;
  const prev = line && i > 0 ? line.stations[i - 1] : null;
  const next = line && i >= 0 && i < line.stations.length - 1 ? line.stations[i + 1] : null;
  return (
    <main className="enter mx-auto max-w-2xl px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
      <Link href="/" className="inline-flex rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-surface-3">← Live line</Link>
      <div className="mt-4">
        {error ? (
          <EmptyState title="Departures are unavailable" body={`The twin service did not answer (${error}).`} />
        ) : !line || !engine ? (
          <div className="space-y-3"><Skeleton className="h-10 w-60" /><Skeleton className="h-64" /></div>
        ) : i < 0 ? (
          <EmptyState title="No such station" body={`${id} is not on the Kelana Jaya Line.`} action={<Link href="/" className="text-sm font-medium text-accent">See all stations</Link>} />
        ) : (
          <StationBoard engine={engine} line={line} stationId={id} headingLevel={1} />
        )}
      </div>
      {(prev || next) && (
        <nav aria-label="Neighbouring stations" className="mt-4 flex justify-between text-[13px]">
          {prev ? <Link href={`/station/${prev.id}`} className="rounded-full bg-surface-2 px-3 py-1.5 font-semibold text-ink-2 hover:bg-surface-3">↑ {prev.name}</Link> : <span />}
          {next ? <Link href={`/station/${next.id}`} className="rounded-full bg-surface-2 px-3 py-1.5 font-semibold text-ink-2 hover:bg-surface-3">{next.name} ↓</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
