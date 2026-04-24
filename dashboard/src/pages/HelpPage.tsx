import React from 'react';
import { useApprovals } from '../hooks/useApprovals';

const ACCENT = '#EC4899';
const CARD_RADIUS = 20;

const card: React.CSSProperties = {
  background: '#fff', borderRadius: CARD_RADIUS,
  border: '1px solid #EBEBF0', boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
};

const TZ = 'Asia/Kolkata';
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: TZ, month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  pending:  { bg: '#FEF3C7', color: '#D97706' },
  approved: { bg: '#dcfce7', color: '#16a34a' },
  rejected: { bg: '#fee2e2', color: '#dc2626' },
  expired:  { bg: '#F0F0F5', color: '#6B7280' },
};

const th: React.CSSProperties = {
  fontSize: 10.5, color: '#9CA3AF', fontWeight: 700, textAlign: 'left',
  padding: '12px 16px', textTransform: 'uppercase', letterSpacing: '0.07em',
  borderBottom: '1px solid #F4F4F8',
};
const td: React.CSSProperties = { fontSize: 12, color: '#1a1a2e', padding: '12px 16px', borderTop: '1px solid #F4F4F8' };

export function HelpPage() {
  const { approvals, loading } = useApprovals();

  const shortcuts = [
    { keys: ['R'], desc: 'Refresh current page data' },
    { keys: ['1'], desc: 'Go to Dashboard' },
    { keys: ['2'], desc: 'Go to Analytics' },
    { keys: ['3'], desc: 'Go to Sessions' },
    { keys: ['4'], desc: 'Go to Tools' },
    { keys: ['5'], desc: 'Go to Servers' },
  ];

  const lanes = [
    { lane: 1, label: 'API Lane',       color: '#7C3AED', bg: '#EDE9FE', desc: 'Direct Cloudstick API calls — user/database/SSL management' },
    { lane: 2, label: 'SSH Read Lane',  color: '#3B82F6', bg: '#EFF6FF', desc: 'Read-only SSH operations — inspection, logs, diagnostics' },
    { lane: 3, label: 'SSH Write Lane', color: '#dc2626', bg: '#fee2e2', desc: 'Mutating SSH operations — requires HITL approval' },
  ];

  const pendingApprovals = approvals.filter(a => a.status === 'pending');

  return (
    <>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e', letterSpacing: '-0.6px' }}>
          Help
        </h1>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: '#9CA3AF' }}>
          Reference guide and pending HITL approval queue
        </p>
      </div>

      {/* HITL Approval Queue */}
      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #F4F4F8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>HITL Approval Queue</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Human-in-the-loop actions awaiting review</div>
          </div>
          {pendingApprovals.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: '#FEF3C7', color: '#D97706' }}>
              {pendingApprovals.length} pending
            </span>
          )}
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading approvals…</div>
        ) : approvals.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
            No approvals in queue
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>ID</th>
                  <th style={th}>Session</th>
                  <th style={th}>Command</th>
                  <th style={th}>Target Host</th>
                  <th style={th}>Status</th>
                  <th style={th}>Requested (IST)</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map(a => {
                  const badge = STATUS_BADGE[a.status] ?? { bg: '#F0F0F5', color: '#6B7280' };
                  return (
                    <tr key={a.id}>
                      <td style={{ ...td, color: '#9CA3AF', fontWeight: 700 }}>#{a.id}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: ACCENT }}>
                        {a.sessionId.length > 20 ? `${a.sessionId.slice(0, 20)}…` : a.sessionId}
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.command}>
                        {a.command}
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{a.targetHost}</td>
                      <td style={td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: badge.bg, color: badge.color }}>
                          {a.status}
                        </span>
                      </td>
                      <td style={{ ...td, fontSize: 11, color: '#9CA3AF' }}>{fmtTime(a.requestedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Lane reference */}
        <div style={card}>
          <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #F4F4F8' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Lane Reference</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Agent operation categories</div>
          </div>
          <div style={{ padding: '8px 0' }}>
            {lanes.map(l => (
              <div key={l.lane} style={{ padding: '12px 24px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: l.bg, color: l.color, flexShrink: 0 }}>
                  {l.label}
                </span>
                <span style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>{l.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Keyboard shortcuts */}
        <div style={card}>
          <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #F4F4F8' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Keyboard Shortcuts</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Navigate the dashboard faster</div>
          </div>
          <div style={{ padding: '8px 0' }}>
            {shortcuts.map(({ keys, desc }) => (
              <div key={desc} style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: '#6B7280' }}>{desc}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {keys.map(k => (
                    <kbd key={k} style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 24, height: 22, padding: '0 6px',
                      background: '#F6F6F9', border: '1px solid #DDDDE5',
                      borderRadius: 5, fontSize: 11, fontWeight: 700,
                      color: '#1a1a2e', fontFamily: 'monospace',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                    }}>{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* About */}
      <div style={card}>
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #F4F4F8' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>About Cloud-Claw</div>
        </div>
        <div style={{ padding: '18px 24px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
            { label: 'Version', value: 'v1.0.0' },
            { label: 'Platform', value: 'Slack + Telegram' },
            { label: 'Model', value: 'Claude Sonnet' },
            { label: 'DB', value: 'PostgreSQL + pgvector' },
            { label: 'Infra', value: 'Node.js + PM2' },
            { label: 'Dashboard', value: 'React + Vite' },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
