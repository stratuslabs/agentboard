"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DroppableContainer,
  type DroppableContainers,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleUserRound,
  Copy,
  Ellipsis,
  GripVertical,
  List,
  LogOut,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useBoardStream } from "../lib/useBoardStream";
import { announceProductsChanged } from "../lib/products-changed";
import dynamic from "next/dynamic";
import ConfirmModal from "./ConfirmModal";
import OrgProductsDialog from "./OrgProductsDialog";
import { usePreferences } from "../contexts/PreferencesContext";
import { openQuickSearch, searchShortcut } from "../lib/quick-search";
import { agentSetupPrompt as coreSetupPrompt, type AgentSetupPrompt } from "../lib/agent-prompt";
import { Button, IconButton, Logo, MenuDivider, MenuItem, MenuPanel, Wordmark, cx } from "./ui";

const EmojiPicker = dynamic(() => import("./EmojiPicker"), {
  ssr: false,
  loading: () => (
    <div className="absolute top-8 left-0 z-50 rounded-[9px] border border-border-strong bg-surface-2 p-4 text-xs text-text-3 shadow-xl">
      Loading…
    </div>
  ),
});

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
  /**
   * True while the page hydrates: draw both forms, and let BoardLayout's
   * preload style pick the one that shows (AB-157). collapsed then only says
   * which form React keeps afterwards.
   */
  bothForms?: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  /** Rendered above Settings in the expanded sidebar footer. */
  footerSlot?: React.ReactNode;
  /** Rendered above Settings in the collapsed sidebar rail. */
  railSlot?: React.ReactNode;
  /** The setup prompt the get-started card copies for a first agent. */
  agentSetupPrompt?: AgentSetupPrompt;
}

const INLINE_INPUT =
  "w-full h-[29px] rounded-md border border-border-strong bg-surface-2 px-2 text-[13px] text-text-1 placeholder:text-text-3 focus:border-text-4 focus:outline-none";

/** A sidebar row: icon or emoji, label, optional trailing content. */
function NavLink({ href, icon, label, active, trailing, tone = "default" }: {
  href: string; icon: React.ReactNode; label: string; active: boolean; trailing?: React.ReactNode; tone?: "default" | "danger";
}) {
  return (
    <Link
      href={href}
      className={cx(
        "flex h-[29px] w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
        tone === "danger"
          ? cx("text-danger", active ? "bg-danger/15" : "hover:bg-danger/10")
          : active
            ? "bg-surface-3 font-medium text-text-1"
            : "text-text-2 hover:bg-surface-2 hover:text-text-1",
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

function NavButton({ onClick, icon, label, trailing }: { onClick: () => void; icon: React.ReactNode; label: string; trailing?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex h-[29px] w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing}
    </button>
  );
}

// --- Drag and drop ---
// Orgs reorder among orgs. Products reorder among products and move into
// another org's product list (its drop zone). Each drag only considers its own
// kind of target, so an org dragged past an expanded org lands on the next org
// rather than on one of its products, where the drop would do nothing. That
// holds for the pointer and for the arrow keys.
const DRAG_ID = /^(org|org-drop|product)-\d+$/;
type DragKind = "org" | "org-drop" | "product";

/** What a sidebar drag id names: an org header, an org's product list, or a product. */
function dragKind(id: UniqueIdentifier): DragKind | null {
  return (String(id).match(DRAG_ID)?.[1] as DragKind | undefined) ?? null;
}

/** The numeric id at the end of a sidebar drag id, such as 7 in "org-drop-7". */
function dragNumber(id: UniqueIdentifier): number {
  return Number(String(id).slice(String(id).lastIndexOf("-") + 1));
}

/** True when the dragged row can be dropped on the target with this id. */
export function canDropOn(activeId: UniqueIdentifier, overId: UniqueIdentifier): boolean {
  const active = dragKind(activeId);
  const over = dragKind(overId);
  if (active === "org") return over === "org";
  if (active === "product") return over === "product" || over === "org-drop";
  return false;
}

const sidebarCollisions: CollisionDetection = (args) =>
  closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => canDropOn(args.active.id, c.id)) });

