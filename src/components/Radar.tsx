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
}

const FADE_MINUTES = 90; // market minutes until a quiet symbol reaches minimum brightness

interface Placed {
  s: RadarSymbol;
  angle: number; // degrees, 0 = 12 o'clock, clockwise
  x: number;
  y: number;
  size: number;
}

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

export function Radar({ symbols, universe, pinned, onPin, now, showLegend = true }: Props) {
  const nowMs = now ? Date.parse(now) : Date.now();
  const wrapRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<SVGGElement>(null);
  const blipRefs = useRef(new Map<string, SVGGElement>());
  const [hover, setHover] = useState<{ symbol: string; x: number; y: number } | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const { angleOf, wedges } = useMemo(() => sectorLayout(universe), [universe]);

  const placed: Placed[] = useMemo(() => {
    const maxVal = Math.max(1, ...symbols.map((s) => s.day_large_buy + s.day_large_sell));
    return symbols.map((s, i) => {
      const angle = angleOf.get(s.symbol) ?? (i * 137.5) % 360;
      const { x, y } = polar(angle, radiusFor(s.max_score));
      const v = s.day_large_buy + s.day_large_sell;
      const size = 6 + 9 * Math.sqrt(Math.max(0, v) / maxVal);
      return { s, angle, x, y, size };
    });
  }, [symbols, angleOf]);

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
          // Only label wedges whose arc can hold the text (≈9 units per char at 15px).
          const arc = ((w.end - w.start) * Math.PI * (R + 36)) / 180;
          const fits = arc >= w.name.length * 9 + 8;
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
          <text key={score} x="6" y={-radiusFor(score) + 4} className="ring-label">
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
          const ping = pings[s.symbol];
          const labelLeft = p.x < 0;
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
                hover?.symbol === s.symbol ? " hovered" : ""
              }`}
              transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`}
              onPointerMove={onMove(s.symbol)}
              onPointerEnter={onMove(s.symbol)}
              onClick={() => onPin(s.symbol)}
              tabIndex={0}
              role="button"
              aria-label={`${s.symbol}: điểm ${s.max_score.toFixed(0)}, ${kind}`}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPin(s.symbol)}
              onFocus={() => {
                const box = wrapRef.current!.getBoundingClientRect();
                const scale = box.width / 1000;
                setHover({ symbol: s.symbol, x: (p.x + 500) * scale, y: (p.y + 500) * scale });
              }}
              onBlur={() => setHover(null)}
            >
              {ping && <circle key={ping} r={p.size} className="ping" />}
              {s.max_severity === "alert" && age > 0.8 && (
                <circle r={p.size + 7} className="alert-ring" />
              )}
              <circle r={Math.max(22, p.size + 8)} className="hit" />
              <path d={glyphPath(kind, p.size)} className="glyph" />
              <text
                x={labelLeft ? -p.size - 5 : p.size + 5}
                y="4"
                textAnchor={labelLeft ? "end" : "start"}
                className="blip-label"
              >
                {s.symbol}
              </text>
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
