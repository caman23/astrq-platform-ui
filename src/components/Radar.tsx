import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Instrument, RadarSymbol } from "../api";
import { SIDE_GLYPH } from "../format";
import { OrderPeek } from "./OrderDetails";

const R = 460; // outer ring radius in SVG units (viewBox is -500..500)
const R_MIN = 56; // strongest signals sit just outside the center
const SWEEP_PERIOD_MS = 4200;
const TRAIL_DEG = 70;

interface Props {
  symbols: RadarSymbol[];
  universe: Instrument[];
  pinned: string | null;
  onPin: (symbol: string) => void;
  /** Market-clock "now" (ISO). Blips dim as their last signal ages. */
  now: string | null;
  showLegend?: boolean;
  /** Watchlist: always labelled, marked with a ring. */
  watched?: Set<string>;
}

const FADE_MINUTES = 90; // market minutes until a quiet symbol reaches minimum brightness

interface Label {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** label moved away from its mark: draw a thin leader line */
  lead: boolean;
}

interface Placed {
  s: RadarSymbol;
  angle: number; // degrees, 0 = 12 o'clock, clockwise
  x: number;
  y: number;
  size: number;
  /** null = no room: shown only on hover/focus */
  label: Label | null;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Mono font: advance ≈ 0.6 em; tickers are 3 characters (a few have 4+). */
function labelBox(l: Label, text: string, font: number): Box {
  const w = text.length * font * 0.6;
  const h = font * 0.9;
  const x0 = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
  // text is drawn with its baseline ~0.3em below the given y (dominant-baseline: middle)
  return { x0: x0 - 2, y0: l.y - h / 2 - 1, x1: x0 + w + 2, y1: l.y + h / 2 + 1 };
}

const SEV_RANK = { info: 0, notice: 1, alert: 2 } as const;

/**
 * Place marks and their labels without collisions.
 *
 * 1. Marks keep their meaning (sector angle, score radius) but nearly-coincident ones are
 *    nudged apart by a few relaxation passes, bounded so nothing drifts far.
 * 2. Labels go to the first free spot of 8 candidates around the mark (then farther out
 *    with a leader line), most important symbols first. Whatever finds no room is shown
 *    on hover only, so a busy session stays readable instead of a pile of text.
 */
function layout(
  symbols: RadarSymbol[],
  angleOf: Map<string, number>,
  scale: { font: number; mark: number },
  priorityOf: (s: RadarSymbol) => number,
): Placed[] {
  const maxVal = Math.max(1, ...symbols.map((s) => s.day_large_buy + s.day_large_sell));
  const marks = symbols.map((s, i) => {
    const angle = angleOf.get(s.symbol) ?? (i * 137.5) % 360;
    const r = radiusFor(s.max_score);
    const { x, y } = polar(angle, r);
    const v = s.day_large_buy + s.day_large_sell;
    const size = (6 + 9 * Math.sqrt(Math.max(0, v) / maxVal)) * scale.mark;
    return { s, angle, x, y, x0: x, y0: y, size };
  });

  // 1. relax overlapping marks (O(n²), n ≤ 100)
  const MAX_SHIFT = 26 * scale.mark;
  for (let iter = 0; iter < 30; iter++) {
    let moved = false;
    for (let i = 0; i < marks.length; i++) {
      for (let j = i + 1; j < marks.length; j++) {
        const a = marks[i];
        const b = marks[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = a.size + b.size + 3;
        if (d >= min) continue;
        if (d < 0.01) {
          // identical spot: split along the ring
          dx = Math.cos((a.angle * Math.PI) / 180);
          dy = Math.sin((a.angle * Math.PI) / 180);
          d = 1;
        }
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    for (const m of marks) {
      // stay near the true position and inside the scope
      const sx = m.x - m.x0;
      const sy = m.y - m.y0;
      const shift = Math.hypot(sx, sy);
      if (shift > MAX_SHIFT) {
        m.x = m.x0 + (sx / shift) * MAX_SHIFT;
        m.y = m.y0 + (sy / shift) * MAX_SHIFT;
      }
      const r = Math.hypot(m.x, m.y);
      const rMax = R - m.size;
      if (r > rMax) {
        m.x *= rMax / r;
        m.y *= rMax / r;
      }
    }
    if (!moved) break;
  }

  // 2. labels, most important first
  const font = scale.font;
  const markBoxes: Box[] = marks.map((m) => ({
    x0: m.x - m.size,
    y0: m.y - m.size,
    x1: m.x + m.size,
    y1: m.y + m.size,
  }));
  const taken: Box[] = [];
  const labels = new Map<string, Label | null>();
  const order = marks
    .map((m, i) => ({ m, i, p: priorityOf(m.s) }))
    .sort((a, b) => b.p - a.p || b.m.s.max_score - a.m.s.max_score);
  for (const { m, i, p } of order) {
    const g = m.size + 4;
    const far = g + font * 1.1;
    const outward = m.x >= 0; // prefer the side facing away from the center
    const side = (d: number): Label => ({ x: m.x + d, y: m.y, anchor: d > 0 ? "start" : "end", lead: false });
    const candidates: Label[] = [
      outward ? side(g) : side(-g),
      outward ? side(-g) : side(g),
      { x: m.x, y: m.y - g - font * 0.45, anchor: "middle", lead: false },
      { x: m.x, y: m.y + g + font * 0.45, anchor: "middle", lead: false },
      { x: m.x + g * 0.8, y: m.y - g * 0.9, anchor: "start", lead: false },
      { x: m.x - g * 0.8, y: m.y - g * 0.9, anchor: "end", lead: false },
      { x: m.x + g * 0.8, y: m.y + g * 0.9, anchor: "start", lead: false },
      { x: m.x - g * 0.8, y: m.y + g * 0.9, anchor: "end", lead: false },
      { ...(outward ? side(far) : side(-far)), lead: true },
      { x: m.x, y: m.y - far - font * 0.3, anchor: "middle", lead: true },
      { x: m.x, y: m.y + far + font * 0.3, anchor: "middle", lead: true },
    ];
    const fits = (l: Label) => {
      const b = labelBox(l, m.s.symbol, font);
      if (Math.hypot(Math.max(Math.abs(b.x0), Math.abs(b.x1)), Math.max(Math.abs(b.y0), Math.abs(b.y1))) > R + 30)
        return false;
      return !taken.some((t) => overlaps(t, b)) && !markBoxes.some((mb, k) => k !== i && overlaps(mb, b));
    };
    let chosen = candidates.find(fits) ?? null;
    // must-show symbols (pinned, alerts, watchlist) keep a label even when crowded
    if (!chosen && p >= MUST_LABEL) chosen = candidates[0];
    if (chosen) taken.push(labelBox(chosen, m.s.symbol, font));
    labels.set(m.s.symbol, chosen);
  }

  return marks.map((m) => ({ s: m.s, angle: m.angle, x: m.x, y: m.y, size: m.size, label: labels.get(m.s.symbol) ?? null }));
}

/** Priorities at or above this always get a label. */
const MUST_LABEL = 100;

/** Score 100 -> near center, score 0 -> outer ring. */
const radiusFor = (score: number) => R_MIN + (1 - Math.min(100, Math.max(0, score)) / 100) * (R - R_MIN - 18);

/** Each sector gets an angular wedge proportional to its member count. */
function sectorLayout(universe: Instrument[]) {
  const sectors: { name: string; members: string[] }[] = [];
  const index = new Map<string, number>();
  for (const i of universe) {
    const name = i.sector ?? "Khác";
    if (!index.has(name)) {
      index.set(name, sectors.length);
      sectors.push({ name, members: [] });
    }
    sectors[index.get(name)!].members.push(i.symbol);
  }
  const total = universe.length || 1;
  const angleOf = new Map<string, number>();
  const wedges: { name: string; start: number; end: number }[] = [];
  let a = 0;
  for (const sec of sectors) {
    const span = (sec.members.length / total) * 360;
    wedges.push({ name: sec.name, start: a, end: a + span });
    sec.members.forEach((sym, i) => angleOf.set(sym, a + ((i + 0.5) / sec.members.length) * span));
    a += span;
  }
  return { angleOf, wedges };
}

const polar = (angleDeg: number, r: number) => {
  const t = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(t), y: -r * Math.cos(t) };
};

function glyphPath(kind: string, size: number): string {
  const s = size;
  switch (kind) {
    case "buy":
      return `M0,${-s} L${s * 0.92},${s * 0.66} L${-s * 0.92},${s * 0.66} Z`;
    case "sell":
      return `M0,${s} L${s * 0.92},${-s * 0.66} L${-s * 0.92},${-s * 0.66} Z`;
    case "mixed":
      return `M0,${-s} L${s},0 L0,${s} L${-s},0 Z`;
    default:
      return `M${-s * 0.75},0 a${s * 0.75},${s * 0.75} 0 1,0 ${s * 1.5},0 a${s * 0.75},${s * 0.75} 0 1,0 ${-s * 1.5},0`;
  }
}

export function Radar({ symbols, universe, pinned, onPin, now, showLegend = true, watched }: Props) {
  const nowMs = now ? Date.parse(now) : Date.now();
  const wrapRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<SVGGElement>(null);
  const blipRefs = useRef(new Map<string, SVGGElement>());
  const [hover, setHover] = useState<{ symbol: string; x: number; y: number } | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const { angleOf, wedges } = useMemo(() => sectorLayout(universe), [universe]);

  // Text and marks are sized in screen pixels, not SVG units: measure the rendered width.
  const [width, setWidth] = useState(700);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, el.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const unitsPerPx = 1000 / width;
  const scale = useMemo(
    () => ({
      font: Math.round(12 * unitsPerPx), // ~12 px labels at any size
      mark: Math.min(1.9, Math.max(1, 0.62 * unitsPerPx)), // marks never smaller than ~9 px
    }),
    [unitsPerPx],
  );

  const placed: Placed[] = useMemo(() => {
    const priorityOf = (s: RadarSymbol) =>
      (s.symbol === pinned ? 1000 : 0) +
      (watched?.has(s.symbol) ? 300 : 0) +
      (s.max_severity === "alert" ? 100 : 0) +
      SEV_RANK[s.max_severity] * 10 +
      s.max_score / 10;
    return layout(symbols, angleOf, scale, priorityOf);
  }, [symbols, angleOf, scale, pinned, watched]);

  // Detect fresh signals per symbol to trigger a ping ripple.
  const lastSeen = useRef(new Map<string, string>());
  const [pings, setPings] = useState<Record<string, number>>({});
  useEffect(() => {
    const fresh: Record<string, number> = {};
    for (const s of symbols) {
      const prev = lastSeen.current.get(s.symbol);
      if (prev !== undefined && prev !== s.last_signal_at) fresh[s.symbol] = Date.now();
      lastSeen.current.set(s.symbol, s.last_signal_at);
    }
    if (Object.keys(fresh).length) setPings((p) => ({ ...p, ...fresh }));
  }, [symbols]);

  // One animation loop drives the sweep and the phosphor afterglow of every blip.
  const anglesRef = useRef(placed);
  anglesRef.current = placed;
  useEffect(() => {
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    // The beam turns on the compositor (Web Animations), not in rAF: mobile browsers throttle
    // or pause rAF inside cross-origin iframes, which froze the embedded sweep. rAF only
    // refreshes the blip afterglow, reading the angle from the same animation clock.
    const spin = reduce
      ? null
      : sweepRef.current?.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
          duration: SWEEP_PERIOD_MS,
          iterations: Infinity,
        });
    const frame = (now: number) => {
      const t = typeof spin?.currentTime === "number" ? spin.currentTime : now - t0;
      const sweep = ((t / SWEEP_PERIOD_MS) * 360) % 360;
      if (!spin) sweepRef.current?.setAttribute("transform", `rotate(${sweep})`);
      for (const p of anglesRef.current) {
        const el = blipRefs.current.get(p.s.symbol);
        if (!el) continue;
        const behind = (sweep - p.angle + 360) % 360; // degrees since the beam passed
        const glow = Math.max(0, 1 - behind / 300);
        el.style.setProperty("--glow", (0.42 + 0.58 * glow).toFixed(3));
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      spin?.cancel();
    };
  }, []);

  // Tooltip placement: follow the cursor, flip at the container edges.
  useLayoutEffect(() => {
    if (!hover || !wrapRef.current || !tipRef.current) {
      setTipPos(null);
      return;
    }
    const box = wrapRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    let left = hover.x + 18;
    let top = hover.y + 18;
    if (left + tip.width > box.width - 8) left = hover.x - tip.width - 18;
    if (top + tip.height > box.height - 8) top = Math.max(8, box.height - tip.height - 8);
    setTipPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [hover]);

  const hovered = hover ? symbols.find((s) => s.symbol === hover.symbol) : undefined;

  const onMove = (symbol: string) => (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const box = wrapRef.current!.getBoundingClientRect();
    setHover({ symbol, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div className="radar-wrap" ref={wrapRef} onPointerLeave={() => setHover(null)}>
      <svg
        className="radar"
        viewBox="-500 -500 1000 1000"
        role="img"
        aria-label={`Radar lệnh lớn: ${symbols.length} mã có tín hiệu`}
      >
        <defs>
          <radialGradient id="scope-bg">
            <stop offset="0%" stopColor="var(--scope-center)" />
            <stop offset="100%" stopColor="var(--scope-edge)" />
          </radialGradient>
          <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--beam)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--beam)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <circle r={R + 18} fill="url(#scope-bg)" stroke="var(--scope-rim)" strokeWidth="2" />

        {/* sector wedges + labels */}
        {wedges.map((w) => {
          const a = polar(w.start, R + 18);
          const mid = polar((w.start + w.end) / 2, R + 36);
          const midDeg = (w.start + w.end) / 2;
          const flip = midDeg > 90 && midDeg < 270;
          // Only label wedges whose arc can hold the text (uppercase + tracking ≈ 0.7 em per character).
          const arc = ((w.end - w.start) * Math.PI * (R + 36)) / 180;
          const fits = arc >= w.name.length * Math.round(11 * unitsPerPx) * 0.7 + 8;
          return (
            <g key={w.name}>
              <line x1="0" y1="0" x2={a.x} y2={a.y} className="spoke" />
              <title>{w.name}</title>
              {fits && (
                <text
                  x={mid.x}
                  y={mid.y}
                  className="sector-label"
                  textAnchor="middle"
                  dominantBaseline="middle"
                    transform={`rotate(${flip ? midDeg + 180 : midDeg} ${mid.x} ${mid.y})`}
                  style={{ fontSize: Math.round(11 * unitsPerPx) }}
                >
                  {w.name}
                </text>
              )}
            </g>
          );
        })}

        {rings.map((f) => (
          <circle key={f} r={R_MIN + f * (R - R_MIN)} className="ring" />
        ))}
        <circle r={R_MIN} className="ring ring-core" />
        {[100, 75, 50, 25].map((score) => (
          <text
            key={score}
            x={6}
            y={-radiusFor(score) + 4}
            className="ring-label"
            style={{ fontSize: Math.round(10 * unitsPerPx) }}
          >
            {score}
          </text>
        ))}

        {/* sweep beam with trailing afterglow */}
        <g ref={sweepRef} className="sweep">
          {Array.from({ length: 28 }, (_, i) => {
            const a0 = -(i + 1) * (TRAIL_DEG / 28);
            const a1 = -i * (TRAIL_DEG / 28);
            const p0 = polar(a0, R + 18);
            const p1 = polar(a1, R + 18);
            return (
              <path
                key={i}
                d={`M0,0 L${p0.x},${p0.y} A${R + 18},${R + 18} 0 0,1 ${p1.x},${p1.y} Z`}
                fill="var(--beam)"
                opacity={0.22 * (1 - i / 28) ** 2}
              />
            );
          })}
          <line x1="0" y1="0" x2="0" y2={-(R + 18)} stroke="var(--beam)" strokeWidth="2.5" />
        </g>

        {/* blips */}
        {placed.map((p) => {
          const s = p.s;
          const kind = s.dominant_side;
          const isPinned = pinned === s.symbol;
          const isHovered = hover?.symbol === s.symbol;
          const isWatched = watched?.has(s.symbol) ?? false;
          const ping = pings[s.symbol];
          // hidden labels appear on hover/focus, beside the mark
          const label: Label | null =
            p.label ??
            (isHovered || isPinned
              ? { x: p.x >= 0 ? p.x + p.size + 4 : p.x - p.size - 4, y: p.y, anchor: p.x >= 0 ? "start" : "end", lead: false }
              : null);
          const ageMin = Math.max(0, (nowMs - Date.parse(s.last_signal_at)) / 60_000);
          const age = Math.max(0.3, 1 - ageMin / FADE_MINUTES);
          return (
            <g
              key={s.symbol}
              style={{ "--age": age.toFixed(2) } as React.CSSProperties}
              ref={(el) => {
                if (el) blipRefs.current.set(s.symbol, el);
                else blipRefs.current.delete(s.symbol);
              }}
              className={`blip side-${kind} sev-${s.max_severity}${isPinned ? " pinned" : ""}${
                isHovered ? " hovered" : ""
              }${isWatched ? " watched" : ""}`}
              onPointerMove={onMove(s.symbol)}
              onPointerEnter={onMove(s.symbol)}
              onClick={() => onPin(s.symbol)}
              tabIndex={0}
              role="button"
              aria-label={`${s.symbol}: điểm ${s.max_score.toFixed(0)}, ${kind}`}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPin(s.symbol)}
              onFocus={() => {
                const box = wrapRef.current!.getBoundingClientRect();
                const k = box.width / 1000;
                setHover({ symbol: s.symbol, x: (p.x + 500) * k, y: (p.y + 500) * k });
              }}
              onBlur={() => setHover(null)}
            >
              <g transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`}>
                {ping && <circle key={ping} r={p.size} className="ping" />}
                {s.max_severity === "alert" && age > 0.8 && (
                  <circle r={p.size + 6 * scale.mark} className="alert-ring" />
                )}
                {isWatched && <circle r={p.size + 4 * scale.mark} className="watch-ring" />}
                <circle r={Math.max(14 * unitsPerPx, p.size + 6)} className="hit" />
                <path d={glyphPath(kind, p.size)} className="glyph" />
              </g>
              {label?.lead && (
                <line
                  x1={p.x}
                  y1={p.y}
                  x2={label.x}
                  y2={label.y}
                  className="blip-lead"
                  strokeWidth={unitsPerPx}
                />
              )}
              {label && (
                <text
                  x={label.x.toFixed(1)}
                  y={label.y.toFixed(1)}
                  textAnchor={label.anchor}
                  dominantBaseline="central"
                  className="blip-label"
                  style={{ fontSize: scale.font, strokeWidth: 3.5 * unitsPerPx }}
                >
                  {s.symbol}
                </text>
              )}
            </g>
          );
        })}

        <circle r="4" className="center-dot" />
      </svg>

      {hovered && (
        <div
          ref={tipRef}
          className="tooltip"
          style={tipPos ? { left: tipPos.left, top: tipPos.top } : { visibility: "hidden" }}
          role="tooltip"
        >
          <OrderPeek s={hovered} />
        </div>
      )}

      {showLegend && (
      <div className="radar-legend" aria-label="Chú giải">
        <span className="lg lg-buy">{SIDE_GLYPH.buy} Ròng mua lớn</span>
        <span className="lg lg-sell">{SIDE_GLYPH.sell} Ròng bán lớn</span>
        <span className="lg lg-mixed">{SIDE_GLYPH.mixed} Hỗn hợp</span>
        <span className="lg lg-unknown">{SIDE_GLYPH.unknown} Không rõ chiều</span>
        <span className="lg-note">
          Càng gần tâm = điểm radar càng cao · kích thước = giá trị lệnh lớn · mờ dần khi không có tín
          hiệu mới
        </span>
      </div>
      )}
    </div>
  );
}