// The arrow keys step to the next target of the same kind. dnd-kit's sortable
// stepper picks from every droppable, so it gets a copy of its own container
// map holding only the targets this drag can land on.
const sidebarKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, droppableContainers } = args.context;
  if (!active) return sortableKeyboardCoordinates(event, args);
  const SameMap = droppableContainers.constructor as new (entries: Iterable<[UniqueIdentifier, DroppableContainer]>) => DroppableContainers;
  const targets = new SameMap([...droppableContainers].filter(([id]) => canDropOn(active.id, id)));
  return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableContainers: targets } });
};

/** dnd-kit's listeners, split: the pointer drags the whole row, the keyboard belongs to the Move handle. */
function splitListeners(listeners: DraggableSyntheticListeners) {
  const { onKeyDown, ...pointer } = listeners ?? {};
  return { pointer, keyboard: onKeyDown ? { onKeyDown } : {} };
}

/**
 * The keyboard way to move a row, in the gutter to its left: Space picks the
 * row up, the arrow keys move it, Space drops it and Escape cancels. It shows
 * on hover and on focus. The row is not a button itself, because it holds its
 * own link and buttons, and it still drags by pointer from anywhere on it.
 */
function MoveHandle({ label, attributes, keyboard, setRef, dragging, className }: {
  label: string; attributes: DraggableAttributes; keyboard: Record<string, unknown>;
  setRef: (el: HTMLElement | null) => void; dragging: boolean; className: string;
}) {
  return (
    <button type="button" ref={setRef} {...attributes} {...keyboard} aria-label={label} title="Drag to move"
      className={cx("absolute top-0 -left-3 flex h-full w-3 cursor-grab items-center justify-center rounded-sm text-text-3 transition-opacity hover:text-text-1 active:cursor-grabbing",
        "focus-visible:text-text-1 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ivory/30 focus-visible:ring-inset",
        dragging ? "opacity-100" : cx("opacity-0", className))}>
      <GripVertical aria-hidden className="h-3 w-3" />
    </button>
  );
}

