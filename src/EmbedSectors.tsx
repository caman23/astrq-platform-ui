import { useEffect, useMemo, useState } from "react";
import type { SectorsView } from "./api";
import { api } from "./api";
import { SectorHeatmap } from "./components/Panels";
import { DISCLAIMER, SESSION_LABEL, hms } from "./format";
import { useLive } from "./useLive";
import { useThrottledReload } from "./useThrottledReload";

/**
 * Embeddable sector heatmap (/embed/sectors): net large-order flow per sector.
 * Options via query string:
 *   header=0|1     bg=transparent     click=open|none     compact=0|1
 */
function readOptions() {
  const q = new URLSearchParams(location.search);
  return {
    header: q.get("header") !== "0",
    transparent: q.get("bg") === "transparent",
    click: q.get("click") === "none" ? "none" : "open",
    compact: q.get("compact") === "1",
  };
}

export default function EmbedSectors() {
  const opt = useMemo(readOptions, []);
  const live = useLive([]);
  const [view, setView] = useState<SectorsView | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("embed");
    if (opt.transparent) document.documentElement.classList.add("embed-transparent");
  }, [opt.transparent]);

  // the server renders this once per data version for every viewer (shared cache)
  useThrottledReload(() => api.sectors(), live.radarTick, 4000, setView);

  const onPick =
    opt.click === "none"
      ? undefined
      : (symbol: string) =>
          window.open(
            `${location.origin}/?symbol=${encodeURIComponent(symbol)}`,
            "_blank",
            "noopener",
          );

  const status = live.status;
  return (
    <div className="embed-root">
      {opt.header && (
        <div className="embed-head">
          <b>Dòng tiền lệnh lớn theo ngành</b>
          <span className="muted">
            {hms(status?.now)} · {status ? (SESSION_LABEL[status.session] ?? status.session) : "…"}
          </span>
          <span className={`dot ${live.connected ? "ok" : "bad"}`} title="Kết nối" />
        </div>
      )}
      <div className="embed-heatmap">
        {view ? (
          <SectorHeatmap sectors={view.sectors} onPick={onPick} compact={opt.compact} />
        ) : (
          <p className="empty">Đang tải…</p>
        )}
      </div>
      <div className="embed-foot">
        Ròng = mua chủ động lớn − bán chủ động lớn. {DISCLAIMER}
      </div>
    </div>
  );
}
