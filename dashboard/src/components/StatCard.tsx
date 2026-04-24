import React from 'react';
import { ArrowUp, ArrowDown, Minus } from './Icons';

type TrendDirection = 'up' | 'down' | 'stable';

interface Trend {
  direction: TrendDirection;
  pct: string;
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  trend?: Trend;
  valueColor?: string;
}

const TREND_STYLE: Record<TrendDirection, { bg: string; color: string; Icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  up:     { bg: '#dcfce7', color: '#16a34a', Icon: ArrowUp },
  down:   { bg: '#fee2e2', color: '#dc2626', Icon: ArrowDown },
  stable: { bg: '#f1f5f9', color: '#64748b', Icon: Minus },
};

export function StatCard({ label, value, icon, iconBg, trend, valueColor }: StatCardProps) {
  const ts = trend ? TREND_STYLE[trend.direction] : null;
  const TrendIcon = ts?.Icon;

  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 12,
      padding: '18px 20px',
      boxShadow: '0 1px 3px rgba(0,0,0,.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{label}</span>
        <div style={{
          width: 36, height: 36, borderRadius: 9, flexShrink: 0,
          background: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: valueColor ?? '#0f172a', lineHeight: 1, marginBottom: 8 }}>
        {value}
      </div>
      {ts && TrendIcon && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontWeight: 600, padding: '3px 8px',
          borderRadius: 99, background: ts.bg, color: ts.color,
        }}>
          <TrendIcon size={11} color={ts.color} />
          {trend!.pct}
        </span>
      )}
    </div>
  );
}
