// The core's board layout with this app's own sidebar slots, the way a hosted
// edition adds its team switcher. Self-hosted AgentBoard passes none.
"use client";

import BoardLayout from "@stratuslabs/agentboard-core/components/BoardLayout";
import TeamBadge from "../../components/TeamBadge";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <BoardLayout sidebarFooter={<TeamBadge />} sidebarRail={<TeamBadge collapsed />}>
      {children}
    </BoardLayout>
  );
}
