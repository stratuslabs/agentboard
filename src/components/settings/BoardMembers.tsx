"use client";

import { useCallback, useEffect, useState } from "react";
import { Palette, Pencil, UserMinus } from "lucide-react";
import ConfirmModal from "../ConfirmModal";
import { Button, ColorSwatches, Input, MenuDivider, MenuItem, PRESET_COLORS, Select } from "../ui";
import { MemberEditor, MemberGroupHeader, MemberListCard, MemberRow, RowMenu } from "./MemberList";

export interface BoardMember {
  id: number;
  name: string;
  type: string;
  color: string;
  avatar_url?: string | null;
  created_at?: string;
}

/** Fired after members change so other sections (connected agents) refresh. */
export const MEMBERS_CHANGED = "agentboard:members-changed";

export function useBoardMembers() {
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch("/api/members");
    if (res.ok) setMembers(await res.json());
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(MEMBERS_CHANGED, onChange);
    return () => window.removeEventListener(MEMBERS_CHANGED, onChange);
  }, [load]);
  return { members, loaded, reload: load };
}

export function announceMembersChanged() {
  window.dispatchEvent(new Event(MEMBERS_CHANGED));
}

export async function updateBoardMember(id: number, name: string, color: string) {
  await fetch(`/api/members/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  announceMembersChanged();
}

/** The add-a-member form: name, human or agent, and a colour. */
export function AddBoardMember({ defaultType = "human" }: { defaultType?: "human" | "agent" }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"human" | "agent">(defaultType);
  const [color, setColor] = useState(PRESET_COLORS[5]);
  async function add() {
    if (!name.trim()) return;
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), type, color }),
    });
    if (res.ok) {
      setName("");
      setType(defaultType);
      setColor(PRESET_COLORS[5]);
      announceMembersChanged();
    }
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-2 max-sm:flex-wrap">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          placeholder="Name"
          aria-label="New member name"
          className="min-w-0 flex-1"
        />
        <Select value={type} onChange={(e) => setType(e.target.value as "human" | "agent")} aria-label="Member type" className="w-[120px]">
          <option value="human">Human</option>
          <option value="agent">Agent</option>
        </Select>
        <Button variant="primary" onClick={add} disabled={!name.trim()}>Add member</Button>
      </div>
      {name.trim() && <ColorSwatches value={color} onChange={setColor} size={20} />}
    </div>
  );
}

/** One editable board-member row: rename, recolour, remove. */
export function BoardMemberRow({ member, sub, trailing, extraMenu, onRemove }: {
  member: BoardMember;
  sub?: React.ReactNode;
  trailing?: React.ReactNode;
  extraMenu?: (close: () => void) => React.ReactNode;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState<"name" | "color" | null>(null);
  const isAgent = member.type === "agent";
  return (
    <MemberRow
      name={member.name}
      color={member.color}
      isAgent={isAgent}
      sub={sub}
      editor={editing && (
        <MemberEditor
          initialName={member.name}
          initialColor={member.color}
          focus={editing}
          onCancel={() => setEditing(null)}
          onSave={async (name, color) => { await updateBoardMember(member.id, name, color); setEditing(null); }}
        />
      )}
      trailing={
        <>
          {trailing ?? <span className="px-2 text-[12.5px] text-text-2">{isAgent ? "Agent" : "Human"}</span>}
          <RowMenu label={`${member.name} options`}>
            {(close) => (
              <>
                <MenuItem icon={<Pencil />} onClick={() => { close(); setEditing("name"); }}>Rename</MenuItem>
                <MenuItem icon={<Palette />} onClick={() => { close(); setEditing("color"); }}>Change color</MenuItem>
                {extraMenu?.(close)}
                <MenuDivider />
                <MenuItem danger icon={<UserMinus />} onClick={() => { close(); onRemove(); }}>Remove from team</MenuItem>
              </>
            )}
          </RowMenu>
        </>
      }
    />
  );
}

/** Confirmation for removing a board member; cards assigned to them become unassigned. */
export function RemoveMemberConfirm({ member, message, onDone }: { member: BoardMember; message?: string; onDone: () => void }) {
  return (
    <ConfirmModal
      title="Remove from team"
      message={message ?? `Remove "${member.name}" from the team? Cards assigned to this member will become unassigned.`}
      confirmLabel="Remove"
      icon={<UserMinus />}
      onCancel={onDone}
      onConfirm={async () => {
        await fetch(`/api/members/${member.id}`, { method: "DELETE" });
        announceMembersChanged();
        onDone();
      }}
    />
  );
}

/** The self-hosted Members section: the people and agents cards are assigned to. */
export default function BoardMembers() {
  const { members, loaded } = useBoardMembers();
  const [removing, setRemoving] = useState<BoardMember | null>(null);
  const people = members.filter((m) => m.type === "human");
  const agents = members.filter((m) => m.type === "agent");

  return (
    <>
      <AddBoardMember />
      {!loaded ? (
        <div className="py-4 text-xs text-text-3">Loading members…</div>
      ) : members.length === 0 ? (
        <div className="rounded-[10px] border border-border bg-surface-1 px-4 py-6 text-center text-[13px] text-text-3">
          No members yet. Add your first team member above.
        </div>
      ) : (
        <MemberListCard>
          {people.length > 0 && <MemberGroupHeader label="People" count={people.length} />}
          {people.map((m) => <BoardMemberRow key={m.id} member={m} onRemove={() => setRemoving(m)} />)}
          {agents.length > 0 && <MemberGroupHeader label="Agents" count={agents.length} />}
          {agents.map((m) => <BoardMemberRow key={m.id} member={m} onRemove={() => setRemoving(m)} />)}
        </MemberListCard>
      )}
      <p className="text-xs leading-normal text-text-4">Removing a member unassigns their cards.</p>
      {removing && <RemoveMemberConfirm member={removing} onDone={() => setRemoving(null)} />}
    </>
  );
}
