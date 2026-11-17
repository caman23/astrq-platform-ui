import { useEffect, useMemo, useState } from "react";
import type { Condition, IndicatorSpec, Operand, ScanResult, ScanRow, ScreenerMeta } from "../api";
import { api } from "../api";
import { DISCLAIMER, pct, price } from "../format";
import type { Watchlist } from "../prefs";
import { downloadCsv, usePersistent } from "../prefs";
import { StarButton } from "./Panels";

const DEFAULT_CONDITIONS: Condition[] = [
  { left: { ind: "rsi", n: 14 }, op: "lt", right: { value: 30 } },
];
const dmy = (d: string) => d.split("-").reverse().join("/");
const SOURCE_LABEL: Record<string, string> = { dnse: "DNSE (nến ngày)", synthetic: "dữ liệu MÔ PHỎNG" };

/** The parameters of an indicator, defaults filled in. */
function withDefaults(spec: IndicatorSpec | undefined, o: Operand): Operand {
  if (!spec) return o;
  const out: Operand = { ind: spec.id };
  for (const p of spec.params) {
    const v = (o as Record<string, number | undefined>)[p.name];
    (out as Record<string, number>)[p.name] = v ?? p.default;
  }
  if (spec.fields.length) out.field = o.field ?? spec.fields[0].id;
  return out;
}

