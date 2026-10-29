// Demo content for `node scripts/seed.js --demo` (and `npm run demo`): a few
// people and agents, and a Development board with cards in every column, so a
// fresh install has something to look at and something to test changes on.
//
// Runs once per team. The whole thing is one transaction that starts by
// claiming the `demo_seeded_at` setting, so a rerun finds the claim and adds
// nothing, a run that fails part way leaves nothing behind, and two runs at
// the same moment can't both insert. Matching on card titles instead would
// put a second copy back after someone renamed or moved a demo card.
//
// Expects the base seed (orgs, products, boards, columns) to exist already.

const { withClient } = require("../src/lib/sql");

const DEMO_PRODUCT = { org: "acme-corp", product: "web-app", board: "development" };

const MEMBERS = [
  { name: "Sam Rivera", type: "human", color: "#3B82F6" },
  { name: "Priya Shah", type: "human", color: "#EC4899" },
  { name: "Scout", type: "agent", color: "#10B981" },
  { name: "Patch", type: "agent", color: "#F59E0B" },
];

// column slug, title, assignee, priority, labels, due in days (null for none),
// sub-tasks as [title, done], links as [url, title]
const CARDS = [
  {
    column: "backlog",
    title: "Dark mode for the dashboard",
    description: "Customers keep asking. Needs a decision on whether charts follow the theme.",
    priority: "low",
    labels: "design,ui",
  },
  {
    column: "backlog",
    title: "Export a report as CSV",
    description: "Finance wants the monthly usage report as a spreadsheet.",
    priority: "medium",
    labels: "feature",
  },
  {
    column: "todo",
    title: "Rate-limit the public API",
    description: "Return 429 with a Retry-After header past 100 requests a minute per key.\n\nDone when: a burst test gets 429s and normal traffic doesn't.",
    assignee: "Patch",
    priority: "high",
    labels: "api,security",
    due: 5,
    subtasks: [
      ["Pick a limiter (token bucket)", true],
      ["Add the middleware", false],
      ["Document the limits", false],
    ],
  },
  {
    column: "todo",
    title: "Welcome email for new sign-ups",
    description: "One plain email with a link to the getting-started guide.",
    assignee: "Priya Shah",
    priority: "medium",
    labels: "growth",
    due: 9,
  },
  {
    column: "in-progress",
    title: "Fix the flaky checkout test",
    description: "checkout.spec fails about 1 run in 20 on CI. Looks like a race with the payment mock.",
    assignee: "Scout",
    priority: "high",
    labels: "bug,ci",
    due: 2,
    subtasks: [
      ["Reproduce locally with --repeat 50", true],
      ["Find the race", true],
      ["Fix and rerun 100 times", false],
    ],
  },
  {
    column: "in-progress",
    title: "Redesign the pricing page",
    description: "Three plans, annual toggle, FAQ at the bottom.",
    assignee: "Sam Rivera",
    priority: "medium",
    labels: "design,marketing",
    links: [["https://www.figma.com/", "Pricing page design"]],
  },
  {
    column: "blocked",
    title: "Move file uploads to the new storage bucket",
    description: "Blocked: waiting on the storage account to be approved.",
    assignee: "Patch",
    priority: "medium",
    labels: "infra",
  },
  {
    column: "in-review",
    title: "Search: match partial words",
    description: "\"inv\" should find \"invoice\". Prefix matching on the title and description.",
    assignee: "Scout",
    priority: "medium",
    labels: "feature,search",
    links: [["https://github.com/", "Pull request"]],
  },
  {
    column: "done",
    title: "Upgrade to Node 22",
    description: "CI and the Dockerfile are on Node 22. No code changes were needed.",
    assignee: "Scout",
    priority: "low",
    labels: "chore",
  },
  {
    column: "done",
    title: "Password reset link expires after an hour",
    description: "Links used to live forever.",
    assignee: "Sam Rivera",
    priority: "urgent",
    labels: "security,bug",
  },
];

/** A YYYY-MM-DD date `days` from today, or null. */
function dueDate(days) {
  if (days === null || days === undefined) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Add the demo content to `teamId`, once.
 * @param {number} teamId
 * @returns {Promise<{ seeded: boolean, cards: number }>}
 */
async function seedDemo(teamId) {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const claim = await client.query(
        `INSERT INTO settings (team_id, key, value) VALUES ($1, 'demo_seeded_at', $2)
         ON CONFLICT DO NOTHING RETURNING key`,
        [teamId, new Date().toISOString()],
      );
      if (claim.rows.length === 0) {
        await client.query("ROLLBACK");
        return { seeded: false, cards: 0 };
      }

      const { rows: columnRows } = await client.query(
        `SELECT col.id, col.slug
         FROM columns col
         JOIN boards b ON b.id = col.board_id
         JOIN products p ON p.id = b.product_id
         JOIN organizations o ON o.id = p.org_id
         WHERE o.team_id = $1 AND o.slug = $2 AND p.slug = $3 AND b.slug = $4`,
        [teamId, DEMO_PRODUCT.org, DEMO_PRODUCT.product, DEMO_PRODUCT.board],
      );
      const columns = new Map(columnRows.map((r) => [r.slug, r.id]));
      if (columns.size === 0) {
        throw new Error(
          `demo board ${DEMO_PRODUCT.org}/${DEMO_PRODUCT.product}/${DEMO_PRODUCT.board} not found; run the base seed first`,
        );
      }

      // Reuse a member with the same name, so a team whose agent already
      // registered as "Scout" gets that agent's cards instead of a duplicate.
      const members = new Map();
      for (const m of MEMBERS) {
        const { rows: existing } = await client.query(
          "SELECT id FROM members WHERE team_id = $1 AND LOWER(name) = LOWER($2) AND type = $3 ORDER BY id LIMIT 1",
          [teamId, m.name, m.type],
        );
        if (existing.length > 0) {
          members.set(m.name, existing[0].id);
          continue;
        }
        const { rows } = await client.query(
          "INSERT INTO members (team_id, name, type, color) VALUES ($1, $2, $3, $4) RETURNING id",
          [teamId, m.name, m.type, m.color],
        );
        members.set(m.name, rows[0].id);
      }

      const positions = new Map();
      for (const card of CARDS) {
        const columnId = columns.get(card.column);
        if (!columnId) throw new Error(`demo board has no ${card.column} column`);
        const position = positions.get(card.column) ?? 0;
        positions.set(card.column, position + 1);
        const { rows } = await client.query(
          `INSERT INTO cards (column_id, title, description, assignee, assignee_id, priority, labels, due_date, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            columnId,
            card.title,
            card.description ?? "",
            card.assignee ?? null,
            card.assignee ? members.get(card.assignee) : null,
            card.priority ?? "medium",
            card.labels ?? "",
            dueDate(card.due),
            position,
          ],
        );
        const cardId = rows[0].id;
        for (const [i, [title, done]] of (card.subtasks ?? []).entries()) {
          await client.query(
            "INSERT INTO subtasks (card_id, title, done, position) VALUES ($1, $2, $3, $4)",
            [cardId, title, done, i],
          );
        }
        for (const [url, title] of card.links ?? []) {
          await client.query("INSERT INTO card_links (card_id, url, title) VALUES ($1, $2, $3)", [cardId, url, title]);
        }
      }

      await client.query("COMMIT");
      return { seeded: true, cards: CARDS.length };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });
}

module.exports = { seedDemo, DEMO_PRODUCT, MEMBERS, CARDS };
