import React, { useState } from 'react';
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

const LANE_COLORS: Record<number, string> = {
  1: '', // will use theme.p
  2: '#06B6D4',
  3: '#F0856A',
};

export function LaneSplitChart({ data, theme }: Props) {
  const [hovered, setHovered] = useState(false);

  const total = data.reduce((s, d) => s + d.count, 0);
  const dominant = data.length > 0
    ? data.reduce((a, b) => (a.count > b.count ? a : b))
    : null;
  const dominantPct   = dominant && total > 0 ? Math.round((dominant.count / total) * 100) : 100;
  const displayLabel  = dominant?.label ?? 'API';
  const animatedPct   = useCountUp(dominantPct, 1000, 350);

  // Build conic-gradient based on real data or full theme gradient for single lane
  let conicBg: string;
  if (data.length <= 1 || total === 0) {
    // Full theme gradient donut (100% single lane)
    conicBg = `conic-gradient(${theme.d} 0deg, ${theme.p} 120deg, ${theme.l} 240deg, ${theme.grad} 360deg)`;
  } else {
    // Multi-lane split with colors
    let angle = 0;
    const stops = data.map((d, i) => {
      const color = i === 0 ? theme.p : LANE_COLORS[d.lane] || theme.l;
      const endAngle = angle + (d.count / total) * 360;
      const stop = `${color} ${angle.toFixed(1)}deg ${endAngle.toFixed(1)}deg`;
      angle = endAngle;
      return stop;
    });
    conicBg = `conic-gradient(${stops.join(', ')})`;
  }

  const rows = data.length > 0
    ? data
    : [{ lane: 1 as const, label: 'API' as const, count: 1 }];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {/* Conic-gradient donut */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative', width: 120, height: 120, flexShrink: 0,
          transition: 'transform 0.25s ease',
          transform: hovered ? 'scale(1.04)' : 'scale(1)',
        }}
      >
        {/* Outer gradient ring */}
        <div style={{
          width: '100%', height: '100%', borderRadius: '50%',
          background: conicBg,
          boxShadow: `0 4px 20px ${theme.p}40`,
        }} />
        {/* Inner white cutout */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 76, height: 76, borderRadius: '50%',
          background: '#fff',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 0 1px #e9eaf0',
        }}>
          <span style={{
            fontSize: 15, fontWeight: 800, color: '#1a1d23',
            fontFamily: "'Geist', sans-serif", lineHeight: 1,
          }}>
            {Math.round(animatedPct)}%
          </span>
          <span style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>{displayLabel}</span>
        </div>
      </div>

      {/* Legend */}
      <div>
        {rows.map((d, i) => {
          const color = i === 0 ? theme.p : LANE_COLORS[d.lane] || theme.l;
          const pct   = total > 0 ? Math.round((d.count / total) * 100) : 100;
          return (
            <div key={d.lane} style={{ marginBottom: i < rows.length - 1 ? 8 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 3,
                  background: `linear-gradient(135deg,${theme.d},${theme.l})`,
                  display: 'inline-block', flexShrink: 0,
                }} />
                <span style={{ fontSize: 12, color: '#6b7280' }}>{d.label}</span>
              </div>
              <div style={{
                fontSize: 13, fontFamily: "'JetBrains Mono', Geist Mono, monospace",
                color: '#374151', fontWeight: 600,
              }}>
                {pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
