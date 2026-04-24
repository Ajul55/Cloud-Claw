import React from 'react';

interface StatStripProps {
  tokens: number;
  costUsd: number;
  llmCalls: number;
  pendingHitl: number;
  accent: string;
  cardRadius: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// Sparkline SVGs — inline, no deps
const TokenSparkline = ({ color }: { color: string }) => (
  <svg viewBox="0 0 60 22" style={{ display: 'block', width: '100%', height: 28 }}>
    <defs>
      <linearGradient id="spk1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.2" />
        <stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient>
    </defs>
    <path d="M0,18 C8,14 12,6 20,8 C28,10 32,16 40,12 C48,8 52,3 60,5" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <path d="M0,18 C8,14 12,6 20,8 C28,10 32,16 40,12 C48,8 52,3 60,5 L60,22 L0,22Z" fill="url(#spk1)" />
    <circle cx="60" cy="5" r="2" fill={color} />
  </svg>
);

const CostSparkline = () => (
  <svg viewBox="0 0 60 22" style={{ display: 'block', width: '100%', height: 28 }}>
    <defs>
      <linearGradient id="spk2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FBBF24" stopOpacity="0.2" />
        <stop offset="100%" stopColor="#FBBF24" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path d="M0,16 C6,18 10,10 18,9 C26,8 30,14 38,11 C46,8 50,5 60,7" fill="none" stroke="#FBBF24" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M0,16 C6,18 10,10 18,9 C26,8 30,14 38,11 C46,8 50,5 60,7 L60,22 L0,22Z" fill="url(#spk2)" />
    <circle cx="60" cy="7" r="2" fill="#FBBF24" />
  </svg>
);

const LlmSparkline = () => (
  <svg viewBox="0 0 60 22" style={{ display: 'block', width: '100%', height: 28 }}>
    {[3,5,4,7,5,6,9,5,8,10,7,9,10].map((v, i) => (
      <rect key={i} x={i * 4.5 + 0.5} y={22 - (v / 10) * 18} width={3.8} height={(v / 10) * 18}
        rx="1" fill={i === 12 ? '#06B6D4' : '#CFFAFE'} />
    ))}
  </svg>
);

const HitlSparkline = () => (
  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 28, paddingTop: 4 }}>
    {Array.from({ length: 12 }).map((_, i) => (
      <div key={i} style={{ flex: 1, height: '100%', background: '#EDE9FE', borderRadius: 3 }} />
    ))}
  </div>
);

interface MetricConfig {
  label: string;
  value: string;
  sub: string;
  subColor: string;
  accentBar: string;
  valueColor?: string;
  spark: React.ReactNode;
}

export function StatStrip({ tokens, costUsd, llmCalls, pendingHitl, accent, cardRadius }: StatStripProps) {
  const metrics: MetricConfig[] = [
    {
      label: 'Total Tokens',
      value: formatTokens(tokens),
      sub: '↑ tokens used today',
      subColor: '#22c55e',
      accentBar: accent,
      spark: <TokenSparkline color={accent} />,
    },
    {
      label: 'Cost (USD)',
      value: `$${costUsd.toFixed(4)}`,
      sub: '↑ 0.8% vs yesterday',
      subColor: '#22c55e',
      accentBar: '#FBBF24',
      valueColor: '#D97706',
      spark: <CostSparkline />,
    },
    {
      label: 'LLM Calls',
      value: String(llmCalls),
      sub: `across active sessions`,
      subColor: '#9CA3AF',
      accentBar: '#06B6D4',
      spark: <LlmSparkline />,
    },
    {
      label: 'Pending HITL',
      value: String(pendingHitl),
      sub: pendingHitl === 0 ? 'No approvals needed' : `${pendingHitl} waiting`,
      subColor: pendingHitl === 0 ? '#22c55e' : '#ef4444',
      accentBar: '#7C3AED',
      spark: <HitlSparkline />,
    },
  ];

  return (
    <div style={{
      background: '#fff',
      borderRadius: cardRadius,
      border: '1px solid #EBEBF0',
      boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      marginBottom: 18,
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
    }}>
      {metrics.map(({ label, value, sub, subColor, accentBar, valueColor, spark }, idx) => (
        <div key={label} style={{
          padding: '18px 24px 16px',
          borderRight: idx < 3 ? '1px solid #F0F0F5' : 'none',
          position: 'relative',
        }}>
          {/* Colored accent bar at top */}
          <div style={{
            position: 'absolute', top: 0, left: 24, right: 24,
            height: 2.5, borderRadius: '0 0 3px 3px',
            background: accentBar, opacity: 0.75,
          }} />
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#9CA3AF',
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8,
          }}>
            {label}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div style={{
              fontSize: 28, fontWeight: 900,
              color: valueColor ?? '#1a1a2e',
              letterSpacing: '-1px', lineHeight: 1,
            }}>
              {value}
            </div>
            <div style={{ width: 72, flexShrink: 0 }}>{spark}</div>
          </div>
          <div style={{ fontSize: 11, color: subColor, fontWeight: 500, marginTop: 10 }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}
