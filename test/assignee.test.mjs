// A card has two assignee fields: assignee_id, the member it's filed under,
// and assignee, free text for someone who isn't a member. Writes used to set
// them independently, so card 699 read assignee "Nova" with assignee_id
// pointing at Blair (card 838). settleAssignee decides both together.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { settleAssignee } from "../src/lib/assignee.js";

const members = { nova: 6, blair: 7 };
const lookup = async (name) => members[name.toLowerCase()] ?? null;

test("a body that doesn't mention the assignee changes nothing", async () => {
  assert.equal(await settleAssignee({}, lookup), null);
  assert.equal(await settleAssignee({ title: "x" }, lookup), null);
});

test("a member id is stored with no text beside it", async () => {
  assert.deepEqual(await settleAssignee({ assignee_id: 7 }, lookup), { assignee_id: 7, assignee: null });
  // The id wins over a name that says someone else.
  assert.deepEqual(await settleAssignee({ assignee_id: 7, assignee: "Nova" }, lookup), { assignee_id: 7, assignee: null });
});

test("a name that matches a member, any case, is stored as that member", async () => {
  assert.deepEqual(await settleAssignee({ assignee: "nova" }, lookup), { assignee_id: 6, assignee: null });
  assert.deepEqual(await settleAssignee({ assignee: "  Blair " }, lookup), { assignee_id: 7, assignee: null });
});

test("a name that matches nobody is stored as text, with no member", async () => {
  assert.deepEqual(await settleAssignee({ assignee: "Pat Outside" }, lookup), { assignee_id: null, assignee: "Pat Outside" });
});

test("an empty name or a null id unassigns both fields", async () => {
  const none = { assignee_id: null, assignee: null };
  assert.deepEqual(await settleAssignee({ assignee: "" }, lookup), none);
  assert.deepEqual(await settleAssignee({ assignee: "   " }, lookup), none);
  assert.deepEqual(await settleAssignee({ assignee: null }, lookup), none);
  assert.deepEqual(await settleAssignee({ assignee_id: null }, lookup), none);
  assert.deepEqual(await settleAssignee({ assignee_id: null, assignee: null }, lookup), none);
});

test("a null id with a name resolves the name", async () => {
  assert.deepEqual(await settleAssignee({ assignee_id: null, assignee: "Nova" }, lookup), { assignee_id: 6, assignee: null });
});

test("whatever the body, the two fields never both name someone", async () => {
  const ids = [undefined, null, 6, 7];
  const names = [undefined, null, "", " ", "nova", "BLAIR", "Pat Outside"];
  for (const assignee_id of ids) {
    for (const assignee of names) {
      const out = await settleAssignee({ assignee_id, assignee }, lookup);
      if (out === null) {
        assert.equal(assignee_id, undefined);
        assert.equal(assignee, undefined);
        continue;
      }
      assert.ok(out.assignee_id === null || out.assignee === null, JSON.stringify({ assignee_id, assignee, out }));
    }
  }
});
