import React, { useState } from 'react';
import type { Theme } from '../types';

interface SystemHealthStripProps {
  activeSessions: number;
  memoryMb: number;
  uptimeSeconds: number;
  llmConsecutiveErrors: number;
  theme: Theme;
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
  icon: React.ReactNode;
}

function IconCircle({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
      background: `${color}0F`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.2s ease',
    }}>
      {children}
    </div>
  );
}

function HealthCard({ metric, idx }: { metric: HealthMetric; idx: number }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff',
        border: `1.5px solid ${metric.alert ? '#fecaca33' : '#e5e7eb44'}`,
        borderRadius: 24,
        boxShadow: hovered ? 'var(--shadow-card-hover)' : 'var(--shadow-card)',
        padding: '20px 24px 18px',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
        animation: `fadeUp 0.4s ease ${idx * 0.08}s both`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{
          fontSize: 10.5, fontWeight: 700, color: '#9CA3AF',
          textTransform: 'uppercase', letterSpacing: '0.1em',
          marginTop: 4,
        }}>
          {metric.label}
        </div>
        <IconCircle color={metric.alert ? '#ef4444' : metric.accentColor}>
          {metric.icon}
        </IconCircle>
      </div>

      <div style={{
        fontSize: 28, fontWeight: 800,
        color: metric.alert ? '#dc2626' : '#1A1D23',
        letterSpacing: '-0.02em', lineHeight: 1,
        marginBottom: 14,
      }}>
        {metric.value}
      </div>

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 20,
        background: metric.alert ? '#ef44440D' : '#f3f4f6',
      }}>
        <div style={{
          width: 5, height: 5, borderRadius: '50%',
          background: metric.alert ? '#ef4444' : metric.accentColor,
          animation: metric.alert ? 'livePulseRed 2s ease infinite' : 'none',
        }} />
        <span style={{ fontSize: 10.5, color: metric.alert ? '#dc2626' : '#6B7280', fontWeight: 500 }}>
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
      label: 'Sessions',
      value: String(activeSessions),
      sub: activeSessions > 20 ? 'High load' : 'Normal',
      alert: activeSessions > 20,
      accentColor: '#1e8ba6',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      label: 'Memory',
      value: `${memoryMb} MB`,
      sub: memoryMb > 800 ? 'Warning' : 'Healthy',
      alert: memoryMb > 800,
      accentColor: '#7e4ce6',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="2" ry="2" />
          <rect x="6" y="6" width="12" height="12" />
          <line x1="6" y1="1" x2="6" y2="2" />
          <line x1="18" y1="1" x2="18" y2="2" />
          <line x1="6" y1="22" x2="6" y2="23" />
          <line x1="18" y1="22" x2="18" y2="23" />
          <line x1="23" y1="6" x2="22" y2="6" />
          <line x1="23" y1="18" x2="22" y2="18" />
          <line x1="1" y1="6" x2="2" y2="6" />
          <line x1="1" y1="18" x2="2" y2="18" />
        </svg>
      ),
    },
    {
      label: 'Uptime',
      value: formatUptime(uptimeSeconds),
      sub: uptimeSeconds < 600 ? 'Recovering' : 'Stable',
      alert: uptimeSeconds < 600,
      accentColor: '#1e8f6e',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      label: 'LLM Errors',
      value: String(llmConsecutiveErrors),
      sub: llmConsecutiveErrors > 0 ? 'Fault detected' : 'Healthy',
      alert: llmConsecutiveErrors > 0,
      accentColor: '#1e8f6e',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      ),
    },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16,
      marginBottom: 16,
    }}>
      {metrics.map((metric, idx) => (
        <HealthCard key={metric.label} metric={metric} idx={idx} />
      ))}
    </div>
  );
}
