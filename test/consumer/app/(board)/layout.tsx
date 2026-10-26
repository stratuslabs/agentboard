// The core's board layout with this app's own sidebar slots, the way a hosted
// edition adds its team switcher and its own agent setup prompt. Self-hosted
// AgentBoard passes none.
"use client";

import BoardLayout from "@stratuslabs/agentboard-core/components/BoardLayout";
import TeamBadge from "../../components/TeamBadge";
import { consumerSetupPrompt } from "../../lib/setup-prompt";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <BoardLayout sidebarFooter={<TeamBadge />} sidebarRail={<TeamBadge collapsed />} agentSetupPrompt={consumerSetupPrompt}>
      {children}
    </BoardLayout>
  );
}
