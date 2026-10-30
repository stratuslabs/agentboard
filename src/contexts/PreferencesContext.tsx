'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { normalizeCollapsed, toggleCollapsed, isCollapsed, replayChoices, type CollapsedGroups, type Grouping, groupingPrefKey, mergeGroupings, normalizeGroupings } from '../lib/list-groups';

interface Preferences {
  expandedOrgs: number[];
  starredProducts: number[];
  showAllOrgs: Record<number, boolean>;
  selectedProduct: { productId: number; orgId: number } | null;
  profileMemberId: number | null;
  /** Today hides cards in a Done column (card 206). */
  hideDoneToday: boolean;
  /** Collapsed product groups on the list pages, per list (card 297). */
  collapsedGroups: CollapsedGroups;
  /** How each list page groups its cards, per list; a missing list means product (card 298). */
  listGrouping: Record<string, Grouping>;
}

interface PreferencesContextType {
  prefs: Preferences;
  setExpandedOrgs: (ids: number[]) => void;
  toggleExpandedOrg: (orgId: number) => void;
  toggleStarredProduct: (productId: number) => void;
  isStarred: (productId: number) => boolean;
  setSelectedProduct: (productId: number, orgId: number) => void;
  setShowAllOrg: (orgId: number, showAll: boolean) => void;
  setProfileMemberId: (id: number) => void;
  setHideDoneToday: (hide: boolean) => void;
  toggleCollapsedGroup: (list: string, key: string) => void;
  setListGrouping: (list: string, grouping: Grouping) => void;
  isLoaded: boolean;
}

const DEFAULT_PREFS: Preferences = {
  expandedOrgs: [],
  starredProducts: [],
  showAllOrgs: {},
  selectedProduct: null,
  profileMemberId: null,
  hideDoneToday: false,
  collapsedGroups: {},
  listGrouping: {},
};

const LS_KEYS = {
  expandedOrgs: 'agentboard-expanded-orgs',
  starredProducts: 'agentboard-starred-products',
  showAllOrgs: 'agentboard-show-all-orgs',
  selectedProduct: 'agentboard-selected',
  profileMemberId: 'agentboard-profile-member-id',
  hideDoneToday: 'agentboard-hide-done-today',
  collapsedGroups: 'agentboard-collapsed-groups',
  // Local cache only. The server keeps one key per list, see groupingPrefKey.
  listGrouping: 'agentboard-list-grouping',
} as const;

