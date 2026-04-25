import React, { useState, useEffect, useRef } from 'react';
import type { Range, Theme } from '../types';

interface Props {
  data: { bucket: string; tokens: number }[];
  range: Range;
  theme: Theme;
}

interface TooltipState {
  x: number;
  y: number;
  value: string;
  label: string;
}

const TZ = 'Asia/Kolkata';

function formatLabel(bucket: string, range: Range): string {
  const d = new Date(bucket);
  if (range === '24h') {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  }
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: TZ });
}

function formatTokenValue(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

const PLACEHOLDER: { ratio: number; label: string }[] = [
  0.12, 0.19, 0.15, 0.30, 0.24, 0.41, 0.58, 0.50,
  0.72, 0.88, 0.65, 0.44, 0.82, 0.70, 0.55, 0.63,
  0.78, 0.90, 0.85, 0.60, 0.48, 0.35, 0.25, 0.18,
].map((r, i) => ({ ratio: r, label: `${i}h` }));

export function BurnRateChart({ data, range, theme }: Props) {
  const containerRef          = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipKey, setTooltipKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  const raw = data.length > 0
    ? data.map(d => ({ raw: d.tokens, label: formatLabel(d.bucket, range) }))
    : PLACEHOLDER.map(d => ({ raw: d.ratio * 440_000, label: d.label }));

  const maxRaw = Math.max(...raw.map(d => d.raw), 1);
  const bars   = raw.map(d => ({ ...d, ratio: d.raw / maxRaw }));

  // ── Pixel-based viewBox — text renders at real px, no distortion ─────────────
  // W×H are viewBox pixels. SVG uses width="100%" so rendered height = W/H ratio.
  const W = 680, H = 160;
  const PL = 36,  // left padding for Y-axis labels
        PR = 4,
        PT = 8,
        PB = 24;  // bottom padding for X-axis labels
  const chartW   = W - PL - PR;          // 640
  const chartH   = H - PT - PB;          // 128
  const baseline = PT + chartH;          // 136 — bars grow UP from here
  const barSlot  = chartW / bars.length;
  const barW     = Math.min(barSlot * 0.55, 18);
  const barR     = Math.min(barW * 0.35, 3);
  const yTicks   = [0.25, 0.5, 0.75, 1.0];

  // ── Tooltip position ─────────────────────────────────────────────────────────
  const handleBarEnter = (i: number, e: React.MouseEvent<SVGGElement>) => {
    if (!containerRef.current) return;
    const cRect   = containerRef.current.getBoundingClientRect();
    const svgEl   = e.currentTarget.closest('svg') as SVGSVGElement;
    const svgRect = svgEl.getBoundingClientRect();
    // map viewBox coordinates → rendered pixel coordinates
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
    // No fixed height — the SVG's viewBox aspect ratio (680:160) controls height naturally
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>

      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="brc-g-normal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={theme.d} stopOpacity="1" />
            <stop offset="100%" stopColor={theme.l} stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="brc-g-hover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={theme.p} stopOpacity="1" />
            <stop offset="100%" stopColor={theme.l} stopOpacity="0.7" />
          </linearGradient>
          <clipPath id="brc-clip">
            <rect x={PL} y={PT} width={chartW} height={chartH} />
          </clipPath>
        </defs>

        {/* Y-axis grid lines + labels */}
        {yTicks.map((t) => {
          const y = baseline - t * chartH;
          return (
            <g key={t}>
              <line
                x1={PL} x2={W - PR} y1={y} y2={y}
                stroke="#f0f0f4" strokeWidth="1"
                style={{ opacity: 0, animation: `fadeUp 0.5s ease ${0.1 + t * 0.08}s forwards` }}
              />
              {/* Y label — right-aligned before PL, vertically centered on grid line */}
              <text
                x={PL - 6} y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="9"
                fill="#9ca3af"
                fontFamily="'JetBrains Mono',monospace"
              >
                {`${Math.round(t * maxRaw / 1000)}k`}
              </text>
            </g>
          );
        })}

        {/* Baseline */}
        <line x1={PL} x2={W - PR} y1={baseline} y2={baseline} stroke="#e9eaf0" strokeWidth="1" />

        {/* Crosshair */}
        {hoveredIdx !== null && (
          <line
            x1={PL + hoveredIdx * barSlot + barSlot / 2}
            x2={PL + hoveredIdx * barSlot + barSlot / 2}
            y1={PT} y2={baseline}
            stroke={`${theme.p}30`} strokeWidth="1"
            strokeDasharray="3 3"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Bars */}
        <g clipPath="url(#brc-clip)">
          {bars.map((d, i) => {
            const bh     = Math.max(1, d.ratio * chartH);
            const x      = PL + i * barSlot + (barSlot - barW) / 2;
            const barTop = baseline - bh;
            const isHov  = hoveredIdx === i;

            const showLabel = bars.length <= 12
              ? i % 2 === 0
              : i % Math.ceil(bars.length / 8) === 0 || i === bars.length - 1;

            return (
              <g key={i} style={{ cursor: 'crosshair' }}
                onMouseEnter={e => handleBarEnter(i, e)}
                onMouseLeave={handleBarLeave}
              >
                <rect
                  x={x} y={barTop}
                  width={barW} height={bh}
                  rx={barR} ry={barR}
                  fill={isHov ? 'url(#brc-g-hover)' : 'url(#brc-g-normal)'}
                  style={{
                    transformBox:    'fill-box',
                    transformOrigin: 'bottom center',
                    transform:       `scaleY(${mounted ? 1 : 0})`,
                    transition:      `transform 0.5s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.018}s`,
                  }}
                />
                {/* X-axis label */}
                {showLabel && (
                  <text
                    x={x + barW / 2}
                    y={H - 6}
                    textAnchor="middle"
                    dominantBaseline="auto"
                    fontSize="9"
                    fill={isHov ? '#6b7280' : '#9ca3af'}
                    fontFamily="'JetBrains Mono',monospace"
                    style={{ transition: 'fill 0.15s ease' }}
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          key={tooltipKey}
          className="tooltip-popup"
          style={{ position: 'absolute', left: tooltip.x, top: tooltip.y, pointerEvents: 'none', zIndex: 20 }}
        >
          <div style={{
            background: 'rgba(15,15,26,0.92)', backdropFilter: 'blur(8px)',
            borderRadius: 9, padding: '7px 12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{tooltip.value}</div>
            <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>{tooltip.label}</div>
          </div>
          <div style={{
            width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '5px solid rgba(15,15,26,0.92)', margin: '0 auto',
          }} />
        </div>
      )}
    </div>
  );
}
