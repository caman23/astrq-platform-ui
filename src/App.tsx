import { useEffect, useMemo, useState } from "react";
import type { Instrument, RadarSymbol, RadarView, Severity, Signal } from "./api";
import { api } from "./api";
import { OrderFull, SeverityBadge, SideTag } from "./components/OrderDetails";
import { RankTable, SignalFeed, SystemPanel } from "./components/Panels";
import { Radar } from "./components/Radar";
import { DISCLAIMER, SESSION_LABEL, SEVERITY_LABEL, SEVERITY_RANK, hms } from "./format";
import { useLive } from "./useLive";
import { useThrottledReload } from "./useThrottledReload";

type SideFilter = "all" | "buy" | "sell";
type Tab = "feed" | "rank" | "system";

export default function App() {
  const [initial, setInitial] = useState<Signal[]>([]);
  const live = useLive(initial);
  const [view, setView] = useState<RadarView | null>(null);
  const [universe, setUniverse] = useState<Instrument[]>([]);
  // ?symbol=FPT opens the detail drawer directly (used by the embedded radar's click-through)
  const [pinned, setPinned] = useState<string | null>(
    () => new URLSearchParams(location.search).get("symbol")?.toUpperCase() || null,
  );
  const [pinnedDetail, setPinnedDetail] = useState<RadarSymbol | null>(null);
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [minSev, setMinSev] = useState<Severity>("notice");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("feed");

  useEffect(() => {
    api.universe().then((u) => setUniverse(u.instruments)).catch(() => undefined);
    api.signals().then(setInitial).catch(() => undefined);
  }, []);

  useThrottledReload(() => api.view(), live.radarTick, 2500, setView);
  useThrottledReload(
    () => (pinned ? api.view(pinned) : Promise.resolve(null)),
    `${pinned}:${live.radarTick}`,
    1500,
    (v) => setPinnedDetail(v?.symbols[0] ?? null),
  );

  const q = query.trim().toUpperCase();
  const visible = useMemo(() => {
    const all = view?.symbols ?? [];
    return all.filter(
      (s) =>
        SEVERITY_RANK[s.max_severity] >= SEVERITY_RANK[minSev] &&
        (sideFilter === "all" || s.dominant_side === sideFilter) &&
        (!q || s.symbol.includes(q)),
    );
  }, [view, minSev, sideFilter, q]);

  const feed = useMemo(
    () =>
      live.signals.filter(
        (s) =>
          SEVERITY_RANK[s.severity] >= SEVERITY_RANK[minSev] &&
          (sideFilter === "all" || s.side === sideFilter) &&
          (!q || s.symbol.includes(q)),
      ),
    [live.signals, minSev, sideFilter, q],
  );

  const status = live.status;
  const latestAlert = live.alerts[0];
  const pinnedSummary = pinnedDetail ?? view?.symbols.find((s) => s.symbol === pinned) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◎
          </span>
          <div>
            <h1>Radar Lệnh Lớn</h1>
            <div className="muted small">
              VN100 · {view?.trading_date ?? status?.trading_date ?? "—"}
            </div>
          </div>
        </div>
        <div className="top-stats">
          <div className="stat">
            <label>Giờ thị trường</label>
            <span className="mono big">{hms(status?.now)}</span>
          </div>
          <div className="stat">
            <label>Phiên</label>
            <span>{status ? (SESSION_LABEL[status.session] ?? status.session) : "—"}</span>
          </div>
          <div className="stat">
            <label>Mã có lệnh lớn</label>
            <span className="mono big">{view?.symbols.length ?? 0}</span>
          </div>
          <div className="stat">
            <label>Kết nối</label>
            <span>
              <span className={`dot ${live.connected ? "ok" : "bad"}`} />{" "}
              {live.connected ? status?.provider.name ?? "…" : "Mất kết nối"}
              {status && status.clock_speed > 1 && (
                <span className="chip">mô phỏng ×{status.clock_speed}</span>
              )}
            </span>
          </div>
        </div>
      </header>

      <div className="filters" role="toolbar" aria-label="Bộ lọc">
        <div className="seg" role="group" aria-label="Chiều">
          {(["all", "buy", "sell"] as SideFilter[]).map((k) => (
            <button key={k} className={sideFilter === k ? "on" : ""} onClick={() => setSideFilter(k)}>
              {k === "all" ? "Tất cả" : k === "buy" ? "▲ Mua" : "▼ Bán"}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Mức độ tối thiểu">
          {(["info", "notice", "alert"] as Severity[]).map((k) => (
            <button key={k} className={minSev === k ? "on" : ""} onClick={() => setMinSev(k)}>
              ≥ {SEVERITY_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder="Tìm mã…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Tìm mã"
        />
        <span className="muted small">
          Hiển thị {visible.length}/{view?.symbols.length ?? 0} mã
        </span>
      </div>

      <main className="layout">
        <section className="scope-panel" aria-label="Màn hình radar">
          <Radar
            symbols={visible}
            universe={universe}
            pinned={pinned}
            onPin={setPinned}
            now={status?.now ?? null}
          />
          {latestAlert && Date.now() - latestAlert.at < 12_000 && (
            <button
              className={`toast sev-${latestAlert.severity}`}
              onClick={() => latestAlert.symbol && setPinned(latestAlert.symbol)}
            >
              {latestAlert.text.split("\n").slice(0, 2).join(" · ")}
            </button>
          )}
        </section>

        <aside className="side-panel">
          <nav className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "feed"} onClick={() => setTab("feed")}>
              Luồng tín hiệu
            </button>
            <button role="tab" aria-selected={tab === "rank"} onClick={() => setTab("rank")}>
              Bảng VN100
            </button>
            <button role="tab" aria-selected={tab === "system"} onClick={() => setTab("system")}>
              Hệ thống
            </button>
          </nav>
          <div className="tab-body">
            {tab === "feed" && <SignalFeed signals={feed.slice(0, 120)} onPick={setPinned} />}
            {tab === "rank" && <RankTable symbols={visible} onPick={setPinned} />}
            {tab === "system" && <SystemPanel status={status} />}
          </div>
        </aside>
      </main>

      {pinned && (
        <div className="drawer" role="dialog" aria-label={`Chi tiết ${pinned}`}>
          <div className="drawer-head">
            <div>
              <span className="sym big">{pinned}</span>{" "}
              <span className="muted">{pinnedSummary?.sector}</span>
            </div>
            {pinnedSummary && (
              <div className="drawer-badges">
                <SideTag side={pinnedSummary.dominant_side} />
                <SeverityBadge sev={pinnedSummary.max_severity} score={pinnedSummary.max_score} />
              </div>
            )}
            <button className="close" onClick={() => setPinned(null)} aria-label="Đóng">
              ✕
            </button>
          </div>
          <div className="drawer-body">
            {pinnedSummary ? <OrderFull s={pinnedSummary} /> : <p className="empty">Đang tải…</p>}
          </div>
        </div>
      )}

      {live.summary && (
        <pre className="summary-box">{live.summary}</pre>
      )}

      <footer className="disclaimer">
        {DISCLAIMER} Hệ thống chỉ đọc và phân tích dữ liệu, không đặt lệnh.
        {status?.provider.name === "synthetic" && " Đang chạy trên dữ liệu MÔ PHỎNG."}
      </footer>
    </div>
  );
}
