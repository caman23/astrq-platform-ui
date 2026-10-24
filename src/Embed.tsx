import { useEffect, useMemo, useState } from "react";
import type { Instrument, RadarView, Severity } from "./api";
import { api } from "./api";
import { Radar } from "./components/Radar";
import { DISCLAIMER, SESSION_LABEL, SEVERITY_RANK, hms } from "./format";
import { useLive } from "./useLive";
import { useThrottledReload } from "./useThrottledReload";

/**
 * Embeddable radar (/embed). Options via query string:
 *   side=all|buy|sell      min=info|notice|alert     legend=0|1     header=0|1
 *   bg=transparent         click=open|none           symbols=FPT,VCB (restrict)
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

  useEffect(() => {
    document.documentElement.classList.add("embed");
    if (opt.transparent) document.documentElement.classList.add("embed-transparent");
    api.universe().then((u) => setUniverse(u.instruments)).catch(() => undefined);
  }, [opt.transparent]);

  useThrottledReload(() => api.view(), live.radarTick, 2500, setView);

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
  return (
    <div className="embed-root">
      {opt.header && (
        <div className="embed-head">
          <b>Radar Lệnh Lớn</b>
          <span className="muted">
            {hms(status?.now)} · {status ? (SESSION_LABEL[status.session] ?? status.session) : "…"}
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
          now={status?.now ?? null}
          showLegend={opt.legend}
        />
      </div>
      <div className="embed-foot">{DISCLAIMER}</div>
    </div>
  );
}
