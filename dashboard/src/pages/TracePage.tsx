import React, { useState } from 'react';
import { RefreshCw, AlertTriangle } from '../components/Icons';
import { useTrace } from '../hooks/useTrace';
import type { AgentEvent } from '../types';

const TZ = 'Asia/Kolkata';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: TZ, month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── Event badge colors ───────────────────────────────────────────────────────

interface BadgeStyle { bg: string; color: string; border: string; label: string }

const EVENT_BADGE: Record<string, BadgeStyle> = {
  llm_call_start:        { bg: '#EFF6FF', color: '#3B82F6', border: '#BFDBFE', label: 'LLM Start' },
  llm_call_complete:     { bg: '#F0FDF4', color: '#16A34A', border: '#BBF7D0', label: 'LLM Done' },
  tool_start:            { bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE', label: 'Tool Start' },
  tool_complete:         { bg: '#DCFCE7', color: '#15803D', border: '#86EFAC', label: 'Tool OK' },
  tool_error:            { bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5', label: 'Tool Error' },
  hitl_requested:        { bg: '#FEF9C3', color: '#CA8A04', border: '#FDE047', label: 'HITL Pause' },
  hitl_resolved:         { bg: '#DCFCE7', color: '#15803D', border: '#86EFAC', label: 'HITL Done' },
  hallucination_detected:{ bg: '#FFEDD5', color: '#C2410C', border: '#FDBA74', label: 'Hallucination' },
  loop_guard_blocked:    { bg: '#FFEDD5', color: '#C2410C', border: '#FDBA74', label: 'Loop Guard' },
  max_iterations_reached:{ bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5', label: 'Max Iter' },
};

function getBadge(eventType: string, success: boolean | null): BadgeStyle {
  if (eventType === 'hitl_resolved' && success === false) {
    return { bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5', label: 'HITL Rejected' };
  }
  return EVENT_BADGE[eventType] ?? { bg: '#F3F4F6', color: '#6B7280', border: '#E5E7EB', label: eventType };
}

function getLeftBorder(eventType: string): string {
  if (['tool_error', 'max_iterations_reached'].includes(eventType)) return '#DC2626';
  if (['hallucination_detected', 'loop_guard_blocked'].includes(eventType)) return '#F97316';
  if (eventType === 'hitl_requested') return '#EAB308';
  return 'transparent';
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: AgentEvent }) {
  const [expanded, setExpanded] = useState(false);
  const badge = getBadge(event.event_type, event.success);
  const leftBorder = getLeftBorder(event.event_type);
  const hasDetail = event.args || event.result_summary;

  return (
    <div
      onClick={() => hasDetail && setExpanded(e => !e)}
      style={{
        borderLeft: `3px solid ${leftBorder === 'transparent' ? '#E5E7EB' : leftBorder}`,
        padding: '10px 16px',
        cursor: hasDetail ? 'pointer' : 'default',
        borderBottom: '1px solid #F4F4F8',
        transition: 'background 0.1s',
        background: expanded ? '#FAFAFE' : 'transparent',
      }}
      onMouseEnter={e => { if (!expanded) (e.currentTarget as HTMLDivElement).style.background = '#FAFAFA'; }}
      onMouseLeave={e => { if (!expanded) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* Iteration badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
          background: '#F3F4F6', color: '#6B7280', minWidth: 32, textAlign: 'center',
        }}>
          i{event.iteration}
        </span>

        {/* Event type badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
          background: badge.bg, color: badge.color,
          border: `1px solid ${badge.border}`,
        }}>
          {badge.label}
        </span>

        {/* Tool name */}
        {event.tool_name && (
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a2e', fontFamily: 'monospace' }}>
            {event.tool_name}
          </span>
        )}

        {/* Duration */}
        {event.duration_ms != null && (
          <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 'auto' }}>
            {event.duration_ms}ms
          </span>
        )}

        {/* Token counts for LLM events */}
        {event.input_tokens != null && (
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>
            ↑{event.input_tokens} ↓{event.output_tokens ?? 0}
            {event.cache_read_tokens ? ` 💾${event.cache_read_tokens}` : ''}
          </span>
        )}

        {/* Success indicator */}
        {event.success != null && (
          <span style={{ fontSize: 13 }}>{event.success ? '✅' : '❌'}</span>
        )}

        {/* Timestamp */}
        <span style={{ fontSize: 10, color: '#C0C4CE', marginLeft: 4 }}>
          {fmtTime(event.timestamp)}
        </span>

        {/* Expand hint */}
        {hasDetail && (
          <span style={{ fontSize: 10, color: '#C0C4CE' }}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {event.result_summary && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Summary
              </div>
              <pre style={{
                margin: 0, fontSize: 11, color: '#374151',
                background: '#F9FAFB', border: '1px solid #E5E7EB',
                borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {event.result_summary}
              </pre>
            </div>
          )}
          {event.args && Object.keys(event.args).length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Args
              </div>
              <pre style={{
                margin: 0, fontSize: 11, color: '#374151',
                background: '#F9FAFB', border: '1px solid #E5E7EB',
                borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {JSON.stringify(event.args, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const CARD_RADIUS = 20;
const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  active:     { bg: '#dcfce7', color: '#16a34a' },
  open:       { bg: '#EFF6FF', color: '#3B82F6' },
  resolved:   { bg: '#F0F0F5', color: '#6B7280' },
  escalated:  { bg: '#fee2e2', color: '#dc2626' },
  in_progress:{ bg: '#FEF3C7', color: '#D97706' },
  timed_out:  { bg: '#F3F0FF', color: '#7C3AED' },
};

interface TracePageProps {
  sessionId: string;
  onBack: () => void;
}

export function TracePage({ sessionId, onBack }: TracePageProps) {
  const { data, loading, error, refresh } = useTrace(sessionId);

  const events = data?.events ?? [];
  const session = data?.session ?? null;

  // Group events by iteration
  const byIteration = events.reduce<Record<number, AgentEvent[]>>((acc, ev) => {
    const key = ev.iteration;
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {});
  const iterations = Object.keys(byIteration).map(Number).sort((a, b) => a - b);

  const statusBadge = STATUS_BADGE[session?.status ?? ''] ?? { bg: '#F0F0F5', color: '#6B7280' };

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <button
              onClick={onBack}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 8,
                border: '1px solid #EBEBF0', background: '#fff',
                color: '#6B7280', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ← Back
            </button>
            {session && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                background: statusBadge.bg, color: statusBadge.color,
              }}>
                {session.status.replace('_', ' ')}
              </span>
            )}
            {session && (
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                {session.channel} · {session.iteration} iterations
              </span>
            )}
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e', letterSpacing: '-0.6px' }}>
            Trace
          </h1>
          <p style={{
            margin: '4px 0 0', fontSize: 11, color: '#9CA3AF',
            fontFamily: 'monospace', wordBreak: 'break-all',
          }}>
            {sessionId}
          </p>
          {session && (
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#C0C4CE' }}>
              Created {fmtTime(session.created_at)}
            </p>
          )}
        </div>
        <button onClick={refresh} disabled={loading} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
          borderRadius: 9, border: '1px solid #EBEBF0',
          background: '#fff', color: '#6B7280',
          fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.65 : 1, fontFamily: 'inherit',
        }}>
          <RefreshCw size={13} color="#6B7280" />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
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

      {/* Event count summary */}
      {events.length > 0 && (
        <div style={{ marginBottom: 16, fontSize: 12, color: '#9CA3AF' }}>
          {events.length} events across {iterations.length} iteration{iterations.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Timeline */}
      <div style={{
        background: '#fff', borderRadius: CARD_RADIUS,
        border: '1px solid #EBEBF0', boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}>
        {loading && events.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Loading trace…
          </div>
        ) : events.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            No events recorded for this session.
            <div style={{ fontSize: 11, marginTop: 6, color: '#C0C4CE' }}>
              Events are recorded for sessions started after the agent tracing feature was deployed.
            </div>
          </div>
        ) : (
          iterations.map(iter => (
            <div key={iter}>
              {/* Iteration separator */}
              <div style={{
                padding: '8px 16px', background: '#F8FAFC',
                borderBottom: '1px solid #F0F0F5',
                fontSize: 10, fontWeight: 800, color: '#9CA3AF',
                textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                Iteration {iter}
              </div>
              {byIteration[iter].map(ev => (
                <EventRow key={ev.id} event={ev} />
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}
