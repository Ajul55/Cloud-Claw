export type Range = '24h' | '7d' | '30d';
export type BurnRange = '7d' | '14d' | '30d';

export interface Theme {
  id: string;
  label: string;
  p: string;    // primary
  l: string;    // light
  d: string;    // dark
  bg: string;   // background tint
  nav: string;  // nav active bg
  grad: string; // extra gradient stop
}

export const THEMES: Record<string, Theme> = {
  violet:  { id:'violet',  label:'Violet',  p:'#7e4ce6', l:'#a78bfa', d:'#5b21b6', bg:'#f5f3ff', nav:'#ede9fe', grad:'#c4b5fd' },
  indigo:  { id:'indigo',  label:'Indigo',  p:'#5c54e0', l:'#818cf8', d:'#3730a3', bg:'#eef2ff', nav:'#e0e7ff', grad:'#a5b4fc' },
  blue:    { id:'blue',    label:'Blue',    p:'#3b69e0', l:'#60a5fa', d:'#1d4ed8', bg:'#eff6ff', nav:'#dbeafe', grad:'#93c5fd' },
  cyan:    { id:'cyan',    label:'Cyan',    p:'#1e8ba6', l:'#22d3ee', d:'#0e7490', bg:'#ecfeff', nav:'#cffafe', grad:'#67e8f9' },
  rose:    { id:'rose',    label:'Rose',    p:'#db3b5a', l:'#fb7185', d:'#be123c', bg:'#fff1f2', nav:'#ffe4e6', grad:'#fda4af' },
  orange:  { id:'orange',  label:'Orange',  p:'#e06524', l:'#fb923c', d:'#c2410c', bg:'#fff7ed', nav:'#ffedd5', grad:'#fdba74' },
  emerald: { id:'emerald', label:'Emerald', p:'#1e8f6e', l:'#34d399', d:'#047857', bg:'#ecfdf5', nav:'#d1fae5', grad:'#6ee7b7' },
};

export type NavPage = 'Dashboard' | 'Sessions' | 'Tools' | 'Servers' | 'Settings' | 'Help';

export interface StatsResponse {
  range: Range;
  totals: {
    tokens: number;
    costUsd: number;
    llmCalls: number;
    pendingHitl: number;
  };
  burnRate: { bucket: string; tokens: number }[];
  topTools: { toolName: string; count: number }[];
  laneSplit: {
    lane: 1 | 2 | 3;
    label: 'API' | 'SSH Read' | 'SSH Write';
    count: number;
  }[];
  recentSessions: {
    sessionId: string;
    platform: 'slack' | 'telegram';
    tokensTotal: number;
    costUsd: number;
    toolCount: number;
    topLane: 1 | 2 | 3;
    createdAt: string;
  }[];
  system: {
    activeSessions: number;
    memoryMb: number;
    uptimeSeconds: number;
    llmConsecutiveErrors: number;
  };
}

export interface SessionRow {
  id: string;
  channel: string;
  userId: string;
  status: string;
  iteration: number;
  problemClass: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivity: string | null;
}

export interface ServerRow {
  id: number;
  label: string;
  ip: string;
  sshUser: string;
  sshPort: number;
  active: boolean;
  addedAt: string;
}

export interface ApprovalRow {
  id: number;
  sessionId: string;
  command: string;
  targetHost: string;
  rationale: string | null;
  status: string;
  requestedAt: string;
  resolvedAt: string | null;
}

export interface ToolEntry {
  toolName: string;
  count: number;
  lane: 1 | 2 | 3;
}
