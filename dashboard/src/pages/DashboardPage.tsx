import React from 'react';
import { StatStrip } from '../components/StatStrip';
import { SystemHealthStrip } from '../components/SystemHealthStrip';
import { BurnRateChart } from '../components/BurnRateChart';
import { LaneSplitChart } from '../components/LaneSplitChart';
import { SessionsTable } from '../components/SessionsTable';
import { TopToolsChart } from '../components/TopToolsChart';
import { ChevronRight } from '../components/Icons';
import type { StatsResponse, Range } from '../types';

const ACCENT = '#EC4899';

const card: React.CSSProperties = {
  background: 'linear-gradient(#fff, #fff) padding-box, linear-gradient(135deg, rgba(234,235,242,0.9), rgba(220,221,232,0.5)) border-box',
  border: '1.5px solid transparent',
  borderRadius: 18,
  boxShadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 2px 8px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.04)',
};

interface Props {
  data: StatsResponse | null;
  range: Range;
}

export function DashboardPage({ data, range }: Props) {
  const totals = data?.totals ?? { tokens: 0, costUsd: 0, llmCalls: 0, pendingHitl: 0 };

  return (
    <>
      {/* Page header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0F0F1A', letterSpacing: '-0.7px' }}>
          Overview
        </h1>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#9CA3AF', fontWeight: 400 }}>
          Live snapshot of all active systems and recent activity
        </p>
      </div>

      {/* KPI cards */}
      <div style={{ marginBottom: 12 }}>
        <StatStrip
          tokens={totals.tokens}
          costUsd={totals.costUsd}
          llmCalls={totals.llmCalls}
          pendingHitl={totals.pendingHitl}
          accent={ACCENT}
          cardRadius={20}
        />
      </div>

      {/* System health */}
      <div style={{ marginBottom: 14 }}>
        <SystemHealthStrip
          activeSessions={data?.system?.activeSessions ?? 0}
          memoryMb={data?.system?.memoryMb ?? 0}
          uptimeSeconds={data?.system?.uptimeSeconds ?? 0}
          llmConsecutiveErrors={data?.system?.llmConsecutiveErrors ?? 0}
          cardRadius={20}
        />
      </div>

      {/*
        Charts row — 7:3 grid, fixed height.
        Left: BurnRate (fills main area).
        Right: LaneSplit (top) + TopTools (bottom) stacked evenly.
      */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '7fr 3fr',
        gap: 16,
        height: 400,
        marginBottom: 16,
        overflow: 'hidden',
      }}>

        {/* ── BurnRate — dominant left panel ── */}
        <div style={{ ...card, padding: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          className="premium-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.3px' }}>
                Token Burn Rate
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                Tokens per hour · {range} window
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(0,0,0,0.04)', borderRadius: 20, padding: '4px 10px',
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#22c55e', animation: 'livePulse 2s ease infinite',
              }} />
              <span style={{ fontSize: 10.5, color: '#6B7280', fontWeight: 500 }}>Live</span>
            </div>
          </div>
          {/* Chart area — contained, no overflow */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <BurnRateChart data={data?.burnRate ?? []} range={range} />
          </div>
        </div>

        {/* ── Right column — Stacked 50/50 ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'hidden' }}>

          {/* Lane Split (Top 50%) */}
          <div style={{ ...card, padding: '16px 18px', flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column' }}
            className="premium-card">
            <div style={{ marginBottom: 12, flexShrink: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.3px' }}>Lane Split</div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>By session type</div>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LaneSplitChart data={data?.laneSplit ?? []} />
            </div>
          </div>

          {/* Top Tools (Bottom 50%) */}
          <div style={{ ...card, padding: '16px 18px', flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column' }}
            className="premium-card">
            <div style={{ marginBottom: 10, flexShrink: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.3px' }}>Top Tools</div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>By call count</div>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <TopToolsChart data={data?.topTools ?? []} />
            </div>
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
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.3px' }}>
              Recent Sessions
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Latest agent activity</div>
          </div>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 4,
            border: 'none', background: 'none',
            color: ACCENT, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            View all <ChevronRight size={13} color={ACCENT} />
          </button>
        </div>
        <div style={{ padding: '0 20px' }}>
          <SessionsTable sessions={data?.recentSessions ?? []} accent={ACCENT} />
        </div>
      </div>
    </>
  );
}
