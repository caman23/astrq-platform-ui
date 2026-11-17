// Types mirror the backend JSON (backend-rs/src/tools/large_order_radar/view.rs, core/models.rs).

export type Side = "buy" | "sell" | "unknown";
export type Dominant = Side | "mixed";
export type Severity = "info" | "notice" | "alert";

export interface Trade {
  ts: string;
  price: number;
  volume: number;
  value: number;
  side: Side;
  side_source: string;
  confidence: number;
  inside_spread: boolean;
  triggers: string[];
  seq: number | null;
}

export interface Contribution {
  factor: string;
  label: string;
  raw: number;
  normalized: number;
  weight: number;
  contribution: number;
  note: string;
}

export interface Order {
  id: string;
  kind: string;
  state: string;
  side: Side;
  score: number;
  severity: Severity;
  peak_score: number;
  peak_severity: Severity;
  quality_flags: string[];
  updated_at: string;
  updates: number;
  summary_vi: string[];
  explanation: Contribution[];
  session: string;
  total_value: number;
  total_volume: number;
  n_trades: number;
  vwap: number;
  first_price: number;
  last_price: number;
  price_change_pct: number;
  started_at: string;
  last_at: string;
  duration_sec: number;
  max_single_value: number;
  triggers: string[];
  side_confidence: number;
  /** absorption / accumulation: share of the window's flow on the pressured side */
  flow_share?: number;
  trades: Trade[];
  outcome?: Outcome | null;
}

/** Price move (%) after the order's first signal; null until the horizon has elapsed. */
export interface Outcome {
  ref_price: number;
  "5m": number | null;
  "15m": number | null;
  "30m": number | null;
  now: number | null;
}

export const HORIZONS = ["5m", "15m", "30m"] as const;

export interface StatsRow {
  group: "severity" | "family" | "all";
  key: string;
  orders: number;
  n: number[];
  hit_rate: (number | null)[];
  avg_move: (number | null)[];
}

export interface Stats {
  horizons: string[];
  rows: StatsRow[];
}

export interface Baseline {
  median_trade_value: number;
  p95_trade_value: number;
  avg_daily_value: number;
  liquidity_tier: string;
  source: string;
}

export interface RadarSymbol {
  symbol: string;
  sector: string | null;
  max_score: number;
  max_severity: Severity;
  dominant_side: Dominant;
  last_signal_at: string;
  n_orders: number;
  day_large_buy: number;
  day_large_sell: number;
  day_net_large: number;
  day_putthrough_value: number;
  metrics: Record<string, number>;
  baseline: Baseline | null;
  orders: Order[];
}

export interface RadarView {
  trading_date: string;
  /** set when viewing a past moment of the day (timeline) */
  at?: string | null;
  /** a past session (`?date=`); `has_outcomes` false = saved before archives existed */
  archived?: boolean;
  has_outcomes?: boolean;
  stats?: Stats;
  symbols: RadarSymbol[];
}

export interface SectorSymbol {
  symbol: string;
  large_buy: number;
  large_sell: number;
  net_large: number;
  max_score: number;
  max_severity: Severity;
}

export interface Sector {
  sector: string;
  n_symbols: number;
  n_active: number;
  large_buy: number;
  large_sell: number;
  net_large: number;
  putthrough_value: number;
  max_score: number;
  max_severity: Severity;
  symbols: SectorSymbol[];
}

export interface SectorsView {
  trading_date: string;
  archived?: boolean;
  at?: string | null;
  sectors: Sector[];
}

export interface FlowBucket {
  /** bucket start, "HH:MM" Vietnam time */
  t: string;
  buy: number;
  sell: number;
  net: number;
  cum_net: number;
  n_buy: number;
  n_sell: number;
  absorption: number;
  accumulation: number;
}

export interface FlowView {
  trading_date: string;
  archived?: boolean;
  at?: string | null;
  bucket_min: number;
  buckets: FlowBucket[];
  totals: {
    large_buy: number;
    large_sell: number;
    net_large: number;
    buy_share: number;
    putthrough_value: number;
    putthrough_count: number;
  };
}

export interface Signal {
  signal_id: string;
  tool_id: string;
  symbol: string;
  ts: string;
  kind: string;
  side: Side;
  score: number;
  severity: Severity;
  state: string;
  features: { group?: Partial<Order>; summary_vi?: string[] } & Record<string, unknown>;
  quality_flags: string[];
  correlation_id: string;
}

