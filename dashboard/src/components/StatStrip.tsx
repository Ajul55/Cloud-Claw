import React, { useState } from 'react';
import { useCountUp } from '../hooks/useCountUp';

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
  return String(Math.round(n));
}

// ─── Sparklines with CSS draw animation ─────────────────────────────────────

const TokenSparkline = () => (
  <svg viewBox="0 0 64 28" style={{ display: 'block', width: '100%', height: 30 }}>
    <defs>
      <linearGradient id="spk-tok-line" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#EC4899" />
        <stop offset="100%" stopColor="#F97316" />
      </linearGradient>
      <linearGradient id="spk-tok-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#EC4899" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
      </linearGradient>
      <filter id="spk-glow-pk">
        <feGaussianBlur stdDeviation="1.2" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
    {/* Area fill — no animation, just reveals with path */}
    <path className="sparkline-path"
      d="M0,22 C8,18 12,8 20,10 C28,12 32,20 40,15 C48,10 54,4 64,6 L64,28 L0,28Z"
      fill="url(#spk-tok-fill)" stroke="none"
      style={{ strokeDasharray: 'none', animationDelay: '0.4s' }}
    />
    <path className="sparkline-path"
      d="M0,22 C8,18 12,8 20,10 C28,12 32,20 40,15 C48,10 54,4 64,6"
      fill="none" stroke="url(#spk-tok-line)" strokeWidth="2" strokeLinecap="round"
      filter="url(#spk-glow-pk)"
    />
    <circle cx="64" cy="6" r="2.5" fill="#F97316"
      style={{ animation: 'dotPop 0.3s ease 1.3s both' }} />
  </svg>
);

const CostSparkline = () => (
  <svg viewBox="0 0 64 28" style={{ display: 'block', width: '100%', height: 30 }}>
    <defs>
      <linearGradient id="spk-cost-line" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#F59E0B" />
        <stop offset="100%" stopColor="#FBBF24" />
      </linearGradient>
      <linearGradient id="spk-cost-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#FBBF24" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path className="sparkline-path"
      d="M0,20 C7,22 12,12 20,11 C28,10 30,17 40,13 C48,10 54,6 64,8 L64,28 L0,28Z"
      fill="url(#spk-cost-fill)" stroke="none"
      style={{ strokeDasharray: 'none', animationDelay: '0.5s' }}
    />
    <path className="sparkline-path"
      d="M0,20 C7,22 12,12 20,11 C28,10 30,17 40,13 C48,10 54,6 64,8"
      fill="none" stroke="url(#spk-cost-line)" strokeWidth="2" strokeLinecap="round"
      style={{ animationDelay: '0.5s' }}
    />
    <circle cx="64" cy="8" r="2.5" fill="#FBBF24"
      style={{ animation: 'dotPop 0.3s ease 1.4s both' }} />
  </svg>
);

const LlmSparkline = () => {
  const vals = [3, 5, 4, 7, 5, 6, 9, 5, 8, 10, 7, 9, 10];
  const max = 10;
  return (
    <svg viewBox="0 0 64 28" style={{ display: 'block', width: '100%', height: 30 }}>
      <defs>
        <linearGradient id="spk-llm-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="spk-llm-peak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0EA5E9" />
          <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      {vals.map((v, i) => {
        const h = (v / max) * 22;
        return (
          <rect key={i}
            x={i * 4.8 + 0.5} y={26 - h} width={3.6} height={h} rx="1.5"
            fill={i === vals.length - 1 ? 'url(#spk-llm-peak)' : 'url(#spk-llm-bar)'}
            style={{
              transformBox: 'fill-box', transformOrigin: 'bottom',
              transform: 'scaleY(0)',
              animation: `growUp 0.5s cubic-bezier(0.22,1,0.36,1) ${0.25 + i * 0.05}s forwards`,
            }}
          />
        );
      })}
    </svg>
  );
};

const HitlSparkline = () => (
  <svg viewBox="0 0 64 28" style={{ display: 'block', width: '100%', height: 30 }}>
    <defs>
      <linearGradient id="spk-hitl-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.14" />
        <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path className="sparkline-bar-path"
      d="M0,24 L10,24 L10,18 L18,18 L18,24 L26,24 L26,14 L34,14 L34,24 L42,24 L42,10 L52,10 L52,24 L64,24"
      fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
    />
    <path
      d="M0,24 L10,24 L10,18 L18,18 L18,24 L26,24 L26,14 L34,14 L34,24 L42,24 L42,10 L52,10 L52,24 L64,24 L64,28 L0,28Z"
      fill="url(#spk-hitl-fill)"
      style={{ opacity: 0, animation: 'fadeUp 0.4s ease 0.8s forwards' }}
    />
  </svg>
);

// ─── Metric card ──────────────────────────────────────────────────────────────

interface MetricConfig {
  label: string;
  rawValue: number;
  formatFn: (n: number) => string;
  sub: string;
  subColor: string;
  valueColor?: string;
  borderGradientNormal: string;
  borderGradientHover: string;
  pulseColor: string;
  spark: React.ReactNode;
}

