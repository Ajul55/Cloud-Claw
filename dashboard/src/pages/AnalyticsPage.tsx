import React from 'react';
import { StatStrip } from '../components/StatStrip';
import { SystemHealthStrip } from '../components/SystemHealthStrip';
import { BurnRateChart } from '../components/BurnRateChart';
import { TopToolsChart } from '../components/TopToolsChart';
import { LaneSplitChart } from '../components/LaneSplitChart';
import { SessionsTable } from '../components/SessionsTable';
import { ChevronRight } from '../components/Icons';
import type { StatsResponse, Range } from '../types';

const ACCENT = '#EC4899';
const CARD_RADIUS = 20;
const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: CARD_RADIUS,
  border: '1px solid #EBEBF0',
  boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
};

interface Props {
  data: StatsResponse | null;
  range: Range;
}

export function AnalyticsPage({ data, range }: Props) {
  const totals = data?.totals ?? { tokens: 0, costUsd: 0, llmCalls: 0, pendingHitl: 0 };

  return (
    <>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e', letterSpacing: '-0.6px' }}>
          AIOps Analytics
        </h1>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: '#9CA3AF' }}>
          Token usage, tool calls, cost and agent behaviour across all sessions
        </p>
      </div>

      <StatStrip
        tokens={totals.tokens}
        costUsd={totals.costUsd}
        llmCalls={totals.llmCalls}
        pendingHitl={totals.pendingHitl}
        accent={ACCENT}
        cardRadius={CARD_RADIUS}
      />

      <SystemHealthStrip
        activeSessions={data?.system?.activeSessions ?? 0}
        memoryMb={data?.system?.memoryMb ?? 0}
        uptimeSeconds={data?.system?.uptimeSeconds ?? 0}
        llmConsecutiveErrors={data?.system?.llmConsecutiveErrors ?? 0}
        cardRadius={CARD_RADIUS}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.75fr', gap: 16, marginBottom: 18 }}>
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

        <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Top Tools</div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>By call count</div>
            </div>
          </div>
          <TopToolsChart data={data?.topTools ?? []} />
        </div>

        <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: '100%', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Lane Split</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>By session type</div>
          </div>
          <LaneSplitChart data={data?.laneSplit ?? []} />
        </div>
      </div>

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
    </>
  );
}
