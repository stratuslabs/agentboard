"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useSidebar } from "@/contexts/SidebarContext";

const KanbanBoard = dynamic(() => import("@/components/KanbanBoard"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-gray-500 text-sm">Loading board...</div>
    </div>
  ),
});

interface ProductData {
  id: number;
  org_id: number;
  name: string;
  slug: string;
  emoji: string;
  org_name: string;
  org_slug: string;
}

export default function ProductBoardPage() {
  const params = useParams();
  const router = useRouter();
  const { setSelectedProduct } = usePreferences();
  const { isMobile } = useSidebar();
  const [product, setProduct] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const orgSlug = params.orgSlug as string;
  const productSlug = params.productSlug as string;

  useEffect(() => {
    if (!orgSlug || !productSlug) return;

    fetch(`/api/products/by-slug?org_slug=${encodeURIComponent(orgSlug)}&product_slug=${encodeURIComponent(productSlug)}`)
      .then((res) => {
        if (!res.ok) {
          setNotFound(true);
          setLoading(false);
          return null;
        }
        return res.json();
      })
      .then((data: ProductData | null) => {
        if (data) {
          setProduct(data);
          setLoading(false);
          // Save as last selected product
          setSelectedProduct(data.id, data.org_id);
        }
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [orgSlug, productSlug, setSelectedProduct]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2 h-8 bg-white/80 rounded-sm animate-pulse" />
            <div className="w-2 h-6 bg-white/40 rounded-sm animate-pulse [animation-delay:150ms]" />
            <div className="w-2 h-4 bg-white/20 rounded-sm animate-pulse [animation-delay:300ms]" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-800 border border-surface-600 flex items-center justify-center mx-auto mb-4 text-2xl">
            🔍
          </div>
          <h2 className="text-lg font-medium text-gray-400 mb-1">Product not found</h2>
          <p className="text-sm text-gray-600 mb-4">
            The product at /{orgSlug}/{productSlug} doesn&apos;t exist.
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  return (
    <KanbanBoard
      key={product.id}
      productId={product.id}
      orgName={product.org_name}
      productName={product.name}
      productEmoji={product.emoji}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
