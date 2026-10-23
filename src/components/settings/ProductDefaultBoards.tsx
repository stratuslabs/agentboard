"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Select } from "../ui";

interface Org { id: number; name: string }
interface Product { id: number; org_id: number; name: string; slug: string; emoji: string; default_board_id?: number | null }
interface Board { id: number; name: string; slug: string; position: number }
interface Row { product: Product; boards: Board[] }

type RowState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/**
 * One row per product: the board an agent lands on when it doesn't name one
 * (no --board, no AGENTBOARD_BOARD). Changes save immediately.
 */
export default function ProductDefaultBoards() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [states, setStates] = useState<Record<number, RowState>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [orgList, products] = await Promise.all([
          fetch("/api/orgs").then((r) => r.json()) as Promise<Org[]>,
          fetch("/api/products").then((r) => r.json()) as Promise<Product[]>,
        ]);
        const withBoards = await Promise.all(
          products.map(async (product) => {
            const boards: Board[] = await fetch(`/api/boards?product_id=${product.id}`).then((r) => r.json());
            boards.sort((a, b) => a.position - b.position);
            return { product, boards };
          }),
        );
        if (!cancelled) { setOrgs(orgList); setRows(withBoards); }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function setRowState(productId: number, state: RowState) {
    setStates((s) => ({ ...s, [productId]: state }));
  }

  async function change(productId: number, value: string) {
    if (!rows) return;
    const next = value === "" ? null : Number(value);
    const previous = rows.find((r) => r.product.id === productId)?.product.default_board_id ?? null;
    const apply = (id: number | null) =>
      setRows((rs) => rs && rs.map((r) => (r.product.id === productId ? { ...r, product: { ...r.product, default_board_id: id } } : r)));
    apply(next);
    setRowState(productId, { kind: "saving" });
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_board_id: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      setRowState(productId, { kind: "saved" });
      setTimeout(() => setStates((s) => (s[productId]?.kind === "saved" ? { ...s, [productId]: { kind: "idle" } } : s)), 2000);
    } catch (e) {
      apply(previous);
      setRowState(productId, { kind: "error", message: e instanceof Error ? e.message : "Save failed" });
    }
  }

  if (loadError) return <div role="alert" className="text-xs text-danger">Couldn&apos;t load products.</div>;
  if (!rows) return <div className="text-xs text-text-3">Loading…</div>;
  if (rows.length === 0) return <div className="text-xs text-text-3">No products yet.</div>;

  const orgName = (id: number) => orgs.find((o) => o.id === id)?.name;
  const showOrg = new Set(rows.map((r) => r.product.org_id)).size > 1;

  return (
    <>
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface-1">
        {rows.map(({ product, boards }) => {
          const state = states[product.id] ?? { kind: "idle" };
          const selectId = `default-board-${product.id}`;
          const errorId = `${selectId}-error`;
          return (
            <div key={product.id} className="border-b border-border px-3 py-2 last:border-b-0">
              <div className="flex min-h-9 items-center gap-2.5">
                <span className="shrink-0 text-[15px]" aria-hidden>{product.emoji}</span>
                <label htmlFor={selectId} className="min-w-0 flex-1 truncate text-[13.5px] text-text-1">
                  {product.name}
                  {showOrg && <span className="ml-1.5 text-text-4">{orgName(product.org_id)}</span>}
                </label>
                {state.kind === "saving" && <span className="text-xs text-text-3">Saving…</span>}
                {state.kind === "saved" && <span className="inline-flex items-center gap-1 text-xs text-text-3"><Check className="h-3 w-3" />Saved</span>}
                <Select
                  id={selectId}
                  selectSize="sm"
                  className="w-48 shrink-0"
                  value={product.default_board_id == null ? "" : String(product.default_board_id)}
                  onChange={(e) => change(product.id, e.target.value)}
                  disabled={state.kind === "saving" || boards.length === 0}
                  aria-invalid={state.kind === "error" || undefined}
                  aria-describedby={state.kind === "error" ? errorId : undefined}
                >
                  <option value="">{boards.length === 1 ? "Automatic (only board)" : "No default"}</option>
                  {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </div>
              {state.kind === "error" && (
                <p id={errorId} role="alert" className="mt-1 text-xs text-danger">{state.message}</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-4">
        Agents use this board when they don&apos;t name one. <code>--board</code> or <code>AGENTBOARD_BOARD</code> still overrides it.
        With no default, a product with several boards asks the agent to pick one.
      </p>
    </>
  );
}
