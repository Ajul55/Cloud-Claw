import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { StatStrip } from './components/StatStrip';
import { SystemHealthStrip } from './components/SystemHealthStrip';
import { BurnRateChart } from './components/BurnRateChart';
import { TopToolsChart } from './components/TopToolsChart';
import { LaneSplitChart } from './components/LaneSplitChart';
import { SessionsTable } from './components/SessionsTable';
import {
  Search, RefreshCw, ChevronRight, AlertTriangle,
} from './components/Icons';
import { useStats } from './hooks/useStats';
import type { Range } from './types';

const RANGES: Range[] = ['24h', '7d', '30d'];
const ACCENT = '#EC4899';
const CARD_RADIUS = 20;

const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: CARD_RADIUS,
  border: '1px solid #EBEBF0',
  boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
};

export default function App() {
  const [range, setRange] = useState<Range>('24h');
  const { data, loading, error, refresh } = useStats(range);

  const totals = data?.totals ?? { tokens: 0, costUsd: 0, llmCalls: 0, pendingHitl: 0 };

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      fontFamily: "'Geist', -apple-system, sans-serif",
      background: '#F0F1F5',
      color: '#1a1a2e',
      fontSize: 13,
    }}>
      <Sidebar pendingHitl={totals.pendingHitl} accent={ACCENT} />

      {/* Main column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top Bar */}
        <header style={{
          height: 56, background: '#fff', borderBottom: '1px solid #EBEBF0',
          display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14,
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          flexShrink: 0,
        }}>
          <div style={{
            flex: 1, maxWidth: 380, height: 36, background: '#F6F6F9',
            borderRadius: 9, border: '1px solid #EBEBF0',
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px',
          }}>
            <Search size={14} color="#9CA3AF" />
            <span style={{ fontSize: 12.5, color: '#9CA3AF' }}>Sessions, tools, servers...</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: `linear-gradient(135deg, #818cf8, ${ACCENT})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 11, fontWeight: 700,
              boxShadow: `0 2px 8px ${ACCENT}44`,
            }}>Pi</div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1a1a2e' }}>Pilot</div>
              <div style={{ fontSize: 10, color: '#9CA3AF' }}>Admin</div>
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          {/* Page Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e', letterSpacing: '-0.6px' }}>
                AIOps Analytics
              </h1>
              <p style={{ margin: '5px 0 0', fontSize: 12.5, color: '#9CA3AF' }}>
                Token usage, tool calls, cost and agent behaviour across all sessions
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <div style={{ display: 'flex', background: '#F2F3F7', borderRadius: 9, padding: 3, border: '1px solid #EBEBF0' }}>
                {RANGES.map(r => (
                  <button key={r} onClick={() => setRange(r)} style={{
                    padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600,
                    background: range === r ? ACCENT : 'transparent',
                    color: range === r ? '#fff' : '#666',
                    transition: 'all 0.2s',
                    boxShadow: range === r ? `0 2px 8px ${ACCENT}44` : 'none',
                    fontFamily: 'inherit',
                  }}>{r}</button>
                ))}
              </div>
              <button
                onClick={refresh}
                disabled={loading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                  borderRadius: 9, border: `1px solid ${ACCENT}40`,
                  background: `${ACCENT}10`, color: ACCENT,
                  fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.65 : 1, fontFamily: 'inherit',
                }}
              >
                <RefreshCw size={13} color={ACCENT} />
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#fee2e2', color: '#dc2626',
              padding: '11px 16px', borderRadius: 10,
              marginBottom: 16, fontSize: 13, fontWeight: 500,
            }}>
              <AlertTriangle size={16} color="#dc2626" />
              {error === 'HTTP 503'
                ? 'Database not connected — stats unavailable'
                : `Error: ${error}`}
            </div>
          )}

          {/* Stats Strip */}
          <StatStrip
            tokens={totals.tokens}
            costUsd={totals.costUsd}
            llmCalls={totals.llmCalls}
            pendingHitl={totals.pendingHitl}
            accent={ACCENT}
            cardRadius={CARD_RADIUS}
          />

          {/* System Health */}
          <SystemHealthStrip
            activeSessions={data?.system?.activeSessions ?? 0}
            memoryMb={data?.system?.memoryMb ?? 0}
            uptimeSeconds={data?.system?.uptimeSeconds ?? 0}
            llmConsecutiveErrors={data?.system?.llmConsecutiveErrors ?? 0}
            cardRadius={CARD_RADIUS}
          />

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.75fr', gap: 16, marginBottom: 18 }}>

            {/* Token Burn Rate */}
            <div style={{ ...card, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Token Burn Rate</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Tokens per hour</div>
                </div>
                <span style={{ fontSize: 11, color: '#9CA3AF', background: '#F6F6F9', padding: '4px 10px', borderRadius: 20, border: '1px solid #EBEBF0' }}>
                  Live
                </span>
              </div>
              <div style={{ height: 220 }}>
                <BurnRateChart data={data?.burnRate ?? []} range={range} />
              </div>
            </div>

            {/* Top Tools */}
            <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Top Tools</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>By call count</div>
                </div>
              </div>
              <TopToolsChart data={data?.topTools ?? []} />
            </div>

            {/* Lane Split */}
            <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: '100%', marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Lane Split</div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>By session type</div>
              </div>
              <LaneSplitChart data={data?.laneSplit ?? []} />
            </div>
          </div>

          {/* Recent Sessions */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px 14px', borderBottom: '1px solid #F4F4F8' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Recent Sessions</div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Latest agent activity</div>
              </div>
              <button style={{
                display: 'flex', alignItems: 'center', gap: 4,
                border: 'none', background: 'none',
                color: ACCENT, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
                View all <ChevronRight size={13} color={ACCENT} />
              </button>
            </div>
            <div style={{ padding: '0 24px' }}>
              <SessionsTable sessions={data?.recentSessions ?? []} accent={ACCENT} />
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
