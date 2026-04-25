import React, { useState } from 'react';
import {
  BarChart2, MessageSquare, Wrench, ServerIcon,
  Settings, HelpCircle,
} from './Icons';
import type { IconProps } from './Icons';
import type { NavPage, Theme } from '../types';

interface SidebarProps {
  pendingHitl: number;
  theme: Theme;
  activeNav: NavPage;
  onNavChange: (page: NavPage) => void;
}

type NavEntry = {
  Icon: React.ComponentType<IconProps>;
  label: NavPage;
};

const NAV_MAIN: NavEntry[] = [
  { Icon: BarChart2,     label: 'Dashboard' },
  { Icon: MessageSquare, label: 'Sessions' },
  { Icon: Wrench,        label: 'Tools' },
  { Icon: ServerIcon,    label: 'Servers' },
];

const NAV_GENERAL: NavEntry[] = [
  { Icon: Settings,   label: 'Settings' },
  { Icon: HelpCircle, label: 'Help' },
];

function NavButton({
  entry, active, onClick, theme,
}: {
  entry: NavEntry;
  active: boolean;
  onClick: () => void;
  theme: Theme;
}) {
  const [hovered, setHovered] = useState(false);
  const { Icon, label } = entry;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`nav-btn${active ? ' nav-btn--active' : ''}`}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center',
        padding: '8px 12px',
        borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
        width: '100%', marginBottom: 2,
        background: active ? theme.nav : hovered ? '#f3f4f6' : 'transparent',
        transition: 'background 0.15s ease',
        fontFamily: 'inherit',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flex: 1,
        transform: hovered && !active ? 'translateX(3px)' : 'none',
        transition: 'transform 0.2s cubic-bezier(0.25,0.46,0.45,0.94)',
      }}>
        <Icon
          size={15}
          color={active ? theme.p : hovered ? '#555' : '#9CA3AF'}
          style={{ transition: 'stroke 0.15s ease', flexShrink: 0 }}
        />
        <span style={{
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          color: active ? theme.p : hovered ? '#374151' : '#6B7280',
          transition: 'color 0.15s ease',
        }}>
          {label}
        </span>
      </div>
    </button>
  );
}

export function Sidebar({ pendingHitl, theme, activeNav, onNavChange }: SidebarProps) {
  const hasPending = pendingHitl > 0;

  return (
    <aside style={{
      width: 210, minWidth: 210, flexShrink: 0,
      background: '#FFFFFF',
      borderRight: '1px solid #EAEBF2',
      padding: '0 10px',
      display: 'flex', flexDirection: 'column',
      height: '100vh',
      overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '4px 8px 20px',
        marginTop: 16,
        animation: 'fadeUp 0.4s ease both',
      }}>
        <img
          src="/dashboard/logo.png"
          alt="Cloud-Claw"
          style={{
            width: 30, height: 30, borderRadius: 8,
            objectFit: 'cover',
            boxShadow: `0 2px 8px ${theme.p}40`,
            flexShrink: 0,
            transition: 'box-shadow 0.2s ease',
          }}
        />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#111827', letterSpacing: '-0.4px' }}>Cloud-Claw</div>
          <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 1, textTransform: 'uppercase', letterSpacing: '.07em' }}>AIOps Hub</div>
        </div>
      </div>

      {/* Main nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', marginBottom: 4 }}>
        {NAV_MAIN.map((entry, i) => (
          <div
            key={entry.label}
            style={{ animation: `fadeUp 0.35s ease ${0.05 + i * 0.06}s both` }}
          >
            <NavButton entry={entry} active={entry.label === activeNav} onClick={() => onNavChange(entry.label)} theme={theme} />
          </div>
        ))}
      </nav>

      {/* General section */}
      <div style={{
        fontSize: 9, fontWeight: 700, color: '#9CA3AF',
        textTransform: 'uppercase', letterSpacing: '.09em',
        padding: '14px 12px 6px',
      }}>
        General
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column' }}>
        {NAV_GENERAL.map((entry, i) => (
          <div
            key={entry.label}
            style={{ animation: `fadeUp 0.35s ease ${0.35 + i * 0.06}s both` }}
          >
            <NavButton entry={entry} active={entry.label === activeNav} onClick={() => onNavChange(entry.label)} theme={theme} />
          </div>
        ))}
      </nav>

      {/* Status card */}
      <div style={{ marginTop: 'auto', marginBottom: 20, paddingTop: 16 }}>
        <div style={{
          background: hasPending ? 'linear-gradient(135deg, #fff1f1, #fff5f5)' : '#f0fdf4',
          border: hasPending ? '1px solid #fecaca' : '1px solid #bbf7d0',
          borderRadius: 10, padding: '12px 14px',
          boxShadow: hasPending
            ? '0 2px 12px rgba(239,68,68,0.08)'
            : '0 2px 12px rgba(34,197,94,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: hasPending ? '#ef4444' : '#22c55e',
              animation: hasPending ? 'livePulseRed 2s ease infinite' : 'livePulse 2s ease infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: hasPending ? '#991b1b' : '#16a34a' }}>
              {hasPending ? `${pendingHitl} Pending` : 'All Clear'}
            </span>
          </div>
          <p style={{
            fontSize: 10, lineHeight: 1.5, margin: '0 0 10px',
            color: '#6b7280',
          }}>
            {hasPending ? 'HITL approvals awaiting your review' : 'No active incidents or approvals'}
          </p>
          <button
            className="btn-press"
            style={{
              width: '100%', padding: '7px 0', borderRadius: 7,
              background: theme.p,
              border: 'none', color: '#fff', fontSize: 11, fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            View Approvals
          </button>
        </div>
      </div>
    </aside>
  );
}
