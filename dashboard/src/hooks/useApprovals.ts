import { useState, useEffect, useCallback } from 'react';
import type { ApprovalRow } from '../types';

interface UseApprovalsResult {
  approvals: ApprovalRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useApprovals(status?: string): UseApprovalsResult {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const res = await fetch(`/api/approvals${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { approvals: ApprovalRow[] };
      setApprovals(json.approvals);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return { approvals, loading, error, refresh: fetchData };
}
