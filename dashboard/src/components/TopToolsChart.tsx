import React, { useState, useEffect } from 'react';
import type { Theme } from '../types';

interface Props {
  data: { toolName: string; count: number }[];
  theme: Theme;
}

export function TopToolsChart({ data, theme }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 200);
    return () => clearTimeout(t);
  }, []);

  const TOOL_COLORS = [theme.p, '#06b6d4', '#22c55e', '#f59e0b'];

  const tools = data.length > 0
    ? data.slice(0, 4).map((d, i) => ({
        name: d.toolName,
        val: d.count,
        color: TOOL_COLORS[i % TOOL_COLORS.length],
      }))
    : [
        { name: 'get_cloudstick_websites', val: 3.0, color: TOOL_COLORS[0] },
        { name: 'execute_ssh_command',      val: 1.9, color: TOOL_COLORS[1] },
        { name: 'get_cloudstick_servers',   val: 1.1, color: TOOL_COLORS[2] },
        { name: 'check_ssl_api',            val: 0.7, color: TOOL_COLORS[3] },
      ];

  const max = Math.max(...tools.map(t => t.val), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: t.color, display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            color: hovered ? '#374151' : '#4b5563',
            fontFamily: "'JetBrains Mono', Geist Mono, monospace",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: 165, transition: 'color 0.15s ease',
          }}>
            {t.name}
          </span>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 600, color: '#374151',
          fontFamily: "'JetBrains Mono', Geist Mono, monospace",
          flexShrink: 0,
        }}>
          {typeof t.val === 'number' && t.val % 1 !== 0 ? t.val.toFixed(1) : t.val}
        </span>
      </div>
      {/* Progress bar */}
      <div style={{
        height: 4, background: '#f3f4f6', borderRadius: 99, overflow: 'hidden',
      }}>
        <div style={{
          width: mounted ? `${(t.val / max) * 100}%` : '0%',
          height: '100%',
          background: t.color,
          borderRadius: 99,
          transition: 'width 600ms cubic-bezier(0.34,1.56,0.64,1) 0.3s',
        }} />
      </div>
    </div>
  );
}
