"use client";

import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import ListView from "./ListView";
import { usePreferences } from "../contexts/PreferencesContext";
import { useSidebar } from "../contexts/SidebarContext";
import { memberViewFetcher, profileMember, useViewCards } from "../lib/view-cards";

type MemberListViewProps = Omit<ComponentProps<typeof ListView>, "cards" | "status" | "onRefresh" | "onBack"> & {
  /** The cards URL for a member. */
  url: (memberId: number) => string;
};

/**
 * A list of the signed-in person's own cards (Assigned to me, Past Due): the
 * cards assigned to their profile member. It shows the loader until the
 * preferences say who that is, and the empty state when they have no profile
 * yet, while profile setup opens over it.
 */
export default function MemberListView(props: MemberListViewProps) {
  const { prefs, isLoaded } = usePreferences();
  const member = profileMember({ isLoaded, profileMemberId: prefs.profileMemberId });
  // A new list for each member, so when the server's profile replaces a cached
  // one the list starts again from the loader, and one person's cards are never
  // left on screen as another's.
  return <MemberCards key={String(member)} member={member} {...props} />;
}

function MemberCards({ member, url, ...list }: MemberListViewProps & { member: number | null | undefined }) {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const [fetchCards] = useState(() => (member === undefined ? null : memberViewFetcher(member, url)));
  const { state, cards, reload } = useViewCards(fetchCards);

  return (
    <ListView
      {...list}
      cards={cards}
      status={state.status}
      onRefresh={reload}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
