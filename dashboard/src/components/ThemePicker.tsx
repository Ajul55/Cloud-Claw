import React, { useState, useRef, useEffect } from 'react';
import { Check } from './Icons';
import type { Theme } from '../types';
import { THEMES } from '../types';

interface Props {
  current: Theme;
  onChange: (t: Theme) => void;
}

export function ThemePicker({ current, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 8,
          border: '1px solid #e5e7eb',
          background: open ? '#f9fafb' : '#fff',
          cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 500, color: '#374151',
          transition: 'all 150ms',
        }}
      >
        <span style={{
          width: 14, height: 14, borderRadius: '50%',
          background: `linear-gradient(135deg,${current.d},${current.l})`,
          display: 'inline-block',
          boxShadow: `0 1px 4px ${current.p}50`,
          flexShrink: 0,
        }} />
        Theme
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
          stroke="#9ca3af" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: '#fff', border: '1px solid #e9eaf0',
          borderRadius: 12, padding: '14px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          width: 220, zIndex: 999,
          animation: 'popIn 150ms ease both',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12,
          }}>
            Color theme
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {Object.values(THEMES).map(t => (
              <div
                key={t.id}
                onClick={() => { onChange(t); setOpen(false); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                  cursor: 'pointer', padding: '6px 4px', borderRadius: 8,
                  background: current.id === t.id ? '#f9fafb' : 'transparent',
                  border: `1.5px solid ${current.id === t.id ? t.p : 'transparent'}`,
                  transition: 'all 150ms',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: `linear-gradient(135deg,${t.d},${t.l})`,
                  boxShadow: `0 2px 6px ${t.p}50`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {current.id === t.id && <Check size={12} color="white" strokeWidth={2.5} />}
                </div>
                <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 500 }}>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
