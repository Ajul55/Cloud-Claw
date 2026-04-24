import { useState, useEffect, useCallback } from 'react';
import type { ToolEntry, Range } from '../types';

interface UseToolsResult {
  tools: ToolEntry[];
  totalCalls: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTools(range: Range): UseToolsResult {
  const [tools, setTools]         = useState<ToolEntry[]>([]);
  const [totalCalls, setTotal]    = useState(0);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tools?range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { tools: ToolEntry[]; totalCalls: number };
      setTools(json.tools);
      setTotal(json.totalCalls);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return { tools, totalCalls, loading, error, refresh: fetchData };
}
