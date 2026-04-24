import React, { useState } from 'react';
import { RefreshCw, AlertTriangle } from '../components/Icons';
import { useTools } from '../hooks/useTools';
import type { Range, ToolEntry } from '../types';

const ACCENT = '#EC4899';
const CARD_RADIUS = 20;

const LANE_META: Record<1 | 2 | 3, { label: string; color: string; bg: string; desc: string }> = {
  1: { label: 'API Lane',       color: '#7C3AED', bg: '#EDE9FE', desc: 'Direct API operations' },
  2: { label: 'SSH Read Lane',  color: '#3B82F6', bg: '#EFF6FF', desc: 'Read-only SSH commands' },
  3: { label: 'SSH Write Lane', color: '#dc2626', bg: '#fee2e2', desc: 'Mutating SSH operations' },
};

const RANGES: Range[] = ['24h', '7d', '30d'];

export function ToolsPage() {
  const [range, setRange] = useState<Range>('24h');
  const [laneFilter, setLaneFilter] = useState<1 | 2 | 3 | 0>(0);
  const { tools, totalCalls, loading, error, refresh } = useTools(range);

  const visible = laneFilter === 0 ? tools : tools.filter(t => t.lane === laneFilter);
  const maxCount = tools.length > 0 ? Math.max(...tools.map(t => t.count)) : 1;

  const laneCounts: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  for (const t of tools) laneCounts[t.lane] = (laneCounts[t.lane] ?? 0) + t.count;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e', letterSpacing: '-0.6px' }}>
            Tools
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, color: '#9CA3AF' }}>
            Tool call frequency and lane distribution across all sessions
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', background: '#F2F3F7', borderRadius: 9, padding: 3, border: '1px solid #EBEBF0' }}>
            {RANGES.map(r => (
              <button key={r} onClick={() => setRange(r)} style={{
                padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                background: range === r ? ACCENT : 'transparent',
                color: range === r ? '#fff' : '#666',
                boxShadow: range === r ? `0 2px 8px ${ACCENT}44` : 'none',
              }}>{r}</button>
            ))}
          </div>
          <button onClick={refresh} disabled={loading} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 9, border: `1px solid ${ACCENT}40`,
            background: `${ACCENT}10`, color: ACCENT,
            fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.65 : 1, fontFamily: 'inherit',
          }}>
            <RefreshCw size={13} color={ACCENT} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#fee2e2', color: '#dc2626',
          padding: '11px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13,
        }}>
          <AlertTriangle size={16} color="#dc2626" />
          {error === 'HTTP 503' ? 'Database not connected' : `Error: ${error}`}
        </div>
      )}

      {/* Lane summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
        {([1, 2, 3] as const).map(lane => {
          const meta = LANE_META[lane];
          const active = laneFilter === lane;
          return (
            <button key={lane} onClick={() => setLaneFilter(active ? 0 : lane)} style={{
              background: active ? meta.bg : '#fff',
              borderRadius: CARD_RADIUS, border: active ? `1.5px solid ${meta.color}40` : '1px solid #EBEBF0',
              boxShadow: active ? `0 2px 12px ${meta.color}20` : '0 1px 6px rgba(0,0,0,0.05)',
              padding: '18px 22px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: meta.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {meta.label}
                </span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#1a1a2e', letterSpacing: '-1px', lineHeight: 1 }}>
                {laneCounts[lane]}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>{meta.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Tools list */}
      <div style={{
        background: '#fff', borderRadius: CARD_RADIUS,
        border: '1px solid #EBEBF0', boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      }}>
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #F4F4F8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>
              {laneFilter === 0 ? 'All Tools' : LANE_META[laneFilter].label}
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
              {visible.length} tools · {totalCalls.toLocaleString()} total calls
            </div>
          </div>
          {laneFilter !== 0 && (
            <button onClick={() => setLaneFilter(0)} style={{
              fontSize: 11, fontWeight: 600, color: '#6B7280', background: '#F0F0F5',
              border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Clear filter
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            {loading ? 'Loading tools…' : 'No tool usage in this period'}
          </div>
        ) : (
          <div style={{ padding: '8px 0' }}>
            {visible.map((t: ToolEntry, idx) => {
              const meta = LANE_META[t.lane];
              const pct = Math.round((t.count / maxCount) * 100);
              return (
                <div key={t.toolName} style={{ padding: '10px 24px', borderBottom: idx < visible.length - 1 ? '1px solid #F8F8FB' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#C4C4C4', width: 20, textAlign: 'right', flexShrink: 0 }}>
                      {idx + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', fontFamily: 'monospace' }}>
                          {t.toolName}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 8px',
                            borderRadius: 99, background: meta.bg, color: meta.color,
                          }}>{meta.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#1a1a2e', minWidth: 36, textAlign: 'right' }}>
                            {t.count.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div style={{ height: 5, background: '#F0F0F5', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${pct}%`,
                          background: meta.color, borderRadius: 99,
                          transition: 'width 0.4s ease',
                          opacity: 0.75,
                        }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
