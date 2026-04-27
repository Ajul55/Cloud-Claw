import React, { useState, useEffect } from 'react';
import { useCountUp } from '../hooks/useCountUp';
import type { Theme } from '../types';

interface LaneStat {
  lane: 1 | 2 | 3;
  label: 'API' | 'SSH Read' | 'SSH Write';
  count: number;
}

interface Props {
  data: LaneStat[];
  theme: Theme;
}

// Low saturation lane colors
const LANE_COLORS: Record<number, string> = {
  1: '', // theme.p
  2: '#5C94A6', // muted cyan
  3: '#B07D66', // muted terracotta
};

const CX = 60, CY = 60, R = 42, STROKE_W = 12;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function LaneSplitChart({ data, theme }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [centerVisible, setCenterVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setCenterVisible(false);
    const t1 = setTimeout(() => setLoaded(true), 100);
    const t2 = setTimeout(() => setCenterVisible(true), 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [data]);

  const total = data.reduce((s, d) => s + d.count, 0);
  const dominant = data.length > 0 ? data.reduce((a, b) => (a.count > b.count ? a : b)) : null;
  const domPct = dominant && total > 0 ? Math.round((dominant.count / total) * 100) : 100;
  const animatedPct = useCountUp(domPct, 1000, 600);

  const rows = data.length > 0 ? data : [{ lane: 1 as const, label: 'API' as const, count: 1 }];
  const isSingle = rows.length === 1;
  const GAP_DEG = rows.length > 1 ? 2.5 : 0;

  let cumulativeAngle = -90;
  const segments = rows.map((d, i) => {
    const color = i === 0 ? theme.p : (LANE_COLORS[d.lane] || theme.l);
    const pct = total > 0 ? d.count / total : 1;
    const arcDeg = pct * 360 - GAP_DEG;
    const arcLen = Math.max(0, (arcDeg / 360) * CIRCUMFERENCE);
    const startAngle = cumulativeAngle;
    cumulativeAngle += pct * 360;
    const dashOffsetTarget = CIRCUMFERENCE - arcLen;
    return { color, startAngle, arcLen, dashOffsetTarget, label: d.label, pct };
  });

  const gradId = `donut-grad-refined-${theme.id}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      {/* Donut Container */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative',
          width: 120, height: 120,
          flexShrink: 0,
          transform: hovered ? 'scale(1.03)' : 'scale(1)',
          transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          filter: hovered ? `drop-shadow(0 6px 16px ${theme.p}1A)` : 'none',
        }}
      >
        <svg width="120" height="120" viewBox="0 0 120 120" style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={theme.d} stopOpacity="0.7" />
              <stop offset="100%" stopColor={theme.p} stopOpacity="0.8" />
            </linearGradient>
          </defs>

          {/* Background Track */}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#F1F3F9" strokeWidth={STROKE_W} />

          {/* Segments */}
          {segments.map((seg, i) => (
            <circle
              key={i}
              cx={CX} cy={CY} r={R}
              fill="none"
              stroke={isSingle ? `url(#${gradId})` : seg.color}
              strokeWidth={STROKE_W}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={loaded ? seg.dashOffsetTarget : CIRCUMFERENCE}
              transform={`rotate(${seg.startAngle} ${CX} ${CY})`}
              style={{
                transition: `stroke-dashoffset 800ms cubic-bezier(0.25, 0.46, 0.45, 0.94) ${i * 0.05}s`,
                opacity: 0.85,
              }}
            />
          ))}
        </svg>

        {/* Center Label */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: `translate(-50%, -50%) scale(${centerVisible ? 1 : 0.95})`,
          opacity: centerVisible ? 1 : 0,
          transition: 'all 400ms ease 300ms',
          textAlign: 'center', pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1A1D23', lineHeight: 1 }}>
            {Math.round(animatedPct)}%
          </div>
          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2, fontWeight: 500 }}>
            {dominant?.label || 'API'}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((d, i) => {
          const color = i === 0 ? theme.p : (LANE_COLORS[d.lane] || theme.l);
          const pct = total > 0 ? Math.round((d.count / total) * 100) : 100;
          return (
            <div key={d.lane}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.7 }} />
                <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>{d.label}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1D23', paddingLeft: 16 }}>
                {pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
