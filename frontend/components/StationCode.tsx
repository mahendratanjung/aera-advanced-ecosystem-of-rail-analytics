import { INTERCHANGES } from "@/lib/stations";

/** Station code plate in the line's colour, as on Rapid KL signage. */
export function StationCode({ id, size = "md" }: { id: string; size?: "sm" | "md" | "lg" }) {
  const cls = { sm: "h-5 min-w-[34px] text-[11px] px-1.5", md: "h-6 min-w-[42px] text-xs px-2", lg: "h-9 min-w-[56px] text-[15px] px-2.5" }[size];
  return (
    <span className={`num inline-flex shrink-0 items-center justify-center rounded-md bg-line font-bold leading-none text-white ${cls}`}>
      {id}
    </span>
  );
}

const LINE_COLOUR: Record<string, string> = {
  AG: "var(--line-ag)", SP: "var(--line-sp)", KG: "var(--line-kg)", PY: "var(--line-py)", MR: "var(--line-mr)", SA: "var(--line-sa)",
  KTM: "var(--line-k1)", ERL: "var(--line-e6)",
};

/** Interchanges with each line's own colour dot and code. */
export function Interchanges({ id }: { id: string }) {
  const lines = INTERCHANGES[id];
  if (!lines) return null;
  return (
    <span className="inline-flex gap-1" aria-label={`Change for ${lines.join(", ")}`}>
      {lines.map((l) => (
        <span key={l} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-[1px] text-[10px] font-bold text-ink-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: LINE_COLOUR[l] ?? "var(--ink-3)" }} />
          {l}
        </span>
      ))}
    </span>
  );
}
