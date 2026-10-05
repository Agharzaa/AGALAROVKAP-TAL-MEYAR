import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, requestKey, type CommandInput } from './api';
import type { CommandResult } from '../contracts/commands';
import type { Query } from '../contracts/queries';

export interface Loaded<T> {
  data: T | undefined;
  error: string;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs a read query and keeps it fresh: it reloads when its parameters change and after any
 * change to the same company. Out-of-order responses are discarded.
 */
export function useQuery<T>(query: Query | null): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(query !== null);
  const sequence = useRef(0);
  const serialized = query ? JSON.stringify(query) : '';
  const load = useCallback(() => {
    if (!serialized) return;
    const id = ++sequence.current;
    setLoading(true);
    api
      .query<T>(JSON.parse(serialized) as Query)
      .then((value) => {
        if (id !== sequence.current) return;
        setData(value);
        setError('');
      })
      .catch((e: Error) => {
        if (id === sequence.current) setError(e.message);
      })
      .finally(() => {
        if (id === sequence.current) setLoading(false);
      });
  }, [serialized]);
  useEffect(() => {
    load();
  }, [load]);
  const companyId = query && 'companyId' in query ? query.companyId : '';
  useEffect(
    () =>
      api.onChanged((changed) => {
        if (!companyId || changed === companyId) load();
      }),
    [companyId, load],
  );
  return { data, error, loading, reload: load };
}

export interface Mutation {
  busy: boolean;
  error: ApiError | null;
  run: (command: CommandInput) => Promise<CommandResult | null>;
  clear: () => void;
}

/**
 * Executes commands one at a time. A second call while one is in flight is ignored, and a
 * retry after a failure reuses nothing: every deliberate submit gets its own idempotency key.
 */
export function useMutation(): Mutation {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const locked = useRef(false);
  const run = useCallback(async (command: CommandInput) => {
    if (locked.current) return null;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      return await api.command(command, requestKey());
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e
          : new ApiError({ message: (e as Error).message, code: 'internal' }),
      );
      return null;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(null) };
}
