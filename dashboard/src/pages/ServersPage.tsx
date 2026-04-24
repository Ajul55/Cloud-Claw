import React from 'react';
import { RefreshCw, AlertTriangle, ServerIcon } from '../components/Icons';
import { useServers } from '../hooks/useServers';
import type { ServerRow } from '../types';

const ACCENT = '#EC4899';
const CARD_RADIUS = 20;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function ServersPage() {
  const { servers, loading, error, refresh } = useServers();

  const active   = servers.filter(s => s.active).length;
  const inactive = servers.filter(s => !s.active).length;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e', letterSpacing: '-0.6px' }}>
            Servers
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, color: '#9CA3AF' }}>
            Registered SSH servers managed by Cloud-Claw agents
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

      {/* Summary strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        background: '#fff', borderRadius: CARD_RADIUS,
        border: '1px solid #EBEBF0', boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
        marginBottom: 18,
      }}>
        {[
          { label: 'Total Servers', value: servers.length, color: ACCENT },
          { label: 'Active',        value: active,          color: '#22c55e' },
          { label: 'Inactive',      value: inactive,        color: '#9CA3AF' },
        ].map(({ label, value, color }, idx) => (
          <div key={label} style={{ padding: '20px 24px', borderRight: idx < 2 ? '1px solid #F0F0F5' : 'none', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 24, right: 24, height: 2.5, borderRadius: '0 0 3px 3px', background: color, opacity: 0.75 }} />
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              {label}
            </div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#1a1a2e', letterSpacing: '-1.5px', lineHeight: 1 }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Server cards */}
      {loading && servers.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: CARD_RADIUS, border: '1px solid #EBEBF0',
          padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13,
        }}>
          Loading servers…
        </div>
      ) : servers.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: CARD_RADIUS, border: '1px solid #EBEBF0',
          padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13,
        }}>
          No servers registered yet
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {servers.map((s: ServerRow) => (
            <div key={s.id} style={{
              background: '#fff', borderRadius: CARD_RADIUS,
              border: `1px solid ${s.active ? '#EBEBF0' : '#F4F4F8'}`,
              boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
              padding: 22,
              opacity: s.active ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: s.active ? 'linear-gradient(135deg, #818cf8, #EC4899)' : '#F0F0F5',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: s.active ? '0 2px 10px #EC489930' : 'none',
                  }}>
                    <ServerIcon size={16} color={s.active ? '#fff' : '#9CA3AF'} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', textTransform: 'capitalize' }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>ID #{s.id}</div>
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
                  background: s.active ? '#dcfce7' : '#F0F0F5',
                  color: s.active ? '#16a34a' : '#9CA3AF',
                }}>
                  {s.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: 'IP Address', value: s.ip },
                  { label: 'SSH User',   value: s.sshUser },
                  { label: 'SSH Port',   value: String(s.sshPort) },
                  { label: 'Added',      value: fmtDate(s.addedAt) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: 12, color: '#1a1a2e', fontWeight: 600, fontFamily: 'monospace' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
