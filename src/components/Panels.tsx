import { useEffect, useState } from "react";
import type { RadarSymbol, Signal, Status, ToolInfo } from "../api";
import { api } from "../api";
import { KIND_LABEL, SESSION_LABEL, STATE_LABEL, hms, vnd } from "../format";
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
