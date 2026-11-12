import { useState } from "react";
import type { FlowBucket, FlowView } from "../api";
import { vnd } from "../format";

export const FLOW_BUCKETS = [1, 5, 15, 30] as const;

const OPEN = 9 * 60;
const CLOSE = 15 * 60;
const LUNCH = [11 * 60 + 30, 13 * 60] as const;
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// virtual canvas; the SVG scales to the panel width
const W = 400;
const L = 46; // left gutter for the value axis
const R = 6;
const PW = W - L - R;
const TITLE = 14; // panel title row above each plot
const LINE_TOP = TITLE;
const LINE_H = 96;
const BAR_TOP = LINE_TOP + LINE_H + 10 + TITLE;
const BAR_H = 104;
const H = BAR_TOP + BAR_H + 18;

/**
 * Visible time range: the session open to an hour past the last bucket (at least 10:00),
 * so the first hour is readable instead of squeezed into a sixth of the width.
 */
function domainEnd(buckets: FlowBucket[], bucketMin: number): number {
  const last = buckets.length ? toMin(buckets[buckets.length - 1].t) + bucketMin : OPEN;
  const end = Math.ceil((last + 15) / 60) * 60;
  return Math.min(CLOSE, Math.max(OPEN + 60, end === 12 * 60 ? 13 * 60 : end));
}

/** "1,2 tỷ" without the unit for tight axis labels */
const axis = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(a >= 1e10 ? 0 : 1)}tỷ`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}tr`;
  return "0";
};

/**
 * Market-wide large-order flow: cumulative net (top) and buy/sell per bucket (bottom,
 * buys up, sells down). Hover or tap a bucket for its numbers.
 */
