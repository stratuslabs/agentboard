/**
 * Settings sections for this edition. The page and the shared sections are
 * identical in both editions; the hosted edition's copy of this file adds its
 * team access, API key and billing sections.
 */
import { Columns3, Palette, Plug, Users } from "lucide-react";
import type { SettingsSectionDef } from "@/components/settings/SettingsShell";
import BoardMembers from "@/components/settings/BoardMembers";
import ConnectAgent from "@/components/settings/ConnectAgent";
import { DefaultBoards, DefaultColumns } from "@/components/settings/DefaultLists";

/** Shown before "/ Settings" in the top bar. */
export function SettingsScope() {
  return <>AgentBoard</>;
}

export function settingsSections(): SettingsSectionDef[] {
  return [
    {
      id: "members",
      group: "Team",
      label: "Members",
      icon: <Users />,
      description: "Manage team members and agents. Members can be assigned to cards across all products.",
      content: <BoardMembers />,
    },
    {
      id: "connect",
      group: "Team",
      label: "Connect an agent",
      icon: <Plug />,
      description: "Copy this prompt and paste it to any AI agent to connect it to AgentBoard. It will auto-register as a member and can manage tasks via CLI.",
      content: <ConnectAgent />,
    },
    {
      id: "default-boards",
      group: "Defaults",
      label: "Default boards",
      icon: <Columns3 />,
      description: "Configure which boards are created by default when a new product is added. Changes only affect new products.",
      content: <DefaultBoards />,
    },
    {
      id: "default-columns",
      group: "Defaults",
      label: "Default columns",
      icon: <Palette />,
      description: "Configure the default columns created in each new board. Each column has a name and color.",
      content: <DefaultColumns />,
    },
  ];
}
