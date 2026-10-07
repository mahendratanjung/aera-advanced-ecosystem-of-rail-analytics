/** Line icons drawn for AERA. Decorative unless given a title. */
type P = { className?: string };
const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IconLine = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><path d="M3 18c4 0 4-12 9-12s5 12 9 12" /><circle cx="3" cy="18" r="1.6" /><circle cx="12" cy="6" r="1.6" /><circle cx="21" cy="18" r="1.6" /></svg>
);
export const IconStation = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-5h6v5" /></svg>
);
export const IconConsole = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M7 12l3-3 2 2 4-4" /></svg>
);
export const IconAdmin = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
);
export const IconChart = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><path d="M4 20V4M4 20h16M8 16l4-5 3 3 5-7" /></svg>
);
export const IconInfo = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>
);
export const IconUser = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
);
export const IconClose = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconBack = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><path d="M15 6l-6 6 6 6" /></svg>
);
export const IconTrain = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...s}><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4" /><circle cx="9" cy="14" r=".6" /><circle cx="15" cy="14" r=".6" /></svg>
);
