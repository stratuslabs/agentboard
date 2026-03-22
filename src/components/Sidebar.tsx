"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
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
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import dynamic from "next/dynamic";
import ConfirmModal from "./ConfirmModal";
import { usePreferences } from "@/contexts/PreferencesContext";

const EmojiPicker = dynamic(() => import("./EmojiPicker"), { ssr: false, loading: () => <div className="absolute left-0 top-8 z-50 bg-surface-700 border border-surface-500 rounded-lg shadow-xl p-4 text-xs text-gray-400">Loading...</div> });

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
  isMobile?: boolean;
}

// --- Sortable Org Header ---
function SortableOrgHeader({ org, expanded, onToggle, onContextMenu, isEditing, editingName, onEditChange, onEditSubmit, onEditCancel, onMenuClick, menuOpen }: {
  org: Org; expanded: boolean; onToggle: () => void; onContextMenu: (e: React.MouseEvent) => void;
  isEditing: boolean; editingName: string; onEditChange: (v: string) => void; onEditSubmit: () => void; onEditCancel: () => void;
  onMenuClick: (e: React.MouseEvent) => void; menuOpen: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `org-${org.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style} className="px-3 py-1">
        <input type="text" value={editingName} onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onEditSubmit(); if (e.key === "Escape") onEditCancel(); }}
          onBlur={onEditSubmit}
          className="w-full px-2 py-1 text-xs font-semibold bg-surface-700 border border-surface-500 rounded text-white uppercase tracking-wider focus:outline-none focus:ring-1 focus:ring-accent" autoFocus />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="group/org flex items-center cursor-default">
      <button onClick={onToggle} onContextMenu={onContextMenu}
        className="flex items-center gap-2 flex-1 px-2 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors">
        <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        {org.name}
      </button>
      <button onClick={onMenuClick}
        className={`w-5 h-5 flex items-center justify-center rounded text-gray-600 hover:text-gray-300 hover:bg-surface-600 transition-colors shrink-0 mr-1 ${menuOpen ? "text-gray-300 bg-surface-600" : "opacity-0 group-hover/org:opacity-100"}`}
        title="More options">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
      </button>
    </div>
  );
}

// --- Droppable Org Zone (for receiving products) ---
function DroppableOrgZone({ orgId, children, isOver }: { orgId: number; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef, isOver: droppableIsOver } = useDroppable({ id: `org-drop-${orgId}` });
  const highlight = isOver || droppableIsOver;
  return (
    <div ref={setNodeRef} className={`ml-2 min-h-[8px] rounded transition-colors ${highlight ? "bg-accent/10 ring-1 ring-accent/30" : ""}`}>
      {children}
    </div>
  );
}

// --- Sortable Product Item ---
function SortableProductItem({ product, isSelected, href, onContextMenu, isEditing, editingName, onEditChange, onEditSubmit, onEditCancel, emojiPickerOpen, onEmojiToggle, onEmojiChange, isStarred, onToggleStar }: {
  product: Product; isSelected: boolean; href: string; onContextMenu: (e: React.MouseEvent) => void;
  isEditing: boolean; editingName: string; onEditChange: (v: string) => void; onEditSubmit: () => void; onEditCancel: () => void;
  emojiPickerOpen: boolean; onEmojiToggle: () => void; onEmojiChange: (emoji: string) => void;
  isStarred: boolean; onToggleStar: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `product-${product.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style} className="px-4 py-1 mx-1">
        <input type="text" value={editingName} onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onEditSubmit(); if (e.key === "Escape") onEditCancel(); }}
          onBlur={onEditSubmit}
          className="w-full px-2 py-1 text-sm bg-surface-700 border border-surface-500 rounded text-white focus:outline-none focus:ring-1 focus:ring-accent" autoFocus />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="group/product relative flex items-center mx-1 cursor-default">
      <button onClick={(e) => { e.stopPropagation(); onEmojiToggle(); }} className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-surface-600 transition-colors text-base leading-none ml-1" title="Change emoji">
        {product.emoji}
      </button>
      <Link href={href} onContextMenu={onContextMenu}
        className={`flex-1 text-left px-2 py-1.5 text-sm rounded-md transition-colors truncate ${isSelected ? "bg-accent/20 text-white" : "text-gray-300 hover:bg-surface-700 hover:text-white"}`}>
        {product.name}
      </Link>
      {emojiPickerOpen && (
        <EmojiPicker onSelect={(emoji) => onEmojiChange(emoji)} onClose={onEmojiToggle} />
      )}
    </div>
  );
}

