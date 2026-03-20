"use client";

import { useState, useEffect } from "react";

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

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedProductId: number | null;
  onSelectProduct: (product: Product, org: Org) => void;
}

export default function Sidebar({
  collapsed,
  onToggle,
  selectedProductId,
  onSelectProduct,
}: SidebarProps) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [productsByOrg, setProductsByOrg] = useState<Record<number, Product[]>>(
    {}
  );
  const [expandedOrgs, setExpandedOrgs] = useState<Set<number>>(new Set());
  const [addingOrgName, setAddingOrgName] = useState("");
  const [showAddOrg, setShowAddOrg] = useState(false);
  const [addingProductOrg, setAddingProductOrg] = useState<number | null>(null);
  const [addingProductName, setAddingProductName] = useState("");
  const [editingOrgId, setEditingOrgId] = useState<number | null>(null);
  const [editingOrgName, setEditingOrgName] = useState("");
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [editingProductName, setEditingProductName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: "org" | "product"; id: number; orgId?: number } | null>(null);

  useEffect(() => {
    loadOrgs();
  }, []);

  async function loadOrgs() {
    const res = await fetch("/api/orgs");
    if (!res.ok) return;
    const data: Org[] = await res.json();
    setOrgs(data);

    const expanded = new Set<number>();
    const prodMap: Record<number, Product[]> = {};

    for (const org of data) {
      expanded.add(org.id);
      const pRes = await fetch(`/api/products?org_id=${org.id}`);
      if (pRes.ok) {
        prodMap[org.id] = await pRes.json();
      }
    }

    setExpandedOrgs(expanded);
    setProductsByOrg(prodMap);
  }

  function toggleOrg(orgId: number) {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  }

  async function handleAddOrg() {
    if (!addingOrgName.trim()) return;
    const res = await fetch("/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: addingOrgName.trim() }),
    });
    if (res.ok) {
      setAddingOrgName("");
      setShowAddOrg(false);
      loadOrgs();
    }
  }

  async function handleAddProduct(orgId: number) {
    if (!addingProductName.trim()) return;
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_id: orgId, name: addingProductName.trim() }),
    });
    if (res.ok) {
      setAddingProductName("");
      setAddingProductOrg(null);
      const pRes = await fetch(`/api/products?org_id=${orgId}`);
      if (pRes.ok) {
        setProductsByOrg((prev) => ({ ...prev, [orgId]: pRes.ok ? [] : prev[orgId] }));
        const products = await pRes.json();
        setProductsByOrg((prev) => ({ ...prev, [orgId]: products }));
      }
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function handleRenameOrg(orgId: number) {
    if (!editingOrgName.trim()) { setEditingOrgId(null); return; }
    const res = await fetch(`/api/orgs/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingOrgName.trim() }),
    });
    if (res.ok) {
      setEditingOrgId(null);
      setEditingOrgName("");
      loadOrgs();
    }
  }

  async function handleDeleteOrg(orgId: number) {
    if (!confirm("Delete this organization and all its products?")) return;
    const res = await fetch(`/api/orgs/${orgId}`, { method: "DELETE" });
    if (res.ok) loadOrgs();
  }

  async function handleRenameProduct(productId: number, orgId: number) {
    if (!editingProductName.trim()) { setEditingProductId(null); return; }
    const res = await fetch(`/api/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingProductName.trim() }),
    });
    if (res.ok) {
      setEditingProductId(null);
      setEditingProductName("");
      const pRes = await fetch(`/api/products?org_id=${orgId}`);
      if (pRes.ok) {
        setProductsByOrg((prev) => ({ ...prev, [orgId]: [] }));
        const products = await pRes.json();
        setProductsByOrg((prev) => ({ ...prev, [orgId]: products }));
      }
    }
  }

  async function handleDeleteProduct(productId: number, orgId: number) {
    if (!confirm("Delete this product and all its boards/cards?")) return;
    const res = await fetch(`/api/products/${productId}`, { method: "DELETE" });
    if (res.ok) {
      const pRes = await fetch(`/api/products?org_id=${orgId}`);
      if (pRes.ok) {
        const products = await pRes.json();
        setProductsByOrg((prev) => ({ ...prev, [orgId]: products }));
      }
    }
  }

  function handleContextMenu(e: React.MouseEvent, type: "org" | "product", id: number, orgId?: number) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type, id, orgId });
  }

  // Close context menu on click anywhere
  useEffect(() => {
    function handleClick() { setContextMenu(null); }
    if (contextMenu) {
      window.addEventListener("click", handleClick);
      return () => window.removeEventListener("click", handleClick);
    }
  }, [contextMenu]);

  if (collapsed) {
    return (
      <div className="w-12 bg-surface-800 border-r border-surface-600 flex flex-col items-center py-3 sidebar-transition shrink-0">
        <button
          onClick={onToggle}
          className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm hover:bg-accent-hover transition-colors"
          title="Expand sidebar"
        >
          A
        </button>
        <div className="flex-1" />
        <button
          onClick={handleLogout}
          className="w-8 h-8 rounded-lg hover:bg-surface-600 flex items-center justify-center text-gray-400 transition-colors"
          title="Logout"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="w-64 bg-surface-800 border-r border-surface-600 flex flex-col sidebar-transition shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-600">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm">
            A
          </div>
          <span className="font-semibold text-white text-sm">AgentBoard</span>
        </div>
        <button
          onClick={onToggle}
          className="w-6 h-6 rounded hover:bg-surface-600 flex items-center justify-center text-gray-400 transition-colors"
          title="Collapse sidebar"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          </svg>
        </button>
      </div>

      {/* Org/Product tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {orgs.map((org) => (
          <div key={org.id} className="mb-1">
            {editingOrgId === org.id ? (
              <div className="px-3 py-1">
                <input
                  type="text"
                  value={editingOrgName}
                  onChange={(e) => setEditingOrgName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameOrg(org.id);
                    if (e.key === "Escape") { setEditingOrgId(null); setEditingOrgName(""); }
                  }}
                  onBlur={() => handleRenameOrg(org.id)}
                  className="w-full px-2 py-1 text-xs font-semibold bg-surface-700 border border-surface-500 rounded text-white uppercase tracking-wider focus:outline-none focus:ring-1 focus:ring-accent"
                  autoFocus
                />
              </div>
            ) : (
            <button
              onClick={() => toggleOrg(org.id)}
              onContextMenu={(e) => handleContextMenu(e, "org", org.id)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors"
            >
              <svg
                className={`w-3 h-3 transition-transform ${
                  expandedOrgs.has(org.id) ? "rotate-90" : ""
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              {org.name}
            </button>
            )}

            {expandedOrgs.has(org.id) && (
              <div className="ml-2">
                {(productsByOrg[org.id] || []).map((product) => (
                  editingProductId === product.id ? (
                    <div key={product.id} className="px-4 py-1 mx-1" style={{ width: "calc(100% - 8px)" }}>
                      <input
                        type="text"
                        value={editingProductName}
                        onChange={(e) => setEditingProductName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameProduct(product.id, org.id);
                          if (e.key === "Escape") { setEditingProductId(null); setEditingProductName(""); }
                        }}
                        onBlur={() => handleRenameProduct(product.id, org.id)}
                        className="w-full px-2 py-1 text-sm bg-surface-700 border border-surface-500 rounded text-white focus:outline-none focus:ring-1 focus:ring-accent"
                        autoFocus
                      />
                    </div>
                  ) : (
                  <button
                    key={product.id}
                    onClick={() => onSelectProduct(product, org)}
                    onContextMenu={(e) => handleContextMenu(e, "product", product.id, org.id)}
                    className={`flex items-center gap-2 w-full px-4 py-1.5 text-sm rounded-md mx-1 transition-colors ${
                      selectedProductId === product.id
                        ? "bg-accent/20 text-white"
                        : "text-gray-300 hover:bg-surface-700 hover:text-white"
                    }`}
                    style={{ width: "calc(100% - 8px)" }}
                  >
                    <span className="text-base leading-none">
                      {product.emoji}
                    </span>
                    <span className="truncate">{product.name}</span>
                  </button>
                  )
                ))}

                {addingProductOrg === org.id ? (
                  <div className="px-4 py-1 mx-1">
                    <input
                      type="text"
                      value={addingProductName}
                      onChange={(e) => setAddingProductName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddProduct(org.id);
                        if (e.key === "Escape") {
                          setAddingProductOrg(null);
                          setAddingProductName("");
                        }
                      }}
                      onBlur={() => {
                        if (!addingProductName.trim()) {
                          setAddingProductOrg(null);
                        }
                      }}
                      className="w-full px-2 py-1 text-sm bg-surface-700 border border-surface-500 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
                      placeholder="Product name"
                      autoFocus
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingProductOrg(org.id)}
                    className="flex items-center gap-1.5 w-full px-4 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors mx-1"
                    style={{ width: "calc(100% - 8px)" }}
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    Add product
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Add org */}
        {showAddOrg ? (
          <div className="px-3 py-1">
            <input
              type="text"
              value={addingOrgName}
              onChange={(e) => setAddingOrgName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddOrg();
                if (e.key === "Escape") {
                  setShowAddOrg(false);
                  setAddingOrgName("");
                }
              }}
              onBlur={() => {
                if (!addingOrgName.trim()) setShowAddOrg(false);
              }}
              className="w-full px-2 py-1 text-sm bg-surface-700 border border-surface-500 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Organization name"
              autoFocus
            />
          </div>
        ) : (
          <button
            onClick={() => setShowAddOrg(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors w-full"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add organization
          </button>
        )}
      </div>

      {/* Logout */}
      <div className="border-t border-surface-600 px-3 py-2">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-surface-700 rounded-md transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Logout
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-surface-700 border border-surface-500 rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              if (contextMenu.type === "org") {
                const org = orgs.find((o) => o.id === contextMenu.id);
                setEditingOrgId(contextMenu.id);
                setEditingOrgName(org?.name || "");
              } else {
                const products = Object.values(productsByOrg).flat();
                const product = products.find((p) => p.id === contextMenu.id);
                setEditingProductId(contextMenu.id);
                setEditingProductName(product?.name || "");
              }
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-surface-600 hover:text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Rename
          </button>
          <button
            onClick={() => {
              if (contextMenu.type === "org") {
                handleDeleteOrg(contextMenu.id);
              } else {
                handleDeleteProduct(contextMenu.id, contextMenu.orgId!);
              }
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-400 hover:bg-red-400/10 hover:text-red-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
