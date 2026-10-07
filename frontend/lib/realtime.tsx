"use client";

/**
 * One WebSocket per tab to the twin service. Reconnects with backoff and marks the data
 * stale when nothing has arrived for a while (NFR-05). The server sends a station summary
 * every five seconds, so silence beyond STALE_MS means the link is in trouble.
 */

import { useEffect } from "react";
import { wsUrl } from "./api";
import { useSession } from "./session";
import { useTwin } from "./store";

const STALE_MS = 12_000;
const PING_MS = 10_000;

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const token = useSession((s) => s.token);
  const ready = useSession((s) => s.ready);
  const hydrate = useSession((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!ready) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const { apply, setStatus } = useTwin.getState();

    const connect = () => {
      setStatus(attempt === 0 ? "connecting" : "offline");
      ws = new WebSocket(wsUrl(token));
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (ev) => {
        try {
          apply(JSON.parse(ev.data));
        } catch {}
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus("offline");
        attempt += 1;
        retryTimer = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(attempt, 5)));
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    const watchdog = setInterval(() => {
      const { lastMessageAt, status } = useTwin.getState();
      if (status === "live" && Date.now() - lastMessageAt > STALE_MS) setStatus("stale");
      if (ws?.readyState === WebSocket.OPEN) ws.send("ping");
    }, PING_MS / 2);

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      ws?.close();
    };
  }, [token, ready]);

  return <>{children}</>;
}