const SERVER_KEYS = LS_KEYS; // Same keys used on server

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const PreferencesContext = createContext<PreferencesContextType | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  // Read from localStorage immediately for fast first render
  const [prefs, setPrefs] = useState<Preferences>(() => ({
    expandedOrgs: readLS(LS_KEYS.expandedOrgs, []),
    starredProducts: readLS(LS_KEYS.starredProducts, []),
    showAllOrgs: readLS(LS_KEYS.showAllOrgs, {}),
    selectedProduct: readLS(LS_KEYS.selectedProduct, null),
    profileMemberId: readLS(LS_KEYS.profileMemberId, null),
    hideDoneToday: readLS<unknown>(LS_KEYS.hideDoneToday, false) === true,
    collapsedGroups: normalizeCollapsed(readLS<unknown>(LS_KEYS.collapsedGroups, {})),
    listGrouping: normalizeGroupings(readLS<unknown>(LS_KEYS.listGrouping, {})),
  }));
  const [isLoaded, setIsLoaded] = useState(false);
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatches = useRef<Record<string, unknown>>({});
  // Keys changed locally since mount. The initial GET may carry an older server
  // value for these, so it must not overwrite them.
  const touched = useRef<Set<string>>(new Set());
  // Collapsed-group choices made before the initial GET lands. They are replayed onto
  // the server's value when it arrives, and nothing is saved until then, so an early
  // click neither snaps back nor wipes groups collapsed in another browser. If the GET
  // fails, they stay local for this page load and are never saved.
  const serverLoaded = useRef(false);
  const earlyToggles = useRef<Array<[string, string, boolean]>>([]);

  // Debounced PATCH to server
  const flushToServer = useCallback(() => {
    if (patchTimer.current) clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(() => {
      const patches = { ...pendingPatches.current };
      pendingPatches.current = {};
      for (const [key, value] of Object.entries(patches)) {
        fetch('/api/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        }).catch(() => {});
      }
    }, 300);
  }, []);

  const queuePatch = useCallback((key: string, value: unknown) => {
    pendingPatches.current[key] = value;
    touched.current.add(key);
    flushToServer();
  }, [flushToServer]);

  // Fetch from server on mount, server wins on conflict. A superseded request (React
  // Strict Mode mounts effects twice in development) is aborted, so a stale second
  // response can't land after the first and undo a click made in between.
  useEffect(() => {
    const request = new AbortController();
    fetch('/api/preferences', { signal: request.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`preferences ${r.status}`))))
      .then((received: Record<string, unknown>) => {
        if (request.signal.aborted) return;
        // Computed once, outside the updater, so a double-invoked updater can't replay twice.
        // Early collapse clicks send no PATCH, so this key is never in `touched` here.
        serverLoaded.current = true;
        const early = earlyToggles.current;
        earlyToggles.current = [];
        const collapsed = replayChoices(normalizeCollapsed(received[SERVER_KEYS.collapsedGroups]), early);
        setPrefs((local) => {
          const merged: Preferences = { ...local };
          // Drop keys the user changed while this request was in flight.
          const serverPrefs: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(received)) {
            if (!touched.current.has(key)) serverPrefs[key] = value;
          }

          if (serverPrefs[SERVER_KEYS.expandedOrgs] !== undefined) {
            merged.expandedOrgs = serverPrefs[SERVER_KEYS.expandedOrgs] as number[];
            writeLS(LS_KEYS.expandedOrgs, merged.expandedOrgs);
          }
          if (serverPrefs[SERVER_KEYS.starredProducts] !== undefined) {
            merged.starredProducts = serverPrefs[SERVER_KEYS.starredProducts] as number[];
            writeLS(LS_KEYS.starredProducts, merged.starredProducts);
          }
          if (serverPrefs[SERVER_KEYS.showAllOrgs] !== undefined) {
            merged.showAllOrgs = serverPrefs[SERVER_KEYS.showAllOrgs] as Record<number, boolean>;
            writeLS(LS_KEYS.showAllOrgs, merged.showAllOrgs);
          }
          if (serverPrefs[SERVER_KEYS.selectedProduct] !== undefined) {
            merged.selectedProduct = serverPrefs[SERVER_KEYS.selectedProduct] as { productId: number; orgId: number } | null;
            writeLS(LS_KEYS.selectedProduct, merged.selectedProduct);
          }
          if (serverPrefs[SERVER_KEYS.profileMemberId] !== undefined) {
            merged.profileMemberId = serverPrefs[SERVER_KEYS.profileMemberId] as number | null;
            writeLS(LS_KEYS.profileMemberId, merged.profileMemberId);
          }
          // The server is the authority for this one: no row means the default.
          // The local cache is unscoped, so on a shared browser it may hold another
          // user's choice, and hiding cards that user never hid is worse than a flash.
          if (!touched.current.has(SERVER_KEYS.hideDoneToday)) {
            merged.hideDoneToday = serverPrefs[SERVER_KEYS.hideDoneToday] === true;
            writeLS(LS_KEYS.hideDoneToday, merged.hideDoneToday);
          }
          // Also server-authoritative, with early clicks replayed on top (see above).
          merged.collapsedGroups = collapsed;
          writeLS(LS_KEYS.collapsedGroups, collapsed);
          // Server-authoritative per list, except lists changed while this was in flight.
          merged.listGrouping = mergeGroupings(local.listGrouping, received, touched.current);
          writeLS(LS_KEYS.listGrouping, merged.listGrouping);

          return merged;
        });
        if (early.length) queuePatch(SERVER_KEYS.collapsedGroups, collapsed);
        setIsLoaded(true);
      })
      .catch(() => {
        if (request.signal.aborted) return;
        // Keep the local state. Collapse clicks stay local for this page load: the
        // local cache was never merged with the server value, so saving it could
        // wipe groups collapsed in another browser. serverLoaded stays false.
        setIsLoaded(true); // Even on error, mark loaded so app works with localStorage data
      });
    return () => request.abort();
  }, [queuePatch]);

  const updatePref = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    writeLS(LS_KEYS[key], value);
    queuePatch(SERVER_KEYS[key], value);
  }, [queuePatch]);

  const setExpandedOrgs = useCallback((ids: number[]) => {
    updatePref('expandedOrgs', ids);
  }, [updatePref]);

  const toggleExpandedOrg = useCallback((orgId: number) => {
    setPrefs((prev) => {
      const set = new Set(prev.expandedOrgs);
      if (set.has(orgId)) set.delete(orgId); else set.add(orgId);
      const next = [...set];
      writeLS(LS_KEYS.expandedOrgs, next);
      queuePatch(SERVER_KEYS.expandedOrgs, next);
      return { ...prev, expandedOrgs: next };
    });
  }, [queuePatch]);

  const toggleStarredProduct = useCallback((productId: number) => {
    setPrefs((prev) => {
      const set = new Set(prev.starredProducts);
      if (set.has(productId)) set.delete(productId); else set.add(productId);
      const next = [...set];
      writeLS(LS_KEYS.starredProducts, next);
      queuePatch(SERVER_KEYS.starredProducts, next);
      return { ...prev, starredProducts: next };
    });
  }, [queuePatch]);

  const isStarred = useCallback((productId: number) => {
    return prefs.starredProducts.includes(productId);
  }, [prefs.starredProducts]);

  const setSelectedProduct = useCallback((productId: number, orgId: number) => {
    const value = { productId, orgId };
    updatePref('selectedProduct', value);
  }, [updatePref]);

  const setShowAllOrg = useCallback((orgId: number, showAll: boolean) => {
    setPrefs((prev) => {
      const next = { ...prev.showAllOrgs, [orgId]: showAll };
      writeLS(LS_KEYS.showAllOrgs, next);
      queuePatch(SERVER_KEYS.showAllOrgs, next);
      return { ...prev, showAllOrgs: next };
    });
  }, [queuePatch]);

  const setProfileMemberId = useCallback((id: number) => {
    updatePref('profileMemberId', id);
  }, [updatePref]);

  const setHideDoneToday = useCallback((hide: boolean) => {
    updatePref('hideDoneToday', hide);
  }, [updatePref]);

  const toggleCollapsedGroup = useCallback((list: string, key: string) => {
    const early = !serverLoaded.current;
    setPrefs((prev) => {
      const next = toggleCollapsed(prev.collapsedGroups, list, key);
      // Record what the user now sees, so the replay keeps it even where the
      // server disagrees with the local cache. Idempotent if the updater reruns.
      if (early) earlyToggles.current.push([list, key, isCollapsed(next, list, key)]);
      writeLS(LS_KEYS.collapsedGroups, next);
      if (!early) queuePatch(SERVER_KEYS.collapsedGroups, next);
      return { ...prev, collapsedGroups: next };
    });
  }, [queuePatch]);

  const setListGrouping = useCallback((list: string, grouping: Grouping) => {
    setPrefs((prev) => {
      const next = { ...prev.listGrouping, [list]: grouping };
      writeLS(LS_KEYS.listGrouping, next);
      return { ...prev, listGrouping: next };
    });
    queuePatch(groupingPrefKey(list), grouping);
  }, [queuePatch]);

  return (
    <PreferencesContext.Provider value={{
      prefs,
      setExpandedOrgs,
      toggleExpandedOrg,
      toggleStarredProduct,
      isStarred,
      setSelectedProduct,
      setShowAllOrg,
      setProfileMemberId,
      setHideDoneToday,
      toggleCollapsedGroup,
      setListGrouping,
      isLoaded,
    }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}
