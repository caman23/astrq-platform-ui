import type { Order, RadarSymbol, Trade } from "../api";
import {
  FLAG_LABEL,
  KIND_LABEL,
  SEVERITY_ICON,
  SEVERITY_LABEL,
  SIDE_GLYPH,
  SIDE_SOURCE_LABEL,
  STATE_LABEL,
  duration,
  hms,
  num,
  pct,
  price,
  sideLabel,
  vnd,
} from "../format";

export function SeverityBadge({ sev, score }: { sev: Order["severity"]; score?: number }) {
  return (
    <span className={`badge sev-badge sev-${sev}`}>
      {SEVERITY_ICON[sev]} {SEVERITY_LABEL[sev]}
      {score !== undefined && <b> {score.toFixed(0)}</b>}
    </span>
  );
}

export function SideTag({ side }: { side: Order["side"] | "mixed" }) {
  return (
    <span className={`side-tag side-${side}`}>
      {SIDE_GLYPH[side]} {sideLabel(side)}
    </span>
  );
}

function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <div className="flags">
      {flags.map((f) => (
        <span key={f} className="flag">
          {FLAG_LABEL[f] ?? f}
        </span>
      ))}
    </div>
  );
}

function OrderLine({ o }: { o: Order }) {
  const live = o.state === "open" || o.state === "update";
  return (
    <div className="order-line">
      <div className="order-line-top">
        <span className="mono time">
          {o.n_trades > 1 ? `${hms(o.started_at)}–${hms(o.last_at)}` : hms(o.started_at)}
        </span>
        <SideTag side={o.side} />
        <span className="muted">{KIND_LABEL[o.kind] ?? o.kind}</span>
        <span className={`state ${live ? "state-live" : ""}`}>{STATE_LABEL[o.state] ?? o.state}</span>
      </div>
      <div className="order-line-nums mono">
        <b>{vnd(o.total_value)}</b>
        <span>{o.n_trades} lệnh</span>
        <span>giá TB {price(o.vwap)}</span>
        {o.n_trades > 1 && (
          <span className={o.price_change_pct >= 0 ? "up" : "down"}>{pct(o.price_change_pct)}</span>
        )}
      </div>
    </div>
  );
}

export function TradesTable({ trades, max, total }: { trades: Trade[]; max?: number; total?: number }) {
  const rows = max ? trades.slice(-max) : trades;
  // the overview view only ships the last few trades; `total` is the order's real count
  const hidden = Math.max(total ?? trades.length, trades.length) - rows.length;
  return (
    <table className="trades">
      <thead>
        <tr>
          <th>Thời gian</th>
          <th className="r">Giá</th>
          <th className="r">KL</th>
          <th className="r">Giá trị</th>
          <th>Chiều</th>
        </tr>
      </thead>
      <tbody>
        {hidden > 0 && (
          <tr>
            <td colSpan={5} className="muted small">
              … {hidden} lệnh trước đó
            </td>
          </tr>
        )}
        {rows.map((t, i) => (
          <tr key={`${t.seq}-${i}`}>
            <td className="mono">{hms(t.ts)}</td>
            <td className="mono r">{price(t.price)}</td>
            <td className="mono r">{num(t.volume)}</td>
            <td className="mono r">{vnd(t.value)}</td>
            <td>
              <span className={`side-${t.side} side-glyph`}>{SIDE_GLYPH[t.side]}</span>
              {t.side_source !== "provider" && (
                <span className="muted small"> {SIDE_SOURCE_LABEL[t.side_source] ?? t.side_source}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DayNumbers({ s }: { s: RadarSymbol }) {
  return (
    <div className="day-grid">
      <div>
        <label>Mua lớn</label>
        <span className="mono">{vnd(s.day_large_buy)}</span>
      </div>
      <div>
        <label>Bán lớn</label>
        <span className="mono">{vnd(s.day_large_sell)}</span>
      </div>
      <div>
        <label>Ròng lớn</label>
        <span className={`mono ${s.day_net_large >= 0 ? "up" : "down"}`}>
          {s.day_net_large > 0 ? "+" : ""}
          {vnd(s.day_net_large)}
        </span>
      </div>
      <div>
        <label>Thỏa thuận</label>
        <span className="mono">{s.day_putthrough_value ? vnd(s.day_putthrough_value) : "—"}</span>
      </div>
    </div>
  );
}

/** Hover card: who, how big, when — plus the child trades of the latest order. */
export function OrderPeek({ s }: { s: RadarSymbol }) {
  const latest = s.orders[0];
  return (
    <div className="peek">
      <div className="peek-head">
        <div>
          <span className="sym">{s.symbol}</span>
          <span className="muted"> {s.sector}</span>
        </div>
        <SeverityBadge sev={s.max_severity} score={s.max_score} />
      </div>
      <DayNumbers s={s} />
      <div className="section-title">
        Lệnh lớn hôm nay <span className="muted">({s.n_orders})</span>
      </div>
      {s.orders.slice(0, 4).map((o) => (
        <OrderLine key={o.id} o={o} />
      ))}
      {latest && latest.trades.length > 0 && (
        <>
          <div className="section-title">
            Chi tiết khớp · lệnh gần nhất{" "}
            <span className="muted">
              ({latest.n_trades > 1 ? duration(latest.duration_sec) : "1 lần khớp"})
            </span>
          </div>
          <TradesTable trades={latest.trades} max={8} total={latest.n_trades} />
          <Flags flags={latest.quality_flags} />
        </>
      )}
      <div className="hint">Bấm để ghim và xem toàn bộ chi tiết</div>
    </div>
  );
}

function Explanation({ o }: { o: Order }) {
  if (!o.explanation.length) return null;
  return (
    <div className="explain">
      {o.explanation.map((c) => (
        <div key={c.factor} className="explain-row" title={c.note}>
          <span className="explain-label">{c.label}</span>
          <span className="explain-bar">
            <span style={{ width: `${Math.min(100, (c.contribution / (c.weight * 100 || 1)) * 100)}%` }} />
          </span>
          <span className="mono small r">+{c.contribution.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

/** Full detail for the pinned drawer: every order with all child trades & score breakdown. */
export function OrderFull({ s }: { s: RadarSymbol }) {
  return (
    <div className="full">
      <DayNumbers s={s} />
      {s.baseline && (
        <p className="muted small">
          Mức bình thường: trung vị lệnh {vnd(s.baseline.median_trade_value)} · GTGD TB/ngày{" "}
          {vnd(s.baseline.avg_daily_value)} · thanh khoản {s.baseline.liquidity_tier}
        </p>
      )}
      {s.orders.map((o) => (
        <details key={o.id} className="order-card" open={o === s.orders[0]}>
          <summary>
            <OrderLine o={o} />
            <SeverityBadge sev={o.peak_severity} score={o.peak_score} />
          </summary>
          {o.summary_vi.length > 0 && (
            <ul className="summary">
              {o.summary_vi.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <Flags flags={o.quality_flags} />
          <div className="section-title">Điểm radar gồm</div>
          <Explanation o={o} />
          <div className="section-title">
            Lệnh khớp ({o.n_trades}){" "}
            {o.trades.length < o.n_trades && (
              <span className="muted small">· hiển thị {o.trades.length} lệnh đầu/cuối</span>
            )}
          </div>
          <TradesTable trades={o.trades} />
        </details>
      ))}
    </div>
  );
}
