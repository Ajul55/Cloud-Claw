import React from 'react';

interface SystemHealthStripProps {
  activeSessions: number;
  memoryMb: number;
  uptimeSeconds: number;
  llmConsecutiveErrors: number;
  cardRadius: number;
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
  accentBar: string;
}

export function SystemHealthStrip({
  activeSessions,
  memoryMb,
  uptimeSeconds,
  llmConsecutiveErrors,
  cardRadius,
}: SystemHealthStripProps) {
  const metrics: HealthMetric[] = [
    {
      label: 'Active Sessions',
      value: String(activeSessions),
      sub: activeSessions > 20 ? 'High load' : 'Normal',
      alert: activeSessions > 20,
      accentBar: '#06B6D4',
    },
    {
      label: 'Memory',
      value: `${memoryMb} MB`,
      sub: memoryMb > 800 ? 'Near restart threshold' : 'Normal',
      alert: memoryMb > 800,
      accentBar: '#8B5CF6',
    },
    {
      label: 'Uptime',
      value: formatUptime(uptimeSeconds),
      sub: uptimeSeconds < 600 ? 'Recent restart' : 'Stable',
      alert: uptimeSeconds < 600,
      accentBar: '#10B981',
    },
    {
      label: 'LLM Errors',
      value: String(llmConsecutiveErrors),
      sub: llmConsecutiveErrors > 0 ? 'Consecutive failures' : 'No errors',
      alert: llmConsecutiveErrors > 0,
      accentBar: '#EF4444',
    },
  ];

  return (
    <div style={{
      background: '#fff',
      borderRadius: cardRadius,
      border: '1px solid #EBEBF0',
      boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      marginBottom: 18,
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
    }}>
      {metrics.map(({ label, value, sub, alert, accentBar }, idx) => (
        <div key={label} style={{
          padding: '18px 24px 16px',
          borderRight: idx < 3 ? '1px solid #F0F0F5' : 'none',
          position: 'relative',
          background: alert ? '#fff5f5' : '#fff',
          borderRadius: idx === 0
            ? `${cardRadius}px 0 0 ${cardRadius}px`
            : idx === 3
              ? `0 ${cardRadius}px ${cardRadius}px 0`
              : 0,
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 24, right: 24,
            height: 2.5, borderRadius: '0 0 3px 3px',
            background: alert ? '#EF4444' : accentBar,
            opacity: 0.85,
          }} />
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#9CA3AF',
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8,
          }}>
            {label}
          </div>
          <div style={{
            fontSize: 28, fontWeight: 900,
            color: alert ? '#dc2626' : '#1a1a2e',
            letterSpacing: '-1px', lineHeight: 1,
          }}>
            {value}
          </div>
          <div style={{
            fontSize: 11,
            color: alert ? '#ef4444' : '#9CA3AF',
            fontWeight: alert ? 600 : 500,
            marginTop: 10,
          }}>
            {sub}
          </div>
        </div>
      ))}
    </div>
  );
}
