import React, { useState, useEffect } from 'react';

interface Props {
  data: { toolName: string; count: number }[];
}

// Distinct per-tool colors: violet → cyan → emerald
const TOOL_COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F0856A', '#FBBF24'];

export function TopToolsChart({ data }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 200);
    return () => clearTimeout(t);
  }, []);

  // Use real data if available, fall back to placeholder
  const tools = data.length > 0
    ? data.slice(0, 5).map((d, i) => ({
        name: d.toolName,
        val: d.count,
        color: TOOL_COLORS[i % TOOL_COLORS.length],
      }))
    : [
        { name: 'get_cloudstick_websites', val: 3.0, color: '#7C3AED' },
        { name: 'execute_ssh_command',      val: 1.9, color: '#06B6D4' },
        { name: 'get_cloudstick_servers',   val: 1.1, color: '#10B981' },
      ];

  const max = Math.max(...tools.map(t => t.val), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0', flex: 1 }}>
      {tools.map((t, i) => (
        <div
          key={t.name}
          className="fade-up"
          style={{ animationDelay: `${i * 0.1 + 0.2}s` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#555', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
              {t.name}
            </span>
            <span style={{
              fontSize: 12, color: '#1a1a2e', fontWeight: 700,
              background: `${t.color}18`, padding: '2px 8px', borderRadius: 6, flexShrink: 0,
            }}>
              {typeof t.val === 'number' && t.val % 1 !== 0 ? t.val.toFixed(1) : t.val}
            </span>
          </div>
          <div style={{ height: 10, background: '#F4F4F8', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
            <div style={{
              height: '100%',
              width: mounted ? `${(t.val / max) * 100}%` : '0%',
              background: `linear-gradient(90deg, ${t.color}CC, ${t.color})`,
              borderRadius: 99,
              transition: `width 1s cubic-bezier(0.34,1.1,0.64,1) ${i * 0.15}s`,
              boxShadow: `0 0 8px ${t.color}66`,
              position: 'relative',
            }}>
              {/* Shimmer sweep */}
              <div style={{
                position: 'absolute', top: 0, right: 0, width: 20, height: '100%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                animation: `shimmer 2s ease ${i * 0.3 + 1}s infinite`,
                borderRadius: 99,
              }} />
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map(v => (
          <span key={v} style={{ fontSize: 10, color: '#C4C4C4' }}>
            {Math.round(v * max)}
          </span>
        ))}
      </div>
    </div>
  );
}
