import React, { useState, useEffect, useRef } from 'react';
import type { BurnRange, Theme } from '../types';

interface Props {
  data: { bucket: string; tokens: number }[];
  burnRange: BurnRange;
  onBurnRangeChange: (r: BurnRange) => void;
  loading: boolean;
  theme: Theme;
}

interface TooltipState {
  x: number;
  y: number;
  value: string;
  label: string;
}

const TZ = 'Asia/Kolkata';
const BURN_RANGES: BurnRange[] = ['7d', '14d', '30d'];

function formatDayLabel(bucket: string): string {
  return new Date(bucket).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: TZ });
}

function formatTokenValue(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

const PLACEHOLDER_RATIOS = [
  0.12, 0.19, 0.15, 0.30, 0.24, 0.41, 0.58, 0.50,
  0.72, 0.88, 0.65, 0.44, 0.82, 0.70, 0.55, 0.63,
  0.78, 0.90, 0.85, 0.60, 0.48, 0.35, 0.25, 0.18,
  0.22, 0.38, 0.52, 0.67, 0.43, 0.31,
];

function makePlaceholder(count: number): { ratio: number; label: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    ratio: PLACEHOLDER_RATIOS[i % PLACEHOLDER_RATIOS.length],
    label: `Day ${i + 1}`,
  }));
}

// Bar width: proportional to slot, consistent across all range modes
function barWidthForSlot(slotPx: number): number {
  return Math.max(4, Math.min(slotPx * 0.6, 24));
}

