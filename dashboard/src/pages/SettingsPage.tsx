import React, { useState, useEffect } from 'react';

const ACCENT = '#EC4899';
const CARD_RADIUS = 20;

const STORAGE_KEY = 'cloudclaw_settings';

interface Settings {
  pollIntervalSec: number;
  defaultRange: '24h' | '7d' | '30d';
  timezone: string;
  showCostInUsd: boolean;
  alertOnHitl: boolean;
  alertOnLlmError: boolean;
  compactTables: boolean;
  dashboardTheme: 'light' | 'auto';
}

const DEFAULTS: Settings = {
  pollIntervalSec: 30,
  defaultRange: '24h',
  timezone: 'Asia/Kolkata',
  showCostInUsd: true,
  alertOnHitl: true,
  alertOnLlmError: true,
  compactTables: false,
  dashboardTheme: 'light',
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  accent?: string;
}

function Toggle({ value, onChange, accent = ACCENT }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      style={{
        width: 40, height: 22, borderRadius: 99,
        background: value ? accent : '#D1D5DB',
        border: 'none', cursor: 'pointer', padding: 0,
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 3,
        left: value ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

interface SectionProps { title: string; desc?: string; children: React.ReactNode }
function Section({ title, desc, children }: SectionProps) {
  return (
    <div style={{
      background: '#fff', borderRadius: CARD_RADIUS,
      border: '1px solid #EBEBF0', boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      marginBottom: 16,
    }}>
      <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #F4F4F8' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{title}</div>
        {desc && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ padding: '4px 0 8px' }}>{children}</div>
    </div>
  );
}

interface RowProps { label: string; desc?: string; children: React.ReactNode }
function Row({ label, desc, children }: RowProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '13px 24px', gap: 16,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = loadSettings();
    setSettings(stored);
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const selectStyle: React.CSSProperties = {
    height: 32, padding: '0 10px', borderRadius: 8,
    border: '1px solid #EBEBF0', background: '#F6F6F9',
    fontSize: 12, color: '#1a1a2e', fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e', letterSpacing: '-0.6px' }}>
            Settings
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, color: '#9CA3AF' }}>
            Dashboard preferences — saved automatically to this browser
          </p>
        </div>
        {saved && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#dcfce7', color: '#16a34a',
            padding: '8px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600,
          }}>
            ✓ Saved
          </div>
        )}
      </div>

      <Section title="Data & Polling" desc="Control how often the dashboard fetches live data">
        <Row label="Poll interval" desc="How frequently the dashboard auto-refreshes">
          <select value={settings.pollIntervalSec} onChange={e => update('pollIntervalSec', Number(e.target.value))} style={selectStyle}>
            <option value={10}>10 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>1 minute</option>
            <option value={300}>5 minutes</option>
          </select>
        </Row>
        <Row label="Default time range" desc="Range selected when the dashboard first loads">
          <select value={settings.defaultRange} onChange={e => update('defaultRange', e.target.value as Settings['defaultRange'])} style={selectStyle}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </Row>
        <Row label="Timezone" desc="Used for all timestamps in the dashboard">
          <select value={settings.timezone} onChange={e => update('timezone', e.target.value)} style={selectStyle}>
            <option value="Asia/Kolkata">IST — Asia/Kolkata</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">EST — New York</option>
            <option value="America/Los_Angeles">PST — Los Angeles</option>
            <option value="Europe/London">GMT — London</option>
          </select>
        </Row>
      </Section>

      <Section title="Alerts & Notifications" desc="In-dashboard alert banners and indicators">
        <Row label="HITL approval alerts" desc="Show banner when human-in-the-loop approvals are pending">
          <Toggle value={settings.alertOnHitl} onChange={v => update('alertOnHitl', v)} />
        </Row>
        <Row label="LLM error alerts" desc="Show warning when consecutive LLM failures are detected">
          <Toggle value={settings.alertOnLlmError} onChange={v => update('alertOnLlmError', v)} />
        </Row>
      </Section>

      <Section title="Display" desc="Visual preferences for the dashboard">
        <Row label="Show cost in USD" desc="Display cost values with USD currency formatting">
          <Toggle value={settings.showCostInUsd} onChange={v => update('showCostInUsd', v)} />
        </Row>
        <Row label="Compact tables" desc="Reduce row padding in session and tool tables">
          <Toggle value={settings.compactTables} onChange={v => update('compactTables', v)} />
        </Row>
        <Row label="Theme" desc="Dashboard colour scheme (dark mode coming soon)">
          <select value={settings.dashboardTheme} onChange={e => update('dashboardTheme', e.target.value as Settings['dashboardTheme'])} style={selectStyle}>
            <option value="light">Light</option>
            <option value="auto">Auto (system)</option>
          </select>
        </Row>
      </Section>

      <Section title="Reset">
        <Row label="Reset to defaults" desc="Clear all saved settings and restore factory defaults">
          <button
            onClick={() => { saveSettings(DEFAULTS); setSettings(DEFAULTS); setSaved(true); setTimeout(() => setSaved(false), 2000); }}
            style={{
              padding: '7px 16px', borderRadius: 8, border: '1px solid #EBEBF0',
              background: '#fff', color: '#6B7280', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Reset defaults
          </button>
        </Row>
      </Section>
    </>
  );
}
