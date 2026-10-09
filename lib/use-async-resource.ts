import { useCallback, useEffect, useRef, useState } from 'react';
import { messageOf } from '@/store/useBovineStore';

export interface AsyncResource<T> {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads data with `fetcher` (keep it stable with useCallback) and exposes a Retry.
 * A request sequence guards against slow responses replacing newer ones or arriving after unmount.
 */
export function useAsyncResource<T>(fetcher: () => Promise<T>, fallbackError: string): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const id = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const result = await fetcher();
      if (id === sequence.current) setData(result);
    } catch (caught) {
      console.error(fallbackError, caught);
      if (id === sequence.current) setError(messageOf(caught, fallbackError));
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }, [fallbackError, fetcher]);

  useEffect(() => {
    void reload();
    const ref = sequence;
    return () => {
      ref.current += 1;
    };
  }, [reload]);

  return { data, error, loading, reload };
}
