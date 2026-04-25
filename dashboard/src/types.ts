export type Range = '24h' | '7d' | '30d';

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
