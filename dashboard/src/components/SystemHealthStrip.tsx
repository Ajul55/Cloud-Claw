import React, { useState } from 'react';
import type { Theme } from '../types';

interface SystemHealthStripProps {
  activeSessions: number;
  memoryMb: number;
  uptimeSeconds: number;
  llmConsecutiveErrors: number;
  theme: Theme;
  cardRadius?: number;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface HealthMetric {
  label: string;
  value: string;
  sub: string;
  alert: boolean;
  accentColor: string;
  pulseAnim: string;
}

function HealthCard({ metric, idx }: { metric: HealthMetric; idx: number }) {
  const [hovered, setHovered] = useState(false);

  const borderGrad = metric.alert
    ? hovered
      ? 'linear-gradient(135deg, #ef444465, #dc262645)'
      : 'linear-gradient(135deg, #ef444440, #dc262625)'
    : hovered
      ? `linear-gradient(135deg, ${metric.accentColor}55, ${metric.accentColor}25)`
      : `linear-gradient(135deg, ${metric.accentColor}35, ${metric.accentColor}14)`;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: metric.alert
          ? `linear-gradient(${hovered ? '#fffafa' : '#fffcfc'}, #fff5f5) padding-box, ${borderGrad} border-box`
          : `linear-gradient(#fff, #fff) padding-box, ${borderGrad} border-box`,
        border: '1.5px solid transparent',
        borderRadius: 20,
        boxShadow: metric.alert
          ? hovered
            ? '0 1px 0 rgba(255,255,255,1) inset, 0 6px 20px rgba(239,68,68,0.12), 0 16px 40px rgba(239,68,68,0.08)'
            : '0 1px 0 rgba(255,255,255,0.85) inset, 0 2px 8px rgba(239,68,68,0.06), 0 4px 20px rgba(239,68,68,0.05)'
          : hovered
            ? '0 1px 0 rgba(255,255,255,1) inset, 0 6px 20px rgba(0,0,0,0.09), 0 16px 40px rgba(0,0,0,0.08)'
            : '0 1px 0 rgba(255,255,255,0.85) inset, 0 2px 8px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.04)',
        padding: '20px 22px 16px',
        transform: hovered ? 'translateY(-4px)' : 'none',
        transition: 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.22s ease, background 0.22s ease',
        animation: `fadeUp 0.4s ease ${idx * 0.08}s both`,
      }}
    >
      {/* Label row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#9CA3AF',
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          {metric.label}
        </div>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: metric.alert ? '#ef4444' : metric.accentColor,
          animation: metric.pulseAnim,
          flexShrink: 0,
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          ...(hovered ? {
            transform: 'scale(1.25)',
            boxShadow: `0 0 0 4px ${metric.alert ? '#ef444425' : metric.accentColor + '25'}`,
          } : {}),
        }} />
      </div>

      {/* Value */}
      <div style={{
        fontSize: 28, fontWeight: 900,
        color: metric.alert ? '#dc2626' : '#0F0F1A',
        letterSpacing: '-1px', lineHeight: 1,
        marginBottom: 14,
        transition: 'color 0.2s ease',
      }}>
        {metric.value}
      </div>

      {/* Status pill */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 20,
        background: metric.alert ? 'rgba(239,68,68,0.08)' : 'rgba(0,0,0,0.04)',
        transition: 'background 0.2s ease',
      }}>
        <div style={{
          width: 5, height: 5, borderRadius: '50%',
          background: metric.alert ? '#ef4444' : metric.accentColor,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 10.5,
          color: metric.alert ? '#dc2626' : '#6B7280',
          fontWeight: metric.alert ? 600 : 500,
        }}>
          {metric.sub}
        </span>
      </div>
    </div>
  );
}

export function SystemHealthStrip({
  activeSessions,
  memoryMb,
  uptimeSeconds,
  llmConsecutiveErrors,
  theme: _theme,
}: SystemHealthStripProps) {
  const metrics: HealthMetric[] = [
    {
      label: 'Active Sessions',
      value: String(activeSessions),
      sub: activeSessions > 20 ? 'High load detected' : 'Load normal',
      alert: activeSessions > 20,
      accentColor: '#06B6D4',
      pulseAnim: activeSessions > 20 ? 'livePulseRed 2s ease infinite' : 'livePulse 2s ease infinite',
    },
    {
      label: 'Memory',
      value: `${memoryMb} MB`,
      sub: memoryMb > 800 ? 'Near restart threshold' : 'Within limits',
      alert: memoryMb > 800,
      accentColor: '#8B5CF6',
      pulseAnim: memoryMb > 800 ? 'livePulseRed 2s ease infinite' : 'livePulse 2s ease infinite',
    },
    {
      label: 'Uptime',
      value: formatUptime(uptimeSeconds),
      sub: uptimeSeconds < 600 ? 'Recent restart' : 'Running stable',
      alert: uptimeSeconds < 600,
      accentColor: '#10B981',
      pulseAnim: uptimeSeconds < 600 ? 'livePulseRed 2s ease infinite' : 'livePulse 2s ease infinite',
    },
    {
      label: 'LLM Errors',
      value: String(llmConsecutiveErrors),
      sub: llmConsecutiveErrors > 0 ? 'Consecutive failures' : 'No errors',
      alert: llmConsecutiveErrors > 0,
      accentColor: '#10B981',
      pulseAnim: llmConsecutiveErrors > 0 ? 'livePulseRed 2s ease infinite' : 'livePulse 2s ease infinite',
    },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12,
      marginBottom: 16,
    }}>
      {metrics.map((metric, idx) => (
        <HealthCard key={metric.label} metric={metric} idx={idx} />
      ))}
    </div>
  );
}
