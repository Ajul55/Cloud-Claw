import React, { useState, useEffect } from 'react';

interface Props {
  data: { toolName: string; count: number }[];
}

const TOOL_COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F0856A', '#FBBF24'];

export function TopToolsChart({ data }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 200);
    return () => clearTimeout(t);
  }, []);

  const tools = data.length > 0
    ? data.slice(0, 4).map((d, i) => ({
        name: d.toolName,
        val: d.count,
        color: TOOL_COLORS[i % TOOL_COLORS.length],
      }))
    : [
        { name: 'get_cloudstick_websites', val: 3.0, color: '#7C3AED' },
        { name: 'execute_ssh_command',      val: 1.9, color: '#06B6D4' },
        { name: 'get_cloudstick_servers',   val: 1.1, color: '#10B981' },
        { name: 'check_ssl_api',            val: 0.7, color: '#F0856A' },
      ];

  const max = Math.max(...tools.map(t => t.val), 1);

  return (
    /* flex column, fills the parent — parent must have display:flex,flexDirection:column */
    <div style={{
      display: 'flex', flexDirection: 'column',
      flex: 1, justifyContent: 'space-between',
      padding: '2px 0',
    }}>
      {tools.map((t, i) => (
        <ToolRow key={t.name} t={t} max={max} idx={i} mounted={mounted} />
      ))}
    </div>
  );
}

function ToolRow({
  t, max, idx, mounted,
}: {
  t: { name: string; val: number; color: string };
  max: number;
  idx: number;
  mounted: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="fade-up"
      style={{ animationDelay: `${idx * 0.1 + 0.2}s` }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'center' }}>
        <span style={{
          fontSize: 11, fontWeight: 500,
          color: hovered ? '#374151' : '#6B7280',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: '74%',
          transition: 'color 0.15s ease',
        }}>
          {t.name}
        </span>
        <span style={{
          fontSize: 11, color: hovered ? t.color : '#1a1a2e', fontWeight: 700,
          background: `${t.color}18`, padding: '2px 7px', borderRadius: 5,
          flexShrink: 0, transition: 'color 0.15s ease',
        }}>
          {typeof t.val === 'number' && t.val % 1 !== 0 ? t.val.toFixed(1) : t.val}
        </span>
      </div>
      {/* Glossy Bar */}
      <div style={{
        position: 'relative', width: '100%', height: 10,
        background: '#F0F1F6', borderRadius: 99,
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)'
      }}>
        {/* Main gradient track with glossy depth */}
        <div style={{
          width: mounted ? `${(t.val / max) * 100}%` : '0%', height: '100%',
          background: `linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 45%, rgba(0,0,0,0.1) 100%), linear-gradient(90deg, ${t.color}DD, ${t.color})`,
          borderRadius: 99,
          transition: 'width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s',
          position: 'relative',
          boxShadow: `0 3px 6px ${t.color}40`,
        }}>
          {/* Top highlight for glass look */}
          <div style={{
            position: 'absolute', top: 1, left: 2, right: 2, height: '35%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.45) 0%, transparent 100%)',
            borderRadius: 99,
          }} />
          {/* Animated Shimmer sweep */}
          <div style={{
            position: 'absolute', top: 0, right: 0, width: 60, height: '100%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
            animation: `shimmer 3s infinite linear ${idx * 0.5}s`,
            transform: 'skewX(-25deg)',
          }} />
        </div>
      </div>
    </div>
  );
}
