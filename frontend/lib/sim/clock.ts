import type { ClockState } from "../types";

/** Simulated epoch ms from the broadcast anchors (SIM-03). offsetMs = server clock minus client clock. */
export function simNowMs(clock: ClockState | null | undefined, offsetMs: number, realNow = Date.now()): number {
  if (!clock) return realNow;
  if (clock.paused) return clock.anchor_sim_ms;
  return clock.anchor_sim_ms + (realNow + offsetMs - clock.anchor_real_ms) * clock.speed;
}
