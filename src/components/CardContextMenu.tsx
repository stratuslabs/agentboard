"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link2, Maximize2, PanelRight, Trash2 } from "lucide-react";
import { MenuDivider, MenuItem, MenuPanel } from "./ui";

/** Where a card's menu opens, and the card element to hand focus back to. */
export interface CardMenuTarget {
  cardId: number;
  title: string;
  x: number;
  y: number;
  returnFocus: HTMLElement | null;
}

/** Keys that open a focused card's menu, as a right-click does. */
export function isMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
}

/**
 * Where to open a card's menu. A right-click opens at the pointer; the keyboard,
 * or a contextmenu event whose point is outside the card, opens just below the
 * card's title.
 */
export function menuPoint(rect: DOMRect, point?: { x: number; y: number } | null): { x: number; y: number } {
  if (point && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) return point;
  return { x: Math.round(rect.left + 12), y: Math.round(rect.top + Math.min(rect.height, 32)) };
}

/**
 * Whether a scroll event moved the card the menu is anchored to: the page or a
 * scroller that holds the card. A scroll elsewhere, like the board tabs nudging
 * by a pixel when focus leaves them, leaves the menu where it belongs.
 */
export function scrollMovesCard(scrolled: EventTarget | null, card: HTMLElement | null): boolean {
  if (!card?.isConnected || !(scrolled instanceof Node) || scrolled.nodeType === Node.DOCUMENT_NODE) return true;
  return scrolled.contains(card);
}

function menuItems(el: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(el?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
}

interface CardContextMenuProps {
  target: CardMenuTarget;
  onOpen: () => void;
  onOpenFull: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  /** Close the menu. Keep it stable (useCallback): it is a listener dependency. */
  onClose: () => void;
}

/**
 * The right-click menu for a card on a board: the same actions as the card's
 * "..." menu. Arrow keys, Home and End move between items; Escape and Tab close
 * it and return focus to the card; a click elsewhere, scrolling the card or
 * resizing closes it.
 */
export default function CardContextMenu({ target, onOpen, onOpenFull, onCopyLink, onDelete, onClose }: CardContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  // Keep the menu on screen: flip it left/up when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = target.x + width > window.innerWidth - 8 ? Math.max(8, target.x - width) : target.x;
    const top = target.y + height > window.innerHeight - 8 ? Math.max(8, target.y - height) : target.y;
    setPos({ left, top });
    // preventScroll: the menu may still sit at its unflipped spot, and a scroll
    // would close it straight away.
    menuItems(el)[0]?.focus({ preventScroll: true });
  }, [target]);

  useEffect(() => {
    const away = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const gone = () => onClose();
    const scrolled = (e: Event) => {
      if (scrollMovesCard(e.target, target.returnFocus)) onClose();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", gone);
    window.addEventListener("blur", gone);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", gone);
      window.removeEventListener("blur", gone);
    };
  }, [onClose, target.returnFocus]);

  function onKeyDown(e: React.KeyboardEvent) {
    // Keys handled here stop at the menu, so an open side panel doesn't also
    // take Escape as "close the card".
    const list = menuItems(ref.current);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (e.key) {
      case "ArrowDown": go(at + 1); break;
      case "ArrowUp": go(at < 0 ? -1 : at - 1); break;
      case "Home": go(0); break;
      case "End": go(-1); break;
      case "Escape":
      case "Tab":
        onClose();
        if (target.returnFocus?.isConnected) target.returnFocus.focus();
        break;
      default:
        if (isMenuKey(e)) break;
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  const act = (fn: () => void) => () => { onClose(); fn(); };

  return (
    <MenuPanel
      ref={ref}
      aria-label={`Actions for ${target.title}`}
      className="fixed w-48"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem tabIndex={-1} icon={<PanelRight />} onClick={act(onOpen)}>Open</MenuItem>
      <MenuItem tabIndex={-1} icon={<Maximize2 />} onClick={act(onOpenFull)}>Open full page</MenuItem>
      <MenuItem tabIndex={-1} icon={<Link2 />} onClick={act(onCopyLink)}>Copy link</MenuItem>
      <MenuDivider />
      <MenuItem tabIndex={-1} danger icon={<Trash2 />} onClick={act(onDelete)}>Delete card</MenuItem>
    </MenuPanel>
  );
}
