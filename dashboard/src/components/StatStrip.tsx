import React, { useState } from 'react';
import { useCountUp } from '../hooks/useCountUp';
import type { Theme } from '../types';

interface StatStripProps {
  tokens: number;
  costUsd: number;
  llmCalls: number;
  pendingHitl: number;
  theme: Theme;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

// ─── Sparklines ──────────────────────────────────────────────────────────────

function TokenSparkline({ theme }: { theme: Theme }) {
  return (
    <svg viewBox="0 0 70 28" style={{ display: 'block', width: 70, height: 28, flexShrink: 0 }}>
      <defs>
        <linearGradient id="spk-tok-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={theme.p} stopOpacity="0.2" />
          <stop offset="100%" stopColor={theme.p} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,22 C8,18 14,8 22,10 C30,12 34,20 42,15 C50,10 58,4 70,6 L70,28 L0,28Z"
        fill="url(#spk-tok-fill)" stroke="none"
      />
      <path
        className="sparkline-path"
        d="M0,22 C8,18 14,8 22,10 C30,12 34,20 42,15 C50,10 58,4 70,6"
        fill="none" stroke={theme.p} strokeWidth="1.75" strokeLinecap="round"
      />
    </svg>
  );
}

function CostSparkline() {
  return (
    <svg viewBox="0 0 70 28" style={{ display: 'block', width: 70, height: 28, flexShrink: 0 }}>
      <defs>
        <linearGradient id="spk-cost-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,20 C8,22 14,12 22,11 C30,10 32,17 42,13 C50,10 58,6 70,8 L70,28 L0,28Z"
        fill="url(#spk-cost-fill)" stroke="none"
      />
      <path
        className="sparkline-path"
        d="M0,20 C8,22 14,12 22,11 C30,10 32,17 42,13 C50,10 58,6 70,8"
        fill="none" stroke="#F59E0B" strokeWidth="1.75" strokeLinecap="round"
        style={{ animationDelay: '0.1s' }}
      />
    </svg>
  );
}

function LlmBarSpark({ theme }: { theme: Theme }) {
  const vals = [2, 3, 5, 4, 8, 6, 9, 10];
  const max  = 10;
  const bw   = 60 / vals.length - 2;
  return (
    <svg viewBox="0 0 60 28" style={{ display: 'block', width: 60, height: 28, flexShrink: 0 }}>
      {vals.map((v, i) => {
        const bh = Math.max(2, (v / max) * 24);
        return (
          <rect key={i}
            x={i * (bw + 2)} y={26 - bh} width={bw} height={bh} rx="1.5"
            fill="#3b82f6" opacity="0.65"
            style={{
              transformBox: 'fill-box', transformOrigin: 'bottom',
              transform: 'scaleY(0)',
              animation: `growUp 0.5s cubic-bezier(0.22,1,0.36,1) ${0.2 + i * 0.05}s forwards`,
            }}
          />
        );
      })}
    </svg>
  );
}

function HitlBarSpark({ pendingHitl }: { pendingHitl: number }) {
  const vals = [0, 0, 0, 1, 0, 0, 0, pendingHitl > 0 ? 1 : 0];
  const max  = Math.max(...vals, 1);
  const bw   = 60 / vals.length - 2;
  return (
    <svg viewBox="0 0 60 28" style={{ display: 'block', width: 60, height: 28, flexShrink: 0 }}>
      {vals.map((v, i) => {
        const bh = Math.max(2, (v / max) * 24);
        return (
          <rect key={i}
            x={i * (bw + 2)} y={26 - bh} width={bw} height={bh} rx="1.5"
            fill="#22c55e" opacity="0.65"
            style={{
              transformBox: 'fill-box', transformOrigin: 'bottom',
              transform: 'scaleY(0)',
              animation: `growUp 0.5s cubic-bezier(0.22,1,0.36,1) ${0.2 + i * 0.05}s forwards`,
            }}
          />
        );
      })}
    </svg>
  );
}

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
        padding: '18px 20px 16px',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.22s ease, background 0.22s ease',
        animation: `fadeUp 0.4s ease ${idx * 0.08}s both`,
        cursor: 'default',
      }}
    >
      {/* Label + icon bg */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>{config.label}</span>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: config.pulseColor, flexShrink: 0,
          ...(hovered ? { boxShadow: `0 0 0 4px ${config.pulseColor}25`, transform: 'scale(1.2)' } : {}),
          transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        }} />
      </div>

      {/* Animated value */}
      <div style={{
        fontFamily: "'Geist', sans-serif",
        fontSize: 26, fontWeight: 700,
        color: config.valueColor ?? '#1a1d23',
        letterSpacing: '-0.03em', lineHeight: 1,
        marginBottom: 8,
      }}>
        {config.formatFn(animated)}
      </div>

      {/* Bottom row: sub + sparkline */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <span style={{
          fontSize: 11, color: config.subColor,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {config.subColor === '#22c55e' && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: config.subColor, display: 'inline-block' }} />
          )}
          {config.sub}
        </span>
        {config.spark}
      </div>
    </div>
  );
}

// ─── Strip ────────────────────────────────────────────────────────────────────

export function StatStrip({ tokens, costUsd, llmCalls, pendingHitl, theme }: StatStripProps) {
  const configs: MetricConfig[] = [
    {
      label: 'Total Tokens',
      rawValue: tokens,
      formatFn: (n) => formatTokens(n),
      sub: `↑ ${formatTokens(Math.round(tokens / 2400))} tokens used today`,
      subColor: '#22c55e',
      borderGradientNormal: `linear-gradient(135deg, ${theme.p}35, ${theme.l}18)`,
      borderGradientHover:  `linear-gradient(135deg, ${theme.p}60, ${theme.l}40)`,
      pulseColor: theme.p,
      spark: <TokenSparkline theme={theme} />,
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
      borderGradientNormal: 'linear-gradient(135deg, #3b82f635, #60a5fa18)',
      borderGradientHover:  'linear-gradient(135deg, #3b82f660, #60a5fa40)',
      pulseColor: '#3b82f6',
      spark: <LlmBarSpark theme={theme} />,
    },
    {
      label: 'Pending HITL',
      rawValue: pendingHitl,
      formatFn: (n) => String(Math.round(n)),
      sub: pendingHitl === 0 ? 'No approvals needed' : `${pendingHitl} waiting`,
      subColor: pendingHitl === 0 ? '#22c55e' : '#ef4444',
      borderGradientNormal: pendingHitl > 0
        ? 'linear-gradient(135deg, #ef444435, #dc262618)'
        : 'linear-gradient(135deg, #22c55e35, #16a34a18)',
      borderGradientHover: pendingHitl > 0
        ? 'linear-gradient(135deg, #ef444460, #dc262640)'
        : 'linear-gradient(135deg, #22c55e60, #16a34a40)',
      pulseColor: pendingHitl > 0 ? '#ef4444' : '#22c55e',
      spark: <HitlBarSpark pendingHitl={pendingHitl} />,
    },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12,
    }}>
      {configs.map((config, idx) => (
        <MetricCard key={config.label} config={config} idx={idx} />
      ))}
    </div>
  );
}
