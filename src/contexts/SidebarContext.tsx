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

/** Marks the <style> SIDEBAR_PRELOAD adds, so BoardLayout can remove it once hydrated. */
export const SIDEBAR_PRELOAD_STYLE = 'data-agentboard-sidebar-preload';

/**
 * An inline script BoardLayout puts in the server's HTML ahead of the sidebar.
 * The server can't read a collapse saved in localStorage, so it sends both the
 * full sidebar and the hidden 52px rail (AB-157). If a collapse is saved, this
 * adds a style to <head> that shows the rail and hides the full sidebar on a
 * desktop, before either one paints. A phone always gets the full sidebar.
 * React leaves an unknown <style> in <head> alone, so hydration still matches.
 * The breakpoint is PHONE_QUERY's, and :root lifts each rule above one class.
 */
export const SIDEBAR_PRELOAD =
  `try{if(localStorage.getItem(${JSON.stringify(COLLAPSED_KEY)})==="true"){` +
  `var s=document.createElement("style");s.setAttribute(${JSON.stringify(SIDEBAR_PRELOAD_STYLE)},"");` +
  `s.textContent='@media (min-width: 768px){:root [data-sidebar-form="rail"]{display:flex}:root [data-sidebar-form="full"]{display:none}}';` +
  `document.head.appendChild(s)}}catch(e){}`;

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // A desktop has the stored collapse from the first render. While the page
  // hydrates BoardLayout ignores it and draws both forms, since the server's
  // HTML can't know it (AB-157); after a client-side navigation it shows at
  // once. A phone reads it with isMobile instead, so "/" never draws the 52px
  // rail before isMobile is known (AB-155). The collapse only applies once the
  // window is wide again.
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
