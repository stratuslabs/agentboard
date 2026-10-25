"use client";

import { useMemo } from "react";
import SettingsShell from "../../components/settings/SettingsShell";
import { defaultSettingsSections } from "../../components/settings/sections";

export default function SettingsPage() {
  const sections = useMemo(() => defaultSettingsSections(), []);
  return <SettingsShell scope="AgentBoard" sections={sections} />;
}
