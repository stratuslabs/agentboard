"use client";

import { CircleUserRound } from "lucide-react";
import MemberListView from "../../../components/MemberListView";

const assignedUrl = (memberId: number) => `/api/cards/views?view=assigned&member_id=${memberId}`;

export default function AssignedPage() {
  return (
    <MemberListView
      url={assignedUrl}
      title="Assigned to me"
      listId="assigned"
      icon={<CircleUserRound />}
      emptyMessage="No cards are assigned to you."
    />
  );
}
