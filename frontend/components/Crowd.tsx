import { User, Users, UsersFour, UsersThree, Warning } from "@phosphor-icons/react/dist/ssr";
import { CROWD, type CrowdLevel, crowdInkVar, crowdOf, crowdSoftVar, crowdVar, pctShort } from "@/lib/crowd/levels";

/** One icon shape per level, so crowding never depends on colour alone. */
export function CrowdIcon({ level, size = 16, color }: { level: CrowdLevel; size?: number; color?: string }) {
  const props = { size, weight: "fill" as const, color: color ?? crowdInkVar(level), "aria-hidden": true };
  if (level === 1) return <User {...props} />;
  if (level === 2) return <Users {...props} />;
  if (level === 3) return <UsersThree {...props} />;
  if (level === 4) return <UsersFour {...props} />;
  return <Warning {...props} />;
}

/** Five segments filled up to the level. */
export function CrowdMeter({ level, size = "md" }: { level: CrowdLevel; size?: "sm" | "md" }) {
  const w = size === "sm" ? 6 : 9;
  const h = size === "sm" ? 6 : 8;
  return (
    <span aria-hidden className="inline-flex items-center gap-[3px]">
      {CROWD.map((s) => (
        <span key={s.level} style={{ width: w, height: h, background: s.level <= level ? crowdVar(level) : "var(--crowd-empty)" }}
          className="rounded-full" />
      ))}
    </span>
  );
}

/** The standard crowding chip: soft tinted pill, icon, level name and optional load. */
export function CrowdTag({ loadPct, showPct = false, showHint = false, size = "md", className = "" }: {
  loadPct: number; showPct?: boolean; showHint?: boolean; size?: "sm" | "md" | "lg"; className?: string;
}) {
  const s = crowdOf(loadPct);
  const pad = size === "sm" ? "px-2 py-0.5 text-xs gap-1" : size === "lg" ? "px-3.5 py-1.5 text-[15px] gap-2" : "px-2.5 py-1 text-[13px] gap-1.5";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className={`inline-flex items-center rounded-full font-semibold ${pad}`} style={{ background: crowdSoftVar(s.level), color: crowdInkVar(s.level) }}>
        <CrowdIcon level={s.level} size={size === "lg" ? 18 : size === "sm" ? 13 : 15} />
        {s.name}
        {showPct && <span className="num font-medium opacity-80">{pctShort(loadPct)}</span>}
      </span>
      {showHint && <span className="text-[13px] text-ink-3">{s.hint}</span>}
    </span>
  );
}

/** A train seen from the side: four cars, front first, each shaded by its own predicted load. */
export function CarDiagram({ cars, size = "md", label, showPct = false }: { cars: number[]; size?: "sm" | "md" | "lg"; label?: string; showPct?: boolean }) {
  const [w, h] = { sm: [16, 9], md: [24, 12], lg: [56, 26] }[size];
  return (
    <span role="img" aria-label={label ?? `By car, front first: ${cars.map((c, i) => `car ${i + 1} ${crowdOf(c).name}`).join(", ")}`}
      className="inline-flex items-center gap-[3px]">
      {cars.map((c, i) => {
        const lv = crowdOf(c).level;
        const front = i === 0;
        const back = i === cars.length - 1;
        return (
          <span key={i} style={{ width: w, height: h, background: crowdVar(lv), color: lv >= 4 || lv === 1 ? "#fff" : crowdInkVar(lv),
            borderTopLeftRadius: front ? h : 3, borderBottomLeftRadius: 3, borderTopRightRadius: back ? h * 0.4 : 3, borderBottomRightRadius: 3 }}
            className="num inline-flex items-center justify-center text-[11px] font-semibold">
            {showPct && size === "lg" ? (c >= 100 ? "100+" : Math.floor(c)) : null}
          </span>
        );
      })}
    </span>
  );
}

export function CrowdScale({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <ul className="flex flex-wrap gap-2" aria-label="Crowding levels">
        {CROWD.map((s) => (
          <li key={s.level}><CrowdTag loadPct={s.from + 0.1} size="sm" /></li>
        ))}
      </ul>
    );
  }
  return (
    <ol className="space-y-2.5" aria-label="Crowding levels">
      {CROWD.map((s, i) => (
        <li key={s.level} className="flex items-center gap-3 text-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: crowdSoftVar(s.level) }}>
            <CrowdIcon level={s.level} size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">{s.name}</span>
            <span className="block text-xs text-ink-3">{s.hint}</span>
          </span>
          <span className="num text-xs text-ink-3">{i === CROWD.length - 1 ? `${s.from}%+` : `${s.from}–${CROWD[i + 1].from}%`}</span>
        </li>
      ))}
    </ol>
  );
}
