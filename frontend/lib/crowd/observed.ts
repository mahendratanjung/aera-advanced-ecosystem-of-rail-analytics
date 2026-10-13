/**
 * Blend what riders and train sensors observed (fused by the twin service, see
 * backend/aera_twin/crowdsource) into the model's predicted load.
 *
 * Both are estimates with an error size, so they are combined by inverse-variance weighting:
 * one rider report nudges the prediction, a camera or load-weigh reading nearly replaces it.
 * The correction carries on to the next stops and fades, because riders get on and off.
 */

export interface ObservedLoad {
  trip_id: string;
  /** Load in percent of capacity on the leg leaving stop_index. */
  pct: number;
  /** Typical error in percentage points, valid at as_of_ms. */
  sd: number;
  stop_index: number;
  n: number;
  sources: Record<string, number>;
  updated_ms: number;
  as_of_ms: number;
  half_life_s: number;
}

/**
 * How far the model may be off for one train, in percentage points. A guess, not measured:
 * the back-test checks daily totals (4.7% error), and single trains vary far more with gaps
 * and events. Tune it once rider or sensor data can be compared with predictions.
 */
export function priorSd(pct: number): number {
  return Math.max(10, 0.3 * pct);
}

/** Observations fade with their half-life: the error grows by sqrt(2) per half-life. */
export function sdAt(o: ObservedLoad, simMs: number): number {
  const age = Math.max(0, (simMs - o.as_of_ms) / 1000);
  return o.sd * 2 ** (age / (2 * o.half_life_s));
}

const FADE_PER_STOP = 0.75;

/** Predicted leg loads with the observation folded in from its leg onwards. */
export function blendLegs(legs: number[], o: ObservedLoad, simMs: number): number[] {
  if (!legs.length) return legs;
  const k = Math.min(Math.max(0, o.stop_index), legs.length - 1);
  const prior = legs[k];
  const wp = 1 / priorSd(prior) ** 2;
  const wo = 1 / Math.max(1, sdAt(o, simMs)) ** 2;
  const fused = (prior * wp + o.pct * wo) / (wp + wo);
  const delta = fused - prior;
  const ratio = prior >= 5 ? Math.min(4, Math.max(0.25, fused / prior)) : null;
  return legs.map((x, j) => {
    if (j < k) return x;
    if (j === k) return fused;
    const f = FADE_PER_STOP ** (j - k);
    return ratio !== null ? x * ratio ** f : Math.max(0, x + delta * f);
  });
}

const SOURCE_WORDS: Record<string, [string, string]> = {
  rider_report: ["rider report", "rider reports"],
  rider_location: ["rider phone count", "rider phone counts"],
  camera: ["camera count", "camera counts"],
  door_counter: ["door count", "door counts"],
  load_weigh: ["load-weigh reading", "load-weigh readings"],
};

/** "2 rider reports and 1 camera count" */
export function describeSources(o: ObservedLoad): string {
  const parts = Object.entries(o.sources).map(([k, n]) => {
    const [one, many] = SOURCE_WORDS[k] ?? ["reading", "readings"];
    return `${n} ${n === 1 ? one : many}`;
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

const DEVICE_KEY = "aera.device";
let memoryDevice = "";

/** A random id for this browser. The service only keeps a hash of it that changes daily. */
export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    memoryDevice ||= crypto.randomUUID();
    return memoryDevice;
  }
}
