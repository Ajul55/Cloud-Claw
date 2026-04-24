export type Range = '24h' | '7d' | '30d';

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
}
