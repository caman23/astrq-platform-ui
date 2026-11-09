import { useEffect, useMemo, useRef, useState } from "react";
import type { Instrument, RadarView, Severity } from "./api";
import { api } from "./api";
import { Timeline } from "./components/Panels";
import { Radar } from "./components/Radar";
import { DISCLAIMER, SESSION_LABEL, SEVERITY_RANK, hm, hms } from "./format";
import { useLive } from "./useLive";
import { useThrottledReload } from "./useThrottledReload";

/**
 * Embeddable radar (/embed). Options via query string:
 *   side=all|buy|sell      min=info|notice|alert     legend=0|1     header=0|1
 *   bg=transparent         click=open|none           symbols=FPT,VCB (restrict)
 *   timeline=1             scrub / replay today's session under the radar
 */
function readOptions() {
  const q = new URLSearchParams(location.search);
  const pick = <T extends string>(key: string, allowed: readonly T[], dflt: T): T => {
    const v = q.get(key) as T | null;
    return v && allowed.includes(v) ? v : dflt;
  };
  return {
    side: pick("side", ["all", "buy", "sell"] as const, "all"),
    min: pick("min", ["info", "notice", "alert"] as const, "notice") as Severity,
    legend: q.get("legend") !== "0",
    header: q.get("header") !== "0",
    transparent: q.get("bg") === "transparent",
    click: pick("click", ["open", "none"] as const, "open"),
    timeline: q.get("timeline") === "1",
    symbols: new Set(
      (q.get("symbols") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  };
}

export default function Embed() {
  const opt = useMemo(readOptions, []);
  const live = useLive([]);
  const [view, setView] = useState<RadarView | null>(null);
  const [universe, setUniverse] = useState<Instrument[]>([]);
  // timeline: null = live, "HH:MM" = the radar as it was then (same views as the dashboard)
  const [at, setAt] = useState<string | null>(null);
  const atRef = useRef(at);
  atRef.current = at;

  useEffect(() => {
    document.documentElement.classList.add("embed");
    if (opt.transparent) document.documentElement.classList.add("embed-transparent");
    if (opt.timeline) document.documentElement.classList.add("embed-timeline");
    api.universe().then((u) => setUniverse(u.instruments)).catch(() => undefined);
  }, [opt.transparent, opt.timeline]);

  useThrottledReload(
    () => api.view(null, at),
    at ?? `live:${live.radarTick}`,
    at ? 150 : 2500,
    (v) => (v.at ? hm(v.at) : null) === atRef.current && setView(v),
  );

  const visible = useMemo(
    () =>
      (view?.symbols ?? []).filter(
        (s) =>
          SEVERITY_RANK[s.max_severity] >= SEVERITY_RANK[opt.min] &&
          (opt.side === "all" || s.dominant_side === opt.side) &&
          (opt.symbols.size === 0 || opt.symbols.has(s.symbol)),
      ),
    [view, opt],
  );

  // Click-through opens the full dashboard (detail drawer) in a new tab.
  const onPin = (symbol: string) => {
    if (opt.click === "none") return;
    window.open(`${location.origin}/?symbol=${encodeURIComponent(symbol)}`, "_blank", "noopener");
  };

  const status = live.status;
  const atIso = at && view?.trading_date ? `${view.trading_date}T${at}:59+07:00` : null;
  return (
    <div className="embed-root">
      {opt.header && (
        <div className="embed-head">
          <b>Radar Lệnh Lớn</b>
          <span className={at ? "warn" : "muted"}>
            {at
              ? `Xem lại lúc ${at}`
              : `${hms(status?.now)} · ${status ? (SESSION_LABEL[status.session] ?? status.session) : "…"}`}
          </span>
          <span className="muted">{visible.length} mã</span>
          <span className={`dot ${live.connected ? "ok" : "bad"}`} title="Kết nối" />
        </div>
      )}
      <div className="embed-scope">
        <Radar
          symbols={visible}
          universe={universe}
          pinned={null}
          onPin={onPin}
          now={atIso ?? status?.now ?? null}
          showLegend={opt.legend}
        />
      </div>
      {opt.timeline && <Timeline at={at} nowHm={hm(status?.now)} onChange={setAt} />}
      <div className="embed-foot">{DISCLAIMER}</div>
    </div>
  );
}
