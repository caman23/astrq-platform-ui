// Types mirror the backend JSON (astrq/tools/large_order_radar/view.py and core/models.py).

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
  trades: Trade[];
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
  symbols: RadarSymbol[];
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

export const api = {
  view: (symbol?: string) =>
    getJson<RadarView>(
      `/api/tools/large_order_radar/view${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`,
    ),
  universe: () => getJson<{ instruments: Instrument[] }>("/api/universe"),
  tools: () => getJson<ToolInfo[]>("/api/tools"),
  signals: (limit = 150) =>
    getJson<Signal[]>(`/api/signals?tool_id=large_order_radar&limit=${limit}`),
  setEnabled: async (toolId: string, enabled: boolean) => {
    const r = await fetch(`/api/tools/${toolId}/enabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  },
};
