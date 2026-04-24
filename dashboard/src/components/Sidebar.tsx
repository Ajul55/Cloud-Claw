import React from 'react';
import {
  BarChart2, TrendingUp, MessageSquare, Wrench, ServerIcon,
  Settings, HelpCircle, Check,
} from './Icons';
import type { IconProps } from './Icons';
import type { NavPage } from '../types';

interface SidebarProps {
  pendingHitl: number;
  accent: string;
  activeNav: NavPage;
  onNavChange: (page: NavPage) => void;
}

type NavEntry = {
  Icon: React.ComponentType<IconProps>;
  label: NavPage;
};

const NAV_MAIN: NavEntry[] = [
  { Icon: BarChart2,     label: 'Dashboard' },
  { Icon: TrendingUp,    label: 'Analytics' },
  { Icon: MessageSquare, label: 'Sessions' },
  { Icon: Wrench,        label: 'Tools' },
  { Icon: ServerIcon,    label: 'Servers' },
];

const NAV_GENERAL: NavEntry[] = [
  { Icon: Settings,   label: 'Settings' },
  { Icon: HelpCircle, label: 'Help' },
];

export function Sidebar({ pendingHitl, accent, activeNav, onNavChange }: SidebarProps) {
  const hasPending = pendingHitl > 0;

  return (
    <aside style={{
      width: 210, minWidth: 210, flexShrink: 0,
      background: '#ffffff',
      borderRight: '1px solid #EBEBF0',
      padding: '0 14px',
      display: 'flex', flexDirection: 'column',
      height: '100vh',
      overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 4px 22px' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: `linear-gradient(135deg, ${accent}, #FBBF24)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: '-0.5px',
          boxShadow: `0 3px 10px ${accent}55`,
        }}>CC</div>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a2e', letterSpacing: '-0.3px' }}>Cloud-Claw</div>
          <div style={{ fontSize: 10, color: '#9CA3AF' }}>Analytics</div>
        </div>
      </div>

      {/* Main nav */}
      <div style={{ fontSize: 9.5, fontWeight: 700, color: '#C4C4C4', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 4px 8px' }}>
        Main Menu
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
        {NAV_MAIN.map(({ label, Icon }) => {
          const active = label === activeNav;
          return (
            <button
              key={label}
              onClick={() => onNavChange(label)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                borderRadius: 9, border: 'none', cursor: 'pointer', textAlign: 'left',
                background: active ? `${accent}15` : 'transparent',
                color: active ? accent : '#6B7280',
                fontWeight: active ? 600 : 400, fontSize: 13,
                transition: 'all 0.15s',
                fontFamily: 'inherit',
              }}
            >
              <Icon size={15} color={active ? accent : '#9CA3AF'} />
              {label}
              {active && (
                <div style={{
                  marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%',
                  background: accent,
                  animation: 'pulse 2s ease infinite',
                }} />
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ height: 1, background: '#F4F4F8', margin: '0 0 14px' }} />

      {/* General nav */}
      <div style={{ fontSize: 9.5, fontWeight: 700, color: '#C4C4C4', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 4px 8px' }}>
        General
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_GENERAL.map(({ label, Icon }) => {
          const active = label === activeNav;
          return (
            <button
              key={label}
              onClick={() => onNavChange(label)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                borderRadius: 9, border: 'none', cursor: 'pointer', textAlign: 'left',
                background: active ? `${accent}15` : 'transparent',
                color: active ? accent : '#6B7280',
                fontWeight: 400, fontSize: 13,
                fontFamily: 'inherit',
              }}
            >
              <Icon size={15} color={active ? accent : '#9CA3AF'} />
              {label}
            </button>
          );
        })}
      </nav>

      {/* All Clear / Pending card — pinned to bottom */}
      <div style={{ marginTop: 'auto', marginBottom: 18 }}>
        <div style={{
          background: hasPending ? 'linear-gradient(135deg,#fee2e2,#fecaca)' : 'linear-gradient(135deg,#f0fdf4,#dcfce7)',
          border: hasPending ? '1px solid #fca5a5' : '1px solid #bbf7d0',
          borderRadius: 11, padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              background: hasPending ? '#ef4444' : '#22c55e',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Check size={10} color="#fff" />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: hasPending ? '#991b1b' : '#16a34a' }}>
              {hasPending ? `${pendingHitl} Pending` : 'All Clear'}
            </span>
          </div>
          <p style={{ fontSize: 10.5, color: hasPending ? '#b91c1c' : '#4ade80', lineHeight: 1.4, marginBottom: 10 }}>
            {hasPending ? 'HITL approvals waiting' : 'No active incidents'}
          </p>
          <button style={{
            width: '100%', padding: '7px 0', borderRadius: 7,
            background: hasPending ? '#ef4444' : '#22c55e',
            border: 'none', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            boxShadow: hasPending ? '0 2px 8px #ef444444' : '0 2px 8px #22c55e44',
            fontFamily: 'inherit',
          }}>
            View Approvals
          </button>
        </div>
      </div>
    </aside>
  );
}