// --- Sortable Org Header ---
export function SortableOrgHeader({ org, expanded, onToggle, onContextMenu, isEditing, editingName, editError, onEditChange, onEditSubmit, onEditCancel, onMenuClick, menuOpen }: {
  org: Org; expanded: boolean; onToggle: () => void; onContextMenu: (e: React.MouseEvent) => void;
  isEditing: boolean; editingName: string; editError: string | null; onEditChange: (v: string) => void; onEditSubmit: () => void; onEditCancel: () => void;
  onMenuClick: (e: React.MouseEvent) => void; menuOpen: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `org-${org.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const { pointer, keyboard } = splitListeners(listeners);

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style} className="py-0.5">
        <input type="text" value={editingName} onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onEditSubmit(); if (e.key === "Escape") onEditCancel(); }}
          onBlur={onEditSubmit}
          aria-invalid={editError ? true : undefined}
          aria-describedby={editError ? `rename-org-error-${org.id}` : undefined}
          className={cx(INLINE_INPUT, "font-mono text-[11px] tracking-[0.8px] uppercase")} autoFocus />
        <RenameError id={`rename-org-error-${org.id}`} error={editError} />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...pointer} className="group/org relative flex h-6 cursor-default items-center">
      <MoveHandle label={`Move ${org.name}`} attributes={attributes} keyboard={keyboard} setRef={setActivatorNodeRef}
        dragging={isDragging} className="group-hover/org:opacity-100" />
      <button onClick={onToggle} onContextMenu={onContextMenu}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left font-mono text-[10.5px] font-medium tracking-[0.8px] text-text-3 uppercase transition-colors hover:text-text-2">
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-text-4" /> : <ChevronRight className="h-3 w-3 shrink-0 text-text-4" />}
        <span className="truncate">{org.name}</span>
      </button>
      <IconButton onClick={onMenuClick} size={22} aria-label={`${org.name} options`} title="More options"
        className={cx("mr-0.5", menuOpen ? "bg-surface-3 text-text-1" : "opacity-0 group-hover/org:opacity-100 focus-visible:opacity-100")}>
        <Ellipsis className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

// Why a rename was refused, such as a name another product already has.
function RenameError({ id, error }: { id: string; error: string | null }) {
  if (!error) return null;
  return <p id={id} role="alert" className="px-2 pt-1 pb-1.5 text-[11.5px] leading-4 text-danger">{error}</p>;
}

// --- Droppable Org Zone (for receiving products) ---
function DroppableOrgZone({ orgId, children, isOver }: { orgId: number; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef, isOver: droppableIsOver } = useDroppable({ id: `org-drop-${orgId}` });
  const highlight = isOver || droppableIsOver;
  return (
    <div ref={setNodeRef} className={cx("flex min-h-2 flex-col gap-px rounded-md transition-colors", highlight && "bg-surface-2 ring-1 ring-border-strong")}>
      {children}
    </div>
  );
}

// --- Sortable Product Item ---
export function SortableProductItem({ product, isSelected, href, onContextMenu, isEditing, editingName, editError, onEditChange, onEditSubmit, onEditCancel, emojiPickerOpen, onEmojiToggle, onEmojiChange }: {
  product: Product; isSelected: boolean; href: string; onContextMenu: (e: React.MouseEvent) => void;
  isEditing: boolean; editingName: string; editError: string | null; onEditChange: (v: string) => void; onEditSubmit: () => void; onEditCancel: () => void;
  emojiPickerOpen: boolean; onEmojiToggle: () => void; onEmojiChange: (emoji: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `product-${product.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const { pointer, keyboard } = splitListeners(listeners);

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style}>
        <input type="text" value={editingName} onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onEditSubmit(); if (e.key === "Escape") onEditCancel(); }}
          onBlur={onEditSubmit}
          aria-invalid={editError ? true : undefined}
          aria-describedby={editError ? `rename-product-error-${product.id}` : undefined}
          className={INLINE_INPUT} autoFocus />
        <RenameError id={`rename-product-error-${product.id}`} error={editError} />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...pointer}
      className={cx("group/product relative flex h-[29px] cursor-default items-center gap-1 rounded-md pl-1 transition-colors",
        isSelected ? "bg-surface-3" : "hover:bg-surface-2")}>
      <MoveHandle label={`Move ${product.name}`} attributes={attributes} keyboard={keyboard} setRef={setActivatorNodeRef}
        dragging={isDragging} className="group-hover/product:opacity-100" />
      <button onClick={(e) => { e.stopPropagation(); onEmojiToggle(); }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px] leading-none transition-colors hover:bg-surface-4"
        title="Change emoji" aria-label={`Change emoji for ${product.name}`}>
        {product.emoji}
      </button>
      <Link href={href} onContextMenu={onContextMenu}
        className={cx("flex h-full min-w-0 flex-1 items-center truncate pr-2 pl-1 text-[13px] transition-colors",
          isSelected ? "font-medium text-text-1" : "text-text-2 group-hover/product:text-text-1")}>
        {product.name}
      </Link>
      {emojiPickerOpen && (
        <EmojiPicker onSelect={(emoji) => onEmojiChange(emoji)} onClose={onEmojiToggle} />
      )}
    </div>
  );
}

function GetStartedStep({ n, complete, enabled, label, onClick }: { n: number; complete: boolean; enabled: boolean; label: React.ReactNode; onClick?: () => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cx("flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full font-mono text-[10px]",
        complete ? "bg-success/15 text-success" : "border border-border-strong text-text-3")}>
        {complete ? <Check className="h-3 w-3" /> : n}
      </span>
      {complete ? (
        <span className="text-[12.5px] text-text-3 line-through">{label}</span>
      ) : enabled && onClick ? (
        <button onClick={onClick} className="text-left text-[12.5px] text-text-1 transition-colors hover:text-ivory-hover">{label}</button>
      ) : (
        <span className="text-[12.5px] text-text-4">{label}</span>
      )}
    </div>
  );
}

