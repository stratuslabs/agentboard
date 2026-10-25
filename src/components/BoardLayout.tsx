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
 */
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import ProfileSetup from "./ProfileSetup";
import { SidebarProvider, useSidebar } from "../contexts/SidebarContext";

export interface BoardLayoutProps {
  children: React.ReactNode;
  /** Rendered above Settings in the expanded sidebar footer. */
  sidebarFooter?: React.ReactNode;
  /** Rendered above Settings in the collapsed sidebar rail. */
  sidebarRail?: React.ReactNode;
}

function BoardLayoutInner({ children, sidebarFooter, sidebarRail }: BoardLayoutProps) {
  const { collapsed, toggleCollapsed, isMobile } = useSidebar();
  const pathname = usePathname();

  // On mobile: "/" shows sidebar only, any other route shows content only
  // On desktop: sidebar + content side by side always
  const isHome = pathname === "/";
  const showSidebar = isMobile ? isHome : true;
  const showContent = isMobile ? !isHome : true;

  return (
    <div className="h-screen flex overflow-hidden bg-bg">
      <ProfileSetup />
      {showSidebar && (
        <Sidebar
          collapsed={isMobile ? false : collapsed}
          onToggle={toggleCollapsed}
          isMobile={isMobile}
          footerSlot={sidebarFooter}
          railSlot={sidebarRail}
        />
      )}
      {showContent && children}
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
