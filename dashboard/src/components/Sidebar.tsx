import React, { useState } from 'react';
import {
  BarChart2, MessageSquare, Wrench, ServerIcon,
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
  { Icon: MessageSquare, label: 'Sessions' },
  { Icon: Wrench,        label: 'Tools' },
  { Icon: ServerIcon,    label: 'Servers' },
];

const NAV_GENERAL: NavEntry[] = [
  { Icon: Settings,   label: 'Settings' },
  { Icon: HelpCircle, label: 'Help' },
];

function NavButton({
  entry,
  active,
  onClick,
}: {
  entry: NavEntry;
  active: boolean;
  onClick: () => void;
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
        padding: '9px 10px',
        borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left',
        width: '100%',
        background: active
          ? 'linear-gradient(135deg, rgba(236,72,153,0.10), rgba(249,115,22,0.05))'
          : hovered
            ? 'rgba(15,15,26,0.04)'
            : 'transparent',
        transition: 'background 0.15s ease',
        fontFamily: 'inherit',
        overflow: 'hidden',
      }}
    >
      {/* Left accent bar — animates in on activation */}
      <div style={{
        position: 'absolute', left: 0,
        top: active ? 6 : '50%',
        bottom: active ? 6 : '50%',
        width: 3,
        borderRadius: '0 3px 3px 0',
        background: 'linear-gradient(180deg, #EC4899, #F97316)',
        opacity: active ? 1 : 0,
        transition: 'top 0.3s cubic-bezier(0.34,1.56,0.64,1), bottom 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease',
      }} />

      {/* Sliding content group */}
      <div
        className="nav-content"
        style={{
          display: 'flex', alignItems: 'center', gap: 9,
          transform: hovered && !active ? 'translateX(3px)' : 'none',
          transition: 'transform 0.2s cubic-bezier(0.25,0.46,0.45,0.94)',
          flex: 1,
        }}
      >
        <Icon
          size={15}
          color={active ? '#EC4899' : hovered ? '#555' : '#9CA3AF'}
          style={{ transition: 'stroke 0.15s ease', flexShrink: 0 }}
        />
        <span style={{
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          color: active ? '#EC4899' : hovered ? '#374151' : '#6B7280',
          transition: 'color 0.15s ease',
        }}>
          {label}
        </span>
      </div>

      {/* Active pulse dot */}
      {active && (
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#EC4899',
          flexShrink: 0,
          animation: 'accentPulse 2.5s ease infinite',
          marginLeft: 'auto',
        }} />
      )}
    </button>
  );
}

export function Sidebar({ pendingHitl, accent, activeNav, onNavChange }: SidebarProps) {
  const hasPending = pendingHitl > 0;

  return (
    <aside style={{
      width: 216, minWidth: 216, flexShrink: 0,
      background: '#FFFFFF',
      borderRight: '1px solid #EAEBF2',
      padding: '0 12px',
      display: 'flex', flexDirection: 'column',
      height: '100vh',
      overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '20px 4px 24px',
        animation: 'fadeUp 0.4s ease both',
      }}>
        <img
          src="/dashboard/logo.png"
          alt="Cloud-Claw"
          style={{
            width: 34, height: 34, borderRadius: 10,
            objectFit: 'cover',
            boxShadow: '0 4px 14px rgba(236,72,153,0.4)',
            flexShrink: 0,
            transition: 'box-shadow 0.2s ease, transform 0.2s ease',
          }}
        />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F0F1A', letterSpacing: '-0.4px' }}>Cloud-Claw</div>
          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>AIOps Hub</div>
        </div>
      </div>

      {/* Main nav label */}
      <div style={{
        fontSize: 9, fontWeight: 700, color: '#C4C9D8',
        letterSpacing: '0.1em', textTransform: 'uppercase',
        padding: '0 6px 8px',
      }}>
        Main Menu
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 20 }}>
        {NAV_MAIN.map((entry, i) => (
          <div
            key={entry.label}
            style={{ animation: `fadeUp 0.35s ease ${0.05 + i * 0.06}s both` }}
          >
            <NavButton
              entry={entry}
              active={entry.label === activeNav}
              onClick={() => onNavChange(entry.label)}
            />
          </div>
        ))}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: '#F0F1F7', margin: '0 0 16px' }} />

      {/* General nav label */}
      <div style={{
        fontSize: 9, fontWeight: 700, color: '#C4C9D8',
        letterSpacing: '0.1em', textTransform: 'uppercase',
        padding: '0 6px 8px',
      }}>
        General
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {NAV_GENERAL.map((entry, i) => (
          <div
            key={entry.label}
            style={{ animation: `fadeUp 0.35s ease ${0.35 + i * 0.06}s both` }}
          >
            <NavButton
              entry={entry}
              active={entry.label === activeNav}
              onClick={() => onNavChange(entry.label)}
            />
          </div>
        ))}
      </nav>

      {/* Status card */}
      <div style={{ marginTop: 'auto', marginBottom: 20 }}>
        <div style={{
          background: hasPending
            ? 'linear-gradient(135deg, #fff1f1, #fff5f5)'
            : 'linear-gradient(135deg, #f0fff8, #f5fffc)',
          border: hasPending ? '1px solid #fecaca' : '1px solid #bbf7d0',
          borderRadius: 14, padding: '14px 14px 12px',
          boxShadow: hasPending
            ? '0 2px 12px rgba(239,68,68,0.08)'
            : '0 2px 12px rgba(34,197,94,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: hasPending ? '#ef4444' : '#22c55e',
              animation: hasPending ? 'livePulseRed 2s ease infinite' : 'livePulse 2s ease infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: hasPending ? '#991b1b' : '#15803d' }}>
              {hasPending ? `${pendingHitl} Pending` : 'All Clear'}
            </span>
          </div>
          <p style={{
            fontSize: 10.5, lineHeight: 1.45, margin: '0 0 12px',
            color: hasPending ? '#b91c1c' : '#16a34a',
          }}>
            {hasPending ? 'HITL approvals awaiting your review' : 'No active incidents or approvals'}
          </p>
          <button
            className="btn-press"
            style={{
              width: '100%', padding: '8px 0', borderRadius: 8,
              background: hasPending
                ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                : 'linear-gradient(135deg, #22c55e, #16a34a)',
              border: 'none', color: '#fff', fontSize: 11.5, fontWeight: 700,
              cursor: 'pointer',
              boxShadow: hasPending
                ? '0 3px 10px rgba(239,68,68,0.3)'
                : '0 3px 10px rgba(34,197,94,0.3)',
              fontFamily: 'inherit',
              letterSpacing: '0.01em',
            }}
          >
            View Approvals
          </button>
        </div>
      </div>
    </aside>
  );
}
