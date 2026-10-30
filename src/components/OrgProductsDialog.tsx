"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pin, Star, X } from "lucide-react";
import { usePreferences } from "../contexts/PreferencesContext";
import { Dialog, IconButton } from "./ui";

export interface OrgProductsDialogProduct {
  id: number;
  name: string;
  slug: string;
  emoji: string;
}

interface OrgProductsDialogProps {
  org: { id: number; name: string; slug: string };
  /** The org's products, when the caller already has them. Fetched otherwise. */
  products?: OrgProductsDialogProduct[];
  onClose: () => void;
  /**
   * Runs before a product link navigates. Call preventDefault to handle it in
   * place, such as the product already on screen.
   */
  onProductClick?: (e: React.MouseEvent<HTMLAnchorElement>, product: OrgProductsDialogProduct) => void;
}

/** An org's "All products" list, opened from the sidebar's org menu or a card page's org crumb. */
export default function OrgProductsDialog({ org, products, onClose, onProductClick }: OrgProductsDialogProps) {
  const { prefs, toggleStarredProduct } = usePreferences();
  const starredProducts = new Set(prefs.starredProducts);
  const [fetched, setFetched] = useState<OrgProductsDialogProduct[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (products) return;
    let live = true;
    fetch(`/api/products?org_id=${org.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows) => { if (live) setFetched(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [products, org.id]);

  const list = products ?? fetched;

  return (
    <Dialog onClose={onClose} z={50} className="flex max-h-[70vh] w-[340px] flex-col rounded-xl">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border pr-2.5 pl-4">
        <h3 className="text-[13px] font-semibold text-text-1">{org.name}</h3>
        <span className="flex-1 text-[13px] text-text-3">All products</span>
        <IconButton onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="flex flex-1 flex-col gap-px overflow-y-auto p-1.5">
        {list === null && !failed && (
          <div className="py-6 text-center text-[13px] text-text-3">Loading…</div>
        )}
        {failed && (
          <div role="alert" className="py-6 text-center text-[13px] text-text-3">Couldn&apos;t load this organization&apos;s products.</div>
        )}
        {list !== null && list.length === 0 && (
          <div className="py-6 text-center text-[13px] text-text-3">No products yet</div>
        )}
        {list?.map((product) => {
          const starred = starredProducts.has(product.id);
          return (
            <div key={product.id} className="flex h-9 items-center gap-2.5 rounded-[7px] pr-2 pl-3 transition-colors hover:bg-surface-3">
              <Link
                href={`/${encodeURIComponent(org.slug)}/${encodeURIComponent(product.slug)}`}
                onClick={(e) => {
                  onProductClick?.(e, product);
                  onClose();
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <span className="shrink-0 text-[15px]">{product.emoji}</span>
                <span className="truncate text-[13px] text-text-1">{product.name}</span>
              </Link>
              <IconButton onClick={() => toggleStarredProduct(product.id)} aria-label={starred ? "Unstar" : "Star"} aria-pressed={starred}
                className={starred ? "text-text-1" : "text-text-3"}>
                <Star className="h-[15px] w-[15px]" fill={starred ? "currentColor" : "none"} />
              </IconButton>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-4 py-2.5">
        <Pin className="h-3 w-3 text-text-3" />
        <p className="text-[11.5px] text-text-3">Star products to pin them in the sidebar</p>
      </div>
    </Dialog>
  );
}
