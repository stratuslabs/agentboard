"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { usePreferences } from "@/contexts/PreferencesContext";
import { SearchX } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";
import { Button, EmptyState, PageLoader } from "@/components/ui";

const KanbanBoard = dynamic(() => import("@/components/KanbanBoard"), {
  ssr: false,
  loading: () => <PageLoader />,
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
    return <PageLoader />;
  }

  if (notFound || !product) {
    return (
      <div className="flex flex-1 items-center justify-center pb-20">
        <EmptyState
          icon={<SearchX />}
          title="Product not found"
          body={<>The product at /{orgSlug}/{productSlug} doesn&apos;t exist.</>}
          action={<Button variant="primary" onClick={() => router.push("/")}>Go home</Button>}
        />
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
