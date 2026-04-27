import { useState, useEffect, useCallback } from 'react';
import type { BurnRange } from '../types';

interface BurnRatePoint { bucket: string; tokens: number; }

interface UseBurnRateResult {
  data: BurnRatePoint[];
  loading: boolean;
}

const POLL_INTERVAL_MS = 60_000;

export function useBurnRate(range: BurnRange): UseBurnRateResult {
  const [data, setData]       = useState<BurnRatePoint[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/burnrate?range=${range}`);
      if (!res.ok) return;
      const json = (await res.json()) as { data: BurnRatePoint[] };
      setData(json.data);
    } catch {
      // keep last data on transient failure
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => { void fetchData(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  return { data, loading };
}
