import { useState, useEffect, useCallback } from 'react';
import type { SessionRow } from '../types';

interface UseSessionsResult {
  sessions: SessionRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { sessions: SessionRow[] };
      setSessions(json.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return { sessions, loading, error, refresh: fetchData };
}
