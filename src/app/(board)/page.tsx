"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Columns3 } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";
import { EmptyState, PageLoader } from "@/components/ui";

export default function HomePage() {
  const router = useRouter();
  const { prefs, isLoaded } = usePreferences();
  const { isMobile } = useSidebar();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isLoaded || isMobile) {
      // On mobile, "/" is the sidebar view — don't redirect
      setChecked(true);
      return;
    }

    // On desktop, try to restore the last selected product
    if (prefs.selectedProduct) {
      const { productId, orgId } = prefs.selectedProduct;
      // Fetch the org and product to get their slugs
      Promise.all([
        fetch("/api/orgs").then((r) => r.json()),
        fetch(`/api/products?org_id=${orgId}`).then((r) => r.json()),
      ])
        .then(([orgs, products]) => {
          const org = orgs.find((o: { id: number }) => o.id === orgId);
          const product = products.find((p: { id: number }) => p.id === productId);
          if (org && product) {
            router.replace(`/${org.slug}/${product.slug}`);
          } else {
            setChecked(true);
          }
        })
        .catch(() => setChecked(true));
    } else {
      setChecked(true);
    }
  }, [isLoaded, isMobile, prefs.selectedProduct, router]);

  // On mobile, this page is never visible (sidebar shows instead via layout)
  if (isMobile) return null;

  // Show loading while restoring
  if (!checked) {
    return <PageLoader />;
  }

  // Desktop empty state
  return (
    <div className="flex flex-1 items-center justify-center pb-20">
      <EmptyState
        icon={<Columns3 />}
        title="Select a product"
        body="Choose a product from the sidebar to view its boards"
      />
    </div>
  );
}
