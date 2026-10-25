// The core's settings screen with this app's scope label and an extra section,
// the way a hosted edition adds billing and drops what it doesn't serve.
"use client";

import { CreditCard } from "lucide-react";
import SettingsShell from "@stratuslabs/agentboard-core/components/settings/SettingsShell";
import { defaultSettingsSections } from "@stratuslabs/agentboard-core/components/settings/sections";

const sections = [
  ...defaultSettingsSections().filter((s) => s.id !== "agent-board"),
  {
    id: "consumer-billing",
    group: "Team",
    label: "Consumer billing",
    icon: <CreditCard />,
    description: "A section only this app has.",
    content: <p data-consumer-slot="settings-section">Free plan</p>,
  },
];

export default function SettingsPage() {
  return <SettingsShell scope={<span data-consumer-slot="settings-scope">Consumer Team</span>} sections={sections} />;
}
