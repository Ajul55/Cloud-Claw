import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { SessionsPage } from './pages/SessionsPage';
import { ToolsPage } from './pages/ToolsPage';
import { ServersPage } from './pages/ServersPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { ThemePicker } from './components/ThemePicker';
import { Search, RefreshCw, AlertTriangle } from './components/Icons';
import { useStats } from './hooks/useStats';
import type { Range, NavPage, Theme } from './types';
import { THEMES } from './types';

const RANGES: Range[] = ['24h', '7d', '30d'];

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

function RangeButton({
  r, active, onClick, theme,
}: { r: Range; active: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; theme: Theme }) {
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
        padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
        fontSize: 12, fontWeight: 600,
        background: active ? theme.p : 'transparent',
        color: active ? '#fff' : '#9ca3af',
        transition: 'all 0.15s ease',
        transform: pressed ? 'scale(0.94)' : 'scale(1)',
        fontFamily: 'inherit',
      }}
    >
      {r}
      {ripples.map(rp => (
        <span key={rp.id} className="ripple-wave" style={{ left: rp.x, top: rp.y, width: rp.size, height: rp.size }} />
      ))}
    </button>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [activePage, setActivePage] = useState<NavPage>('Dashboard');
  const [range, setRange]           = useState<Range>('24h');
  const [theme, setTheme]           = useState<Theme>(THEMES.violet);
  const { data, loading, error, refresh } = useStats(range);

  const totals = data?.totals ?? { tokens: 0, costUsd: 0, llmCalls: 0, pendingHitl: 0 };

  const { ripples: refreshRipples, addRipple: addRefreshRipple } = useRipple();
  const [refreshPressed, setRefreshPressed] = useState(false);

  // Keyboard shortcuts: 1-4 for nav, R for refresh
  useEffect(() => {
    const pages: NavPage[] = ['Dashboard', 'Sessions', 'Tools', 'Servers'];
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key >= '1' && e.key <= '4') setActivePage(pages[Number(e.key) - 1]);
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
        theme={theme}
        activeNav={activePage}
        onNavChange={setActivePage}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top Bar */}
        <header style={{
          height: 54,
          background: '#fff',
          borderBottom: '1px solid #e9eaf0',
          display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14,
          flexShrink: 0,
        }}>
          {/* Search */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#f9fafb', border: '1px solid #e5e7eb',
            borderRadius: 9, padding: '7px 14px', width: 280, cursor: 'text',
          }}>
            <Search size={13} color="#9CA3AF" />
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Search sessions, tools, servers…</span>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {showRangeBar && (
              <>
                {/* Range toggles */}
                <div style={{
                  display: 'flex', background: '#f3f4f6',
                  borderRadius: 8, padding: 3, gap: 1,
                }}>
                  {RANGES.map(r => (
                    <RangeButton
                      key={r} r={r} active={range === r}
                      onClick={() => setRange(r)}
                      theme={theme}
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
                    padding: '6px 14px', borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    background: '#fff', color: '#6b7280',
                    fontSize: 12, fontWeight: 500,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.6 : 1,
                    fontFamily: 'inherit',
                    transform: refreshPressed ? 'scale(0.94)' : 'scale(1)',
                    transition: 'transform 0.12s ease, opacity 0.15s ease, background 0.15s ease',
                  }}
                >
                  <RefreshCw
                    size={13} color="#6b7280"
                    style={{ transition: 'transform 0.5s ease', transform: loading ? 'rotate(360deg)' : 'none' }}
                  />
                  {loading ? 'Loading…' : 'Refresh'}
                  {refreshRipples.map(rp => (
                    <span key={rp.id} className="ripple-wave" style={{ left: rp.x, top: rp.y, width: rp.size, height: rp.size }} />
                  ))}
                </button>
              </>
            )}

            <ThemePicker current={theme} onChange={setTheme} />

            {/* Avatar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', padding: '4px 8px', borderRadius: 8,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: `linear-gradient(135deg,${theme.d},${theme.l})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>PI</span>
              </div>
              <div style={{ lineHeight: 1.3 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>Pilot</div>
                <div style={{ fontSize: 10, color: '#9ca3af' }}>Admin</div>
              </div>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
                stroke="#9ca3af" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
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

        {/* Scrollable content */}
        <main
          key={activePage}
          className="page-enter"
          style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}
        >
          {activePage === 'Dashboard'  && <DashboardPage data={data} range={range} theme={theme} />}
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
