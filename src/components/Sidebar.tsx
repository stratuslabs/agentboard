"use client";

import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Org {
  id: number;
  name: string;
  slug: string;
  position: number;
}

interface Product {
  id: number;
  org_id: number;
  name: string;
  slug: string;
  emoji: string;
  position: number;
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedProductId: number | null;
  onSelectProduct: (product: Product, org: Org) => void;
}

// --- Sortable Org Item ---
function SortableOrgItem({
  org,
  expanded,
  onToggle,
  onContextMenu,
  isEditing,
  editingName,
  onEditChange,
  onEditSubmit,
  onEditCancel,
}: {
  org: Org;
  expanded: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  isEditing: boolean;
  editingName: string;
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `org-${org.id}` });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style} className="px-3 py-1">
        <input
          type="text"
          value={editingName}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditSubmit();
            if (e.key === "Escape") onEditCancel();
          }}
          onBlur={onEditSubmit}
          className="w-full px-2 py-1 text-xs font-semibold bg-surface-700 border border-surface-500 rounded text-white uppercase tracking-wider focus:outline-none focus:ring-1 focus:ring-accent"
          autoFocus
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center">
      <button
        {...attributes}
        {...listeners}
        className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing shrink-0 ml-1"
        title="Drag to reorder"
      >
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
        </svg>
      </button>
      <button
        onClick={onToggle}
        onContextMenu={onContextMenu}
        className="flex items-center gap-2 flex-1 px-1 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
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
    </div>
  );
}

