import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveAlert } from "./useLive";

// Per-viewer preferences kept in localStorage. Storage can be missing or throw (private
// windows, blocked site data, iframes): every access is guarded and falls back to defaults.

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep the in-memory value only */
  }
}

function usePersistent<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [v, setV] = useState<T>(() => load(key, fallback));
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setV((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        save(key, value);
        return value;
      }),
    [key],
  );
  return [v, set];
}

// ---------------------------------------------------------------- watchlist

export interface Watchlist {
  symbols: Set<string>;
  has: (symbol: string) => boolean;
  toggle: (symbol: string) => void;
}

export function useWatchlist(): Watchlist {
  const [list, setList] = usePersistent<string[]>("astrq.watchlist", []);
  // stable identity while the list is unchanged (the radar layout depends on it)
  const symbols = useMemo(() => new Set(list), [list]);
  return {
    symbols,
    has: (s) => symbols.has(s),
    // functional update: several quick toggles in one tick must all land
    toggle: (s) =>
      setList((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].sort())),
  };
}

// ---------------------------------------------------------------- alert notifications

export type NotifyMode = "off" | "watch" | "all";

export const NOTIFY_LABEL: Record<NotifyMode, string> = {
  off: "🔕 Tắt báo",
  watch: "🔔 Báo mã theo dõi",
  all: "🔔 Báo mọi cảnh báo",
};

export function usePersistentNotifyMode() {
  return usePersistent<NotifyMode>("astrq.notify", "off");
}

let audio: AudioContext | null = null;

/** Two short tones; silent if the browser blocks audio. */
function beep(severity: string | null) {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const tones = severity === "alert" ? [880, 660] : [660];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.16);
    });
  } catch {
    /* no audio */
  }
}

/** Ask for permission when the viewer turns notifications on (must follow a click). */
export async function requestNotifyPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

/**
 * Desktop notification + sound for each new live alert that matches the mode. Alerts that
 * were already on screen when the mode was switched on are not replayed.
 */
export function useAlertNotifications(
  alerts: LiveAlert[],
  mode: NotifyMode,
  watch: Watchlist,
  onOpen: (symbol: string) => void,
) {
  const seen = useRef<number>(alerts[0]?.at ?? 0);
  useEffect(() => {
    const fresh = alerts.filter((a) => a.at > seen.current);
    if (alerts[0]) seen.current = Math.max(seen.current, alerts[0].at);
    if (mode === "off" || !fresh.length) return;
    for (const a of fresh.reverse()) {
      if (mode === "watch" && !(a.symbol && watch.has(a.symbol))) continue;
      beep(a.severity);
      if (!("Notification" in window) || Notification.permission !== "granted") continue;
      const [title, ...rest] = a.text.split("\n");
      try {
        const n = new Notification(title || "Radar Lệnh Lớn", {
          body: rest.slice(0, 3).join("\n"),
          tag: a.symbol ?? undefined,
        });
        n.onclick = () => {
          window.focus();
          if (a.symbol) onOpen(a.symbol);
          n.close();
        };
      } catch {
        /* e.g. mobile browsers that only allow service-worker notifications */
      }
    }
  }, [alerts, mode, watch, onOpen]);
}

// ---------------------------------------------------------------- CSV export

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens Vietnamese text as UTF-8
  const text = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
