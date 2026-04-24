/**
 * BurnRateChart — grounded, premium SVG bar chart
 *
 * ROOT CAUSE of "floating bars":
 *   1. rx/ry rounds ALL 4 corners → bottom rounding visually lifts bars off baseline
 *   2. Animating SVG `y` + `height` attributes separately → they don't stay in sync
 *      during transition → bar bottom drifts up from baseline mid-animation
 *
 * FIXES:
 *   1. clipPath crops the chart area at the baseline → bottom rounding is hidden,
 *      bars appear flush to the floor
 *   2. Switched to transform: scaleY() + transform-box: fill-box +
 *      transform-origin: bottom → single-property animation, always grows
 *      from baseline, never floats
 *   3. Explicit baseline line (strokeWidth 1) anchors bars visually
 *   4. Y domain always [0, max], no auto-centering
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

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  // ── Data normalisation ──────────────────────────────────────────────────────
  const raw = data.length > 0
    ? data.map(d => ({ raw: d.tokens,       label: formatLabel(d.bucket, range) }))
    : PLACEHOLDER.map(d => ({ raw: d.ratio * 500_000, label: d.label }));

  // Y domain always starts at 0
  const maxRaw = Math.max(...raw.map(d => d.raw), 1);
  const bars   = raw.map(d => ({ ...d, ratio: d.raw / maxRaw }));  // ratio ∈ [0, 1]

  const peakIdx = bars.reduce((b, d, i) => (d.ratio > bars[b].ratio ? i : b), 0);

  // ── SVG layout ──────────────────────────────────────────────────────────────
  // viewBox units (not px)
  const VW = 100, VH = 100;
  const PL = 9;   // left  — room for y-axis labels
  const PR = 1;   // right
  const PT = 4;   // top   — minimal headroom
  const PB = 14;  // bottom — x-axis labels

  const chartW    = VW - PL - PR;
  const chartH    = VH - PT - PB;
  const baseline  = PT + chartH;           // y-coordinate of the zero line
  const barSlot   = chartW / bars.length;
  const barW      = barSlot * 0.38;        // thin, elegant — 38 % of slot
  const barR      = 3;                     // corner radius (top only, see clip)

  // Y-axis: 4 grid lines at 0 %, 33 %, 66 %, 100 %
  const yTicks = [0, 0.33, 0.66, 1.0];

  // ── Tooltip positioning ─────────────────────────────────────────────────────
  const handleBarEnter = (i: number, e: React.MouseEvent<SVGGElement>) => {
    if (!containerRef.current) return;
    const cRect   = containerRef.current.getBoundingClientRect();
    const svgEl   = e.currentTarget.closest('svg') as SVGSVGElement;
    const svgRect = svgEl.getBoundingClientRect();

    const barCX = svgRect.left + ((PL + i * barSlot + barSlot / 2) / VW) * svgRect.width;
    const barTY = svgRect.top  + ((baseline - bars[i].ratio * chartH) / VH) * svgRect.height;

    setHoveredIdx(i);
    setTooltip({
      x: barCX - cRect.left,
      y: barTY - cRect.top - 10,
      value: formatTokenValue(bars[i].raw),
      label: bars[i].label,
    });
  };

  const handleBarLeave = () => { setHoveredIdx(null); setTooltip(null); };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>

      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: '100%', height: '100%', overflow: 'visible' }}
      >
        <defs>
          {/* ── FIX 1: clipPath at exact chart bounds ──────────────────────
              Any part of a bar below `baseline` is clipped → bottom
              rounded corners disappear → bars look flush to the floor.    */}
          <clipPath id="brc-clip">
            <rect x={PL} y={PT} width={chartW} height={chartH} />
          </clipPath>

          {/* Gradients — single coral hue, 3-stop color shift (not opacity-only) */}
          <linearGradient id="brc-g-normal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#F0856A" stopOpacity="0.95" />
            <stop offset="55%"  stopColor="#E8622A" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#F0856A" stopOpacity="0.08" />
          </linearGradient>

          <linearGradient id="brc-g-hover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#FF9E7A" stopOpacity="1.00" />
            <stop offset="50%"  stopColor="#F0856A" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#F0856A" stopOpacity="0.14" />
          </linearGradient>

          <linearGradient id="brc-g-peak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#EC4899" stopOpacity="1.00" />
            <stop offset="55%"  stopColor="#F0856A" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#F0856A" stopOpacity="0.10" />
          </linearGradient>

          {/* Glow filters */}
          <filter id="brc-glow" x="-60%" y="-30%" width="220%" height="160%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="brc-glow-peak" x="-80%" y="-40%" width="260%" height="180%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ── Grid lines ── light hairlines, no dash, baseline solid ─────── */}
        {yTicks.map((t) => {
          const y   = baseline - t * chartH;          // y=baseline at t=0
          const val = t === 0
            ? '0'
            : `${Math.round(t * maxRaw / 1000)}k`;
          return (
            <g key={t}>
              <line
                x1={PL} x2={PL + chartW}
                y1={y}  y2={y}
                stroke={t === 0 ? '#C8C4DC' : '#EEECF6'}
                strokeWidth={t === 0 ? 0.7 : 0.3}
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

        {/* ── Bars (inside clipPath) ──────────────────────────────────────── */}
        <g clipPath="url(#brc-clip)">
          {bars.map((d, i) => {
            const bh     = d.ratio * chartH;
            const x      = PL + i * barSlot + (barSlot - barW) / 2;
            // Bar top-left: starts at baseline, extends up by bh.
            // Add barR to height so the bottom rounded corners fall *below*
            // the clip boundary and are invisible → only top corners show.
            const barTop = baseline - bh;
            const isHov  = hoveredIdx === i;
            const isPeak = i === peakIdx;
            const fill   = isHov    ? 'url(#brc-g-hover)'
                         : isPeak   ? 'url(#brc-g-peak)'
                         :            'url(#brc-g-normal)';
            const filter = isPeak   ? 'url(#brc-glow-peak)'
                         : isHov    ? 'url(#brc-glow)'
                         :            'none';

            const showLabel = bars.length <= 8
              ? true
              : i % Math.ceil(bars.length / 6) === 0 || i === bars.length - 1;

            return (
              <g
                key={i}
                style={{ cursor: 'crosshair' }}
                onMouseEnter={e => handleBarEnter(i, e)}
                onMouseLeave={handleBarLeave}
              >
                {/* ── FIX 2: scaleY from bottom instead of animating y+height ──
                    transform-box:fill-box  → transform-origin is relative to
                                              this element's own bounding box.
                    transform-origin:bottom → scale pivot is the bar's bottom edge
                                              (= the baseline), so it grows UP.
                    scaleY(0→1)             → single property, always in sync,
                                              bar bottom stays at baseline.       */}
                <rect
                  x={x}
                  y={barTop}
                  width={barW}
                  height={bh + barR}   // +barR pushed below clip → no bottom rounding visible
                  rx={barR}
                  ry={barR}
                  fill={fill}
                  filter={filter}
                  style={{
                    transformBox:    'fill-box',
                    transformOrigin: 'bottom',
                    transform:       `scaleY(${mounted ? 1 : 0})`,
                    transition:      `transform 0.6s cubic-bezier(0.22,1,0.36,1) ${i * 0.035}s,
                                      fill 0.15s ease`,
                  }}
                />

                {/* Highlight cap — top 2px white sheen, only when visible */}
                {mounted && bh > 3 && (
                  <rect
                    x={x + 1}
                    y={barTop + 0.5}
                    width={barW - 2}
                    height={1.8}
                    rx={1.5}
                    fill="rgba(255,255,255,0.4)"
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {/* X-axis label */}
                {showLabel && (
                  <text
                    x={x + barW / 2} y={VH - 1.5}
                    textAnchor="middle" fontSize="2.6"
                    fill="#B8B5C8" fontFamily="Geist,sans-serif"
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Strong baseline drawn ON TOP of bars so it's always crisp */}
        <line
          x1={PL} x2={PL + chartW}
          y1={baseline} y2={baseline}
          stroke="#C8C4DC" strokeWidth="0.7"
        />
      </svg>

      {/* ── HTML tooltip — stays readable at any zoom ───────────────────────── */}
      {tooltip && (
        <div style={{
          position:      'absolute',
          left:          tooltip.x,
          top:           tooltip.y,
          transform:     'translate(-50%, -100%)',
          pointerEvents: 'none',
          zIndex:        20,
        }}>
          <div style={{
            background:   '#1a1a2e',
            borderRadius: 8,
            padding:      '6px 11px',
            boxShadow:    '0 4px 18px rgba(0,0,0,0.28)',
            whiteSpace:   'nowrap',
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
            borderTop:   '5px solid #1a1a2e',
            margin:      '0 auto',
          }} />
        </div>
      )}
    </div>
  );
}
