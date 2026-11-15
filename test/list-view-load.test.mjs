// Today, Assigned to me and Past Due used to start from an empty list and had
// no loading or error state, so they said "No cards found" and "0 cards" until
// the cards arrived, and kept saying it when the request failed (AB-156).
// Someone with cards due saw a false "nothing due" first, and a failed load
// looked like an empty list. They now show a loader until the first answer,
// the empty state only after an OK empty answer, and an error with Try again
// when the load fails.
//
//   node --test test/

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { PreferencesProvider } = await import("../src/contexts/PreferencesContext.tsx");
const { SidebarProvider } = await import("../src/contexts/SidebarContext.tsx");
const { default: ListView } = await import("../src/components/ListView.tsx");
const { default: TodayPage } = await import("../src/app/(board)/today/page.tsx");
const { default: AssignedPage } = await import("../src/app/(board)/assigned/page.tsx");
const { default: PastDuePage } = await import("../src/app/(board)/past-due/page.tsx");
const { fetchJsonList, settleViewCards, viewCardsLoader, memberViewFetcher, profileMember } = await import("../src/lib/view-cards.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const card = {
  id: 7, number: 7, product_key: "AB", title: "Ship it", priority: "high", due_date: null,
  assignee_name: null, assignee_color: null, column_name: "Todo", column_color: "#888",
  org_name: "Labs", product_name: "AgentBoard", product_emoji: "", board_name: "Development",
};

// ---------------------------------------------------------------------------
// Fetching a list never throws: a failure is null, never an empty list.

test("fetchJsonList returns the array the server sends", async () => {
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/cards/views?view=today");
    return json([card]);
  };
  assert.deepEqual(await fetchJsonList("/api/cards/views?view=today"), [card]);
});

test("fetchJsonList is null when the request never reaches the server", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await fetchJsonList("/x"), null);
});

test("fetchJsonList is null on a server error, not an empty list", async () => {
  globalThis.fetch = async () => json({ error: "boom" }, 500);
  assert.equal(await fetchJsonList("/x"), null);
});

test("fetchJsonList is null when the answer isn't JSON (a proxy's error page)", async () => {
  globalThis.fetch = async () => new Response("<html>Bad gateway</html>", { status: 200 });
  assert.equal(await fetchJsonList("/x"), null);
});

test("fetchJsonList is null when the JSON isn't a list", async () => {
  globalThis.fetch = async () => json({ error: "Unauthorized" });
  assert.equal(await fetchJsonList("/x"), null);
});

// ---------------------------------------------------------------------------
// The list's state after each answer.

test("an OK answer makes the list ready, empty or not", () => {
  assert.deepEqual(settleViewCards({ status: "loading" }, []), { status: "ready", cards: [] });
  assert.deepEqual(settleViewCards({ status: "loading" }, [card]), { status: "ready", cards: [card] });
  assert.deepEqual(settleViewCards({ status: "failed" }, [card]), { status: "ready", cards: [card] });
});

test("a failed first load is an error, not an empty list", () => {
  assert.deepEqual(settleViewCards({ status: "loading" }, null), { status: "failed" });
  assert.deepEqual(settleViewCards({ status: "failed" }, null), { status: "failed" });
});

test("a failed refresh keeps the cards already on screen", () => {
  const ready = { status: "ready", cards: [card] };
  assert.equal(settleViewCards(ready, null), ready);
});

/** A fetch stand-in whose answer the test hands over later. */
function deferred() {
  let resolve;
  const promise = new Promise((ok) => (resolve = ok));
  return { promise, resolve };
}

test("an older load that answers late doesn't overwrite a newer one", async () => {
  const first = deferred();
  const second = deferred();
  const answers = [first.promise, second.promise];
  const applied = [];
  const load = viewCardsLoader((cards) => applied.push(cards), () => answers.shift());
  const a = load(); // the page's first load
  const b = load(); // a refresh after editing a card
  second.resolve([card]);
  await b;
  first.resolve(null);
  await a;
  assert.deepEqual(applied, [[card]]);
});

