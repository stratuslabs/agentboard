'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { normalizeCollapsed, toggleCollapsed, type CollapsedGroups } from '../lib/list-groups';

interface Preferences {
  expandedOrgs: number[];
  starredProducts: number[];
  showAllOrgs: Record<number, boolean>;
  selectedProduct: { productId: number; orgId: number } | null;
  profileMemberId: number | null;
  /** Collapsed product groups on the list pages, per list (card 297). */
  collapsedGroups: CollapsedGroups;
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
  toggleCollapsedGroup: (list: string, key: string) => void;
  isLoaded: boolean;
}

const DEFAULT_PREFS: Preferences = {
  expandedOrgs: [],
  starredProducts: [],
  showAllOrgs: {},
  selectedProduct: null,
  profileMemberId: null,
  collapsedGroups: {},
};

const LS_KEYS = {
  expandedOrgs: 'agentboard-expanded-orgs',
  starredProducts: 'agentboard-starred-products',
  showAllOrgs: 'agentboard-show-all-orgs',
  selectedProduct: 'agentboard-selected',
  profileMemberId: 'agentboard-profile-member-id',
  collapsedGroups: 'agentboard-collapsed-groups',
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
    collapsedGroups: normalizeCollapsed(readLS<unknown>(LS_KEYS.collapsedGroups, {})),
  }));
  const [isLoaded, setIsLoaded] = useState(false);
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatches = useRef<Record<string, unknown>>({});

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
    flushToServer();
  }, [flushToServer]);

  // Fetch from server on mount, server wins on conflict
  useEffect(() => {
    fetch('/api/preferences')
      .then((r) => r.json())
      .then((serverPrefs: Record<string, unknown>) => {
        setPrefs((local) => {
          const merged: Preferences = { ...local };

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
          // The server is the authority: no row means nothing collapsed. The local
          // cache is unscoped, so on a shared browser it may hold another user's choice.
          merged.collapsedGroups = normalizeCollapsed(serverPrefs[SERVER_KEYS.collapsedGroups]);
          writeLS(LS_KEYS.collapsedGroups, merged.collapsedGroups);

          return merged;
        });
        setIsLoaded(true);
      })
      .catch(() => {
        setIsLoaded(true); // Even on error, mark loaded so app works with localStorage data
      });
  }, []);

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

  const toggleCollapsedGroup = useCallback((list: string, key: string) => {
    setPrefs((prev) => {
      const next = toggleCollapsed(prev.collapsedGroups, list, key);
      writeLS(LS_KEYS.collapsedGroups, next);
      queuePatch(SERVER_KEYS.collapsedGroups, next);
      return { ...prev, collapsedGroups: next };
    });
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
      toggleCollapsedGroup,
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
