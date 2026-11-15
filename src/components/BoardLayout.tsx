"use client";

/**
 * The board screens' frame: the sidebar beside the page, or one of the two on
 * a phone. src/app/(board)/layout.tsx renders it as is. An app that consumes
 * the core renders it from its own (board)/layout.tsx to put something of its
 * own in the sidebar, such as a team switcher:
 *
 *   <BoardLayout sidebarFooter={<TeamSwitcher />} sidebarRail={<TeamSwitcher collapsed />}>
 *     {children}
 *   </BoardLayout>
 *
 * agentSetupPrompt replaces the prompt the sidebar's get-started card copies
 * for a first agent. It is a function, so the layout that passes it must be a
 * client component.
 */
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import type { AgentSetupPrompt } from "../lib/agent-prompt";
import ProfileSetup from "./ProfileSetup";
import QuickSearch from "./QuickSearch";
import { SidebarProvider, useSidebar } from "../contexts/SidebarContext";
import { cx } from "./ui/cx";

export interface BoardLayoutProps {
  children: React.ReactNode;
  /** Rendered above Settings in the expanded sidebar footer. */
  sidebarFooter?: React.ReactNode;
  /** Rendered above Settings in the collapsed sidebar rail. */
  sidebarRail?: React.ReactNode;
  /** The setup prompt for a new agent, given the board's URL. Defaults to the core's. */
  agentSetupPrompt?: AgentSetupPrompt;
}

function BoardLayoutInner({ children, sidebarFooter, sidebarRail, agentSetupPrompt }: BoardLayoutProps) {
  const { collapsed, toggleCollapsed, isMobile } = useSidebar();
  const pathname = usePathname();

  // On mobile: "/" shows sidebar only, any other route shows content only
  // On desktop: sidebar + content side by side always
  const isHome = pathname === "/";
  const showSidebar = isMobile ? isHome : true;
  const showContent = isMobile ? !isHome : true;

  // isMobile is false until the browser runs the app's code, so the server's
  // HTML is the desktop frame. The two regions also carry the phone layout in
  // CSS, so a phone paints the right one before JS loads and nothing jumps
  // when it does (AB-155). max-[768px] compiles to PHONE_QUERY exactly; max-md
  // would not, since rem breakpoints move with the browser's font size.
  // display: contents keeps the sidebar and the page this row's flex items.
  return (
    <div className="h-screen flex overflow-hidden bg-bg">
      <ProfileSetup />
      <QuickSearch />
      <div data-layout="sidebar" className={cx("contents", !isHome && "max-[768px]:hidden")}>
        {showSidebar && (
          <Sidebar
            collapsed={isMobile ? false : collapsed}
            onToggle={toggleCollapsed}
            isMobile={isMobile}
            footerSlot={sidebarFooter}
            railSlot={sidebarRail}
            agentSetupPrompt={agentSetupPrompt}
          />
        )}
      </div>
      <div data-layout="page" className={cx("contents", isHome && "max-[768px]:hidden")}>
        {showContent && children}
      </div>
    </div>
  );
}

export default function BoardLayout(props: BoardLayoutProps) {
  return (
    <SidebarProvider>
      <BoardLayoutInner {...props} />
    </SidebarProvider>
  );
}
