"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import MemberListView from "../../../components/MemberListView";

function pastDueUrl(memberId: number) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `/api/cards/views?view=past-due&member_id=${memberId}&tz=${encodeURIComponent(tz)}`;
}

export default function PastDuePage() {
  return (
    <MemberListView
      url={pastDueUrl}
      title="Past Due"
      listId="past-due"
      icon={<CircleAlert />}
      emptyMessage="Nothing assigned to you is overdue."
      emptyIcon={<CircleCheck />}
      tone="danger"
    />
  );
}
