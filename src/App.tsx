import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowView, History, Instrument, RadarSymbol, RadarView, SectorsView, Severity, Signal } from "./api";
import { api } from "./api";
import { FlowPanel } from "./components/Flow";
import { OrderFull, SeverityBadge, SideTag } from "./components/OrderDetails";
import {
  RankTable,
  SectorHeatmap,
  SignalFeed,
  StarButton,
  StatsPanel,
  SystemPanel,
  Timeline,
} from "./components/Panels";
import type { NotifyMode } from "./prefs";
import {
  NOTIFY_LABEL,
  requestNotifyPermission,
  useAlertNotifications,
  usePersistentNotifyMode,
  useWatchlist,
} from "./prefs";
import { Radar } from "./components/Radar";
import { DISCLAIMER, SESSION_LABEL, SEVERITY_LABEL, SEVERITY_RANK, hm, hms } from "./format";
import { useLive } from "./useLive";
import { useThrottledReload } from "./useThrottledReload";

type SideFilter = "all" | "buy" | "sell";
type Tab = "feed" | "rank" | "flow" | "sectors" | "stats" | "system";
const NOTIFY_NEXT: Record<NotifyMode, NotifyMode> = { off: "watch", watch: "all", all: "off" };
/** Sessions in which the market is trading (the live radar is the thing to watch). */
const TRADING = new Set(["ato", "continuous_am", "lunch", "continuous_pm", "atc", "put_through"]);
const dmy = (d: string) => d.split("-").reverse().join("/");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  // timeline: null = live, "HH:MM" = the radar as it was at that moment today
  const [at, setAt] = useState<string | null>(null);
  const atRef = useRef(at);
  atRef.current = at;
  const [sectors, setSectors] = useState<SectorsView | null>(null);
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [flowBucket, setFlowBucket] = useState(5);
  // past session: null = live; ?date=YYYY-MM-DD opens one directly
  const [date, setDate] = useState<string | null>(() => {
    const d = new URLSearchParams(location.search).get("date");
    return d && DATE_RE.test(d) ? d : null;
  });
  const dateRef = useRef(date);
  dateRef.current = date;
  const [history, setHistory] = useState<History | null>(null);
  const [autoPicked, setAutoPicked] = useState(false);
  const [pastFeed, setPastFeed] = useState<Signal[]>([]);
  const pickDate = (d: string | null, auto = false) => {
    setDate(d);
    setAt(null);
    setAutoPicked(auto);
    setPastFeed([]);
    const u = new URL(location.href);
    if (d) u.searchParams.set("date", d);
    else u.searchParams.delete("date");
    history_replace(u);
  };
  const watch = useWatchlist();
  const [onlyWatched, setOnlyWatched] = useState(false);
  const [notifyMode, setNotifyMode] = usePersistentNotifyMode();
  useAlertNotifications(live.alerts, notifyMode, watch, setPinned);
  const cycleNotify = async () => {
    const next = NOTIFY_NEXT[notifyMode];
    // sound still works when the browser refuses desktop notifications
    if (next !== "off") await requestNotifyPermission();
    setNotifyMode(next);
  };

  useEffect(() => {
    api.universe().then((u) => setUniverse(u.instruments)).catch(() => undefined);
    api.signals().then(setInitial).catch(() => undefined);
    api.history().then(setHistory).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (date) api.signals(300, date).then(setPastFeed).catch(() => setPastFeed([]));
  }, [date]);

  // Live: reload after radar signals (throttled). Timeline: reload on every scrub step;
  // a late response for an older position is dropped.
  // a late response for another moment or another session is dropped
  const matchesAt = (v: { at?: string | null; trading_date: string; archived?: boolean }) =>
    (v.at ? hm(v.at) : null) === atRef.current &&
    (dateRef.current ? v.trading_date === dateRef.current : !v.archived);
  // past sessions never change: reload only when the position changes
  const tick = date ? `d:${date}` : `live:${live.radarTick}`;
  const fast = at || date;
  useThrottledReload(
    () => api.view(null, at, date),
    `${date}:${at ?? tick}`,
    fast ? 150 : 2500,
    (v) => matchesAt(v) && setView(v),
  );
  useThrottledReload(
    () => (tab === "sectors" ? api.sectors(at, date) : Promise.resolve(null)),
    `${tab}:${date}:${at ?? tick}`,
    fast ? 150 : 3000,
    (v) => v && matchesAt(v) && setSectors(v),
  );
  useThrottledReload(
    () => (tab === "flow" ? api.flow(at, flowBucket, date) : Promise.resolve(null)),
    `${tab}:${flowBucket}:${date}:${at ?? tick}`,
    fast ? 150 : 3000,
    (v) => v && matchesAt(v) && v.bucket_min === flowBucket && setFlow(v),
  );
  useThrottledReload(
    () => (pinned ? api.view(pinned, null, date) : Promise.resolve(null)),
    `${pinned}:${date ?? live.radarTick}`,
    1500,
    (v) => setPinnedDetail(v?.symbols[0] ?? null),
  );

  // Outside trading hours with an empty live radar (weekend, holiday, before the open,
  // after a restart), show the last recorded session instead of an empty screen.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || date || !history || !view || !live.status) return;
    autoTried.current = true;
    const quiet = !TRADING.has(live.status.session);
    if (quiet && view.symbols.length === 0 && history.dates.length) pickDate(history.dates[0], true);
  }, [history, view, live.status, date]);

  const q = query.trim().toUpperCase();
  const visible = useMemo(() => {
    const all = view?.symbols ?? [];
    return all.filter(
      (s) =>
        SEVERITY_RANK[s.max_severity] >= SEVERITY_RANK[minSev] &&
        (sideFilter === "all" || s.dominant_side === sideFilter) &&
        (!onlyWatched || watch.has(s.symbol)) &&
        (!q || s.symbol.includes(q)),
    );
  }, [view, minSev, sideFilter, q, onlyWatched, watch]);

  const atIso = at && view?.trading_date ? `${view.trading_date}T${at}:59+07:00` : null;
  // the radar's "now": end of a past session, or the market clock
  const radarNow = atIso ?? (date ? `${date}T15:00:00+07:00` : status_now(live.status));
  const feed = useMemo(
    () =>
      (date ? pastFeed : live.signals).filter(
        (s) =>
          (!atIso || Date.parse(s.ts) <= Date.parse(atIso)) &&
          SEVERITY_RANK[s.severity] >= SEVERITY_RANK[minSev] &&
          (sideFilter === "all" || s.side === sideFilter) &&
          (!onlyWatched || watch.has(s.symbol)) &&
          (!q || s.symbol.includes(q)),
      ),
    [live.signals, pastFeed, date, minSev, sideFilter, q, atIso, onlyWatched, watch.symbols],
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
            <div className="muted small session-pick">
              VN100 ·{" "}
              <select
                value={date ?? ""}
                onChange={(e) => pickDate(e.target.value || null)}
                aria-label="Chọn phiên giao dịch"
                title="Xem lại một phiên đã qua"
              >
                <option value="">
                  {history ? dmy(history.live_date) : (status?.trading_date ?? "—")} · trực tiếp
                </option>
                {history?.dates.map((d) => (
                  <option key={d} value={d}>
                    {dmy(d)}
                  </option>
                ))}
                {date && !history?.dates.includes(date) && <option value={date}>{dmy(date)}</option>}
              </select>
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
            <span>
              {date ? `Xem lại ${dmy(date)}` : status ? (SESSION_LABEL[status.session] ?? status.session) : "—"}
            </span>
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
        <button
          className={`tool-btn ${onlyWatched ? "on" : ""}`}
          onClick={() => setOnlyWatched(!onlyWatched)}
          aria-pressed={onlyWatched}
          title={watch.symbols.size ? "Chỉ hiện các mã đã đánh dấu ★" : "Bấm ☆ ở Bảng VN100 hoặc chi tiết mã để theo dõi"}
        >
          ★ Theo dõi ({watch.symbols.size})
        </button>
        <button
          className={`tool-btn ${notifyMode !== "off" ? "on" : ""}`}
          onClick={cycleNotify}
          title="Âm thanh và thông báo trình duyệt khi có cảnh báo (bấm để đổi chế độ)"
        >
          {NOTIFY_LABEL[notifyMode]}
        </button>
        <span className="muted small">
          Hiển thị {visible.length}/{view?.symbols.length ?? 0} mã
        </span>
        {date && (
          <button className="chip chip-past" onClick={() => pickDate(null)} title="Về phiên trực tiếp">
            📅 {autoPicked ? "Ngoài giờ giao dịch · đang xem" : "Đang xem"} phiên {dmy(date)}
            {at ? ` lúc ${at}` : ""} · về trực tiếp
          </button>
        )}
        {at && !date && (
          <button className="chip chip-past" onClick={() => setAt(null)} title="Về trực tiếp">
            ⏪ Đang xem lại lúc {at} · về trực tiếp
          </button>
        )}
      </div>

      <main className="layout">
        <section className="scope-panel" aria-label="Màn hình radar">
          <Radar
            symbols={visible}
            universe={universe}
            pinned={pinned}
            onPin={setPinned}
            now={radarNow}
            watched={watch.symbols}
          />
          <Timeline at={at} nowHm={date ? "15:00" : hm(status?.now)} onChange={setAt} />
          {!at && !date && latestAlert && Date.now() - latestAlert.at < 12_000 && (
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
            <button role="tab" aria-selected={tab === "flow"} onClick={() => setTab("flow")}>
              Dòng tiền
            </button>
            <button role="tab" aria-selected={tab === "sectors"} onClick={() => setTab("sectors")}>
              Ngành
            </button>
            <button role="tab" aria-selected={tab === "stats"} onClick={() => setTab("stats")}>
              Hiệu quả
            </button>
            <button role="tab" aria-selected={tab === "system"} onClick={() => setTab("system")}>
              Hệ thống
            </button>
          </nav>
          <div className="tab-body">
            {tab === "feed" && <SignalFeed signals={feed.slice(0, 120)} onPick={setPinned} />}
            {tab === "rank" && (
              <RankTable symbols={visible} onPick={setPinned} watch={watch} tradingDate={view?.trading_date} />
            )}
            {tab === "flow" && <FlowPanel flow={flow} bucket={flowBucket} onBucket={setFlowBucket} />}
            {tab === "sectors" &&
              (sectors ? (
                <SectorHeatmap sectors={sectors.sectors} onPick={setPinned} />
              ) : (
                <p className="empty">Đang tải…</p>
              ))}
            {tab === "stats" &&
              (at ? (
                <p className="empty">Bảng hiệu quả tính cho cả phiên — kéo timeline về cuối để xem.</p>
              ) : view?.archived && !view.has_outcomes ? (
                <p className="empty">Phiên này được ghi trước khi có lưu trữ cuối ngày, nên không có số liệu giá sau tín hiệu.</p>
              ) : (
                <StatsPanel stats={view?.stats} />
              ))}
            {tab === "system" && <SystemPanel status={status} />}
          </div>
        </aside>
      </main>

      {pinned && (
        <div className="drawer" role="dialog" aria-label={`Chi tiết ${pinned}`}>
          <div className="drawer-head">
            <div>
              <StarButton symbol={pinned} watch={watch} />
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

function status_now(st: { now: string } | null): string | null {
  return st?.now ?? null;
}

/** Keep the address bar in sync (shareable link) without adding history entries. */
function history_replace(u: URL) {
  try {
    window.history.replaceState(null, "", u);
  } catch {
    /* sandboxed iframes may refuse */
  }
}
