"use client";

/**
 * Ask AERA conversation (ASK-01). The server forwards to a free OpenRouter model; when the
 * model asks for a tool, the browser runs it (lib/assistant/tools.ts) and sends the result
 * back, up to a few rounds. When the model is off, busy or unreachable, the turn is answered
 * by the quick answers in local.ts instead, so the panel never goes blank (ASK-04).
 */

import { create } from "zustand";
import { ApiError, api } from "../api";
import { localAnswer } from "./local";
import { type Card, type ToolCtx, hm, runTool } from "./tools";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface WireMsg {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[] | null;
  tool_call_id?: string;
}

export interface Turn {
  id: number;
  role: "user" | "assistant";
  text: string;
  cards: Card[];
  /** Answered without the language model, and why. */
  quick?: "off" | "busy" | "error";
}

const MAX_ROUNDS = 4;
const KEEP = 16; // messages of history sent back to the model

interface ChatState {
  turns: Turn[];
  wire: WireMsg[];
  busy: boolean;
  /** null until the server has said whether the model is set up. */
  enabled: boolean | null;
  model: string | null;
  check: () => Promise<void>;
  send: (text: string, ctx: () => ToolCtx | null) => Promise<void>;
  clear: () => void;
}

let nextId = 1;

/** Recent history, cut at a question so a tool result never loses the call that asked for it. */
function recent(wire: WireMsg[]): WireMsg[] {
  if (wire.length <= KEEP) return wire;
  let start = wire.length - KEEP;
  while (start < wire.length - 1 && wire[start].role !== "user") start++;
  return wire.slice(start);
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export const useChat = create<ChatState>((set, get) => ({
  turns: [],
  wire: [],
  busy: false,
  enabled: null,
  model: null,
  check: async () => {
    if (get().enabled !== null) return;
    try {
      const r = await api<{ enabled: boolean; model: string | null }>("/assistant");
      set({ enabled: r.enabled, model: r.model });
    } catch {
      set({ enabled: false });
    }
  },
  clear: () => set({ turns: [], wire: [] }),
  send: async (text, getCtx) => {
    const q = text.trim();
    const ctx = getCtx();
    if (!q || get().busy || !ctx) return;
    set((s) => ({ busy: true, turns: [...s.turns, { id: nextId++, role: "user", text: q, cards: [] }] }));
    const quick = (why: Turn["quick"]) => {
      const a = localAnswer(q, getCtx() ?? ctx);
      set((s) => ({ busy: false, turns: [...s.turns, { id: nextId++, role: "assistant", text: a.text, cards: a.cards, quick: why }],
        wire: recent([...s.wire, { role: "user", content: q }, { role: "assistant", content: a.text }]) }));
    };
    if (get().enabled === false) return quick("off");

    let wire: WireMsg[] = [...get().wire, { role: "user", content: q }];
    const cards: Card[] = [];
    try {
      for (let round = 0; round <= MAX_ROUNDS; round++) {
        const c = getCtx() ?? ctx;
        const res = await api<{ message: WireMsg }>("/assistant", {
          method: "POST",
          json: { messages: recent(wire), context: { role: c.role, sim_time: hm(c.t), my_station: c.home ? c.ix.stop[c.home]?.name : null } },
        });
        const msg = res.message;
        wire = [...wire, { role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls ?? undefined }];
        if (!msg.tool_calls?.length || round === MAX_ROUNDS) {
          const answer = (msg.content ?? "").trim();
          if (!answer) return quick("error");
          // Keep only the last card of each kind, so a retried tool does not stack duplicates.
          const shown = cards.filter((x, i) => !cards.slice(i + 1).some((y) => y.kind === x.kind));
          set((s) => ({ busy: false, wire: recent(wire), turns: [...s.turns, { id: nextId++, role: "assistant", text: answer, cards: shown }] }));
          return;
        }
        for (const call of msg.tool_calls) {
          const out = runTool(call.function.name, parseArgs(call.function.arguments), getCtx() ?? ctx);
          if (out.card) cards.push(out.card);
          wire.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out.result) });
        }
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      if (code === 503) set({ enabled: false });
      return quick(code === 429 ? "busy" : code === 503 ? "off" : "error");
    }
  },
}));
