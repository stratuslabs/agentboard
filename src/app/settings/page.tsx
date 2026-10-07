"use client";

import { useMemo } from "react";
import SettingsShell from "@/components/settings/SettingsShell";
import { SettingsScope, settingsSections } from "@/edition/settings";

export default function SettingsPage() {
  const sections = useMemo(() => settingsSections(), []);
  return <SettingsShell scope={<SettingsScope />} sections={sections} />;
}
