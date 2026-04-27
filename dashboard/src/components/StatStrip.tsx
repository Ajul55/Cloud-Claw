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

// ─── Consistent icon system ──────────────────────────────────────────────────
// All icons use inline SVG only, stroke="currentColor", fill="none", strokeWidth="1.8".
// Wrapped in a 40px rounded container with a soft 6% tinted background.

function IconCircle({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
      background: `${color}0F`, // ~6% opacity
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.2s ease',
    }}>
      {children}
    </div>
  );
}

function TokenIcon({ color }: { color: string }) {
  return (
    <IconCircle color={color}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color }}>
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    </IconCircle>
  );
}

function CostIcon({ color }: { color: string }) {
  return (
    <IconCircle color={color}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color }}>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
        <path d="M7 15h.01M17 15h.01" />
      </svg>
    </IconCircle>
  );
}

function LlmIcon({ color }: { color: string }) {
  return (
    <IconCircle color={color}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color }}>
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    </IconCircle>
  );
}

function HitlIcon({ color }: { color: string }) {
  return (
    <IconCircle color={color}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color }}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    </IconCircle>
  );
}

// ─── Sparklines ──────────────────────────────────────────────────────────────

function TokenSparkline({ theme }: { theme: Theme }) {
  return (
    <svg viewBox="0 0 70 28" style={{ display: 'block', width: 70, height: 28, flexShrink: 0 }}>
      <defs>
        <linearGradient id="spk-tok-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={theme.p} stopOpacity="0.08" />
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
        fill="none" stroke={theme.p} strokeWidth="1.8" strokeLinecap="round" opacity="0.6"
      />
    </svg>
  );
}

function CostSparkline() {
  const color = '#A67C3B';
  return (
    <svg viewBox="0 0 70 28" style={{ display: 'block', width: 70, height: 28, flexShrink: 0 }}>
      <defs>
        <linearGradient id="spk-cost-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.08" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,20 C8,22 14,12 22,11 C30,10 32,17 42,13 C50,10 58,6 70,8 L70,28 L0,28Z"
        fill="url(#spk-cost-fill)" stroke="none"
      />
      <path
        className="sparkline-path"
        d="M0,20 C8,22 14,12 22,11 C30,10 32,17 42,13 C50,10 58,6 70,8"
        fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round"
        style={{ animationDelay: '0.1s' }} opacity="0.6"
      />
    </svg>
  );
}

