import { useState, useEffect, useCallback } from 'react';
import type { TraceResponse } from '../types';

interface UseTraceResult {
  data: TraceResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTrace(sessionId: string | null): UseTraceResult {
  const [data, setData]       = useState<TraceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/trace`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TraceResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    void fetchData();
  }, [fetchData, sessionId]);

  return { data, loading, error, refresh: fetchData };
}