function OperandEditor({
  value,
  onChange,
  specs,
  allowConst,
  label,
}: {
  value: Operand;
  onChange: (o: Operand) => void;
  specs: IndicatorSpec[];
  allowConst: boolean;
  label: string;
}) {
  const isConst = value.ind === undefined;
  const spec = specs.find((s) => s.id === value.ind);
  return (
    <div className="operand" role="group" aria-label={label}>
      <select
        value={isConst ? "__value" : value.ind}
        onChange={(e) => {
          const id = e.target.value;
          if (id === "__value") onChange({ value: value.value ?? 0 });
          else onChange(withDefaults(specs.find((s) => s.id === id), {}));
        }}
        aria-label={`${label}: chỉ báo`}
      >
        {allowConst && <option value="__value">Giá trị số</option>}
        {specs.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {isConst ? (
        <input
          type="number"
          step="any"
          className="num"
          value={value.value ?? 0}
          onChange={(e) => onChange({ value: Number(e.target.value) })}
          aria-label={`${label}: giá trị`}
        />
      ) : (
        <>
          {spec?.params.map((p) => (
            <label key={p.name} className="param" title={`${p.name}: ${p.min}–${p.max}`}>
              <span>{p.name === "n" ? "n" : p.name}</span>
              <input
                type="number"
                min={p.min}
                max={p.max}
                step={p.name === "k" ? 0.1 : 1}
                value={(value as Record<string, number | undefined>)[p.name] ?? p.default}
                onChange={(e) => onChange({ ...value, [p.name]: Number(e.target.value) })}
              />
            </label>
          ))}
          {spec && spec.fields.length > 0 && (
            <select
              value={value.field ?? spec.fields[0].id}
              onChange={(e) => onChange({ ...value, field: e.target.value })}
              aria-label={`${label}: thành phần`}
            >
              {spec.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const w = 90;
  const h = 24;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "var(--buy)" : "var(--sell)"} strokeWidth="1.5" />
    </svg>
  );
}

const fmtValue = (v: number | null | undefined) =>
  v == null ? "—" : Math.abs(v) >= 1000 ? price(v) : v.toFixed(Math.abs(v) >= 100 ? 1 : 2);

type SortKey = "symbol" | "change" | string;

export function Screener({
  watch,
  onOpenSymbol,
}: {
  watch: Watchlist;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [meta, setMeta] = useState<ScreenerMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [conditions, setConditions] = usePersistent<Condition[]>("astrq.screener.conditions", DEFAULT_CONDITIONS);
  const [logic, setLogic] = usePersistent<"all" | "any">("astrq.screener.logic", "all");
  const [scope, setScope] = usePersistent<"all" | "watch">("astrq.screener.scope", "all");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "change", desc: true });

  useEffect(() => {
    api.screenerMeta().then(setMeta).catch((e) => setMetaError(String(e.message ?? e)));
  }, []);

  const specs = meta?.indicators ?? [];
  const max = meta?.max_conditions ?? 8;
  const update = (i: number, c: Condition) => setConditions(conditions.map((x, k) => (k === i ? c : x)));

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const symbols = scope === "watch" ? [...watch.symbols] : null;
      setResult(await api.scan({ conditions, logic, symbols }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const rows = useMemo(() => {
    const r = [...(result?.rows ?? [])];
    const val = (x: ScanRow): number | string =>
      sort.key === "symbol"
        ? x.symbol
        : sort.key === "change"
          ? (x.change_pct ?? -Infinity)
          : (x.values[sort.key] ?? -Infinity);
    r.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sort.desc ? -c : c;
    });
    return r;
  }, [result, sort]);

  const th = (key: SortKey, label: string, cls = "r") => (
    <th
      className={`${cls} sortable`}
      onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== "symbol" })}
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}
    >
      {label}
      {sort.key === key ? (sort.desc ? " ▾" : " ▴") : ""}
    </th>
  );

  const exportCsv = () => {
    if (!result) return;
    downloadCsv(
      `loc-chi-bao-${result.as_of ?? "hom-nay"}.csv`,
      ["Mã", "Ngành", "Ngày", "Giá", "% ngày", ...result.columns.map((c) => c.label)],
      rows.map((r) => [
        r.symbol,
        r.sector ?? "",
        r.date,
        r.close,
        r.change_pct ?? "",
        ...result.columns.map((c) => r.values[c.key] ?? ""),
      ]),
    );
  };

  return (
    <main className="screener">
      <section className="screener-form" aria-label="Điều kiện lọc">
        <h2>Lọc theo chỉ báo kỹ thuật</h2>
        <p className="muted small">
          Chọn chỉ báo và điều kiện rồi bấm <b>Quét</b>. Bộ lọc dùng nến ngày và chỉ chạy khi bạn yêu cầu,
          không theo thời gian thực.
        </p>
        {metaError && <p className="error">Không tải được danh mục chỉ báo: {metaError}</p>}

        {meta && (
          <div className="presets" aria-label="Mẫu có sẵn">
            {meta.presets.map((p) => (
              <button key={p.id} className="sym-chip preset" onClick={() => setConditions(p.conditions)}>
                {p.label}
              </button>
            ))}
          </div>
        )}

        <ol className="conditions">
          {conditions.map((c, i) => {
            const spec = specs.find((s) => s.id === c.left.ind);
            return (
              <li key={i} className="condition">
                <div className="cond-head">
                  <span className="muted small">Điều kiện {i + 1}</span>
                  {conditions.length > 1 && (
                    <button
                      className="close small-btn"
                      onClick={() => setConditions(conditions.filter((_, k) => k !== i))}
                      aria-label={`Xóa điều kiện ${i + 1}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <OperandEditor
                  value={c.left}
                  onChange={(left) => update(i, { ...c, left })}
                  specs={specs}
                  allowConst={false}
                  label={`Điều kiện ${i + 1}, vế trái`}
                />
                <select
                  className="op"
                  value={c.op}
                  onChange={(e) => update(i, { ...c, op: e.target.value })}
                  aria-label={`Điều kiện ${i + 1}: phép so sánh`}
                >
                  {(meta?.ops ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <OperandEditor
                  value={c.right}
                  onChange={(right) => update(i, { ...c, right })}
                  specs={specs}
                  allowConst
                  label={`Điều kiện ${i + 1}, vế phải`}
                />
                {spec?.hint && <div className="hint small muted">{spec.hint}</div>}
              </li>
            );
          })}
        </ol>
        <button
          className="tool-btn"
          disabled={conditions.length >= max}
          onClick={() => setConditions([...conditions, { left: { ind: "sma", n: 20 }, op: "gt", right: { value: 0 } }])}
        >
          + Thêm điều kiện
        </button>

        <div className="scan-opts">
          <div className="seg" role="group" aria-label="Kết hợp điều kiện">
            <button className={logic === "all" ? "on" : ""} onClick={() => setLogic("all")}>
              Thỏa tất cả
            </button>
            <button className={logic === "any" ? "on" : ""} onClick={() => setLogic("any")}>
              Ít nhất một
            </button>
          </div>
          <div className="seg" role="group" aria-label="Phạm vi">
            <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
              Toàn VN100
            </button>
            <button
              className={scope === "watch" ? "on" : ""}
              onClick={() => setScope("watch")}
              disabled={!watch.symbols.size}
              title={watch.symbols.size ? "" : "Chưa có mã nào trong danh sách theo dõi"}
            >
              ★ Theo dõi ({watch.symbols.size})
            </button>
          </div>
        </div>
        <button className="scan-btn" onClick={run} disabled={running || !meta || !conditions.length}>
          {running ? "Đang quét…" : "Quét"}
        </button>
        {meta && (
          <p className="muted small">
            Nguồn: {SOURCE_LABEL[meta.source] ?? meta.source}. Lần quét đầu tải dữ liệu nên mất vài giây; các
            lần sau dùng bộ nhớ đệm.
          </p>
        )}
      </section>

      <section className="screener-results" aria-label="Kết quả lọc" aria-busy={running}>
        {error && <p className="error">{error}</p>}
        {!result && !error && (
          <div className="empty screener-empty">
            <p>Chưa quét. Chọn một mẫu bên trái hoặc tự tạo điều kiện, rồi bấm <b>Quét</b>.</p>
            <p className="small">Radar lệnh lớn vẫn chạy bình thường ở tab "Radar lệnh lớn".</p>
          </div>
        )}
        {result && (
          <>
            <div className="results-head">
              <div>
                <div className="big">
                  <b className="mono">{result.matched}</b>
                  <span className="muted"> / {result.scanned} mã thỏa điều kiện</span>
                </div>
                <div className="small muted">
                  {result.as_of ? `Dữ liệu đến phiên ${dmy(result.as_of)}` : ""} · {SOURCE_LABEL[result.source] ?? result.source} ·{" "}
                  {(result.took_ms / 1000).toFixed(1)} s
                </div>
                <div className="cond-chips">
                  {result.conditions.map((c, i) => (
                    <span key={i} className="chip">
                      {c}
                    </span>
                  ))}
                  <span className="muted small">{result.logic === "all" ? "(thỏa tất cả)" : "(ít nhất một)"}</span>
                </div>
              </div>
              <button className="tool-btn" onClick={exportCsv} disabled={!rows.length}>
                ⤓ CSV
              </button>
            </div>
            {result.errors.length > 0 && (
              <details className="small muted">
                <summary>{result.errors.length} mã không tải được dữ liệu</summary>
                {result.errors.map((e) => (
                  <div key={e.symbol}>
                    {e.symbol}: {e.error}
                  </div>
                ))}
              </details>
            )}
            {rows.length === 0 ? (
              <p className="empty">Không có mã nào thỏa điều kiện.</p>
            ) : (
              <div className="table-scroll">
                <table className="rank scan-table">
                  <thead>
                    <tr>
                      <th aria-label="Theo dõi" />
                      {th("symbol", "Mã", "")}
                      {th("change", "% ngày")}
                      <th className="r">Giá</th>
                      {result.columns.map((c) => th(c.key, c.label))}
                      <th>40 phiên</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.symbol}
                        tabIndex={0}
                        onClick={() => onOpenSymbol(r.symbol)}
                        onKeyDown={(e) => e.key === "Enter" && onOpenSymbol(r.symbol)}
                        title="Mở trên radar lệnh lớn"
                      >
                        <td>
                          <StarButton symbol={r.symbol} watch={watch} />
                        </td>
                        <td>
                          <span className="sym">{r.symbol}</span>
                          <div className="small muted">{r.sector}</div>
                        </td>
                        <td className={`mono r ${(r.change_pct ?? 0) >= 0 ? "up" : "down"}`}>
                          {r.change_pct == null ? "—" : pct(r.change_pct)}
                        </td>
                        <td className="mono r">{price(r.close)}</td>
                        {result.columns.map((c) => (
                          <td key={c.key} className="mono r">
                            {fmtValue(r.values[c.key])}
                          </td>
                        ))}
                        <td>
                          <Spark values={r.spark} up={r.spark[r.spark.length - 1] >= r.spark[0]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">{DISCLAIMER}</p>
          </>
        )}
      </section>
    </main>
  );
}
