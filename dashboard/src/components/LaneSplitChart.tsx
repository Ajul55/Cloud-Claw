import React, { useState, useEffect } from 'react';

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

  const r = 40, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  const dash = drawn ? (dominantPct / 100) * circ : 0;

  const displayLabel = dominant?.label ?? 'SSH/Read';
  const displayPct = total === 0 ? 100 : dominantPct;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      {/* SVG Donut */}
      <svg width={150} height={150} viewBox="0 0 100 100">
        <defs>
          <filter id="ls-glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="ls-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#06B6D4" />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EDE9FE" strokeWidth="12" />
        {/* Progress */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="url(#ls-grad)"
          strokeWidth="12"
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ * 0.25}
          strokeLinecap="round"
          filter="url(#ls-glow)"
          style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.34,1.2,0.64,1)' }}
        />
        {/* Center text */}
        <text x="50" y="47" textAnchor="middle" fontSize="16" fontWeight="800" fill="#1a1a2e" fontFamily="Geist,sans-serif">
          {displayPct}%
        </text>
        <text x="50" y="61" textAnchor="middle" fontSize="7" fill="#94A3B8" fontFamily="Geist,sans-serif">
          {displayLabel}
        </text>
      </svg>

      {/* Legend */}
      <div style={{ marginTop: 14, width: '100%', padding: '10px 0 0', borderTop: '1px solid #F0EEF8' }}>
        {data.length > 0 ? data.map(d => (
          <div key={d.lane} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{
                width: 9, height: 9, borderRadius: '50%',
                background: LANE_COLORS[d.lane],
                boxShadow: `0 0 6px ${LANE_COLORS[d.lane]}aa`,
              }} />
              <span style={{ fontSize: 12, color: '#555' }}>{d.label}</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>
              {total > 0 ? Math.round((d.count / total) * 100) : 0}%
            </span>
          </div>
        )) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#7C3AED', boxShadow: '0 0 6px #7C3AEDaa' }} />
              <span style={{ fontSize: 12, color: '#555' }}>SSH/Read</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>100%</span>
          </div>
        )}
      </div>
    </div>
  );
}