// ---------------------------------------------------------------------------
// Assigned and Past Due belong to the person using the app: their profile
// member. They used to take the team's first human member, so on a team with
// two people one of them saw the other's cards (AB-162).

test("\"me\" isn't known until the preferences have loaded", () => {
  assert.equal(profileMember({ isLoaded: false, profileMemberId: 9 }), undefined);
  assert.equal(profileMember({ isLoaded: false, profileMemberId: null }), undefined);
});

test("once the preferences have loaded, \"me\" is the profile member, or no one yet", () => {
  assert.equal(profileMember({ isLoaded: true, profileMemberId: 9 }), 9);
  assert.equal(profileMember({ isLoaded: true, profileMemberId: null }), null);
});

test("a member list asks for that member's cards in one request, without the members", async () => {
  const urls = [];
  const fetchList = async (url) => {
    urls.push(url);
    return [card];
  };
  const fetchCards = memberViewFetcher(9, (id) => `/cards/${id}`, fetchList);
  assert.deepEqual(await fetchCards(), [card]);
  assert.deepEqual(await fetchCards(), [card]);
  assert.deepEqual(urls, ["/cards/9", "/cards/9"]);
});

test("a member list is empty, without asking for cards, when there's no profile yet", async () => {
  const urls = [];
  const fetchList = async (url) => {
    urls.push(url);
    return [card];
  };
  assert.deepEqual(await memberViewFetcher(null, (id) => `/cards/${id}`, fetchList)(), []);
  assert.deepEqual(urls, []);
});

test("a member list whose cards fail to load is a failure", async () => {
  const fetchList = async () => null;
  assert.equal(await memberViewFetcher(9, (id) => `/cards/${id}`, fetchList)(), null);
});

// ---------------------------------------------------------------------------
// What the list shows in each state.

const router = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {} };

function render(node, pathname = "/today") {
  return renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: router },
      h(PathnameContext.Provider, { value: pathname },
        h(PreferencesProvider, null,
          h(SidebarProvider, null, node)))),
  );
}

const list = (props) =>
  render(h(ListView, { cards: [], title: "Today", icon: h("svg"), emptyMessage: "No cards are due today.", onRefresh() {}, ...props }));

test("while loading, the list shows a loader, not an empty list or a zero count", () => {
  const html = list({ status: "loading" });
  assert.match(html, /role="status"/);
  assert.match(html, />Today</, "the header stays");
  assert.doesNotMatch(html, /No cards found/);
  assert.doesNotMatch(html, /0 cards/);
});

test("after an OK empty answer, the list shows its empty state and count", () => {
  const html = list({ status: "ready" });
  assert.match(html, /No cards found/);
  assert.match(html, /No cards are due today\./);
  assert.match(html, /0 cards/);
  assert.doesNotMatch(html, /role="status"/);
});

test("after a failed load, the list shows an error with Try again, not an empty list", () => {
  const html = list({ status: "failed" });
  assert.match(html, /role="alert"/);
  assert.match(html, /Couldn(&#x27;|')t load these cards/);
  assert.match(html, /<button[^>]*>Try again<\/button>/);
  assert.doesNotMatch(html, /No cards found/);
  assert.doesNotMatch(html, /0 cards/);
});

test("with cards, the list shows them and their count", () => {
  const html = list({ status: "ready", cards: [card] });
  assert.match(html, /Ship it/);
  assert.match(html, /1 card</);
});

for (const [name, Page, path] of [["Today", TodayPage, "/today"], ["Assigned to me", AssignedPage, "/assigned"], ["Past Due", PastDuePage, "/past-due"]]) {
  test(`${name}'s first paint is the loader, not "No cards found"`, () => {
    const html = render(h(Page), path);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /No cards found|No cards are|Nothing assigned to you/);
    assert.doesNotMatch(html, /0 cards/);
  });
}