// --- Getting Started Card ---
function GetStartedCard({ orgs, productsByOrg, members, onAddOrg, onAddProduct, setupPrompt }: {
  orgs: Org[];
  productsByOrg: Record<number, Product[]>;
  members: { id: number; name: string; type: string; color: string }[];
  onAddOrg: () => void;
  onAddProduct: (orgId: number) => void;
  setupPrompt: AgentSetupPrompt;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasOrg = orgs.length > 0;
  const hasProduct = Object.values(productsByOrg).flat().length > 0;
  const hasAgent = members.some((m) => m.type === "agent");

  // Hide entirely once an agent is connected
  if (hasAgent) return null;

  const boardUrl = typeof window !== "undefined" ? window.location.origin : "";

  const prompt = setupPrompt(boardUrl);

  function handleCopy() {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const done = [hasOrg, hasProduct, false].filter(Boolean).length;

  return (
    <div className="px-3 pt-1 pb-3">
      <div className="rounded-lg border border-border bg-surface-1 p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-text-1">Get started</span>
          <span className="font-mono text-[10.5px] text-text-3">{done}/3</span>
        </div>

        <div className="flex flex-col gap-2">
          <GetStartedStep n={1} complete={hasOrg} enabled label="Add an organization" onClick={onAddOrg} />
          <GetStartedStep n={2} complete={hasProduct} enabled={hasOrg} label="Add a product" onClick={() => onAddProduct(orgs[0].id)} />
          <GetStartedStep n={3} complete={false} enabled={hasProduct}
            label={<span className="inline-flex items-center gap-1">Connect your first agent <ChevronDown className={cx("h-3 w-3 transition-transform", showPrompt && "rotate-180")} /></span>}
            onClick={() => setShowPrompt(!showPrompt)} />
        </div>

        {/* Expandable agent prompt */}
        {showPrompt && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 text-[11.5px] text-text-3">
              Copy this and paste it to your agent. It&apos;ll handle the rest.
            </p>
            <pre className="max-h-32 overflow-y-auto rounded-md border border-border bg-bg p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-text-2">
              {prompt.slice(0, 300)}…
            </pre>
            <Button variant={copied ? "secondary" : "primary"} size="sm" onClick={handleCopy} className="mt-2 w-full">
              {copied ? <><Check className="h-3.5 w-3.5 text-success" /> Copied to clipboard</> : <><Copy className="h-3.5 w-3.5" /> Copy full prompt</>}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** For a value that never changes after hydration, such as the platform. */
const noSubscribe = () => () => {};

// --- Main Sidebar ---
export default function Sidebar({ collapsed, bothForms = false, onToggle, isMobile, footerSlot, railSlot, agentSetupPrompt = coreSetupPrompt }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { prefs, confirmedProfileMemberId: pastDueMember, toggleExpandedOrg, setExpandedOrgs } = usePreferences();
  // The quick search shortcut, once the platform is known (not during SSR).
  const shortcut = useSyncExternalStore(noSubscribe, searchShortcut, () => null);
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
  // Why the open org or product rename was refused (say, a 409 for a name
  // another one already has), shown under its input until it changes.
  const [renameError, setRenameError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: "org" | "product"; id: number; orgId?: number } | null>(null);
  const [emojiPickerProductId, setEmojiPickerProductId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const [dragOverOrgId, setDragOverOrgId] = useState<number | null>(null);
  const [activeProductDrag, setActiveProductDrag] = useState<Product | null>(null);
  const [orgMenuId, setOrgMenuId] = useState<number | null>(null);
  const [orgMenuPos, setOrgMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [browsingOrgId, setBrowsingOrgId] = useState<number | null>(null);
  const [members, setMembers] = useState<{ id: number; name: string; type: string; color: string }[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [pastDueCount, setPastDueCount] = useState(0);

  const expandedOrgs = new Set(prefs.expandedOrgs);
  const starredProducts = new Set(prefs.starredProducts);
  const showAllProducts = prefs.showAllOrgs;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sidebarKeyboardCoordinates }),
  );

  useEffect(() => { loadOrgs(); loadMembers(); }, []);

  // The badge counts the person's own overdue cards, as Past Due lists them:
  // the profile member the server confirms (AB-162). Counted again when that
  // becomes known or changes; the ref lets a recount drop an answer for an
  // earlier member.
  const pastDueMemberRef = useRef(pastDueMember);
  useEffect(() => {
    pastDueMemberRef.current = pastDueMember;
    loadPastDueCount();
  }, [pastDueMember]);

  // Keep the past-due badge live. It used to load once on mount and then sit
  // there, so a card falling overdue — or being dealt with — was invisible
  // until the next navigation.
  //
  // Debounced because one gesture is often several writes: a card drag lands a
  // move and a reorder, and the badge does not need to be recounted twice.
  const pastDueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useBoardStream(null, () => {
    if (pastDueTimerRef.current) clearTimeout(pastDueTimerRef.current);
    pastDueTimerRef.current = setTimeout(() => { loadPastDueCount(); }, 400);
  });
  useEffect(() => () => {
    if (pastDueTimerRef.current) clearTimeout(pastDueTimerRef.current);
  }, []);

  // Two outcomes that look alike and are not: "there is nobody to have overdue
  // cards" is a real answer and clears the badge, while a failed request means
  // we do not know and the last count stands. Zeroing on failure would make the
  // whole nav entry vanish on any blip, since it is gated on the count.
  async function loadPastDueCount() {
    const member = pastDueMemberRef.current;
    // Not known until the server confirms it; the effect above counts then.
    if (member === undefined) return;
    if (member === null) {
      // No profile yet, so nothing is assigned to "me".
      setPastDueCount(0);
      return;
    }
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/cards/views?view=past-due-count&member_id=${member}&tz=${encodeURIComponent(tz)}`);
      if (res.ok && pastDueMemberRef.current === member) {
        const data = await res.json();
        setPastDueCount(data.count || 0);
      }
    } catch {
      // silently fail
    }
  }

  async function loadMembers() {
    const res = await fetch("/api/members");
    if (res.ok) setMembers(await res.json());
    setMembersLoaded(true);
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
    announceProductsChanged();
  }

  function toggleOrg(orgId: number) {
    toggleExpandedOrg(orgId);
  }

  function handleOrgMenuClick(e: React.MouseEvent, orgId: number) {
    e.stopPropagation();
    if (orgMenuId === orgId) { setOrgMenuId(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
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
    announceProductsChanged();
  }

  async function handleLogout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }

  async function handleRenameOrg(orgId: number) {
    if (!editingOrgName.trim()) { setEditingOrgId(null); setRenameError(null); return; }
    const res = await fetch(`/api/orgs/${orgId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingOrgName.trim() }) });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setRenameError(data?.error || "Couldn't rename this organization.");
      return;
    }
    setEditingOrgId(null); setEditingOrgName(""); setRenameError(null); loadOrgs();
  }

  function handleDeleteOrg(orgId: number) {
    setConfirmAction({
      title: "Delete organization",
      message: "This will delete the organization and all its products, boards, and cards.",
      action: async () => { await fetch(`/api/orgs/${orgId}`, { method: "DELETE" }); loadOrgs(); setConfirmAction(null); },
    });
  }

  async function handleRenameProduct(productId: number, orgId: number) {
    if (!editingProductName.trim()) { setEditingProductId(null); setRenameError(null); return; }
    const res = await fetch(`/api/products/${productId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingProductName.trim() }) });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setRenameError(data?.error || "Couldn't rename this product.");
      return;
    }
    setEditingProductId(null); setEditingProductName(""); setRenameError(null); await refreshProducts(orgId);
  }

  function handleDeleteProduct(productId: number, orgId: number) {
    setConfirmAction({
      title: "Delete product",
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
  /** A dragged row or drop target by name, for screen reader announcements. */
  function dragName(id: UniqueIdentifier): string {
    const kind = dragKind(id);
    const n = dragNumber(id);
    if (kind === "product") return Object.values(productsByOrg).flat().find((p) => p.id === n)?.name ?? "the product";
    const org = orgs.find((o) => o.id === n);
    if (kind === "org-drop") return org ? `${org.name}'s products` : "the organization's products";
    return org?.name ?? "the organization";
  }

  // A drag starts over its own row, so saying so would talk over "Picked up".
  // Coming back to it later is worth saying.
  const leftStartRef = useRef(false);
  const announcements: Announcements = {
    onDragStart: ({ active }) => { leftStartRef.current = false; return `Picked up ${dragName(active.id)}.`; },
    onDragOver: ({ active, over }) => {
      if (over?.id === active.id) return leftStartRef.current ? `${dragName(active.id)} is back where it started.` : undefined;
      leftStartRef.current = true;
      return over ? `${dragName(active.id)} is over ${dragName(over.id)}.` : `${dragName(active.id)} is not over a drop target.`;
    },
    onDragEnd: ({ active, over }) =>
      over && over.id !== active.id ? `${dragName(active.id)} was dropped on ${dragName(over.id)}.` : `${dragName(active.id)} was dropped where it was.`,
    onDragCancel: ({ active }) => `Moving ${dragName(active.id)} was cancelled.`,
  };

  // Escape cancels a drag, by keyboard or pointer. Without this the product
  // drop-zone highlight stayed on after a cancelled product drag.
  function handleDragCancel() {
    setActiveProductDrag(null);
    setDragOverOrgId(null);
  }

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
          announceProductsChanged();
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
        announceProductsChanged();
      }
    }
  }

  // While the page hydrates the server can't know a saved collapse, so this
  // draws both forms and the preload style in BoardLayout shows one before it
  // paints (AB-157). Only the keys use collapsed then: keys aren't in the HTML,
  // so hydration still matches, and the form that shows is the one keyed
  // "sidebar", which React keeps. Collapsing and expanding later reuse that
  // same box, so its width still animates. The footer slot is in the server's
  // HTML as it always was; the rail's slot waits for the next render, so for
  // most people a control a consuming app passes for both forms, such as
  // Cloud's team switcher, mounts once. (With a saved collapse the footer's
  // copy mounts in the hidden full sidebar until hydration ends.)
  const shown = collapsed && !isMobile ? "rail" : "full";
  const rail = (
    <div
      key={shown === "rail" ? "sidebar" : "rail"}
      data-sidebar-form={bothForms ? "rail" : undefined}
      className={cx("sidebar-transition w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-sidebar py-3", bothForms ? "hidden" : "flex")}
    >
      <button onClick={onToggle} className="rounded-lg transition-opacity hover:opacity-80" title="Expand sidebar" aria-label="Expand sidebar">
        <Logo size={32} />
      </button>
      <IconButton onClick={openQuickSearch} size={32} title={`Search${shortcut ? ` (${shortcut})` : ""}`} aria-label="Search" className="mt-2 text-text-2">
        <Search className="h-4 w-4" />
      </IconButton>
      <div className="flex-1" />
      {!bothForms && railSlot}
      <IconButton onClick={() => router.push("/settings")} size={32} title="Settings" aria-label="Settings" className="text-text-2">
        <Settings className="h-4 w-4" />
      </IconButton>
      <IconButton onClick={handleLogout} size={32} title="Logout" aria-label="Logout" className="text-text-2">
        <LogOut className="h-4 w-4" />
      </IconButton>
    </div>
  );
  if (shown === "rail" && !bothForms) return rail;

  const full = (
    <div
      key={shown === "full" ? "sidebar" : "full"}
      data-sidebar-form={bothForms ? "full" : undefined}
      className={cx("sidebar-transition flex shrink-0 flex-col bg-bg-sidebar", isMobile ? "w-full" : "w-64 border-r border-border max-[768px]:w-full max-[768px]:border-r-0")}
    >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 pr-3.5 pl-4">
        <Logo size={28} />
        <Wordmark className="flex-1 text-sm" />
        {!isMobile && (
          <IconButton onClick={onToggle} title="Collapse sidebar" aria-label="Collapse sidebar" className="max-[768px]:hidden">
            <PanelLeftClose className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      {/* Getting Started — shows until first agent is connected, waits for data to avoid flash */}
      {membersLoaded && (
        <GetStartedCard
          orgs={orgs}
          productsByOrg={productsByOrg}
          members={members}
          setupPrompt={agentSetupPrompt}
          onAddOrg={() => setShowAddOrg(true)}
          onAddProduct={(orgId) => {
            setAddingProductOrg(orgId);
            setAddingProductName("");
            if (!expandedOrgs.has(orgId)) {
              setExpandedOrgs([...prefs.expandedOrgs, orgId]);
            }
          }}
        />
      )}

      {/* Quick views */}
      <nav className="flex flex-col gap-px px-3 pt-1 pb-2">
        {pastDueCount > 0 && (
          <NavLink href="/past-due" tone="danger" active={pathname === "/past-due"} icon={<CircleAlert />} label="Past Due"
            trailing={<span className="font-mono text-[11px]">{pastDueCount}</span>} />
        )}
        <NavButton onClick={openQuickSearch} icon={<Search />} label="Search"
          trailing={shortcut && <kbd className="font-mono text-[10.5px] text-text-4">{shortcut}</kbd>} />
        <NavLink href="/today" active={pathname === "/today"} icon={<CalendarDays />} label="Today" />
        <NavLink href="/assigned" active={pathname === "/assigned"} icon={<CircleUserRound />} label="Assigned to me" />
      </nav>
      <div className="h-px shrink-0 bg-border" />

      {/* Org/Product tree */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-1.5">
        <DndContext sensors={sensors} collisionDetection={sidebarCollisions} accessibility={{ announcements }}
          onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          <SortableContext items={orgs.map((o) => `org-${o.id}`)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2.5">
            {orgs.map((org) => {
              const allProducts = productsByOrg[org.id] || [];
              const isShowAll = showAllProducts[org.id] || false;
              const starredInOrg = allProducts.filter((p) => starredProducts.has(p.id));
              // Default: show only starred. Show all if toggled or if no starred products exist
              const visibleProducts = (isShowAll || starredInOrg.length === 0) ? allProducts : starredInOrg;
              return (
              <div key={org.id} className="flex flex-col gap-px">
                <SortableOrgHeader org={org} expanded={expandedOrgs.has(org.id)} onToggle={() => toggleOrg(org.id)}
                  onContextMenu={(e) => handleContextMenu(e, "org", org.id)}
                  isEditing={editingOrgId === org.id} editingName={editingOrgName} editError={editingOrgId === org.id ? renameError : null}
                  onEditChange={(v) => { setEditingOrgName(v); setRenameError(null); }}
                  onEditSubmit={() => handleRenameOrg(org.id)} onEditCancel={() => { setEditingOrgId(null); setEditingOrgName(""); setRenameError(null); }}
                  onMenuClick={(e) => handleOrgMenuClick(e, org.id)} menuOpen={orgMenuId === org.id} />

                {expandedOrgs.has(org.id) && (
                  <DroppableOrgZone orgId={org.id} isOver={dragOverOrgId === org.id && activeProductDrag !== null}>
                    <SortableContext items={visibleProducts.map((p) => `product-${p.id}`)} strategy={verticalListSortingStrategy}>
                      {visibleProducts.map((product) => (
                        <SortableProductItem key={product.id} product={product} isSelected={pathname === `/${org.slug}/${product.slug}`}
                          href={`/${org.slug}/${product.slug}`}
                          onContextMenu={(e) => handleContextMenu(e, "product", product.id, org.id)}
                          isEditing={editingProductId === product.id} editingName={editingProductName} editError={editingProductId === product.id ? renameError : null}
                          onEditChange={(v) => { setEditingProductName(v); setRenameError(null); }}
                          onEditSubmit={() => handleRenameProduct(product.id, org.id)} onEditCancel={() => { setEditingProductId(null); setEditingProductName(""); setRenameError(null); }}
                          emojiPickerOpen={emojiPickerProductId === product.id}
                          onEmojiToggle={() => setEmojiPickerProductId(emojiPickerProductId === product.id ? null : product.id)}
                          onEmojiChange={(emoji) => handleChangeEmoji(product.id, org.id, emoji)} />
                      ))}
                    </SortableContext>

                    {/* Empty drop zone when no products */}
                    {visibleProducts.length === 0 && (
                      <div className="flex h-7 items-center px-2 text-[12px] text-text-4">Drop here</div>
                    )}

                    {addingProductOrg === org.id && (
                      <input type="text" value={addingProductName} onChange={(e) => setAddingProductName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddProduct(org.id); if (e.key === "Escape") { setAddingProductOrg(null); setAddingProductName(""); } }}
                        onBlur={() => { if (!addingProductName.trim()) setAddingProductOrg(null); }}
                        className={INLINE_INPUT}
                        placeholder="Product name" autoFocus />
                    )}
                  </DroppableOrgZone>
                )}
              </div>
            ); })}
            </div>
          </SortableContext>

          <DragOverlay>
            {activeProductDrag && (
              <div className="flex h-[29px] items-center gap-2.5 rounded-md border border-border-strong bg-surface-3 px-2 text-[13px] text-text-1 shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
                <span className="text-[14px]">{activeProductDrag.emoji}</span>
                <span>{activeProductDrag.name}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* Add org */}
        <div className="mt-2.5">
          {showAddOrg ? (
            <input type="text" value={addingOrgName} onChange={(e) => setAddingOrgName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddOrg(); if (e.key === "Escape") { setShowAddOrg(false); setAddingOrgName(""); } }}
              onBlur={() => { if (!addingOrgName.trim()) setShowAddOrg(false); }}
              className={INLINE_INPUT}
              placeholder="Organization name" autoFocus />
          ) : (
            <button onClick={() => setShowAddOrg(true)} className="flex h-[30px] items-center gap-1.5 rounded-md px-2 text-[12.5px] text-text-3 transition-colors hover:bg-surface-2 hover:text-text-2">
              <Plus className="h-[13px] w-[13px]" />
              Add organization
            </button>
          )}
        </div>
      </div>

      {/* Footer: the consuming app's slot, settings & logout */}
      <div className="flex shrink-0 flex-col gap-px border-t border-border px-3 py-2">
        {footerSlot}
        <NavButton onClick={() => router.push("/settings")} icon={<Settings />} label="Settings" />
        <NavButton onClick={handleLogout} icon={<LogOut />} label="Logout" />
      </div>

      {/* Org ellipsis dropdown menu */}
      {orgMenuId !== null && (
        <MenuPanel className="fixed w-52" style={{ left: Math.min(orgMenuPos.x, 200), top: orgMenuPos.y }}>
          <MenuItem icon={<List />} onClick={(e) => { e.stopPropagation(); setBrowsingOrgId(orgMenuId); setOrgMenuId(null); }}>
            Browse all products
          </MenuItem>
          <MenuItem icon={<Plus />} onClick={(e) => { e.stopPropagation(); const id = orgMenuId; setOrgMenuId(null); setAddingProductOrg(id); setAddingProductName(""); if (!expandedOrgs.has(id)) { const next = [...prefs.expandedOrgs, id]; setExpandedOrgs(next); } }}>
            Add product
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={<Pencil />} onClick={(e) => { e.stopPropagation(); const org = orgs.find((o) => o.id === orgMenuId); if (org) { setEditingOrgId(orgMenuId); setEditingOrgName(org.name); setRenameError(null); } setOrgMenuId(null); }}>
            Rename
          </MenuItem>
          <MenuItem danger icon={<Trash2 />} onClick={(e) => { e.stopPropagation(); handleDeleteOrg(orgMenuId); setOrgMenuId(null); }}>
            Delete
          </MenuItem>
        </MenuPanel>
      )}

      {/* Browse all products overlay */}
      {browsingOrgId !== null && (() => {
        const org = orgs.find((o) => o.id === browsingOrgId);
        if (!org) return null;
        return <OrgProductsDialog org={org} products={productsByOrg[browsingOrgId] || []} onClose={() => setBrowsingOrgId(null)} />;
      })()}

      {/* Context menu */}
      {contextMenu && (
        <MenuPanel className="fixed w-44" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <MenuItem icon={<Pencil />} onClick={() => {
            if (contextMenu.type === "org") { const org = orgs.find((o) => o.id === contextMenu.id); setEditingOrgId(contextMenu.id); setEditingOrgName(org?.name || ""); setRenameError(null); }
            else { const products = Object.values(productsByOrg).flat(); const product = products.find((p) => p.id === contextMenu.id); setEditingProductId(contextMenu.id); setEditingProductName(product?.name || ""); setRenameError(null); }
            setContextMenu(null);
          }}>
            Rename
          </MenuItem>
          <MenuItem danger icon={<Trash2 />} onClick={() => {
            if (contextMenu.type === "org") handleDeleteOrg(contextMenu.id);
            else handleDeleteProduct(contextMenu.id, contextMenu.orgId!);
            setContextMenu(null);
          }}>
            Delete
          </MenuItem>
        </MenuPanel>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmModal title={confirmAction.title} message={confirmAction.message} onConfirm={confirmAction.action} onCancel={() => setConfirmAction(null)} />
      )}
    </div>
  );
  return bothForms ? <>{rail}{full}</> : full;
}