function MetricCard({ config, idx }: { config: MetricConfig; idx: number }) {
  const [hovered, setHovered] = useState(false);
  const animated = useCountUp(config.rawValue, 900, 150 + idx * 80);

  const borderGrad = hovered ? config.borderGradientHover : config.borderGradientNormal;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: `linear-gradient(#fff, #fff) padding-box, ${borderGrad} border-box`,
        border: '1.5px solid transparent',
        borderRadius: 20,
        boxShadow: hovered
          ? '0 1px 0 rgba(255,255,255,1) inset, 0 6px 20px rgba(0,0,0,0.09), 0 16px 40px rgba(0,0,0,0.08)'
          : '0 1px 0 rgba(255,255,255,0.85) inset, 0 2px 8px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.04)',
        padding: '20px 22px 16px',
        transform: hovered ? 'translateY(-4px)' : 'none',
        transition: 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.22s ease, background 0.22s ease',
        animation: `fadeUp 0.4s ease ${idx * 0.08}s both`,
      }}
    >
      {/* Label row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#9CA3AF',
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          {config.label}
        </div>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: config.pulseColor,
          flexShrink: 0,
          transition: `box-shadow 0.2s ease, transform 0.2s ease`,
          ...(hovered ? {
            boxShadow: `0 0 0 4px ${config.pulseColor}25`,
            transform: 'scale(1.2)',
          } : {}),
        }} />
      </div>

      {/* Animated value */}
      <div style={{
        fontSize: 30, fontWeight: 900,
        color: config.valueColor ?? '#0F0F1A',
        letterSpacing: '-1.5px', lineHeight: 1,
        marginBottom: 10,
        transition: 'color 0.2s ease',
      }}>
        {config.formatFn(animated)}
      </div>

      {/* Sparkline */}
      <div style={{ marginBottom: 8 }}>{config.spark}</div>

      {/* Sub label */}
      <div style={{ fontSize: 11, color: config.subColor, fontWeight: 500, marginTop: 2 }}>
        {config.sub}
      </div>
    </div>
  );
}

// ─── Strip ────────────────────────────────────────────────────────────────────

export function StatStrip({ tokens, costUsd, llmCalls, pendingHitl }: StatStripProps) {
  const configs: MetricConfig[] = [
    {
      label: 'Total Tokens',
      rawValue: tokens,
      formatFn: (n) => formatTokens(n),
      sub: `↑ ${formatTokens(tokens)} tokens used today`,
      subColor: '#22c55e',
      borderGradientNormal: 'linear-gradient(135deg, #EC489935, #F9731618)',
      borderGradientHover:  'linear-gradient(135deg, #EC489960, #F9731640)',
      pulseColor: '#EC4899',
      spark: <TokenSparkline />,
    },
    {
      label: 'Cost (USD)',
      rawValue: costUsd,
      formatFn: (n) => `$${n.toFixed(4)}`,
      sub: '↑ 0.8% vs yesterday',
      subColor: '#22c55e',
      valueColor: '#D97706',
      borderGradientNormal: 'linear-gradient(135deg, #F59E0B35, #FBBF2418)',
      borderGradientHover:  'linear-gradient(135deg, #F59E0B60, #FBBF2440)',
      pulseColor: '#F59E0B',
      spark: <CostSparkline />,
    },
    {
      label: 'LLM Calls',
      rawValue: llmCalls,
      formatFn: (n) => String(Math.round(n)),
      sub: 'Across active sessions',
      subColor: '#9CA3AF',
      borderGradientNormal: 'linear-gradient(135deg, #06B6D435, #0EA5E918)',
      borderGradientHover:  'linear-gradient(135deg, #06B6D460, #0EA5E940)',
      pulseColor: '#06B6D4',
      spark: <LlmSparkline />,
    },
    {
      label: 'Pending HITL',
      rawValue: pendingHitl,
      formatFn: (n) => String(Math.round(n)),
      sub: pendingHitl === 0 ? 'No approvals needed' : `${pendingHitl} waiting`,
      subColor: pendingHitl === 0 ? '#22c55e' : '#ef4444',
      borderGradientNormal: pendingHitl > 0
        ? 'linear-gradient(135deg, #ef444435, #dc262618)'
        : 'linear-gradient(135deg, #7C3AED35, #A855F718)',
      borderGradientHover: pendingHitl > 0
        ? 'linear-gradient(135deg, #ef444460, #dc262640)'
        : 'linear-gradient(135deg, #7C3AED60, #A855F740)',
      pulseColor: pendingHitl > 0 ? '#ef4444' : '#7C3AED',
      spark: <HitlSparkline />,
    },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12,
      marginBottom: 16,
    }}>
      {configs.map((config, idx) => (
        <MetricCard key={config.label} config={config} idx={idx} />
      ))}
    </div>
  );
}
