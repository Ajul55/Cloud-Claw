import React, { useState, useEffect } from 'react';
import { useCountUp } from '../hooks/useCountUp';

interface LaneStat {
  lane: 1 | 2 | 3;
  label: 'API' | 'SSH Read' | 'SSH Write';
  count: number;
}

interface Props {
  data: LaneStat[];
}

const LANE_COLORS: Record<number, string> = {
  1: '#7C3AED',
  2: '#06B6D4',
  3: '#F0856A',
};

export function LaneSplitChart({ data }: Props) {
  const [drawn, setDrawn] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 300);
    return () => clearTimeout(t);
  }, []);

  const total = data.reduce((s, d) => s + d.count, 0);
  const dominant = data.length > 0
    ? data.reduce((a, b) => (a.count > b.count ? a : b))
    : null;
  const dominantPct = dominant && total > 0
    ? Math.round((dominant.count / total) * 100)
    : 100;

  const r = 36, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  const dash = drawn ? (dominantPct / 100) * circ : 0;

  const displayLabel = dominant?.label ?? 'API';
  const displayPct   = total === 0 ? 100 : dominantPct;
  const animatedPct  = useCountUp(displayPct, 1000, 350);

  const rows = data.length > 0
    ? data
    : [{ lane: 1 as const, label: 'API' as const, count: 1 }];

  return (
    /* Horizontal layout: donut left, legend right */
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      position: 'relative'
    }}>
      {/* Donut Container — Centered in card */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          transition: 'filter 0.25s ease, transform 0.25s ease',
          filter: hovered
            ? 'drop-shadow(0 0 10px rgba(124,58,237,0.28)) drop-shadow(0 0 4px rgba(6,182,212,0.18))'
            : 'none',
          transform: hovered ? 'scale(1.04)' : 'scale(1)',
          cursor: 'default',
        }}
      >
        <svg width={140} height={140} viewBox="0 0 100 100">
          <defs>
            <filter id="ls-glow" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur stdDeviation="2.8" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="ls-grad" gradientUnits="userSpaceOnUse" x1="10" y1="10" x2="90" y2="90">
              <stop offset="0%"   stopColor="#7C3AED" />
              <stop offset="55%"  stopColor="#6366F1" />
              <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>
          </defs>

          {/* Track ring */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEF0F8" strokeWidth="10" />

          {/* Animated progress stroke */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="url(#ls-grad)"
            strokeWidth="10"
            strokeDasharray={`${dash} ${circ}`}
            strokeDashoffset={circ * 0.25}
            strokeLinecap="round"
            filter="url(#ls-glow)"
            style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.34,1.2,0.64,1) 0.3s' }}
          />

          {/* Center text — perfectly aligned (true center, not offset) */}
          <g textAnchor="middle" fontFamily="Geist,sans-serif" transform={`translate(${cx},${cy})`}>
            <text
              y="-1"
              fontSize="20" fontWeight="900"
              fill="#0F0F1A" letterSpacing="-0.5"
              dominantBaseline="middle"
            >
              {Math.round(animatedPct)}%
            </text>
            <text
              y="14"
              fontSize="7"
              fill="#9CA3AF"
              fontWeight="700"
              dominantBaseline="middle"
              style={{ textTransform: 'uppercase', letterSpacing: '0.8px' }}
            >
              {displayLabel}
            </text>
          </g>
        </svg>
      </div>

      {/* Legend — Below the donut to maintain centering, or floated */}
      <div style={{
        marginTop: 14,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: 10,
        width: '100%',
        padding: '0 10px'
      }}>
        {rows.map((d, i) => (
          <LegendRow
            key={d.lane}
            d={d}
            total={total}
            color={LANE_COLORS[d.lane]}
            idx={i}
          />
        ))}
      </div>
    </div>
  );
}

function LegendRow({
  d, total, color, idx,
}: {
  d: LaneStat;
  total: number;
  color: string;
  idx: number;
}) {
  const [hovered, setHovered] = useState(false);
  const pct = total > 0 ? Math.round((d.count / total) * 100) : 100;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 12,
        background: hovered ? `${color}12` : 'rgba(0,0,0,0.02)',
        transition: 'all 0.2s ease',
        animation: `fadeUp 0.35s ease ${0.6 + idx * 0.1}s both`,
        cursor: 'default',
        minWidth: 100,
      }}
    >
      <div style={{
        width: 8, height: 8, borderRadius: '50%', background: color,
        boxShadow: `0 0 6px ${color}66`,
        transform: hovered ? 'scale(1.2)' : 'scale(1)',
        transition: 'transform 0.2s ease',
      }} />
      <span style={{
        fontSize: 11, fontWeight: 700, color: '#4B5563', flex: 1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      }}>
        {d.label}
      </span>
      <span style={{
        fontSize: 11, fontWeight: 800, color: '#1F2937',
        fontFamily: 'Geist Mono, monospace'
      }}>
        {pct}%
      </span>
    </div>
  );
}