// --- Sortable Product Item ---
function SortableProductItem({
  product,
  org,
  isSelected,
  onSelect,
  onContextMenu,
  isEditing,
  editingName,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  emojiPickerOpen,
  onEmojiToggle,
  onEmojiChange,
}: {
  product: Product;
  org: Org;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  isEditing: boolean;
  editingName: string;
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  emojiPickerOpen: boolean;
  onEmojiToggle: () => void;
  onEmojiChange: (emoji: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `product-${product.id}` });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style} className="px-4 py-1 mx-1">
        <input
          type="text"
          value={editingName}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditSubmit();
            if (e.key === "Escape") onEditCancel();
          }}
          onBlur={onEditSubmit}
          className="w-full px-2 py-1 text-sm bg-surface-700 border border-surface-500 rounded text-white focus:outline-none focus:ring-1 focus:ring-accent"
          autoFocus
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="relative flex items-center mx-1" >
      <button
        {...attributes}
        {...listeners}
        className="w-4 h-6 flex items-center justify-center text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing shrink-0"
        title="Drag to reorder"
      >
        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
        </svg>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onEmojiToggle(); }}
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-surface-600 transition-colors text-base leading-none"
        title="Change emoji"
      >
        {product.emoji}
      </button>
      <button
        onClick={onSelect}
        onContextMenu={onContextMenu}
        className={`flex-1 text-left px-2 py-1.5 text-sm rounded-md transition-colors truncate ${
          isSelected ? "bg-accent/20 text-white" : "text-gray-300 hover:bg-surface-700 hover:text-white"
        }`}
      >
        {product.name}
      </button>
      {emojiPickerOpen && (
        <div className="absolute left-0 top-8 z-50 bg-surface-700 border border-surface-500 rounded-lg shadow-xl p-2 w-[200px]">
          <input
            type="text"
            placeholder="Paste emoji..."
            className="w-full px-2 py-1 mb-2 text-sm bg-surface-600 border border-surface-500 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Escape") onEmojiToggle(); }}
            onChange={(e) => { const val = e.target.value.trim(); if (val) onEmojiChange(val); }}
          />
          <div className="grid grid-cols-6 gap-1">
            {["📦","🧶","🌙","⭐","🎨","📋","🚀","💡","🔧","📊","🎯","🛡️","💬","📝","🔥","🌐","💰","📱"].map((em) => (
              <button key={em} onClick={() => onEmojiChange(em)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-600 transition-colors text-base">{em}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main Sidebar ---
export default function Sidebar({ collapsed, onToggle, selectedProductId, onSelectProduct }: SidebarProps) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [productsByOrg, setProductsByOrg] = useState<Record<number, Product[]>>({});
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
  const [emojiPickerProductId, setEmojiPickerProductId] = useState<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => { loadOrgs(); }, []);

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
      if (pRes.ok) prodMap[org.id] = await pRes.json();
    }
    setExpandedOrgs(expanded);
    setProductsByOrg(prodMap);
  }

  function toggleOrg(orgId: number) {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId); else next.add(orgId);
      return next;
    });
  }

  async function handleAddOrg() {
    if (!addingOrgName.trim()) return;
    const res = await fetch("/api/orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: addingOrgName.trim() }) });
    if (res.ok) { setAddingOrgName(""); setShowAddOrg(false); loadOrgs(); }
  }

  async function handleAddProduct(orgId: number) {
    if (!addingProductName.trim()) return;
    const res = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: orgId, name: addingProductName.trim() }) });
    if (res.ok) {
      setAddingProductName(""); setAddingProductOrg(null);
      const pRes = await fetch(`/api/products?org_id=${orgId}`);
      if (pRes.ok) setProductsByOrg((prev) => ({ ...prev, [orgId]: [] }));
      if (pRes.ok) { const products = await pRes.json(); setProductsByOrg((prev) => ({ ...prev, [orgId]: products })); }
    }
  }

  async function handleLogout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }

  async function handleRenameOrg(orgId: number) {
    if (!editingOrgName.trim()) { setEditingOrgId(null); return; }
    const res = await fetch(`/api/orgs/${orgId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingOrgName.trim() }) });
    if (res.ok) { setEditingOrgId(null); setEditingOrgName(""); loadOrgs(); }
  }

  async function handleDeleteOrg(orgId: number) {
    if (!confirm("Delete this organization and all its products?")) return;
    const res = await fetch(`/api/orgs/${orgId}`, { method: "DELETE" });
    if (res.ok) loadOrgs();
  }

  async function handleRenameProduct(productId: number, orgId: number) {
    if (!editingProductName.trim()) { setEditingProductId(null); return; }
    const res = await fetch(`/api/products/${productId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingProductName.trim() }) });
    if (res.ok) {
      setEditingProductId(null); setEditingProductName("");
      const pRes = await fetch(`/api/products?org_id=${orgId}`);
      if (pRes.ok) { const products = await pRes.json(); setProductsByOrg((prev) => ({ ...prev, [orgId]: products })); }
    }
  }

  async function handleDeleteProduct(productId: number, orgId: number) {
    if (!confirm("Delete this product and all its boards/cards?")) return;
    const res = await fetch(`/api/products/${productId}`, { method: "DELETE" });
    if (res.ok) {
      const pRes = await fetch(`/api/products?org_id=${orgId}`);
      if (pRes.ok) { const products = await pRes.json(); setProductsByOrg((prev) => ({ ...prev, [orgId]: products })); }
    }
  }

  async function handleChangeEmoji(productId: number, orgId: number, emoji: string) {
    const res = await fetch(`/api/products/${productId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }) });
    if (res.ok) {
      const pRes = await fetch(`/api/products?org_id=${orgId}`);
      if (pRes.ok) { const products = await pRes.json(); setProductsByOrg((prev) => ({ ...prev, [orgId]: products })); }
    }
    setEmojiPickerProductId(null);
  }

  function handleContextMenu(e: React.MouseEvent, type: "org" | "product", id: number, orgId?: number) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type, id, orgId });
  }

  useEffect(() => {
    function handleClick() { setContextMenu(null); }
    if (contextMenu) { window.addEventListener("click", handleClick); return () => window.removeEventListener("click", handleClick); }
  }, [contextMenu]);

  // Drag end handler for orgs
  async function handleOrgDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = parseInt(String(active.id).replace("org-", ""), 10);
    const overId = parseInt(String(over.id).replace("org-", ""), 10);
    const oldIndex = orgs.findIndex((o) => o.id === activeId);
    const newIndex = orgs.findIndex((o) => o.id === overId);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrgs = arrayMove(orgs, oldIndex, newIndex);
    setOrgs(newOrgs);
    await fetch("/api/orgs/reorder", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: newOrgs.map((o) => o.id) }) });
  }

  // Drag end handler for products within an org
  async function handleProductDragEnd(orgId: number, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const products = productsByOrg[orgId] || [];
    const activeId = parseInt(String(active.id).replace("product-", ""), 10);
    const overId = parseInt(String(over.id).replace("product-", ""), 10);
    const oldIndex = products.findIndex((p) => p.id === activeId);
    const newIndex = products.findIndex((p) => p.id === overId);
    if (oldIndex === -1 || newIndex === -1) return;
    const newProducts = arrayMove(products, oldIndex, newIndex);
    setProductsByOrg((prev) => ({ ...prev, [orgId]: newProducts }));
    await fetch("/api/products/reorder", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: newProducts.map((p) => p.id) }) });
  }

  if (collapsed) {
    return (
      <div className="w-12 bg-surface-800 border-r border-surface-600 flex flex-col items-center py-3 sidebar-transition shrink-0">
        <button onClick={onToggle} className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm hover:bg-accent-hover transition-colors" title="Expand sidebar">A</button>
        <div className="flex-1" />
        <button onClick={handleLogout} className="w-8 h-8 rounded-lg hover:bg-surface-600 flex items-center justify-center text-gray-400 transition-colors" title="Logout">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="w-64 bg-surface-800 border-r border-surface-600 flex flex-col sidebar-transition shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-600">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm">A</div>
          <span className="font-semibold text-white text-sm">AgentBoard</span>
        </div>
        <button onClick={onToggle} className="w-6 h-6 rounded hover:bg-surface-600 flex items-center justify-center text-gray-400 transition-colors" title="Collapse sidebar">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
        </button>
      </div>

      {/* Org/Product tree */}
      <div className="flex-1 overflow-y-auto py-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleOrgDragEnd}>
          <SortableContext items={orgs.map((o) => `org-${o.id}`)} strategy={verticalListSortingStrategy}>
            {orgs.map((org) => (
              <div key={org.id} className="mb-1">
                <SortableOrgItem
                  org={org}
                  expanded={expandedOrgs.has(org.id)}
                  onToggle={() => toggleOrg(org.id)}
                  onContextMenu={(e) => handleContextMenu(e, "org", org.id)}
                  isEditing={editingOrgId === org.id}
                  editingName={editingOrgName}
                  onEditChange={setEditingOrgName}
                  onEditSubmit={() => handleRenameOrg(org.id)}
                  onEditCancel={() => { setEditingOrgId(null); setEditingOrgName(""); }}
                />

                {expandedOrgs.has(org.id) && (
                  <div className="ml-2">
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleProductDragEnd(org.id, e)}>
                      <SortableContext items={(productsByOrg[org.id] || []).map((p) => `product-${p.id}`)} strategy={verticalListSortingStrategy}>
                        {(productsByOrg[org.id] || []).map((product) => (
                          <SortableProductItem
                            key={product.id}
                            product={product}
                            org={org}
                            isSelected={selectedProductId === product.id}
                            onSelect={() => onSelectProduct(product, org)}
                            onContextMenu={(e) => handleContextMenu(e, "product", product.id, org.id)}
                            isEditing={editingProductId === product.id}
                            editingName={editingProductName}
                            onEditChange={setEditingProductName}
                            onEditSubmit={() => handleRenameProduct(product.id, org.id)}
                            onEditCancel={() => { setEditingProductId(null); setEditingProductName(""); }}
                            emojiPickerOpen={emojiPickerProductId === product.id}
                            onEmojiToggle={() => setEmojiPickerProductId(emojiPickerProductId === product.id ? null : product.id)}
                            onEmojiChange={(emoji) => handleChangeEmoji(product.id, org.id, emoji)}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>

                    {addingProductOrg === org.id ? (
                      <div className="px-4 py-1 mx-1">
                        <input type="text" value={addingProductName} onChange={(e) => setAddingProductName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddProduct(org.id); if (e.key === "Escape") { setAddingProductOrg(null); setAddingProductName(""); } }}
                          onBlur={() => { if (!addingProductName.trim()) setAddingProductOrg(null); }}
                          className="w-full px-2 py-1 text-sm bg-surface-700 border border-surface-500 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
                          placeholder="Product name" autoFocus />
                      </div>
                    ) : (
                      <button onClick={() => setAddingProductOrg(org.id)}
                        className="flex items-center gap-1.5 w-full px-4 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors mx-1"
                        style={{ width: "calc(100% - 8px)" }}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        Add product
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </SortableContext>
        </DndContext>

        {/* Add org */}
        {showAddOrg ? (
          <div className="px-3 py-1">
            <input type="text" value={addingOrgName} onChange={(e) => setAddingOrgName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddOrg(); if (e.key === "Escape") { setShowAddOrg(false); setAddingOrgName(""); } }}
              onBlur={() => { if (!addingOrgName.trim()) setShowAddOrg(false); }}
              className="w-full px-2 py-1 text-sm bg-surface-700 border border-surface-500 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Organization name" autoFocus />
          </div>
        ) : (
          <button onClick={() => setShowAddOrg(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors w-full">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add organization
          </button>
        )}
      </div>

      {/* Logout */}
      <div className="border-t border-surface-600 px-3 py-2">
        <button onClick={handleLogout} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-surface-700 rounded-md transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          Logout
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-50 bg-surface-700 border border-surface-500 rounded-lg shadow-xl py-1 min-w-[140px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            onClick={() => {
              if (contextMenu.type === "org") { const org = orgs.find((o) => o.id === contextMenu.id); setEditingOrgId(contextMenu.id); setEditingOrgName(org?.name || ""); }
              else { const products = Object.values(productsByOrg).flat(); const product = products.find((p) => p.id === contextMenu.id); setEditingProductId(contextMenu.id); setEditingProductName(product?.name || ""); }
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-surface-600 hover:text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Rename
          </button>
          <button
            onClick={() => {
              if (contextMenu.type === "org") handleDeleteOrg(contextMenu.id);
              else handleDeleteProduct(contextMenu.id, contextMenu.orgId!);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-400 hover:bg-red-400/10 hover:text-red-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
