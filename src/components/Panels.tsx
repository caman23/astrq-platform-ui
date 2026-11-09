import { useEffect, useState } from "react";
import type { RadarSymbol, Sector, Severity, Signal, Stats, StatsRow, Status, ToolInfo } from "../api";
import { api } from "../api";
import {
  FAMILY_LABEL,
  HORIZON_LABEL,
  KIND_LABEL,
  SESSION_LABEL,
  SEVERITY_LABEL,
  STATE_LABEL,
  hms,
  moveClass,
  pct,
  vnd,
} from "../format";
import { SeverityBadge, SideTag } from "./OrderDetails";

export function SignalFeed({
  signals,
  onPick,
}: {
  signals: Signal[];
  onPick: (symbol: string) => void;
}) {
  if (!signals.length) return <p className="empty">Chưa có tín hiệu nào khớp bộ lọc.</p>;
  return (
    <ul className="feed">
      {signals.map((s) => {
        const g = s.features.group ?? {};
        return (
          <li key={s.signal_id}>
            <button className="feed-row" onClick={() => onPick(s.symbol)}>
              <span className="mono time">{hms(s.ts)}</span>
              <span className="sym">{s.symbol}</span>
              <SideTag side={s.side} />
              <span className="mono">{vnd(g.total_value ?? 0)}</span>
              <SeverityBadge sev={s.severity} score={s.score} />
              <span className="feed-kind muted">
                {KIND_LABEL[s.kind] ?? s.kind} · {STATE_LABEL[s.state] ?? s.state}
                {g.n_trades ? ` · ${g.n_trades} lệnh` : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type SortKey = "net" | "score";

/** Table view of the radar (also the accessible alternative to the scope). */
export function RankTable({
  symbols,
  onPick,
}: {
  symbols: RadarSymbol[];
  onPick: (symbol: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>("net");
  const rows = [...symbols].sort((a, b) =>
    sort === "net"
      ? Math.abs(b.day_net_large) - Math.abs(a.day_net_large)
      : b.max_score - a.max_score,
  );
  return (
    <div>
      <div className="seg" role="group" aria-label="Sắp xếp">
        <button className={sort === "net" ? "on" : ""} onClick={() => setSort("net")}>
          Theo ròng lớn
        </button>
        <button className={sort === "score" ? "on" : ""} onClick={() => setSort("score")}>
          Theo điểm radar
        </button>
      </div>
      <table className="rank">
        <thead>
          <tr>
            <th>Mã</th>
            <th className="r">Ròng lớn</th>
            <th className="r">Mua lớn</th>
            <th className="r">Bán lớn</th>
            <th className="r">Điểm</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.symbol} onClick={() => onPick(s.symbol)} tabIndex={0}>
              <td>
                <span className="sym">{s.symbol}</span>
              </td>
              <td className={`mono r ${s.day_net_large >= 0 ? "up" : "down"}`}>
                {s.day_net_large > 0 ? "+" : ""}
                {vnd(s.day_net_large)}
              </td>
              <td className="mono r">{vnd(s.day_large_buy)}</td>
              <td className="mono r">{vnd(s.day_large_sell)}</td>
              <td className="mono r">{s.max_score.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const secs = (v: number) => (v < 1 ? `${(v * 1000).toFixed(0)} ms` : `${v.toFixed(2)} s`);

export function SystemPanel({ status }: { status: Status | null }) {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.tools().then(setTools).catch(() => undefined);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);

  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      await api.setEnabled(id, enabled);
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <p className="empty">Đang kết nối…</p>;
  const p = status.provider;
  return (
    <div className="system">
      <dl className="kv">
        <dt>Nguồn dữ liệu</dt>
        <dd>
          <span className={`dot ${p.connected && !p.error ? "ok" : "bad"}`} /> {p.name} · {p.detail}
          {p.error && <div className="down small">{p.error}</div>}
        </dd>
        <dt>Phiên</dt>
        <dd>{SESSION_LABEL[status.session] ?? status.session}</dd>
        <dt>Tick/giây</dt>
        <dd className="mono">{status.tick_rate.toFixed(1)}</dd>
        <dt>Trễ feed (nhà cung cấp)</dt>
        <dd className="mono">
          p50 {secs(status.latency.feed.p50)} · p95 {secs(status.latency.feed.p95)}
        </dd>
        <dt>Trễ nội bộ (tick → tín hiệu)</dt>
        <dd className="mono">
          p50 {secs(status.latency.internal.p50)} · p95 {secs(status.latency.internal.p95)}
        </dd>
        <dt>Baseline</dt>
        <dd className="mono">{Math.round(status.baseline_coverage * 100)}% mã có dữ liệu nền</dd>
        <dt>Rổ</dt>
        <dd>
          {status.universe.name} · {status.universe.size} mã
          {!status.universe.verified && (
            <div className="warn small">⚠ Danh sách mẫu, chưa đối chiếu VN100 chính thức</div>
          )}
        </dd>
        <dt>Ingest</dt>
        <dd className="mono small">
          nhận {status.ingest.accepted ?? 0} · trùng {status.ingest.duplicates ?? 0} · thiếu gói{" "}
          {status.ingest.gaps ?? 0} · muộn {status.ingest.late ?? 0}
        </dd>
      </dl>
      {p.stats && Object.keys(p.stats).length > 0 && (
        <details>
          <summary className="small">Chẩn đoán nguồn dữ liệu (mã phiên, khối lượng sót, đơn vị…)</summary>
          <pre className="mono small stats-pre">{JSON.stringify(p.stats, null, 2)}</pre>
        </details>
      )}

      <div className="section-title">Công cụ</div>
      {tools.map((t) => (
        <div key={t.manifest.id} className="tool-card">
          <div className="tool-head">
            <div>
              <b>{t.manifest.name}</b> <span className="muted small">v{t.manifest.version}</span>
              <div className="muted small">{t.manifest.description}</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={t.status.enabled}
                disabled={busy === t.manifest.id || t.control_enabled === false}
                onChange={(e) => toggle(t.manifest.id, e.target.checked)}
              />
              <span title={t.control_enabled === false ? "Bản công khai: không cho bật/tắt từ web" : undefined}>
                {t.status.enabled ? "Bật" : "Tắt"}
                {t.control_enabled === false && " 🔒"}
              </span>
            </label>
          </div>
          <div className="mono small muted">
            trạng thái {t.status.state} · sự kiện {t.status.events} · tín hiệu {t.status.signals} ·
            lỗi {t.status.errors} · timeout {t.status.timeouts} · hàng đợi {t.status.queue_lag}
          </div>
          <details>
            <summary className="small">Cấu hình (từ manifest)</summary>
            <table className="cfg">
              <tbody>
                {Object.entries(t.config)
                  .filter(([, v]) => typeof v !== "object")
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td className="muted small">
                        {t.manifest.config_schema.properties?.[k]?.description ?? k}
                      </td>
                      <td className="mono small r">{String(v)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- accuracy (follow-through)

const STATS_ORDER = ["all", "alert", "notice", "info", "block_order", "absorption", "accumulation"];

function rowLabel(r: StatsRow): string {
  if (r.group === "severity") return `Mức ${SEVERITY_LABEL[r.key as Severity] ?? r.key}`;
  return FAMILY_LABEL[r.key] ?? r.key;
}

/** Share of orders whose price moved their way 5/15/30 minutes after the first signal. */
export function StatsPanel({ stats }: { stats?: Stats }) {
  const rows = (stats?.rows ?? [])
    .filter((r) => STATS_ORDER.includes(r.key))
    .sort((a, b) => STATS_ORDER.indexOf(a.key) - STATS_ORDER.indexOf(b.key));
  if (!rows.length) {
    return <p className="empty">Chưa có lệnh mua/bán nào đủ 5 phút để đánh giá.</p>;
  }
  return (
    <div className="stats">
      <table className="rank stats-table">
        <thead>
          <tr>
            <th>Nhóm tín hiệu</th>
            <th className="r">Lệnh</th>
            {(stats?.horizons ?? []).map((h) => (
              <th key={h} className="r">
                Sau {HORIZON_LABEL[h] ?? h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.group}:${r.key}`} className={r.group === "all" ? "stats-all" : ""}>
              <td>{rowLabel(r)}</td>
              <td className="mono r">{r.orders}</td>
              {r.hit_rate.map((h, i) => (
                <td key={i} className="mono r" title={`${r.n[i]} lệnh đã đủ thời gian`}>
                  {h == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <b className={h >= 0.55 ? "up" : h <= 0.45 ? "down" : ""}>{Math.round(h * 100)}%</b>
                      <div className={`small ${moveClass(r.avg_move[i], "buy")}`}>
                        {r.avg_move[i] == null ? "" : pct(r.avg_move[i] as number)}
                      </div>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        % = tỷ lệ lệnh mà giá đi đúng chiều (mua → giá tăng, bán → giá giảm) sau khoảng thời gian
        tính từ tín hiệu đầu tiên; dòng dưới = mức thay đổi giá trung bình theo chiều lệnh. Thống kê
        trên dữ liệu đã qua của hôm nay, không phải dự báo. Thỏa thuận/khớp định kỳ không có chiều
        nên không tính.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- sector heatmap

/** Net large-order flow per sector: tone = direction, intensity = size. */
export function SectorHeatmap({
  sectors,
  onPick,
  compact = false,
}: {
  sectors: Sector[];
  onPick?: (symbol: string) => void;
  compact?: boolean;
}) {
  if (!sectors.length) return <p className="empty">Chưa có lệnh lớn nào hôm nay.</p>;
  const maxAbs = Math.max(1, ...sectors.map((s) => Math.abs(s.net_large)));
  return (
    <div className={`heatmap ${compact ? "heatmap-compact" : ""}`}>
      {sectors.map((s) => {
        const heat = Math.sqrt(Math.abs(s.net_large) / maxAbs); // perceptual spread
        const tone = s.net_large > 0 ? "var(--buy)" : s.net_large < 0 ? "var(--sell)" : "var(--unknown)";
        const top = [...s.symbols]
          .sort((a, b) => Math.abs(b.net_large) - Math.abs(a.net_large))
          .slice(0, compact ? 3 : 5);
        return (
          <div
            key={s.sector}
            className="sector-tile"
            style={{ "--heat": heat.toFixed(3), "--tone": tone } as React.CSSProperties}
            title={`Mua lớn ${vnd(s.large_buy)} · Bán lớn ${vnd(s.large_sell)}${s.putthrough_value ? ` · Thỏa thuận ${vnd(s.putthrough_value)}` : ""}`}
          >
            <div className="sector-name">{s.sector}</div>
            <div className={`mono sector-net ${s.net_large >= 0 ? "up" : "down"}`}>
              {s.net_large > 0 ? "+" : ""}
              {vnd(s.net_large)}
            </div>
            <div className="small muted">
              {s.n_active}/{s.n_symbols} mã có lệnh lớn
            </div>
            <div className="sector-syms">
              {top.map((x) => (
                <button
                  key={x.symbol}
                  className={`sym-chip ${x.net_large >= 0 ? "up" : "down"}`}
                  onClick={() => onPick?.(x.symbol)}
                  disabled={!onPick}
                >
                  {x.symbol} <span className="mono">{x.net_large > 0 ? "+" : ""}{vnd(x.net_large)}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- timeline

const OPEN_MIN = 9 * 60;
const CLOSE_MIN = 15 * 60;
const toMin = (hmStr: string) => {
  const [h, m] = hmStr.split(":").map(Number);
  return h * 60 + m;
};
const toHm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Scrub through today's session: `at` = null means live. Play replays the day from the
 * current position (2 minutes per step) and returns to live at the end.
 */
export function Timeline({
  at,
  nowHm,
  onChange,
}: {
  at: string | null;
  nowHm: string;
  onChange: (at: string | null) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const end = Math.max(OPEN_MIN, Math.min(CLOSE_MIN, toMin(nowHm || "15:00")));
  const value = at ? toMin(at) : end;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      const next = (at ? toMin(at) : OPEN_MIN) + 2;
      if (next >= end) {
        setPlaying(false);
        onChange(null);
      } else {
        onChange(toHm(next));
      }
    }, 450);
    return () => window.clearInterval(t);
  }, [playing, at, end, onChange]);

  return (
    <div className="timeline" role="group" aria-label="Dòng thời gian trong ngày">
      <button
        className="tl-btn"
        onClick={() => {
          if (!playing && !at) onChange(toHm(OPEN_MIN));
          setPlaying(!playing);
        }}
        aria-label={playing ? "Tạm dừng" : "Phát lại phiên"}
        title={playing ? "Tạm dừng" : "Phát lại diễn biến trong ngày"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={OPEN_MIN}
        max={end}
        step={1}
        value={value}
        onChange={(e) => {
          setPlaying(false);
          const v = Number(e.target.value);
          onChange(v >= end ? null : toHm(v));
        }}
        aria-label="Thời điểm"
      />
      <span className={`mono tl-time ${at ? "tl-past" : ""}`}>{at ?? nowHm ?? "—"}</span>
      <button
        className={`tl-live ${at ? "" : "on"}`}
        onClick={() => {
          setPlaying(false);
          onChange(null);
        }}
      >
        ● Trực tiếp
      </button>
    </div>
  );
}
