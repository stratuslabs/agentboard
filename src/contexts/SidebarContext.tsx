'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface SidebarContextType {
  collapsed: boolean;
  toggleCollapsed: () => void;
  isMobile: boolean;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

/**
 * A phone: narrower than 768px. BoardLayout's max-[768px]: classes compile to
 * this same query, so CSS and isMobile never disagree about a width.
 */
export const PHONE_QUERY = 'not all and (min-width: 768px)';

const COLLAPSED_KEY = 'agentboard-sidebar-collapsed';

function storedCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // A desktop shows the stored collapse from the first render, as it always
  // has. A phone reads it with isMobile instead: its first render has to be the
  // full sidebar the server sent, or "/" flashes the 52px rail before isMobile
  // is known (AB-155). The collapse only applies once the window is wide again.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return !window.matchMedia(PHONE_QUERY).matches && storedCollapsed(); } catch { return false; }
  });
  const [isMobile, setIsMobile] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    setIsMobile(mq.matches);
    setCollapsed(storedCollapsed());
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, toggleCollapsed, isMobile, mobileSidebarOpen, setMobileSidebarOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
