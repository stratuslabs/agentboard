"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, CloudOff, LayoutGrid, SearchX, Star } from "lucide-react";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useSidebar } from "../../../contexts/SidebarContext";
import { pageTitle, useDocumentTitle } from "../../../lib/page-title";
import { Button, EmptyState, IconButton, PageLoader } from "../../../components/ui";

interface OrgData {
  id: number;
  name: string;
  slug: string;
}

interface ProductData {
  id: number;
  name: string;
  slug: string;
  emoji: string;
  /** The product's card key, the AB in AB-142. Null until it has one. */
  key?: string | null;
}

/**
 * An organization's page, /<orgSlug>: every product in the org, each linking
 * to its board. The org name in a board's breadcrumb links here.
 */
export default function OrgPage() {
  const params = useParams();
  const router = useRouter();
  const { isMobile } = useSidebar();
  const { isStarred, toggleStarredProduct } = usePreferences();
  const orgSlug = params.orgSlug as string;
  // What was loaded, and for which slug: moving to another org's page shows
  // the loader until that org's own data arrives, never the previous org's.
  const [loaded, setLoaded] = useState<{ slug: string; org: OrgData | null; products: ProductData[]; failed?: boolean } | null>(null);
  const current = loaded?.slug === orgSlug ? loaded : null;
  const org = current?.org ?? null;
  const products = current?.products ?? [];

  useDocumentTitle(pageTitle(org?.name));

  useEffect(() => {
    if (!orgSlug) return;
    let cancelled = false;
    const settle = (org: OrgData | null, products: ProductData[] = [], failed = false) => {
      if (!cancelled) setLoaded({ slug: orgSlug, org, products, failed });
    };
    (async () => {
      try {
        const orgsRes = await fetch("/api/orgs");
        if (!orgsRes.ok) throw new Error(`orgs ${orgsRes.status}`);
        const orgs: OrgData[] = await orgsRes.json();
        const found = orgs.find((o) => o.slug === orgSlug);
        if (!found) return settle(null);
        const productsRes = await fetch(`/api/products?org_id=${found.id}`);
        if (!productsRes.ok) throw new Error(`products ${productsRes.status}`);
        settle(found, await productsRes.json());
      } catch {
        settle(null, [], true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  if (!current) return <PageLoader />;

  if (current.failed) {
    return (
      <div className="flex flex-1 items-center justify-center pb-20">
        <EmptyState
          icon={<CloudOff />}
          title="Couldn't load this organization"
          body="Check your connection and try again."
          action={<Button variant="primary" onClick={() => window.location.reload()}>Try again</Button>}
        />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="flex flex-1 items-center justify-center pb-20">
        <EmptyState
          icon={<SearchX />}
          title="Organization not found"
          body={<>There&apos;s no organization at /{orgSlug}.</>}
          action={<Button variant="primary" onClick={() => router.push("/")}>Go home</Button>}
        />
      </div>
    );
  }

  return (
    <div data-org-page className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-8 max-md:px-4">
        {isMobile && (
          <IconButton onClick={() => router.push("/")} title="Back" aria-label="Back" size={28} className="-ml-1.5">
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
        )}
        <h1 className="min-w-0 truncate text-base font-semibold tracking-[-0.2px] text-text-1">{org.name}</h1>
        <span className="shrink-0 font-mono text-[11.5px] text-text-3">
          {products.length} {products.length === 1 ? "product" : "products"}
        </span>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-8 py-7 max-md:px-4">
        {products.length === 0 ? (
          <EmptyState
            className="flex-1 pb-20"
            icon={<LayoutGrid />}
            title="No products yet"
            body="Add one from the organization's menu in the sidebar."
          />
        ) : (
          <ul className="flex max-w-[880px] flex-col gap-1">
            {products.map((product) => {
              const starred = isStarred(product.id);
              return (
                <li key={product.id} className="group flex h-11 items-center gap-1 rounded-lg border border-border bg-surface-1 pr-1.5 transition-colors hover:border-border-strong hover:bg-surface-2">
                  <Link href={`/${org.slug}/${product.slug}`} className="flex h-full min-w-0 flex-1 items-center gap-3 pl-3.5">
                    <span className="shrink-0 text-[15px]">{product.emoji}</span>
                    <span className="min-w-0 truncate text-[13.5px] text-text-1">{product.name}</span>
                    {product.key && <span className="shrink-0 font-mono text-[11.5px] text-text-4">{product.key}</span>}
                    <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-text-4" />
                  </Link>
                  <IconButton onClick={() => toggleStarredProduct(product.id)} size={28} aria-pressed={starred}
                    className={starred ? "text-text-1" : "text-text-3"}
                    title={starred ? "Unstar" : "Star"} aria-label={starred ? `Unstar ${product.name}` : `Star ${product.name}`}>
                    <Star className="h-3.5 w-3.5" fill={starred ? "currentColor" : "none"} />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