export function BurnRateChart({ data, burnRange, onBurnRangeChange, loading, theme }: Props) {
  const containerRef          = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipKey, setTooltipKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  // Reset mount animation when range changes so bars re-enter cleanly
  useEffect(() => {
    setMounted(false);
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, [burnRange]);

  const expectedCount = burnRange === '7d' ? 8 : burnRange === '14d' ? 15 : 31;
  const raw = data.length > 0
    ? data.map(d => ({ raw: d.tokens, label: formatDayLabel(d.bucket) }))
    : makePlaceholder(expectedCount).map(d => ({ raw: d.ratio * 440_000, label: d.label }));

  const maxRaw = Math.max(...raw.map(d => d.raw), 1);
  const bars   = raw.map(d => ({ ...d, ratio: d.raw / maxRaw }));

  // Full-bleed chart: no internal padding gaps — bars fill the entire width
  const W = 680, H = 160;
  const PL = 36, PR = 0, PT = 8, PB = 24;
  const chartW   = W - PL - PR;
  const chartH   = H - PT - PB;
  const baseline = PT + chartH;
  const barSlot  = chartW / bars.length;
  const barW     = barWidthForSlot(barSlot);
  // Top-only radius: 6–8px (clamped)
  const barR     = Math.min(barW * 0.4, 8);
  const yTicks   = [0.25, 0.5, 0.75, 1.0];

  const handleBarEnter = (i: number, e: React.MouseEvent<SVGGElement>) => {
    if (!containerRef.current) return;
    const cRect   = containerRef.current.getBoundingClientRect();
    const svgEl   = e.currentTarget.closest('svg') as SVGSVGElement;
    const svgRect = svgEl.getBoundingClientRect();
    const scaleX  = svgRect.width  / W;
    const scaleY  = svgRect.height / H;
    const barCX   = svgRect.left + (PL + i * barSlot + barSlot / 2) * scaleX;
    const barTY   = svgRect.top  + (baseline - bars[i].ratio * chartH) * scaleY;

    setHoveredIdx(i);
    setTooltipKey(k => k + 1);
    setTooltip({
      x: barCX - cRect.left,
      y: barTY - cRect.top - 8,
      value: formatTokenValue(bars[i].raw),
      label: bars[i].label,
    });
  };

  const handleBarLeave = () => { setHoveredIdx(null); setTooltip(null); };

  return (
    <div>
      {/* Chart header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 2 }}>Token Burn Rate</div>
          <div style={{ fontSize: 11, color: '#9CA3AF' }}>Daily token usage · day-by-day</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Range pill selector */}
          <div style={{ display: 'flex', background: '#F1F3F8', borderRadius: 7, padding: 3, gap: 1 }}>
            {BURN_RANGES.map(r => (
              <button
                key={r}
                onClick={() => onBurnRangeChange(r)}
                style={{
                  padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                  background: burnRange === r ? theme.p : 'transparent',
                  color: burnRange === r ? '#fff' : '#9ca3af',
                  transition: 'all 0.15s ease',
                }}
              >
                {r}
              </button>
            ))}
          </div>
          {/* Live badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#16a34a', fontWeight: 500 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: loading ? '#d97706' : '#22c55e',
              display: 'inline-block', animation: 'livePulse 2s ease infinite',
            }} />
            {loading ? 'Loading' : 'Live'}
          </div>
        </div>
      </div>

      {/* SVG chart */}
      <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            {/* Normal: subtle vertical gradient — lighter top, slightly darker bottom */}
            <linearGradient id="brc-g-normal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={theme.l} stopOpacity="0.65" />
              <stop offset="100%" stopColor={theme.p} stopOpacity="0.85" />
            </linearGradient>
            {/* Hover: slightly more saturated, same direction */}
            <linearGradient id="brc-g-hover" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={theme.p} stopOpacity="0.85" />
              <stop offset="100%" stopColor={theme.d} stopOpacity="0.9" />
            </linearGradient>
          </defs>

          {/* Y-axis grid lines + labels */}
          {yTicks.map((t) => {
            const y = baseline - t * chartH;
            return (
              <g key={t}>
                <line
                  x1={PL} x2={W - PR} y1={y} y2={y}
                  stroke="#ECEEF5" strokeWidth="1"
                  style={{ opacity: 0, animation: `fadeUp 0.5s ease ${0.1 + t * 0.08}s forwards` }}
                />
                <text
                  x={PL - 6} y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="9"
                  fill="#b0b5c3"
                  fontFamily="'JetBrains Mono',monospace"
                >
                  {`${Math.round(t * maxRaw / 1000)}k`}
                </text>
              </g>
            );
          })}

          {/* Baseline */}
          <line x1={PL} x2={W - PR} y1={baseline} y2={baseline} stroke="#ECEEF5" strokeWidth="1" />

          {/* Crosshair — very subtle */}
          {hoveredIdx !== null && (
            <line
              x1={PL + hoveredIdx * barSlot + barSlot / 2}
              x2={PL + hoveredIdx * barSlot + barSlot / 2}
              y1={PT} y2={baseline}
              stroke={`${theme.p}18`} strokeWidth="1"
              strokeDasharray="3 3"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Bars — flat bottom, rounded top only via clipPath per bar */}
          {bars.map((d, i) => {
            const bh     = Math.max(1, d.ratio * chartH);
            const x      = PL + i * barSlot + (barSlot - barW) / 2;
            const barTop = baseline - bh;
            const isHov  = hoveredIdx === i;

            const step = bars.length <= 8 ? 1 : bars.length <= 16 ? 2 : Math.ceil(bars.length / 8);
            const showLabel = i % step === 0 || i === bars.length - 1;

            // clipPath: rounded top corners only, flat bottom
            const clipId = `brc-bar-clip-${i}`;

            return (
              <g key={i} style={{ cursor: 'crosshair' }}
                onMouseEnter={e => handleBarEnter(i, e)}
                onMouseLeave={handleBarLeave}
              >
                <defs>
                  <clipPath id={clipId}>
                    {/* Rounded rect for the top portion */}
                    <rect
                      x={x} y={barTop}
                      width={barW} height={bh}
                      rx={barR} ry={barR}
                    />
                    {/* Square rect to flatten the bottom — covers bottom half of rounded rect */}
                    <rect
                      x={x} y={barTop + barR}
                      width={barW} height={Math.max(0, bh - barR)}
                    />
                  </clipPath>
                </defs>
                <rect
                  x={x} y={barTop}
                  width={barW} height={bh}
                  clipPath={`url(#${clipId})`}
                  fill={isHov ? 'url(#brc-g-hover)' : 'url(#brc-g-normal)'}
                  style={{
                    transformBox:    'fill-box',
                    transformOrigin: 'bottom center',
                    transform: `scaleY(${mounted ? 1 : 0})`,
                    transition: mounted
                      ? `transform 200ms cubic-bezier(0.4,0,0.2,1), filter 200ms ease`
                      : `transform 0.45s cubic-bezier(0.4,0,0.2,1) ${i * 0.018}s`,
                    // Hover: slight brightness increase only (3–5%), no scaling
                    filter: isHov ? 'brightness(1.05)' : 'none',
                  }}
                />
                {showLabel && (
                  <text
                    x={x + barW / 2}
                    y={H - 6}
                    textAnchor="middle"
                    dominantBaseline="auto"
                    fontSize="9"
                    fill={isHov ? '#6b7280' : '#b0b5c3'}
                    fontFamily="'JetBrains Mono',monospace"
                    style={{ transition: 'fill 0.15s ease' }}
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            key={tooltipKey}
            className="tooltip-popup"
            style={{ position: 'absolute', left: tooltip.x, top: tooltip.y, pointerEvents: 'none', zIndex: 20 }}
          >
            <div style={{
              background: 'rgba(15,15,26,0.88)', backdropFilter: 'blur(10px)',
              borderRadius: 9, padding: '7px 12px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.22)',
              whiteSpace: 'nowrap', border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{tooltip.value}</div>
              <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>{tooltip.label}</div>
            </div>
            <div style={{
              width: 0, height: 0,
              borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
              borderTop: '5px solid rgba(15,15,26,0.88)', margin: '0 auto',
            }} />
          </div>
        )}
      </div>
    </div>
  );
}
