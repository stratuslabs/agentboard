/**
 * Edition hooks.
 *
 * The self-hosted and hosted editions share every screen; the few places where
 * the hosted edition adds something of its own read from this file, which is
 * the one UI module the two copies are expected to differ in. Everything here
 * is deliberately empty in the self-hosted edition.
 */

export const EDITION: "self-hosted" | "cloud" = "self-hosted";

/** Rendered above Settings in the expanded sidebar footer. */
export function SidebarFooterSlot(): React.ReactNode {
  return null;
}

/** Rendered above Settings in the collapsed sidebar rail. */
export function SidebarRailSlot(): React.ReactNode {
  return null;
}
