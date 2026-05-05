import React, { useState } from 'react';
import { RefreshCw, AlertTriangle } from '../components/Icons';
import { useSessions } from '../hooks/useSessions';
import type { SessionRow } from '../types';

const ACCENT = '#EC4899';
const CARD_RADIUS = 20;

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  active:     { bg: '#dcfce7', color: '#16a34a' },
  open:       { bg: '#EFF6FF', color: '#3B82F6' },
  resolved:   { bg: '#F0F0F5', color: '#6B7280' },
  escalated:  { bg: '#fee2e2', color: '#dc2626' },
  in_progress:{ bg: '#FEF3C7', color: '#D97706' },
  timed_out:  { bg: '#F3F0FF', color: '#7C3AED' },
};

const TZ = 'Asia/Kolkata';
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: TZ, month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const th: React.CSSProperties = {
  fontSize: 10.5, color: '#9CA3AF', fontWeight: 700,
  textAlign: 'left', padding: '12px 12px',
  textTransform: 'uppercase', letterSpacing: '0.07em',
  borderBottom: '1px solid #F4F4F8',
};
const td: React.CSSProperties = {
  fontSize: 12, color: '#1a1a2e',
  padding: '13px 12px', borderTop: '1px solid #F4F4F8',
};

type FilterStatus = 'all' | 'active' | 'resolved' | 'escalated';

interface SessionsPageProps {
  onOpenTrace?: (sessionId: string) => void;
}

export function SessionsPage({ onOpenTrace }: SessionsPageProps) {
  const { sessions, loading, error, refresh } = useSessions();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');

  const visible = sessions.filter(s => {
    const matchStatus = filter === 'all' || s.status === filter ||
      (filter === 'active' && (s.status === 'active' || s.status === 'open' || s.status === 'in_progress'));
    const matchSearch = !search || s.id.toLowerCase().includes(search.toLowerCase()) ||
      s.userId.toLowerCase().includes(search.toLowerCase()) ||
      (s.problemClass ?? '').toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const counts = {
    all:      sessions.length,
    active:   sessions.filter(s => ['active','open','in_progress'].includes(s.status)).length,
    resolved: sessions.filter(s => s.status === 'resolved').length,
    escalated:sessions.filter(s => s.status === 'escalated').length,
  };

  const filterBtn = (label: string, key: FilterStatus, count: number) => {
    const active = filter === key;
    return (
      <button key={key} onClick={() => setFilter(key)} style={{
        padding: '6px 14px', borderRadius: 8, border: active ? `1px solid ${ACCENT}40` : '1px solid #EBEBF0',
        background: active ? `${ACCENT}10` : '#fff',
        color: active ? ACCENT : '#6B7280',
        fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {label}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
          background: active ? ACCENT : '#F0F0F5', color: active ? '#fff' : '#6B7280',
        }}>{count}</span>
      </button>
    );
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e', letterSpacing: '-0.6px' }}>
            Sessions
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, color: '#9CA3AF' }}>
            All agent conversation sessions across Slack and Telegram
          </p>
        </div>
        <button onClick={refresh} disabled={loading} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
          borderRadius: 9, border: `1px solid ${ACCENT}40`,
          background: `${ACCENT}10`, color: ACCENT,
          fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.65 : 1, fontFamily: 'inherit',
        }}>
          <RefreshCw size={13} color={ACCENT} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#fee2e2', color: '#dc2626',
          padding: '11px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13,
        }}>
          <AlertTriangle size={16} color="#dc2626" />
          {error === 'HTTP 503' ? 'Database not connected' : `Error: ${error}`}
        </div>
      )}

      <div style={{
        background: '#fff', borderRadius: CARD_RADIUS,
        border: '1px solid #EBEBF0', boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid #F4F4F8', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {filterBtn('All', 'all', counts.all)}
            {filterBtn('Active', 'active', counts.active)}
            {filterBtn('Resolved', 'resolved', counts.resolved)}
            {filterBtn('Escalated', 'escalated', counts.escalated)}
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search session ID, user..."
              style={{
                height: 32, padding: '0 12px', borderRadius: 8,
                border: '1px solid #EBEBF0', background: '#F6F6F9',
                fontSize: 12, color: '#1a1a2e', fontFamily: 'inherit', outline: 'none',
                width: 220,
              }}
            />
          </div>
        </div>

        {/* Table */}
        {visible.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            {loading ? 'Loading sessions…' : 'No sessions found'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Session ID</th>
                  <th style={th}>Platform</th>
                  <th style={th}>User</th>
                  <th style={th}>Status</th>
                  <th style={th}>Iterations</th>
                  <th style={th}>Problem Class</th>
                  <th style={th}>Last Active</th>
                  <th style={th}>Created (IST)</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s: SessionRow) => {
                  const badge = STATUS_BADGE[s.status] ?? { bg: '#F0F0F5', color: '#6B7280' };
                  const shortId = s.id.length > 22 ? `${s.id.slice(0, 22)}…` : s.id;
                  return (
                    <tr key={s.id} style={{ transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: ACCENT, fontWeight: 600 }} title={s.id}>
                        {shortId}
                      </td>
                      <td style={td}>
                        <span style={{ textTransform: 'capitalize' }}>{s.channel}</span>
                      </td>
                      <td style={{ ...td, fontSize: 11, color: '#6B7280', fontFamily: 'monospace' }}>{s.userId}</td>
                      <td style={td}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center',
                          fontSize: 10, fontWeight: 600, padding: '2px 8px',
                          borderRadius: 99, background: badge.bg, color: badge.color,
                        }}>
                          {s.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{s.iteration}</td>
                      <td style={{ ...td, fontSize: 11, color: '#6B7280' }}>{s.problemClass ?? '—'}</td>
                      <td style={{ ...td, fontSize: 11, color: '#9CA3AF' }}>{timeAgo(s.lastActivity ?? s.updatedAt)}</td>
                      <td style={{ ...td, fontSize: 11, color: '#9CA3AF' }}>{fmtTime(s.createdAt)}</td>
                      <td style={{ ...td }}>
                        {onOpenTrace && (
                          <button
                            onClick={() => onOpenTrace(s.id)}
                            style={{
                              padding: '3px 10px', borderRadius: 6,
                              border: `1px solid ${ACCENT}40`,
                              background: `${ACCENT}10`, color: ACCENT,
                              fontSize: 11, fontWeight: 600,
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            Trace →
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: '1px solid #F4F4F8', fontSize: 11, color: '#9CA3AF' }}>
          Showing {visible.length} of {sessions.length} sessions
        </div>
      </div>
    </>
  );
}
