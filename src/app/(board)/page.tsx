"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePreferences } from "../../contexts/PreferencesContext";
import { Columns3 } from "lucide-react";
import { PHONE_QUERY, useSidebar } from "../../contexts/SidebarContext";
import { EmptyState, PageLoader } from "../../components/ui";
import { restoreLastProduct } from "../../lib/home-restore.js";

export default function HomePage() {
  const router = useRouter();
  const { prefs, isLoaded } = usePreferences();
  const { isMobile } = useSidebar();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isLoaded) {
      setChecked(true);
      return;
    }
    // On a phone "/" is the sidebar view and never redirects. isMobile alone
    // isn't enough: after a client-side navigation from Settings the frame
    // mounts with this page, and this effect runs before the frame's has set
    // isMobile (AB-160). The query is what isMobile reads, so ask it too.
    return restoreLastProduct({
      onPhone: isMobile || window.matchMedia(PHONE_QUERY).matches,
      selected: prefs.selectedProduct,
      fetchJson: (url) => fetch(url).then((r) => r.json()),
      go: (path) => router.replace(path),
      stay: () => setChecked(true),
    });
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