export interface Latency {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface ToolStatus {
  tool_id: string;
  enabled: boolean;
  state: string;
  events: number;
  signals: number;
  errors: number;
  timeouts: number;
  queue_lag: number;
  dropped: number;
  last_error: string | null;
}

export interface Status {
  now: string;
  trading_date: string;
  session: string;
  clock: string;
  clock_speed: number;
  provider: {
    name: string;
    connected: boolean;
    finished: boolean;
    last_event_at: string | null;
    reconnects: number;
    detail: string;
    error: string | null;
    stats?: Record<string, unknown>;
  };
  ingest: Record<string, number>;
  tick_rate: number;
  latency: { feed: Latency; internal: Latency };
  baseline_coverage: number;
  universe: { name: string; size: number; verified: boolean; as_of: string | null };
  signals_today: number;
  tools: ToolStatus[];
}

export interface ToolInfo {
  manifest: {
    id: string;
    version: string;
    name: string;
    description: string;
    config_schema: { properties?: Record<string, { title?: string; description?: string }> };
    signal_kinds: string[];
  };
  config: Record<string, unknown>;
  status: ToolStatus;
  control_enabled?: boolean;
}

export interface Instrument {
  symbol: string;
  exchange: string;
  sector: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

const VIEW = "/api/tools/large_order_radar/view";
const qs = (p: Record<string, string | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
};

// ---------------------------------------------------------------- indicator screener

export interface Operand {
  ind?: string;
  value?: number;
  n?: number;
  fast?: number;
  slow?: number;
  signal?: number;
  k?: number;
  field?: string;
}

export interface Condition {
  left: Operand;
  op: string;
  right: Operand;
}

export interface IndicatorSpec {
  id: string;
  label: string;
  unit: string;
  hint: string;
  params: { name: string; default: number; min: number; max: number }[];
  fields: { id: string; label: string }[];
}

export interface ScreenerMeta {
  source: string;
  indicators: IndicatorSpec[];
  presets: { id: string; label: string; conditions: Condition[] }[];
  ops: { id: string; label: string }[];
  max_conditions: number;
}

export interface ScanRow {
  symbol: string;
  sector: string | null;
  date: string;
  close: number;
  change_pct: number | null;
  volume: number;
  bars: number;
  checks: boolean[];
  values: Record<string, number | null>;
  spark: number[];
}

export interface ScanResult {
  source: string;
  as_of: string | null;
  logic: "all" | "any";
  conditions: string[];
  columns: { key: string; label: string }[];
  scanned: number;
  requested: number;
  matched: number;
  errors: { symbol: string; error: string }[];
  took_ms: number;
  rows: ScanRow[];
}

export interface History {
  /** session held by the live radar */
  live_date: string;
  today: string;
  retention_days: number;
  /** past sessions that can be viewed, newest first */
  dates: string[];
}

export const api = {
  /** `at` = "HH:MM" (Vietnam time) for a past moment; `date` = a past session */
  view: (symbol?: string | null, at?: string | null, date?: string | null) =>
    getJson<RadarView>(VIEW + qs({ symbol, at, date })),
  sectors: (at?: string | null, date?: string | null) =>
    getJson<SectorsView>(VIEW + qs({ sectors: "1", at, date })),
  /** market-wide large-order flow per `bucket` minutes (1 · 5 · 15 · 30) */
  flow: (at?: string | null, bucket = 5, date?: string | null) =>
    getJson<FlowView>(VIEW + qs({ flow: "1", bucket: String(bucket), at, date })),
  universe: () => getJson<{ instruments: Instrument[] }>("/api/universe"),
  tools: () => getJson<ToolInfo[]>("/api/tools"),
  history: () => getJson<History>("/api/history"),
  screenerMeta: () => getJson<ScreenerMeta>("/api/screener/meta"),
  /** run a scan on demand; throws with the server's message on 4xx/5xx */
  scan: async (body: { conditions: Condition[]; logic: string; symbols?: string[] | null }) => {
    const r = await fetch("/api/screener/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = j?.detail ?? (r.status === 429 ? "Quá nhiều yêu cầu, thử lại sau ít giây." : `HTTP ${r.status}`);
      throw new Error(msg);
    }
    return j as ScanResult;
  },
  signals: (limit = 150, date?: string | null) =>
    getJson<Signal[]>(`/api/signals${qs({ tool_id: "large_order_radar", limit: String(limit), date })}`),
  setEnabled: async (toolId: string, enabled: boolean) => {
    const r = await fetch(`/api/tools/${toolId}/enabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  },
};