// --- Getting Started Card ---
function GetStartedCard({ orgs, productsByOrg, members, onAddOrg, onAddProduct }: {
  orgs: Org[];
  productsByOrg: Record<number, Product[]>;
  members: { id: number; name: string; type: string; color: string }[];
  onAddOrg: () => void;
  onAddProduct: (orgId: number) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasOrg = orgs.length > 0;
  const hasProduct = Object.values(productsByOrg).flat().length > 0;
  const hasAgent = members.some((m) => m.type === "agent");

  // Hide entirely once an agent is connected
  if (hasAgent) return null;

  const boardUrl = typeof window !== "undefined" ? window.location.origin : "";

  const prompt = `You're being connected to AgentBoard — a kanban-style project management tool your team uses to track work. Your job is to set yourself up.

## Step 1: Register yourself

Make this API call to register as a team member:

\`\`\`bash
curl -X POST ${boardUrl}/api/members \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $AGENTBOARD_PASSWORD" \\
  -d '{"name": "YOUR_NAME", "type": "agent", "color": "#3B82F6"}'
\`\`\`

Replace YOUR_NAME with your actual name. Pick a color you like from: #EF4444 (red), #F97316 (orange), #EAB308 (yellow), #22C55E (green), #06B6D4 (cyan), #3B82F6 (blue), #8B5CF6 (purple), #EC4899 (pink).

## Step 2: Install the CLI

\`\`\`bash
npm install -g agentboard
\`\`\`

## Step 3: Set your environment variables

Add these to your shell config or agent environment:

\`\`\`bash
export AGENTBOARD_URL="${boardUrl}"
export AGENTBOARD_PASSWORD="<ask your human for the password if you don't have it>"
\`\`\`

## Step 4: Check what's on your plate

\`\`\`bash
agentboard my-tasks --assignee "YOUR_NAME"
\`\`\`

## How to use AgentBoard

\`\`\`bash
# See your assigned tasks
agentboard my-tasks --assignee "YOUR_NAME"

# View a product board
agentboard board --product <slug> --board dev

# Pick up a task (move to in-progress)
agentboard task move <card-id> --column in-progress

# Mark a task done
agentboard task done <card-id>

# Create a new task
agentboard task add --product <slug> --board <board> "Title" \\
  --assignee "YOUR_NAME" --priority medium --description "Details"

# Link GitHub issues/PRs
agentboard task link <card-id> --issue "https://github.com/org/repo/issues/42"
agentboard task link <card-id> --pr "https://github.com/org/repo/pull/15"
\`\`\`

## Your workflow
1. Check your tasks at the start of each session
2. Move tasks to "in-progress" when you start working
3. Move to "done" when complete
4. Create new tasks as you discover work needed

Now do Step 1 — register yourself. Then check if you have any tasks assigned.`;

  function handleCopy() {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="px-3 py-3 border-b border-surface-600">
      <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🚀</span>
          <span className="text-sm font-semibold text-white">Get Started</span>
        </div>

        <div className="space-y-2">
          {/* Step 1: Add org */}
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 ${hasOrg ? "bg-green-500/20 text-green-400" : "bg-surface-600 text-gray-500"}`}>
              {hasOrg ? "✓" : "1"}
            </div>
            {hasOrg ? (
              <span className="text-xs text-gray-500 line-through">Add an organization</span>
            ) : (
              <button onClick={onAddOrg} className="text-xs text-accent hover:text-white transition-colors text-left">
                Add an organization
              </button>
            )}
          </div>

          {/* Step 2: Add product */}
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 ${hasProduct ? "bg-green-500/20 text-green-400" : "bg-surface-600 text-gray-500"}`}>
              {hasProduct ? "✓" : "2"}
            </div>
            {hasProduct ? (
              <span className="text-xs text-gray-500 line-through">Add a product</span>
            ) : hasOrg ? (
              <button onClick={() => onAddProduct(orgs[0].id)} className="text-xs text-accent hover:text-white transition-colors text-left">
                Add a product
              </button>
            ) : (
              <span className="text-xs text-gray-600">Add a product</span>
            )}
          </div>

          {/* Step 3: Connect agent */}
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 bg-surface-600 text-gray-500">
              3
            </div>
            <div className="flex-1 min-w-0">
              {hasProduct ? (
                <button onClick={() => setShowPrompt(!showPrompt)} className="text-xs text-accent hover:text-white transition-colors text-left">
                  Connect your first agent {showPrompt ? "▴" : "▾"}
                </button>
              ) : (
                <span className="text-xs text-gray-600">Connect your first agent</span>
              )}
            </div>
          </div>
        </div>

        {/* Expandable agent prompt */}
        {showPrompt && (
          <div className="mt-3 pt-3 border-t border-accent/20">
            <p className="text-[11px] text-gray-400 mb-2">
              Copy this and paste it to your agent. It&apos;ll handle the rest.
            </p>
            <div className="relative">
              <pre className="bg-surface-900 border border-surface-600 rounded-lg p-2.5 text-[10px] text-gray-400 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                {prompt.slice(0, 300)}...
              </pre>
              <button
                onClick={handleCopy}
                className={`mt-2 w-full px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  copied
                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                    : "bg-accent hover:bg-accent-hover text-white"
                }`}
              >
                {copied ? "✓ Copied to clipboard!" : "Copy full prompt"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main Sidebar ---
export default function Sidebar({ collapsed, onToggle, isMobile }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { prefs, toggleExpandedOrg, setExpandedOrgs, toggleStarredProduct, isStarred, setShowAllOrg } = usePreferences();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [productsByOrg, setProductsByOrg] = useState<Record<number, Product[]>>({});
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
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const [dragOverOrgId, setDragOverOrgId] = useState<number | null>(null);
  const [activeProductDrag, setActiveProductDrag] = useState<Product | null>(null);
  const [orgMenuId, setOrgMenuId] = useState<number | null>(null);
  const [orgMenuPos, setOrgMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [browsingOrgId, setBrowsingOrgId] = useState<number | null>(null);
  const [members, setMembers] = useState<{ id: number; name: string; type: string; color: string }[]>([]);

  const expandedOrgs = new Set(prefs.expandedOrgs);
  const starredProducts = new Set(prefs.starredProducts);
  const showAllProducts = prefs.showAllOrgs;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }));

  useEffect(() => { loadOrgs(); loadMembers(); }, []);

  async function loadMembers() {
    const res = await fetch("/api/members");
    if (res.ok) setMembers(await res.json());
  }

  async function loadOrgs() {
    const res = await fetch("/api/orgs");
    if (!res.ok) return;
    const data: Org[] = await res.json();
    setOrgs(data);
    const prodMap: Record<number, Product[]> = {};
    for (const org of data) {
      const pRes = await fetch(`/api/products?org_id=${org.id}`);
      if (pRes.ok) prodMap[org.id] = await pRes.json();
    }
    // If no expanded orgs preference exists, expand all
    if (prefs.expandedOrgs.length === 0) {
      setExpandedOrgs(data.map((o) => o.id));
    }
    setProductsByOrg(prodMap);
  }

  function toggleOrg(orgId: number) {
    toggleExpandedOrg(orgId);
  }

  function toggleShowAllProducts(orgId: number) {
    setShowAllOrg(orgId, !showAllProducts[orgId]);
  }

  function handleOrgMenuClick(e: React.MouseEvent, orgId: number) {
    e.stopPropagation();
    if (orgMenuId === orgId) { setOrgMenuId(null); return; }
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setOrgMenuPos({ x: rect.left, y: rect.bottom + 4 });
    setOrgMenuId(orgId);
  }

  async function handleAddOrg() {
    if (!addingOrgName.trim()) return;
    const res = await fetch("/api/orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: addingOrgName.trim() }) });
    if (res.ok) { setAddingOrgName(""); setShowAddOrg(false); loadOrgs(); }
  }

  async function handleAddProduct(orgId: number) {
    if (!addingProductName.trim()) return;
    const res = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: orgId, name: addingProductName.trim() }) });
    if (res.ok) { setAddingProductName(""); setAddingProductOrg(null); await refreshProducts(orgId); }
  }

  async function refreshProducts(orgId: number) {
    const pRes = await fetch(`/api/products?org_id=${orgId}`);
    if (pRes.ok) { const products = await pRes.json(); setProductsByOrg((prev) => ({ ...prev, [orgId]: products })); }
  }

  async function handleLogout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }

  async function handleRenameOrg(orgId: number) {
    if (!editingOrgName.trim()) { setEditingOrgId(null); return; }
    await fetch(`/api/orgs/${orgId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingOrgName.trim() }) });
    setEditingOrgId(null); setEditingOrgName(""); loadOrgs();
  }

  function handleDeleteOrg(orgId: number) {
    setConfirmAction({
      title: "Delete Organization",
      message: "This will delete the organization and all its products, boards, and cards.",
      action: async () => { await fetch(`/api/orgs/${orgId}`, { method: "DELETE" }); loadOrgs(); setConfirmAction(null); },
    });
  }

  async function handleRenameProduct(productId: number, orgId: number) {
    if (!editingProductName.trim()) { setEditingProductId(null); return; }
    await fetch(`/api/products/${productId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingProductName.trim() }) });
    setEditingProductId(null); setEditingProductName(""); await refreshProducts(orgId);
  }

  function handleDeleteProduct(productId: number, orgId: number) {
    setConfirmAction({
      title: "Delete Product",
      message: "This will delete the product and all its boards and cards.",
      action: async () => { await fetch(`/api/products/${productId}`, { method: "DELETE" }); await refreshProducts(orgId); setConfirmAction(null); },
    });
  }

  async function handleChangeEmoji(productId: number, orgId: number, emoji: string) {
    await fetch(`/api/products/${productId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }) });
    setEmojiPickerProductId(null); await refreshProducts(orgId);
  }

  function handleContextMenu(e: React.MouseEvent, type: "org" | "product", id: number, orgId?: number) {
    e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, type, id, orgId });
  }

  useEffect(() => {
    function handleClick() { setContextMenu(null); setOrgMenuId(null); }
    if (contextMenu || orgMenuId !== null) { window.addEventListener("click", handleClick); return () => window.removeEventListener("click", handleClick); }
  }, [contextMenu, orgMenuId]);

  // --- Unified drag handlers ---
  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("product-")) {
      const productId = parseInt(id.replace("product-", ""), 10);
      const allProducts = Object.values(productsByOrg).flat();
      const product = allProducts.find((p) => p.id === productId);
      if (product) setActiveProductDrag(product);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    if (!over) { setDragOverOrgId(null); return; }
    const overId = String(over.id);
    if (overId.startsWith("org-drop-")) {
      setDragOverOrgId(parseInt(overId.replace("org-drop-", ""), 10));
    } else if (overId.startsWith("product-")) {
      const productId = parseInt(overId.replace("product-", ""), 10);
      for (const [orgId, products] of Object.entries(productsByOrg)) {
        if (products.find((p) => p.id === productId)) {
          setDragOverOrgId(parseInt(orgId, 10));
          break;
        }
      }
    } else {
      setDragOverOrgId(null);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveProductDrag(null);
    setDragOverOrgId(null);

    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Org reordering
    if (activeId.startsWith("org-") && overId.startsWith("org-")) {
      const activeOrgId = parseInt(activeId.replace("org-", ""), 10);
      const overOrgId = parseInt(overId.replace("org-", ""), 10);
      const oldIndex = orgs.findIndex((o) => o.id === activeOrgId);
      const newIndex = orgs.findIndex((o) => o.id === overOrgId);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrgs = arrayMove(orgs, oldIndex, newIndex);
        setOrgs(newOrgs);
        await fetch("/api/orgs/reorder", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: newOrgs.map((o) => o.id) }) });
      }
      return;
    }

    // Product reordering / moving
    if (activeId.startsWith("product-")) {
      const productId = parseInt(activeId.replace("product-", ""), 10);

      let sourceOrgId: number | null = null;
      for (const [orgId, products] of Object.entries(productsByOrg)) {
        if (products.find((p) => p.id === productId)) { sourceOrgId = parseInt(orgId, 10); break; }
      }
      if (!sourceOrgId) return;

      let targetOrgId: number | null = null;

      if (overId.startsWith("org-drop-")) {
        targetOrgId = parseInt(overId.replace("org-drop-", ""), 10);
      } else if (overId.startsWith("product-")) {
        const overProductId = parseInt(overId.replace("product-", ""), 10);
        for (const [orgId, products] of Object.entries(productsByOrg)) {
          if (products.find((p) => p.id === overProductId)) { targetOrgId = parseInt(orgId, 10); break; }
        }
      }

      if (!targetOrgId) return;

      if (sourceOrgId === targetOrgId) {
        const products = productsByOrg[sourceOrgId] || [];
        const overProductId = parseInt(overId.replace("product-", ""), 10);
        const oldIndex = products.findIndex((p) => p.id === productId);
        const newIndex = products.findIndex((p) => p.id === overProductId);
        if (oldIndex !== -1 && newIndex !== -1) {
          const newProducts = arrayMove(products, oldIndex, newIndex);
          setProductsByOrg((prev) => ({ ...prev, [sourceOrgId]: newProducts }));
          await fetch("/api/products/reorder", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: newProducts.map((p) => p.id) }) });
        }
      } else {
        const sourceProducts = (productsByOrg[sourceOrgId] || []).filter((p) => p.id !== productId);
        const movedProduct = (productsByOrg[sourceOrgId] || []).find((p) => p.id === productId);
        if (!movedProduct) return;

        const targetProducts = [...(productsByOrg[targetOrgId] || []), { ...movedProduct, org_id: targetOrgId }];
        setProductsByOrg((prev) => ({ ...prev, [sourceOrgId]: sourceProducts, [targetOrgId]: targetProducts }));

        // Expand target org if collapsed — update via context
        if (!expandedOrgs.has(targetOrgId)) {
          const next = [...prefs.expandedOrgs, targetOrgId];
          setExpandedOrgs(next);
        }

        await fetch("/api/products/move", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: productId, org_id: targetOrgId, position: targetProducts.length - 1 }) });

        await fetch("/api/products/reorder", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: sourceProducts.map((p) => p.id) }) });
        await fetch("/api/products/reorder", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: targetProducts.map((p) => p.id) }) });
      }
    }
  }

  // Collect all sortable IDs for the unified context
  const allSortableIds: string[] = [];
  for (const org of orgs) {
    allSortableIds.push(`org-${org.id}`);
    for (const product of (productsByOrg[org.id] || [])) {
      allSortableIds.push(`product-${product.id}`);
    }
  }

  if (collapsed && !isMobile) {
    return (
      <div className="w-12 bg-surface-800 border-r border-surface-600 flex flex-col items-center py-3 sidebar-transition shrink-0">
        <button onClick={onToggle} className="w-8 h-8 rounded-lg overflow-hidden hover:opacity-80 transition-opacity" title="Expand sidebar">
          <img src="/icon-192.png" alt="AgentBoard" className="w-full h-full" />
        </button>
        <div className="flex-1" />
        <button onClick={() => router.push("/settings")} className="w-8 h-8 rounded-lg hover:bg-surface-600 flex items-center justify-center text-gray-400 transition-colors mb-1" title="Settings">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>
        <button onClick={handleLogout} className="w-8 h-8 rounded-lg hover:bg-surface-600 flex items-center justify-center text-gray-400 transition-colors" title="Logout">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className={`${isMobile ? "w-full" : "w-64"} bg-surface-800 ${isMobile ? "" : "border-r border-surface-600"} flex flex-col sidebar-transition shrink-0`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-600">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg overflow-hidden"><img src="/icon-192.png" alt="AgentBoard" className="w-full h-full" /></div>
          <span className="font-semibold text-white text-sm">AgentBoard</span>
        </div>
        {!isMobile && (
          <button onClick={onToggle} className="w-6 h-6 rounded hover:bg-surface-600 flex items-center justify-center text-gray-400 transition-colors" title="Collapse sidebar">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        )}
      </div>

      {/* Getting Started — shows until first agent is connected */}
      <GetStartedCard
        orgs={orgs}
        productsByOrg={productsByOrg}
        members={members}
        onAddOrg={() => setShowAddOrg(true)}
        onAddProduct={(orgId) => {
          setAddingProductOrg(orgId);
          setAddingProductName("");
          if (!expandedOrgs.has(orgId)) {
            setExpandedOrgs([...prefs.expandedOrgs, orgId]);
          }
        }}
      />

      {/* Quick views */}
      <div className="px-3 py-2 border-b border-surface-600 space-y-0.5">
        <Link
          href="/today"
          className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md transition-colors ${
            pathname === "/today" ? "bg-accent/20 text-white" : "text-gray-300 hover:bg-surface-700 hover:text-white"
          }`}
        >
          <span className="text-base leading-none">{"\u{1F4C5}"}</span>
          Today
        </Link>
        <Link
          href="/assigned"
          className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md transition-colors ${
            pathname === "/assigned" ? "bg-accent/20 text-white" : "text-gray-300 hover:bg-surface-700 hover:text-white"
          }`}
        >
          <span className="text-base leading-none">{"\u{1F464}"}</span>
          Assigned to me
        </Link>
      </div>

      {/* Org/Product tree */}
      <div className="flex-1 overflow-y-auto py-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <SortableContext items={orgs.map((o) => `org-${o.id}`)} strategy={verticalListSortingStrategy}>
            {orgs.map((org) => {
              const allProducts = productsByOrg[org.id] || [];
              const isShowAll = showAllProducts[org.id] || false;
              const starredInOrg = allProducts.filter((p) => starredProducts.has(p.id));
              // Default: show only starred. Show all if toggled or if no starred products exist
              const visibleProducts = (isShowAll || starredInOrg.length === 0) ? allProducts : starredInOrg;
              return (
              <div key={org.id} className="mb-1">
                <SortableOrgHeader org={org} expanded={expandedOrgs.has(org.id)} onToggle={() => toggleOrg(org.id)}
                  onContextMenu={(e) => handleContextMenu(e, "org", org.id)}
                  isEditing={editingOrgId === org.id} editingName={editingOrgName} onEditChange={setEditingOrgName}
                  onEditSubmit={() => handleRenameOrg(org.id)} onEditCancel={() => { setEditingOrgId(null); setEditingOrgName(""); }}
                  onMenuClick={(e) => handleOrgMenuClick(e, org.id)} menuOpen={orgMenuId === org.id} />

                {expandedOrgs.has(org.id) && (
                  <DroppableOrgZone orgId={org.id} isOver={dragOverOrgId === org.id && activeProductDrag !== null}>
                    {/* Starred-only indicator */}

                    <SortableContext items={visibleProducts.map((p) => `product-${p.id}`)} strategy={verticalListSortingStrategy}>
                      {visibleProducts.map((product) => (
                        <SortableProductItem key={product.id} product={product} isSelected={pathname === `/${org.slug}/${product.slug}`}
                          href={`/${org.slug}/${product.slug}`}
                          onContextMenu={(e) => handleContextMenu(e, "product", product.id, org.id)}
                          isEditing={editingProductId === product.id} editingName={editingProductName} onEditChange={setEditingProductName}
                          onEditSubmit={() => handleRenameProduct(product.id, org.id)} onEditCancel={() => { setEditingProductId(null); setEditingProductName(""); }}
                          emojiPickerOpen={emojiPickerProductId === product.id}
                          onEmojiToggle={() => setEmojiPickerProductId(emojiPickerProductId === product.id ? null : product.id)}
                          onEmojiChange={(emoji) => handleChangeEmoji(product.id, org.id, emoji)}
                          isStarred={starredProducts.has(product.id)}
                          onToggleStar={() => toggleStarredProduct(product.id)} />
                      ))}
                    </SortableContext>

                    {/* Empty drop zone when no products */}
                    {visibleProducts.length === 0 && (
                      <div className="h-6 flex items-center justify-center text-xs text-gray-600 italic">Drop here</div>
                    )}

                    {addingProductOrg === org.id && (
                      <div className="px-4 py-1 mx-1">
                        <input type="text" value={addingProductName} onChange={(e) => setAddingProductName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddProduct(org.id); if (e.key === "Escape") { setAddingProductOrg(null); setAddingProductName(""); } }}
                          onBlur={() => { if (!addingProductName.trim()) setAddingProductOrg(null); }}
                          className="w-full px-2 py-1 text-sm bg-surface-700 border border-surface-500 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
                          placeholder="Product name" autoFocus />
                      </div>
                    )}
                  </DroppableOrgZone>
                )}
              </div>
            ); })}
          </SortableContext>

          <DragOverlay>
            {activeProductDrag && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-700 border border-surface-500 rounded-lg shadow-xl text-sm text-white opacity-90">
                <span>{activeProductDrag.emoji}</span>
                <span>{activeProductDrag.name}</span>
              </div>
            )}
          </DragOverlay>
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

      {/* Settings & Logout */}
      <div className="border-t border-surface-600 px-3 py-2">
        <button onClick={() => router.push("/settings")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-surface-700 rounded-md transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          Settings
        </button>
        <button onClick={handleLogout} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-surface-700 rounded-md transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          Logout
        </button>
      </div>

      {/* Org ellipsis dropdown menu */}
      {orgMenuId !== null && (
        <div className="fixed z-50 bg-surface-700 border border-surface-500 rounded-lg shadow-xl py-1 min-w-[160px]" style={{ left: Math.min(orgMenuPos.x, 200), top: orgMenuPos.y }}>
          <button onClick={(e) => { e.stopPropagation(); setBrowsingOrgId(orgMenuId); setOrgMenuId(null); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-surface-600 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
            Browse all products
          </button>
          <button onClick={(e) => { e.stopPropagation(); const id = orgMenuId; setOrgMenuId(null); setAddingProductOrg(id); setAddingProductName(""); if (!expandedOrgs.has(id)) { const next = [...prefs.expandedOrgs, id]; setExpandedOrgs(next); } }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-surface-600 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add product
          </button>

          <div className="border-t border-surface-600 my-1" />
          <button onClick={(e) => { e.stopPropagation(); const org = orgs.find((o) => o.id === orgMenuId); if (org) { setEditingOrgId(orgMenuId); setEditingOrgName(org.name); } setOrgMenuId(null); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-surface-600 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Rename
          </button>
          <button onClick={(e) => { e.stopPropagation(); handleDeleteOrg(orgMenuId); setOrgMenuId(null); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-400 hover:bg-red-400/10 hover:text-red-300 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Delete
          </button>
        </div>
      )}

      {/* Browse all products overlay */}
      {browsingOrgId !== null && (() => {
        const org = orgs.find((o) => o.id === browsingOrgId);
        const allProducts = productsByOrg[browsingOrgId] || [];
        return createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBrowsingOrgId(null)}>
            <div className="bg-surface-800 border border-surface-600 rounded-xl shadow-2xl w-80 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-600">
                <h3 className="text-sm font-semibold text-white">{org?.name} — All Products</h3>
                <button onClick={() => setBrowsingOrgId(null)} className="w-6 h-6 rounded hover:bg-surface-600 flex items-center justify-center text-gray-400 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {allProducts.length === 0 && (
                  <div className="text-center py-6 text-sm text-gray-500">No products yet</div>
                )}
                {allProducts.map((product) => (
                  <div key={product.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-700 transition-colors">
                    <Link href={`/${org!.slug}/${product.slug}`} onClick={() => setBrowsingOrgId(null)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <span className="text-base shrink-0">{product.emoji}</span>
                      <span className="text-sm text-gray-200 truncate hover:text-white">{product.name}</span>
                    </Link>
                    <button onClick={() => toggleStarredProduct(product.id)}
                      className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${starredProducts.has(product.id) ? "text-yellow-400" : "text-gray-600 hover:text-gray-400"}`}>
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill={starredProducts.has(product.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth={starredProducts.has(product.id) ? 0 : 1.5}>
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t border-surface-600 px-4 py-2">
                <p className="text-[11px] text-gray-500">Star products to pin them in the sidebar</p>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-50 bg-surface-700 border border-surface-500 rounded-lg shadow-xl py-1 min-w-[140px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => {
            if (contextMenu.type === "org") { const org = orgs.find((o) => o.id === contextMenu.id); setEditingOrgId(contextMenu.id); setEditingOrgName(org?.name || ""); }
            else { const products = Object.values(productsByOrg).flat(); const product = products.find((p) => p.id === contextMenu.id); setEditingProductId(contextMenu.id); setEditingProductName(product?.name || ""); }
            setContextMenu(null);
          }} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-surface-600 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Rename
          </button>
          <button onClick={() => {
            if (contextMenu.type === "org") handleDeleteOrg(contextMenu.id);
            else handleDeleteProduct(contextMenu.id, contextMenu.orgId!);
            setContextMenu(null);
          }} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-400 hover:bg-red-400/10 hover:text-red-300 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Delete
          </button>
        </div>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmModal title={confirmAction.title} message={confirmAction.message} onConfirm={confirmAction.action} onCancel={() => setConfirmAction(null)} />
      )}
    </div>
  );
}
