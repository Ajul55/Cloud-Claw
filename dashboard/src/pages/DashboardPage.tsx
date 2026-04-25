import React from 'react';
import { StatStrip } from '../components/StatStrip';
import { SystemHealthStrip } from '../components/SystemHealthStrip';
import { BurnRateChart } from '../components/BurnRateChart';
import { LaneSplitChart } from '../components/LaneSplitChart';
import { SessionsTable } from '../components/SessionsTable';
import { TopToolsChart } from '../components/TopToolsChart';
import { ChevronRight } from '../components/Icons';
import type { StatsResponse, Range, Theme } from '../types';

interface Props {
  data: StatsResponse | null;
  range: Range;
  theme: Theme;
}

export function DashboardPage({ data, range, theme }: Props) {
  const totals = data?.totals ?? { tokens: 0, costUsd: 0, llmCalls: 0, pendingHitl: 0 };

  const card: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e9eaf0',
    borderRadius: 12,
    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    transition: 'box-shadow 200ms ease, transform 200ms ease',
  };

  return (
    <>
      {/* Page header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.5px' }}>
          Overview
        </h1>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#9CA3AF', fontWeight: 400 }}>
          Live snapshot of all active systems and recent activity
        </p>
      </div>

      {/* KPI cards row 1 */}
      <div style={{ marginBottom: 12 }}>
        <StatStrip
          tokens={totals.tokens}
          costUsd={totals.costUsd}
          llmCalls={totals.llmCalls}
          pendingHitl={totals.pendingHitl}
          theme={theme}
        />
      </div>

      {/* System health row 2 */}
      <div style={{ marginBottom: 20 }}>
        <SystemHealthStrip
          activeSessions={data?.system?.activeSessions ?? 0}
          memoryMb={data?.system?.memoryMb ?? 0}
          uptimeSeconds={data?.system?.uptimeSeconds ?? 0}
          llmConsecutiveErrors={data?.system?.llmConsecutiveErrors ?? 0}
          theme={theme}
        />
      </div>

      {/* Charts row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 290px',
        gap: 16,
        marginBottom: 20,
      }}>
        {/* Token Burn Rate */}
        <div style={{ ...card, padding: '20px 22px' }} className="premium-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 2 }}>Token Burn Rate</div>
              <div style={{ fontSize: 11, color: '#9CA3AF' }}>Tokens per hour · {range} window</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
                display: 'inline-block', animation: 'livePulse 2s ease infinite',
              }} />
              Live
            </div>
          </div>
          <BurnRateChart data={data?.burnRate ?? []} range={range} theme={theme} />
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Lane Split */}
          <div style={{ ...card, padding: '18px 20px' }} className="premium-card">
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 1 }}>Lane Split</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>By session type</div>
            <LaneSplitChart data={data?.laneSplit ?? []} theme={theme} />
          </div>

          {/* Top Tools */}
          <div style={{ ...card, padding: '18px 20px', flex: 1 }} className="premium-card">
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 1 }}>Top Tools</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>By call count</div>
            <TopToolsChart data={data?.topTools ?? []} theme={theme} />
          </div>
        </div>
      </div>

      {/* Recent Sessions */}
      <div style={card} className="premium-card">
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px 12px',
          borderBottom: '1px solid #F2F3F8',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Recent Sessions</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Latest agent activity</div>
          </div>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 4,
            border: 'none', background: 'none',
            color: theme.p, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            View all sessions <ChevronRight size={13} color={theme.p} />
          </button>
        </div>
        <div style={{ padding: '0 20px' }}>
          <SessionsTable sessions={data?.recentSessions ?? []} accent={theme.p} />
        </div>
      </div>
    </>
  );
}
