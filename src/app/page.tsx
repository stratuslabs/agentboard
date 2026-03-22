"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import Sidebar from "@/components/Sidebar";
import ListView from "@/components/ListView";
import ProfileSetup from "@/components/ProfileSetup";
import { usePreferences } from "@/contexts/PreferencesContext";

const KanbanBoard = dynamic(() => import("@/components/KanbanBoard"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-gray-500 text-sm">Loading board...</div>
    </div>
  ),
});

interface Org {
  id: number;
  name: string;
  slug: string;
}

interface Product {
  id: number;
  org_id: number;
  name: string;
  slug: string;
  emoji: string;
}

type ViewType = "today" | "assigned";

interface ViewCard {
  id: number;
  column_id: number;
  title: string;
  description: string;
  assignee: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  assignee_type: string | null;
  assignee_color: string | null;
  priority: string;
  labels: string;
  github_issue_url: string | null;
  github_pr_url: string | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  org_name: string;
  product_name: string;
  product_emoji: string;
  board_name: string;
  column_name: string;
  column_color: string;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export default function HomePage() {
  const { prefs, setSelectedProduct } = usePreferences();
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("agentboard-sidebar-collapsed") === "true"; } catch { return false; }
  });
  const [selectedProduct, setSelectedProductLocal] = useState<Product | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
  const [isRestoring, setIsRestoring] = useState(() => !!prefs.selectedProduct);
  const [activeView, setActiveView] = useState<ViewType | null>(null);
  const [viewCards, setViewCards] = useState<ViewCard[]>([]);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);

  // On mobile, don't auto-restore product selection (show sidebar first)
  useEffect(() => {
    if (isMobile && isRestoring) {
      setIsRestoring(false);
    }
  }, [isMobile, isRestoring]);

  // Fetch first human member for "assigned to me"
  useEffect(() => {
    fetch("/api/members")
      .then((r) => r.json())
      .then((members: { id: number; type: string }[]) => {
        const human = members.find((m) => m.type === "human");
        if (human) setCurrentMemberId(human.id);
      })
      .catch(() => {});
  }, []);

  const loadViewCards = useCallback(async (view: ViewType) => {
    let url = `/api/cards/views?view=${view}`;
    if (view === "assigned" && currentMemberId) {
      url += `&member_id=${currentMemberId}`;
    }
    const res = await fetch(url);
    if (res.ok) {
      setViewCards(await res.json());
    }
  }, [currentMemberId]);

  useEffect(() => {
    if (activeView) {
      loadViewCards(activeView);
    }
  }, [activeView, loadViewCards]);

  function handleSelectProduct(product: Product, org: Org) {
    setSelectedProductLocal(product);
    setSelectedOrg(org);
    setIsRestoring(false);
    setActiveView(null);
    setSelectedProduct(product.id, org.id);
  }

  function handleSelectView(view: ViewType) {
    setActiveView(view);
    setSelectedProductLocal(null);
    setSelectedOrg(null);
    setIsRestoring(false);
  }

  function handleMobileBack() {
    setSelectedProductLocal(null);
    setSelectedOrg(null);
    setActiveView(null);
    setIsRestoring(false);
  }

  // Determine if we have an active content view (product or list view)
  const hasContent = !!(activeView || (selectedProduct && selectedOrg));

  // On mobile: show sidebar OR content, not both
  // On desktop: show sidebar + content side by side
  const showSidebar = isMobile ? !hasContent : true;
  const showContent = isMobile ? hasContent : true;

  return (
    <div className="h-screen flex overflow-hidden bg-surface-900">
      <ProfileSetup />
      {showSidebar && (
        <Sidebar
          collapsed={isMobile ? false : sidebarCollapsed}
          onToggle={() => {
            const next = !sidebarCollapsed;
            setSidebarCollapsed(next);
            try { localStorage.setItem("agentboard-sidebar-collapsed", String(next)); } catch {}
          }}
          selectedProductId={activeView ? null : (selectedProduct?.id ?? null)}
          onSelectProduct={handleSelectProduct}
          onSelectView={handleSelectView}
          selectedView={activeView}
          isMobile={isMobile}
        />
      )}

      {showContent && (
        <>
          {activeView ? (
            <ListView
              key={activeView}
              cards={viewCards}
              title={activeView === "today" ? "Today" : "Assigned to me"}
              icon={activeView === "today" ? "\u{1F4C5}" : "\u{1F464}"}
              onRefresh={() => loadViewCards(activeView)}
              onBack={isMobile ? handleMobileBack : undefined}
            />
          ) : selectedProduct && selectedOrg ? (
            <KanbanBoard
              key={selectedProduct.id}
              productId={selectedProduct.id}
              orgName={selectedOrg.name}
              productName={selectedProduct.name}
              productEmoji={selectedProduct.emoji}
              onBack={isMobile ? handleMobileBack : undefined}
            />
          ) : !isMobile ? (
            isRestoring ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-8 bg-white/80 rounded-sm animate-pulse" />
                    <div className="w-2 h-6 bg-white/40 rounded-sm animate-pulse [animation-delay:150ms]" />
                    <div className="w-2 h-4 bg-white/20 rounded-sm animate-pulse [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-surface-800 border border-surface-600 flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-8 h-8 text-gray-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
                      />
                    </svg>
                  </div>
                  <h2 className="text-lg font-medium text-gray-400 mb-1">
                    Select a product
                  </h2>
                  <p className="text-sm text-gray-600">
                    Choose a product from the sidebar to view its boards
                  </p>
                </div>
              </div>
            )
          ) : null}
        </>
      )}
    </div>
  );
}
