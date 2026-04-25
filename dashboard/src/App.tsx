import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { SessionsPage } from './pages/SessionsPage';
import { ToolsPage } from './pages/ToolsPage';
import { ServersPage } from './pages/ServersPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { Search, RefreshCw, AlertTriangle } from './components/Icons';
import { useStats } from './hooks/useStats';
import type { Range, NavPage } from './types';

const RANGES: Range[] = ['24h', '7d', '30d'];
const ACCENT = '#EC4899';

// ─── Ripple hook ─────────────────────────────────────────────────────────────

interface Ripple { id: number; x: number; y: number; size: number; }

function useRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const addRipple = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top  - size / 2;
    const id = Date.now() + Math.random();
    setRipples(prev => [...prev, { id, x, y, size }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 600);
  }, []);

  return { ripples, addRipple };
}

// ─── Range button ─────────────────────────────────────────────────────────────

function RangeButton({ r, active, onClick }: { r: Range; active: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const { ripples, addRipple } = useRipple();
  const [pressed, setPressed] = useState(false);

  return (
    <button
      onClick={e => { addRipple(e); onClick(e); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        position: 'relative', overflow: 'hidden',
        padding: '5px 13px', borderRadius: 8, border: 'none', cursor: 'pointer',
        fontSize: 12, fontWeight: 600,
        background: active ? 'linear-gradient(135deg, #EC4899, #F97316)' : 'transparent',
        color: active ? '#fff' : '#6B7280',
        transition: 'all 0.18s ease',
        boxShadow: active ? '0 2px 10px rgba(236,72,153,0.35)' : 'none',
        transform: pressed ? 'scale(0.94)' : 'scale(1)',
        fontFamily: 'inherit',
      }}
    >
      {r}
      {ripples.map(rp => (
        <span key={rp.id} className="ripple-wave" style={{
          left: rp.x, top: rp.y,
          width: rp.size, height: rp.size,
        }} />
      ))}
    </button>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [activePage, setActivePage] = useState<NavPage>('Dashboard');
  const [range, setRange]           = useState<Range>('24h');
  const { data, loading, error, refresh } = useStats(range);

  const totals = data?.totals ?? { tokens: 0, costUsd: 0, llmCalls: 0, pendingHitl: 0 };

  const { ripples: refreshRipples, addRipple: addRefreshRipple } = useRipple();
  const [refreshPressed, setRefreshPressed] = useState(false);

  // Keyboard shortcuts: 1-5 for nav, R for refresh
  useEffect(() => {
    const pages: NavPage[] = ['Dashboard', 'Sessions', 'Tools', 'Servers'];
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key >= '1' && e.key <= '5') setActivePage(pages[Number(e.key) - 1]);
      if (e.key === 'r' || e.key === 'R') refresh();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [refresh]);

  const showRangeBar = activePage === 'Dashboard';

  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden',
      fontFamily: "'Geist', -apple-system, sans-serif",
      background: '#F2F3F8', color: '#0F0F1A', fontSize: 13,
    }}>
      <Sidebar
        pendingHitl={totals.pendingHitl}
        accent={ACCENT}
        activeNav={activePage}
        onNavChange={setActivePage}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top Bar */}
        <header style={{
          height: 60,
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          borderBottom: '1px solid rgba(234,235,242,0.8)',
          display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14,
          boxShadow: '0 1px 0 rgba(255,255,255,0.6) inset, 0 1px 10px rgba(0,0,0,0.04)',
          flexShrink: 0,
        }}>
          {/* Search */}
          <div style={{
            flex: 1, maxWidth: 360, height: 36,
            background: '#F4F5FA', borderRadius: 10, border: '1px solid #EAEBF2',
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px',
          }}>
            <Search size={13} color="#9CA3AF" />
            <span style={{ fontSize: 12.5, color: '#B0B4C0' }}>Sessions, tools, servers…</span>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {showRangeBar && (
              <>
                {/* Range toggles */}
                <div style={{
                  display: 'flex', background: '#F4F5FA', borderRadius: 10,
                  padding: 3, border: '1px solid #EAEBF2',
                }}>
                  {RANGES.map(r => (
                    <RangeButton
                      key={r}
                      r={r}
                      active={range === r}
                      onClick={() => setRange(r)}
                    />
                  ))}
                </div>

                {/* Refresh */}
                <button
                  onClick={e => { addRefreshRipple(e); refresh(); }}
                  onMouseDown={() => setRefreshPressed(true)}
                  onMouseUp={() => setRefreshPressed(false)}
                  onMouseLeave={() => setRefreshPressed(false)}
                  disabled={loading}
                  style={{
                    position: 'relative', overflow: 'hidden',
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 10,
                    background: 'linear-gradient(#fff, #fff) padding-box, linear-gradient(135deg, #EC489940, #F9731630) border-box',
                    border: '1px solid transparent',
                    color: ACCENT, fontSize: 12, fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.6 : 1,
                    fontFamily: 'inherit',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                    transform: refreshPressed ? 'scale(0.94)' : 'scale(1)',
                    transition: 'transform 0.12s ease, opacity 0.15s ease',
                  }}
                >
                  <RefreshCw
                    size={13} color={ACCENT}
                    style={{ transition: 'transform 0.5s ease', transform: loading ? 'rotate(360deg)' : 'none' }}
                  />
                  {loading ? 'Loading…' : 'Refresh'}
                  {refreshRipples.map(rp => (
                    <span key={rp.id} className="ripple-wave" style={{
                      left: rp.x, top: rp.y,
                      width: rp.size, height: rp.size,
                      background: 'rgba(236,72,153,0.15)',
                    }} />
                  ))}
                </button>
              </>
            )}

            {/* Avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'linear-gradient(135deg, #7C3AED, #EC4899)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 11, fontWeight: 800,
                boxShadow: '0 3px 12px rgba(124,58,237,0.35)',
                letterSpacing: '-0.3px',
              }}>Pi</div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.2px' }}>Pilot</div>
                <div style={{ fontSize: 10, color: '#9CA3AF' }}>Admin</div>
              </div>
            </div>
          </div>
        </header>

        {/* Error banner */}
        {error && activePage === 'Dashboard' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'linear-gradient(135deg, #fee2e2, #fef2f2)',
            color: '#dc2626',
            padding: '10px 24px', fontSize: 13, fontWeight: 500,
            borderBottom: '1px solid #fecaca',
            flexShrink: 0,
          }}>
            <AlertTriangle size={16} color="#dc2626" />
            {error === 'HTTP 503'
              ? 'Database not connected — stats unavailable'
              : `Error: ${error}`}
          </div>
        )}

        {/* Scrollable content — key triggers re-mount + page-enter animation */}
        <main
          key={activePage}
          className="page-enter"
          style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}
        >
          {activePage === 'Dashboard'  && <DashboardPage data={data} range={range} />}
          {activePage === 'Sessions'   && <SessionsPage />}
          {activePage === 'Tools'      && <ToolsPage />}
          {activePage === 'Servers'    && <ServersPage />}
          {activePage === 'Settings'   && <SettingsPage />}
          {activePage === 'Help'       && <HelpPage />}
        </main>
      </div>
    </div>
  );
}
