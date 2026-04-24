import React from 'react';
import type { StatsResponse } from '../types';

type Session = StatsResponse['recentSessions'][number];

interface Props {
  sessions: Session[];
  accent?: string;
}

const LANE_BADGE: Record<1 | 2 | 3, { label: string; bg: string; color: string }> = {
  1: { label: 'API',       bg: '#EDE9FE', color: '#7C3AED' },
  2: { label: 'SSH/Read',  bg: '#EFF6FF', color: '#3B82F6' },
  3: { label: 'SSH/Write', bg: '#fee2e2', color: '#dc2626' },
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

export function SessionsTable({ sessions, accent = '#EC4899' }: Props) {
  const th: React.CSSProperties = {
    fontSize: 10.5, color: '#9CA3AF', fontWeight: 700,
    textAlign: 'left', padding: '12px 8px',
    textTransform: 'uppercase', letterSpacing: '0.07em',
  };
  const td: React.CSSProperties = {
    fontSize: 12, color: '#1a1a2e',
    padding: '13px 8px', borderTop: '1px solid #F4F4F8',
  };

  if (sessions.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
        No sessions recorded yet
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>Session</th>
          <th style={th}>Platform</th>
          <th style={th}>Tools</th>
          <th style={th}>Tokens</th>
          <th style={th}>Cost</th>
          <th style={th}>Lane</th>
          <th style={th}>Time (IST)</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => {
          const badge = LANE_BADGE[s.topLane];
          const shortId = s.sessionId.length > 18 ? `${s.sessionId.slice(0, 18)}…` : s.sessionId;
          return (
            <tr key={s.sessionId}>
              <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: accent, fontWeight: 600 }} title={s.sessionId}>
                {shortId}
              </td>
              <td style={td}>{s.platform}</td>
              <td style={td}>{s.toolCount}</td>
              <td style={td}>{fmt(s.tokensTotal)}</td>
              <td style={{ ...td, color: '#F97316', fontWeight: 700 }}>
                ${s.costUsd.toFixed(4)}
              </td>
              <td style={td}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center',
                  fontSize: 10, fontWeight: 600, padding: '2px 8px',
                  borderRadius: 99, background: badge.bg, color: badge.color,
                }}>
                  {badge.label}
                </span>
              </td>
              <td style={{ ...td, color: '#94a3b8', fontSize: 11 }}>{fmtTime(s.createdAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
