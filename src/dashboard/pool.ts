import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

let _dashPool: pg.Pool | null = null;

export function getDashboardPool(): pg.Pool {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL not configured');
  if (!_dashPool) {
    _dashPool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 3_000,
    });
    _dashPool.on('error', (err) => {
      console.error('[dashboard-pool] Pool error:', err.message);
    });
  }
  return _dashPool;
}

export async function closeDashboardPool(): Promise<void> {
  if (_dashPool) {
    await _dashPool.end();
    _dashPool = null;
  }
}
