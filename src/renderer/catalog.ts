import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import type { Catalog, CompanyView } from '../contracts/queries';

/**
 * Shared, self-refreshing cache of each company's reference data (partners, accounts,
 * products…). Every window of a company reads the same copy; any change reloads it once.
 */
interface Entry {
  data?: Catalog;
  error?: string;
  loading: boolean;
  revision: number;
  listeners: Set<() => void>;
}
const entries = new Map<string, Entry>();
let unsubscribe: (() => void) | undefined;

function entry(companyId: string): Entry {
  let e = entries.get(companyId);
  if (!e) {
    e = { loading: false, revision: 0, listeners: new Set() };
    entries.set(companyId, e);
  }
  return e;
}
function notify(e: Entry) {
  e.revision++;
  for (const l of e.listeners) l();
}
export function reloadCatalog(companyId: string): Promise<void> {
  const e = entry(companyId);
  e.loading = true;
  notify(e);
  return api
    .query<Catalog>({ type: 'catalog', companyId })
    .then((data) => {
      e.data = data;
      e.error = undefined;
    })
    .catch((error: Error) => {
      e.error = error.message;
    })
    .finally(() => {
      e.loading = false;
      notify(e);
    });
}
function ensureSubscription() {
  if (unsubscribe) return;
  unsubscribe = api.onChanged((companyId) => {
    if (entries.has(companyId)) void reloadCatalog(companyId);
  });
}
/** Test hook: forget cached companies between test cases. */
export function resetCatalogs() {
  entries.clear();
  unsubscribe?.();
  unsubscribe = undefined;
}

export function useCatalog(companyId: string | undefined): {
  company: CompanyView | undefined;
  catalog: Catalog | undefined;
  error: string | undefined;
  loading: boolean;
} {
  const e = companyId ? entry(companyId) : undefined;
  useSyncExternalStore(
    (listener) => {
      if (!e) return () => {};
      e.listeners.add(listener);
      return () => {
        e.listeners.delete(listener);
      };
    },
    () => e?.revision ?? -1,
  );
  useEffect(() => {
    if (!companyId) return;
    ensureSubscription();
    const current = entry(companyId);
    if (!current.data && !current.loading) void reloadCatalog(companyId);
  }, [companyId]);
  return {
    company: e?.data?.company,
    catalog: e?.data,
    error: e?.error,
    loading: e?.loading ?? false,
  };
}
