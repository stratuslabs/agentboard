"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Sidebar from "@/components/Sidebar";

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

function loadStarred(): Set<number> {
  if (typeof window === "undefined") return new Set();
  try { const saved = localStorage.getItem("agentboard-starred-products"); return saved ? new Set(JSON.parse(saved)) : new Set(); } catch { return new Set(); }
}

function saveStarred(starred: Set<number>) {
  try { localStorage.setItem("agentboard-starred-products", JSON.stringify([...starred])); } catch {}
}

function hasSavedSelection(): boolean {
  if (typeof window === "undefined") return false;
  try { return !!localStorage.getItem("agentboard-selected"); } catch { return false; }
}

export default function HomePage() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
  const [starredProducts, setStarredProducts] = useState<Set<number>>(loadStarred);
  const [isRestoring, setIsRestoring] = useState(hasSavedSelection);

  function handleSelectProduct(product: Product, org: Org) {
    setSelectedProduct(product);
    setSelectedOrg(org);
    setIsRestoring(false);
    try { localStorage.setItem("agentboard-selected", JSON.stringify({ productId: product.id, orgId: org.id })); } catch {}
  }

  const toggleStar = useCallback((productId: number) => {
    setStarredProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      saveStarred(next);
      return next;
    });
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-surface-900">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        selectedProductId={selectedProduct?.id ?? null}
        onSelectProduct={handleSelectProduct}
        starredProducts={starredProducts}
        onToggleStar={toggleStar}
      />

      {selectedProduct && selectedOrg ? (
        <KanbanBoard
          key={selectedProduct.id}
          productId={selectedProduct.id}
          orgName={selectedOrg.name}
          productName={selectedProduct.name}
          productEmoji={selectedProduct.emoji}
          isStarred={starredProducts.has(selectedProduct.id)}
          onToggleStar={() => toggleStar(selectedProduct.id)}
        />
      ) : isRestoring ? (
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
      )}
    </div>
  );
}