function LlmBarSpark() {
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
            fill="#5C7FB8" opacity="0.35"
            style={{
              transformBox: 'fill-box', transformOrigin: 'bottom',
              transform: 'scaleY(0)',
              animation: `growUp 0.5s cubic-bezier(0.4,0,0.2,1) ${0.2 + i * 0.05}s forwards`,
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
  const color = pendingHitl > 0 ? '#B05B5B' : '#4A8F6B';
  return (
    <svg viewBox="0 0 60 28" style={{ display: 'block', width: 60, height: 28, flexShrink: 0 }}>
      {vals.map((v, i) => {
        const bh = Math.max(2, (v / max) * 24);
        return (
          <rect key={i}
            x={i * (bw + 2)} y={26 - bh} width={bw} height={bh} rx="1.5"
            fill={color} opacity="0.35"
            style={{
              transformBox: 'fill-box', transformOrigin: 'bottom',
              transform: 'scaleY(0)',
              animation: `growUp 0.5s cubic-bezier(0.4,0,0.2,1) ${0.2 + i * 0.05}s forwards`,
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
  accentColor: string;
  borderGradientNormal: string;
  borderGradientHover: string;
  icon: React.ReactNode;
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
        background: `linear-gradient(160deg, ${config.accentColor}05 0%, transparent 60%), linear-gradient(#fff, #fff) padding-box, ${borderGrad} border-box`,
        border: '1.5px solid transparent',
        borderRadius: 24,
        boxShadow: hovered
          ? '0 1px 0 rgba(255,255,255,1) inset, 0 4px 12px rgba(0,0,0,0.05), 0 20px 48px rgba(0,0,0,0.07)'
          : '0 1px 0 rgba(255,255,255,0.9) inset, 0 2px 4px rgba(0,0,0,0.02), 0 10px 30px rgba(0,0,0,0.04)',
        padding: '20px 24px 18px',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
        animation: `fadeUp 0.4s ease ${idx * 0.08}s both`,
        cursor: 'default',
      }}
    >
      {/* Label + icon badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginTop: 4 }}>{config.label}</span>
        <div style={{
          transition: 'transform 200ms ease, opacity 200ms ease',
          transform: hovered ? 'scale(1.05)' : 'none',
        }}>
          {config.icon}
        </div>
      </div>

      {/* Animated value */}
      <div style={{
        fontFamily: "'Geist', sans-serif",
        fontSize: 28, fontWeight: 700,
        color: config.valueColor ?? '#1a1d23',
        letterSpacing: '-0.03em', lineHeight: 1,
        marginBottom: 10,
      }}>
        {config.formatFn(animated)}
      </div>

      {/* Bottom row: sub label + sparkline */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <span style={{
          fontSize: 11.5, color: config.subColor,
          display: 'flex', alignItems: 'center', gap: 4,
          opacity: 0.85,
        }}>
          {config.subColor === '#4A8F6B' && (
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: config.subColor, display: 'inline-block', opacity: 0.6 }} />
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
  // Production-grade muted colors: -18% saturation
  const costColor = '#A67C3B';  
  const llmColor  = '#5C7FB8';  
  const hitlGreen = '#4A8F6B';  
  const hitlRed   = '#B05B5B';  

  const configs: MetricConfig[] = [
    {
      label: 'Total Tokens',
      rawValue: tokens,
      formatFn: (n) => formatTokens(n),
      sub: `↑ ${formatTokens(Math.round(tokens / 2400))} today`,
      subColor: hitlGreen,
      accentColor: theme.p,
      borderGradientNormal: `linear-gradient(135deg, ${theme.p}1A, ${theme.l}0A)`,
      borderGradientHover:  `linear-gradient(135deg, ${theme.p}2A, ${theme.l}1A)`,
      icon: <TokenIcon color={theme.p} />,
      spark: <TokenSparkline theme={theme} />,
    },
    {
      label: 'Cost (USD)',
      rawValue: costUsd,
      formatFn: (n) => `$${n.toFixed(4)}`,
      sub: '↑ 0.8% vs yesterday',
      subColor: hitlGreen,
      valueColor: '#1A1D23',
      accentColor: costColor,
      borderGradientNormal: `linear-gradient(135deg, ${costColor}1A, ${costColor}0A)`,
      borderGradientHover:  `linear-gradient(135deg, ${costColor}2A, ${costColor}1A)`,
      icon: <CostIcon color={costColor} />,
      spark: <CostSparkline />,
    },
    {
      label: 'LLM Calls',
      rawValue: llmCalls,
      formatFn: (n) => String(Math.round(n)),
      sub: 'Active sessions',
      subColor: '#9CA3AF',
      accentColor: llmColor,
      borderGradientNormal: `linear-gradient(135deg, ${llmColor}1A, ${llmColor}0A)`,
      borderGradientHover:  `linear-gradient(135deg, ${llmColor}2A, ${llmColor}1A)`,
      icon: <LlmIcon color={llmColor} />,
      spark: <LlmBarSpark />,
    },
    {
      label: 'Pending HITL',
      rawValue: pendingHitl,
      formatFn: (n) => String(Math.round(n)),
      sub: pendingHitl === 0 ? 'Normal' : `${pendingHitl} waiting`,
      subColor: pendingHitl === 0 ? hitlGreen : hitlRed,
      accentColor: pendingHitl > 0 ? hitlRed : hitlGreen,
      borderGradientNormal: pendingHitl > 0
        ? `linear-gradient(135deg, ${hitlRed}1A, ${hitlRed}0A)`
        : `linear-gradient(135deg, ${hitlGreen}1A, ${hitlGreen}0A)`,
      borderGradientHover: pendingHitl > 0
        ? `linear-gradient(135deg, ${hitlRed}2A, ${hitlRed}1A)`
        : `linear-gradient(135deg, ${hitlGreen}2A, ${hitlGreen}1A)`,
      icon: <HitlIcon color={pendingHitl > 0 ? hitlRed : hitlGreen} />,
      spark: <HitlBarSpark pendingHitl={pendingHitl} />,
    },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16,
      marginBottom: 20,
    }}>
      {configs.map((config, idx) => (
        <MetricCard key={config.label} config={config} idx={idx} />
      ))}
    </div>
  );
}
