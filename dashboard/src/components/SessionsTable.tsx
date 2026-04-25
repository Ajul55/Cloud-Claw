import React, { useState } from 'react';
import type { StatsResponse } from '../types';

type Session = StatsResponse['recentSessions'][number];

interface Props {
  sessions: Session[];
  accent?: string;
}

const LANE_BADGE: Record<1 | 2 | 3, { label: string; bg: string; color: string; hoverBg: string }> = {
  1: { label: 'API',       bg: '#EDE9FE', color: '#7C3AED', hoverBg: '#DDD6FE' },
  2: { label: 'SSH/Read',  bg: '#EFF6FF', color: '#3B82F6', hoverBg: '#DBEAFE' },
  3: { label: 'SSH/Write', bg: '#fee2e2', color: '#dc2626', hoverBg: '#FECACA' },
};

const TZ = 'Asia/Kolkata';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: TZ,
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function SessionRow({ s, accent, idx }: { s: Session; accent: string; idx: number }) {
  const [hovered, setHovered] = useState(false);
  const badge = LANE_BADGE[s.topLane];
  const shortId = s.sessionId.length > 18 ? `${s.sessionId.slice(0, 18)}…` : s.sessionId;

  const td: React.CSSProperties = {
    fontSize: 12, color: hovered ? '#0F0F1A' : '#374151',
    padding: '13px 8px',
    borderTop: '1px solid #F2F3F8',
    transition: 'color 0.15s ease',
  };

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'rgba(236,72,153,0.028)' : 'transparent',
        transition: 'background 0.15s ease',
        animation: `fadeUp 0.35s ease ${0.05 + idx * 0.04}s both`,
      }}
    >
      <td style={{
        ...td,
        fontFamily: 'monospace', fontSize: 11,
        color: hovered ? accent : `${accent}CC`,
        fontWeight: 600,
        transition: 'color 0.15s ease',
      }} title={s.sessionId}>
        {shortId}
      </td>
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: s.platform === 'slack' ? '#4A154B' : '#229ED9',
            flexShrink: 0,
          }} />
          {s.platform}
        </div>
      </td>
      <td style={{ ...td, fontWeight: hovered ? 600 : 400 }}>{s.toolCount}</td>
      <td style={{ ...td, fontWeight: hovered ? 600 : 400 }}>{fmt(s.tokensTotal)}</td>
      <td style={{
        ...td,
        color: hovered ? '#D97706' : '#F97316',
        fontWeight: 700,
        transition: 'color 0.15s ease',
      }}>
        ${s.costUsd.toFixed(4)}
      </td>
      <td style={td}>
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          fontSize: 10, fontWeight: 600, padding: '2px 8px',
          borderRadius: 99,
          background: hovered ? badge.hoverBg : badge.bg,
          color: badge.color,
          transition: 'background 0.15s ease',
        }}>
          {badge.label}
        </span>
      </td>
      <td style={{ ...td, color: '#94a3b8', fontSize: 11 }}>{fmtTime(s.createdAt)}</td>
    </tr>
  );
}

export function SessionsTable({ sessions, accent = '#EC4899' }: Props) {
  const th: React.CSSProperties = {
    fontSize: 10.5, color: '#9CA3AF', fontWeight: 700,
    textAlign: 'left', padding: '12px 8px',
    textTransform: 'uppercase', letterSpacing: '0.07em',
  };

  if (sessions.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>🕓</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
          No sessions recorded yet
        </div>
        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
          Start a session to see activity here.
        </div>
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['Session', 'Platform', 'Tools', 'Tokens', 'Cost', 'Lane', 'Time (IST)'].map(h => (
            <th key={h} style={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sessions.map((s, idx) => (
          <SessionRow key={s.sessionId} s={s} accent={accent} idx={idx} />
        ))}
      </tbody>
    </table>
  );
}