export function FlowPanel({
  flow,
  bucket,
  onBucket,
}: {
  flow: FlowView | null;
  bucket: number;
  onBucket: (b: number) => void;
}) {
  const [hover, setHover] = useState<FlowBucket | null>(null);
  if (!flow) return <p className="empty">Đang tải…</p>;
  const { totals, buckets } = flow;
  const shown = hover ?? buckets[buckets.length - 1] ?? null;

  const end = domainEnd(buckets, flow.bucket_min);
  const x = (min: number) => L + ((Math.min(min, end) - OPEN) / (end - OPEN)) * PW;
  const hours = Array.from({ length: (end - OPEN) / 60 + 1 }, (_, i) => 9 + i).filter((h) => h !== 12);

  const cumMax = Math.max(1, ...buckets.map((b) => Math.abs(b.cum_net)));
  const barMax = Math.max(1, ...buckets.map((b) => Math.max(b.buy, b.sell)));
  const lineY = (v: number) => LINE_TOP + LINE_H / 2 - (v / cumMax) * (LINE_H / 2 - 4);
  const barMid = BAR_TOP + BAR_H / 2;
  const barY = (v: number) => (v / barMax) * (BAR_H / 2 - 2);
  const bw = Math.max(1, (flow.bucket_min / (end - OPEN)) * PW - 1);

  // the line steps at bucket ends so a value is drawn where it was reached
  const pts = buckets.map((b) => [x(toMin(b.t) + flow.bucket_min), lineY(b.cum_net)] as const);
  const path = pts.length
    ? `M${x(toMin(buckets[0].t)).toFixed(1)},${lineY(0).toFixed(1)} ` +
      pts.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(" ")
    : "";
  const lastNet = buckets[buckets.length - 1]?.cum_net ?? 0;
  const tone = lastNet >= 0 ? "var(--buy)" : "var(--sell)";

  return (
    <div className="flow">
      <div className="flow-totals">
        <div>
          <label>Ròng lớn</label>
          <span className={`mono ${totals.net_large >= 0 ? "up" : "down"}`}>
            {totals.net_large > 0 ? "+" : ""}
            {vnd(totals.net_large)}
          </span>
        </div>
        <div>
          <label>▲ Mua lớn</label>
          <span className="mono up">{vnd(totals.large_buy)}</span>
        </div>
        <div>
          <label>▼ Bán lớn</label>
          <span className="mono down">{vnd(totals.large_sell)}</span>
        </div>
        <div>
          <label>Tỷ trọng mua</label>
          <span className="mono">{(totals.buy_share * 100).toFixed(0)}%</span>
        </div>
      </div>
      <div className="flow-share" aria-hidden>
        <span style={{ width: `${totals.buy_share * 100}%` }} />
      </div>

      <div className="flow-head">
        <div className="seg" role="group" aria-label="Khung thời gian">
          {FLOW_BUCKETS.map((b) => (
            <button key={b} className={bucket === b ? "on" : ""} onClick={() => onBucket(b)}>
              {b}′
            </button>
          ))}
        </div>
        <span className="muted small">
          {totals.putthrough_count
            ? `Thỏa thuận: ${vnd(totals.putthrough_value)} (${totals.putthrough_count}) — không tính vào dòng tiền`
            : "Không có giao dịch thỏa thuận"}
        </span>
      </div>

      {buckets.length === 0 ? (
        <p className="empty">Chưa có lệnh lớn nào hôm nay.</p>
      ) : (
        <svg
          className="flow-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Dòng tiền lệnh lớn: ròng lũy kế ${vnd(lastNet)}`}
          onMouseLeave={() => setHover(null)}
        >
          {/* lunch break */}
          {end > LUNCH[0] && (
            <>
              <rect x={x(LUNCH[0])} y={LINE_TOP} width={x(LUNCH[1]) - x(LUNCH[0])} height={LINE_H} className="flow-lunch" />
              <rect x={x(LUNCH[0])} y={BAR_TOP} width={x(LUNCH[1]) - x(LUNCH[0])} height={BAR_H} className="flow-lunch" />
            </>
          )}
          {/* cumulative net */}
          <text x={L} y={LINE_TOP - 4} className="flow-title">
            Ròng lũy kế
          </text>
          <text x={L - 4} y={LINE_TOP + 8} className="flow-axis" textAnchor="end">
            {axis(cumMax)}
          </text>
          <text x={L - 4} y={LINE_TOP + LINE_H} className="flow-axis" textAnchor="end">
            {axis(-cumMax)}
          </text>
          <line x1={L} x2={W - R} y1={lineY(0)} y2={lineY(0)} className="flow-zero" />
          <path d={path} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" />
          {pts.length > 0 && (
            <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} fill={tone} />
          )}

          {/* buy / sell per bucket */}
          <text x={L} y={BAR_TOP - 4} className="flow-title">
            ▲ Mua / ▼ bán lớn mỗi {flow.bucket_min}′
          </text>
          <text x={L - 4} y={BAR_TOP + 8} className="flow-axis" textAnchor="end">
            {axis(barMax)}
          </text>
          <text x={L - 4} y={BAR_TOP + BAR_H} className="flow-axis" textAnchor="end">
            {axis(-barMax)}
          </text>
          <line x1={L} x2={W - R} y1={barMid} y2={barMid} className="flow-zero" />
          {buckets.map((b) => {
            const bx = x(toMin(b.t));
            const active = hover?.t === b.t;
            return (
              <g key={b.t} className={active ? "flow-active" : ""}>
                <rect x={bx} y={barMid - barY(b.buy)} width={bw} height={barY(b.buy)} fill="var(--buy)" rx={1} />
                <rect x={bx} y={barMid} width={bw} height={barY(b.sell)} fill="var(--sell)" rx={1} />
                {(b.absorption > 0 || b.accumulation > 0) && (
                  <circle cx={bx + bw / 2} cy={BAR_TOP + BAR_H + 5} r={2.2} className="flow-marker" />
                )}
                {/* hit area spans both panels */}
                <rect
                  x={bx - 0.5}
                  y={0}
                  width={Math.max(bw + 1, 4)}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(b)}
                  onClick={() => setHover(b)}
                >
                  <title>{`${b.t}: mua ${vnd(b.buy)} · bán ${vnd(b.sell)} · ròng lũy kế ${vnd(b.cum_net)}`}</title>
                </rect>
              </g>
            );
          })}

          {/* time axis */}
          {hours.map((h) => (
            <text key={h} x={x(h * 60)} y={H - 1} className="flow-axis" textAnchor="middle">
              {h}h
            </text>
          ))}
        </svg>
      )}

      {shown && (
        <div className="flow-readout small">
          <span className="mono">{shown.t}</span>
          <span className="up">▲ {vnd(shown.buy)} ({shown.n_buy})</span>
          <span className="down">▼ {vnd(shown.sell)} ({shown.n_sell})</span>
          <span>
            Ròng lũy kế{" "}
            <b className={`mono ${shown.cum_net >= 0 ? "up" : "down"}`}>
              {shown.cum_net > 0 ? "+" : ""}
              {vnd(shown.cum_net)}
            </b>
          </span>
          {(shown.absorption > 0 || shown.accumulation > 0) && (
            <span className="muted">
              ● {shown.absorption ? `${shown.absorption} hấp thụ` : ""}
              {shown.absorption && shown.accumulation ? " · " : ""}
              {shown.accumulation ? `${shown.accumulation} gom/xả` : ""}
            </span>
          )}
        </div>
      )}
      <p className="muted small flow-note">
        Mỗi lệnh lớn (khối hoặc nhóm lệnh tách) được tính một lần, vào khung bắt đầu. Chấm ● đánh
        dấu khung có tín hiệu hấp thụ hoặc gom/xả âm thầm.
      </p>
    </div>
  );
}
