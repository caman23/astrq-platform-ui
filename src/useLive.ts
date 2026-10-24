import { useEffect, useRef, useState } from "react";
import type { Signal, Status } from "./api";

export interface LiveAlert {
  text: string;
  symbol: string | null;
  severity: string | null;
  at: number;
}

export interface Live {
  connected: boolean;
  status: Status | null;
  signals: Signal[]; // newest first
  alerts: LiveAlert[];
  radarTick: number; // increments on every radar signal (triggers a view refresh)
  summary: string | null;
}

const MAX_SIGNALS = 300;

/** WebSocket connection with automatic reconnect (exponential backoff). */
export function useLive(initialSignals: Signal[]): Live {
  const [state, setState] = useState<Live>({
    connected: false,
    status: null,
    signals: [],
    alerts: [],
    radarTick: 0,
    summary: null,
  });
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || initialSignals.length === 0) return;
    seeded.current = true;
    setState((s) => ({ ...s, signals: [...s.signals, ...initialSignals].slice(0, MAX_SIGNALS) }));
  }, [initialSignals]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 500;
    let timer: number | undefined;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 500;
        setState((s) => ({ ...s, connected: true }));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string);
        setState((s) => {
          switch (msg.type) {
            case "hello":
            case "status":
              return { ...s, status: msg.status as Status };
            case "signal": {
              const sig = msg.signal as Signal;
              if (sig.tool_id !== "large_order_radar") return s;
              return {
                ...s,
                signals: [sig, ...s.signals].slice(0, MAX_SIGNALS),
                radarTick: s.radarTick + 1,
              };
            }
            case "alert":
              return {
                ...s,
                alerts: [
                  { text: msg.text, symbol: msg.symbol, severity: msg.severity, at: Date.now() },
                  ...s.alerts,
                ].slice(0, 50),
              };
            case "summary":
              return { ...s, summary: msg.text as string };
            default:
              return s;
          }
        });
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (closed) return;
        timer = window.setTimeout(connect, retry);
        retry = Math.min(retry * 2, 10_000);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return state;
}
