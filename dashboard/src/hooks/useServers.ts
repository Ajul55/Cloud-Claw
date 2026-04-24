import { useState, useEffect, useCallback } from 'react';
import type { ServerRow } from '../types';

interface UseServersResult {
  servers: ServerRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useServers(): UseServersResult {
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/servers');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { servers: ServerRow[] };
      setServers(json.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return { servers, loading, error, refresh: fetchData };
}
