import type { Severity, Side, Dominant } from "./api";

const nf0 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const timeFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** VND value: "1,25 tỷ" / "520 tr" */
export function vnd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf2.format(v / 1e9)} tỷ`;
  if (a >= 1e6) return `${nf0.format(v / 1e6)} tr`;
  return nf0.format(v);
}

export const num = (v: number) => nf0.format(v);
export const price = (v: number) => nf0.format(v);
export const pct = (v: number) => `${v > 0 ? "+" : ""}${nf2.format(v)}%`;

export function hms(iso: string | null | undefined): string {
  if (!iso) return "—";
  return timeFmt.format(new Date(iso));
}

export function duration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} giây`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m} phút ${s} giây` : `${m} phút`;
}

export const SIDE_LABEL: Record<Dominant, string> = {
  buy: "Mua",
  sell: "Bán",
  mixed: "Hỗn hợp",
  unknown: "Không rõ",
};

export const SIDE_GLYPH: Record<Dominant, string> = {
  buy: "▲",
  sell: "▼",
  mixed: "◆",
  unknown: "●",
};

export const sideLabel = (s: Side | Dominant) => SIDE_LABEL[s] ?? s;

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: "Thông tin",
  notice: "Chú ý",
  alert: "Cảnh báo",
};
export const SEVERITY_ICON: Record<Severity, string> = { info: "ⓘ", notice: "◉", alert: "⚠" };
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, notice: 1, alert: 2 };

export const SESSION_LABEL: Record<string, string> = {
  pre_open: "Trước giờ mở cửa",
  ato: "Phiên ATO",
  continuous_am: "Khớp lệnh liên tục · sáng",
  lunch: "Nghỉ trưa",
  continuous_pm: "Khớp lệnh liên tục · chiều",
  atc: "Phiên ATC",
  put_through: "Thỏa thuận",
  closed: "Đóng cửa",
};

export const KIND_LABEL: Record<string, string> = {
  block_order_open: "Nhóm lệnh lớn",
  block_order_update: "Nhóm lệnh lớn",
  block_order_close: "Nhóm lệnh lớn",
  block_auction: "Khớp định kỳ",
  block_putthrough: "Thỏa thuận",
  absorption: "Hấp thụ",
  accumulation: "Gom/xả âm thầm",
};

/** Families used by the accuracy table. */
export const FAMILY_LABEL: Record<string, string> = {
  block_order: "Nhóm lệnh lớn",
  absorption: "Hấp thụ",
  accumulation: "Gom/xả âm thầm",
  block_auction: "Khớp định kỳ",
  block_putthrough: "Thỏa thuận",
  all: "Tất cả",
};

export const HORIZON_LABEL: Record<string, string> = { "5m": "5′", "15m": "15′", "30m": "30′" };

/** Colour class for a price move seen from the order's side (good = moved its way). */
export function moveClass(move: number | null | undefined, side: Side): string {
  if (move == null || side === "unknown" || move === 0) return "muted";
  return (side === "buy" ? move > 0 : move < 0) ? "up" : "down";
}

/** "HH:MM" in Vietnam time for an ISO timestamp. */
export function hm(iso: string | null | undefined): string {
  return hms(iso).slice(0, 5);
}

export const STATE_LABEL: Record<string, string> = {
  open: "Đang mở",
  update: "Đang mở",
  close: "Đã đóng",
  single: "Một lần khớp",
};

export const FLAG_LABEL: Record<string, string> = {
  baseline_cold: "Thiếu dữ liệu nền",
  side_inferred: "Chiều suy luận",
  side_unknown: "Không rõ chiều",
  inside_spread: "Khớp trong spread",
  late_ticks: "Có tick muộn",
  auction: "Khớp định kỳ",
  negotiated: "Thỏa thuận",
};

export const SIDE_SOURCE_LABEL: Record<string, string> = {
  provider: "nguồn",
  quote_rule: "theo giá chào",
  tick_rule: "theo tick",
  unknown: "không rõ",
};

export const DISCLAIMER = "Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư.";
