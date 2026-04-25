/**
 * BurnRateChart — premium bar chart with micro-interactions
 *
 * Interaction model:
 *   • Bars grow from baseline on mount with staggered delay
 *   • Hovered bar: scaleX expansion + glow increase
 *   • Crosshair vertical hairline follows hovered bar
 *   • Tooltip fades in with upward motion (via CSS keyframe)
 *   • Peak bar always highlighted pink→orange
 */

import React, { useState, useEffect, useRef } from 'react';
import type { Range } from '../types';

interface Props {
  data: { bucket: string; tokens: number }[];
  range: Range;
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
  0.72, 0.88, 0.65, 0.44, 0.82,
].map((r, i) => ({ ratio: r, label: `${i}h` }));

export function BurnRateChart({ data, range }: Props) {
  const containerRef          = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // Tooltip key forces re-mount (re-animation) on each new bar hover
  const [tooltipKey, setTooltipKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  const raw = data.length > 0
    ? data.map(d => ({ raw: d.tokens, label: formatLabel(d.bucket, range) }))
    : PLACEHOLDER.map(d => ({ raw: d.ratio * 500_000, label: d.label }));

  const maxRaw = Math.max(...raw.map(d => d.raw), 1);
  const bars   = raw.map(d => ({ ...d, ratio: d.raw / maxRaw }));
  const peakIdx = bars.reduce((b, d, i) => (d.ratio > bars[b].ratio ? i : b), 0);

  // ── SVG layout — strictly aligned to container bounds ────────────────────────
  const VW = 100, VH = 100;
  const PL = 8, PR = 1, PT = 4, PB = 12;
  const chartW   = VW - PL - PR;
  const chartH   = VH - PT - PB;
  const baseline = PT + chartH;
  const barSlot  = chartW / bars.length;
  // barW: medium width bars proportional to slot
  const barW     = barSlot * 0.6; 
  const barR     = barW * 0.35;
  const yTicks   = [0, 0.25, 0.5, 0.75, 1.0];

  // ── Tooltip ─────────────────────────────────────────────────────────────────
  const handleBarEnter = (i: number, e: React.MouseEvent<SVGGElement>) => {
    if (!containerRef.current) return;
    const cRect   = containerRef.current.getBoundingClientRect();
    const svgEl   = e.currentTarget.closest('svg') as SVGSVGElement;
    const svgRect = svgEl.getBoundingClientRect();
    // Use the middle of the slot for tooltips
    const barCX = svgRect.left + ((PL + i * barSlot + barSlot / 2) / VW) * svgRect.width;
    const barTY = svgRect.top  + ((baseline - bars[i].ratio * chartH) / VH) * svgRect.height;

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

  // Crosshair x position in px (for the div overlay crosshair)
  const crosshairX = hoveredIdx !== null && containerRef.current
    ? (() => {
        // We'll compute it on the SVG dimensions — approximate via ratio
        return null; // computed inline below
      })()
    : null;
  void crosshairX;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>

      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', overflow: 'hidden' }}
      >
        <defs>
          <clipPath id="brc-clip">
            <rect x={PL} y={PT} width={chartW} height={chartH} />
          </clipPath>

          {/* Normal bar: pink→orange, semi-transparent base */}
          <linearGradient id="brc-g-normal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#EC4899" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0.30" />
          </linearGradient>

          {/* Hover bar: full intensity */}
          <linearGradient id="brc-g-hover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#FF2D9B" stopOpacity="1.00" />
            <stop offset="100%" stopColor="#FF7A20" stopOpacity="0.55" />
          </linearGradient>

          {/* Peak bar: vivid, deepened orange at bottom */}
          <linearGradient id="brc-g-peak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#EC4899" stopOpacity="1.00" />
            <stop offset="60%"  stopColor="#F97316" stopOpacity="0.90" />
            <stop offset="100%" stopColor="#EA580C" stopOpacity="0.50" />
          </linearGradient>

          {/* Glow filters */}
          <filter id="brc-glow" x="-80%" y="-40%" width="260%" height="180%">
            <feGaussianBlur stdDeviation="1.8" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="brc-glow-hover" x="-100%" y="-50%" width="300%" height="200%">
            <feGaussianBlur stdDeviation="2.8" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="brc-glow-peak" x="-100%" y="-50%" width="300%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {yTicks.map((t) => {
          const y   = baseline - t * chartH;
          const val = t === 0 ? '0' : `${Math.round(t * maxRaw / 1000)}k`;
          return (
            <g key={t}>
              <line
                x1={PL} x2={PL + chartW} y1={y} y2={y}
                stroke={t === 0 ? '#C8C4DC' : '#EEECF6'}
                strokeWidth={t === 0 ? 0.7 : 0.3}
                style={t > 0 ? {
                  opacity: 0,
                  animation: `fadeUp 0.5s ease ${0.2 + t * 0.1}s forwards`,
                } : {}}
              />
              <text
                x={PL - 1.5} y={y + 1.4}
                textAnchor="end" fontSize="2.7"
                fill="#C0BDCE" fontFamily="Geist,sans-serif"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Y-axis left line removed for clean layout */}

        {/* Crosshair hairline */}
        {hoveredIdx !== null && (() => {
          const cx = PL + hoveredIdx * barSlot + barSlot / 2;
          return (
            <line
              x1={cx} x2={cx} y1={PT} y2={baseline}
              stroke="#EC489930" strokeWidth="0.5"
              strokeDasharray="2 2"
              style={{ pointerEvents: 'none' }}
            />
          );
        })()}

        {/* Bars */}
        <g clipPath="url(#brc-clip)">
          {bars.map((d, i) => {
            const bh     = d.ratio * chartH;
            const x      = PL + i * barSlot + (barSlot - barW) / 2;
            const barTop = baseline - bh;
            const isHov  = hoveredIdx === i;
            const isPeak = i === peakIdx;

            const fill   = isHov    ? 'url(#brc-g-hover)'
                         : isPeak   ? 'url(#brc-g-peak)'
                         :            'url(#brc-g-normal)';
            const filter = isHov    ? 'url(#brc-glow-hover)'
                         : isPeak   ? 'url(#brc-glow-peak)'
                         :            'url(#brc-glow)';

            const showLabel = bars.length <= 8
              ? true
              : i % Math.ceil(bars.length / 6) === 0 || i === bars.length - 1;

            // scaleX expands bar width on hover; scaleY is always 1 after mount
            const scaleX = isHov ? 1.18 : 1;

            return (
              <g
                key={i}
                style={{ cursor: 'crosshair' }}
                onMouseEnter={e => handleBarEnter(i, e)}
                onMouseLeave={handleBarLeave}
              >
                <rect
                  x={x}
                  y={barTop}
                  width={barW}
                  height={bh + barR}
                  rx={barR}
                  ry={barR}
                  fill={fill}
                  filter={filter}
                  style={{
                    transformBox:    'fill-box',
                    transformOrigin: 'bottom center',
                    transform:       `scaleY(${mounted ? 1 : 0}) scaleX(${scaleX})`,
                    transition:      `transform 0.6s cubic-bezier(0.22,1,0.36,1) ${i * 0.035}s,
                                      fill 0.18s ease,
                                      filter 0.18s ease`,
                  }}
                />

                {/* Highlight cap */}
                {mounted && bh > 3 && (
                  <rect
                    x={x + 1} y={barTop + 0.5}
                    width={barW - 2} height={1.5} rx={1}
                    fill={isHov ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.35)"}
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {/* X-axis label */}
                {showLabel && (
                  <text
                    x={x + barW / 2} y={VH - 1.5}
                    textAnchor="middle" fontSize="2.6"
                    fill={isHov ? '#9B8FB0' : '#B8B5C8'}
                    fontFamily="Geist,sans-serif"
                    style={{ transition: 'fill 0.15s ease' }}
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {/* Subtle baseline */}
        <line
          x1={PL} x2={PL + chartW}
          y1={baseline} y2={baseline}
          stroke="#EEECF6" strokeWidth="0.8"
        />
      </svg>

      {/* Tooltip — CSS fade-in on each hover */}
      {tooltip && (
        <div
          key={tooltipKey}
          className="tooltip-popup"
          style={{
            position:      'absolute',
            left:          tooltip.x,
            top:           tooltip.y,
            pointerEvents: 'none',
            zIndex:        20,
          }}
        >
          <div style={{
            background:   'rgba(15,15,26,0.92)',
            backdropFilter: 'blur(8px)',
            borderRadius: 9,
            padding:      '7px 12px',
            boxShadow:    '0 4px 20px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.06) inset',
            whiteSpace:   'nowrap',
            border:       '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>
              {tooltip.value}
            </div>
            <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>
              {tooltip.label}
            </div>
          </div>
          <div style={{
            width: 0, height: 0,
            borderLeft:  '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop:   '5px solid rgba(15,15,26,0.92)',
            margin:      '0 auto',
          }} />
        </div>
      )}
    </div>
  );
}
