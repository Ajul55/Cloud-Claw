import React from 'react';
import { StatStrip } from '../components/StatStrip';
import { SystemHealthStrip } from '../components/SystemHealthStrip';
import { BurnRateChart } from '../components/BurnRateChart';
import { TopToolsChart } from '../components/TopToolsChart';
import { LaneSplitChart } from '../components/LaneSplitChart';
import { SessionsTable } from '../components/SessionsTable';
import { ChevronRight } from '../components/Icons';
import type { StatsResponse, Range } from '../types';
import { THEMES } from '../types';

const ACCENT = '#EC4899';
const card: React.CSSProperties = {
  background: 'linear-gradient(#fff, #fff) padding-box, linear-gradient(135deg, rgba(234,235,242,0.9), rgba(220,221,232,0.5)) border-box',
  border: '1.5px solid transparent',
  borderRadius: 20,
  boxShadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 2px 8px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.04)',
};

interface Props {
  data: StatsResponse | null;
  range: Range;
}

export function AnalyticsPage({ data, range }: Props) {
  const totals = data?.totals ?? { tokens: 0, costUsd: 0, llmCalls: 0, pendingHitl: 0 };
  const theme = THEMES.violet;

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, color: '#0F0F1A', letterSpacing: '-0.7px' }}>
          AIOps Analytics
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#9CA3AF' }}>
          Token usage, tool calls, cost and agent behaviour across all sessions
        </p>
      </div>

      <StatStrip
        tokens={totals.tokens}
        costUsd={totals.costUsd}
        llmCalls={totals.llmCalls}
        pendingHitl={totals.pendingHitl}
        theme={theme}
      />

      <SystemHealthStrip
        activeSessions={data?.system?.activeSessions ?? 0}
        memoryMb={data?.system?.memoryMb ?? 0}
        uptimeSeconds={data?.system?.uptimeSeconds ?? 0}
        llmConsecutiveErrors={data?.system?.llmConsecutiveErrors ?? 0}
        theme={theme}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.75fr', gap: 14, marginBottom: 16 }}>
        <div style={{ ...card, padding: 24 }} className="premium-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.3px' }}>Token Burn Rate</div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>Tokens per hour</div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(0,0,0,0.04)', borderRadius: 20, padding: '4px 10px',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'livePulse 2s ease infinite' }} />
              <span style={{ fontSize: 10.5, color: '#6B7280', fontWeight: 500 }}>Live</span>
            </div>
          </div>
          <div style={{ height: 220 }}>
            <BurnRateChart data={data?.burnRate ?? []} range={range} theme={theme} />
          </div>
        </div>

        <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column' }} className="premium-card">
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.3px' }}>Top Tools</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>By call count</div>
          </div>
          <TopToolsChart data={data?.topTools ?? []} theme={theme} />
        </div>

        <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }} className="premium-card">
          <div style={{ width: '100%', marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.3px' }}>Lane Split</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>By session type</div>
          </div>
          <LaneSplitChart data={data?.laneSplit ?? []} theme={theme} />
        </div>
      </div>

      <div style={card} className="premium-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px 14px', borderBottom: '1px solid #F2F3F8' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.3px' }}>Recent Sessions</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>Latest agent activity</div>
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
    </>
  );
}
