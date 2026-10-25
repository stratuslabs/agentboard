/**
 * The settings screen's sections, in order. src/app/settings/page.tsx shows
 * them as they are. An app that consumes the core builds its own list from
 * these, by id, and passes it to SettingsShell: add a billing section, swap
 * "members" for its own, leave one out.
 *
 * Ids are also the page anchors (/settings#members): members, connect,
 * agent-board, default-boards, default-columns.
 */
import { Bot, Columns3, Palette, Plug, Users } from "lucide-react";
import type { SettingsSectionDef } from "./SettingsShell";
import BoardMembers from "./BoardMembers";
import ConnectAgent from "./ConnectAgent";
import { DefaultBoards, DefaultColumns } from "./DefaultLists";
import ProductDefaultBoards from "./ProductDefaultBoards";

/** A new list each call, so a caller can change it freely. */
export function defaultSettingsSections(): SettingsSectionDef[] {
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
      id: "agent-board",
      group: "Defaults",
      label: "Agent default board",
      icon: <Bot />,
      description: "The board each product's agents work on when they don't name one. Set per product.",
      content: <ProductDefaultBoards />,
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
