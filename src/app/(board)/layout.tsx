"use client";

import Sidebar from "@/components/Sidebar";
import ProfileSetup from "@/components/ProfileSetup";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";
import { usePathname } from "next/navigation";

function BoardLayoutInner({ children }: { children: React.ReactNode }) {
  const { collapsed, toggleCollapsed, isMobile } = useSidebar();
  const pathname = usePathname();

  // On mobile: "/" shows sidebar only, any other route shows content only
  // On desktop: sidebar + content side by side always
  const isHome = pathname === "/";
  const showSidebar = isMobile ? isHome : true;
  const showContent = isMobile ? !isHome : true;

  return (
    <div className="h-screen flex overflow-hidden bg-surface-900">
      <ProfileSetup />
      {showSidebar && (
        <Sidebar
          collapsed={isMobile ? false : collapsed}
          onToggle={toggleCollapsed}
          isMobile={isMobile}
        />
      )}
      {showContent && children}
    </div>
  );
}

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <BoardLayoutInner>{children}</BoardLayoutInner>
    </SidebarProvider>
  );
}
