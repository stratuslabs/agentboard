const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.AGENTBOARD_DB || path.join(process.cwd(), "agentboard.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const DEFAULT_BOARDS = ["Development", "Marketing", "Sales", "Support"];
const DEFAULT_COLUMNS = [
  { name: "Backlog", color: "#6B7280" },
  { name: "Todo", color: "#3B82F6" },
  { name: "In Progress", color: "#F59E0B" },
  { name: "In Review", color: "#8B5CF6" },
  { name: "Done", color: "#10B981" },
];

const seedData = {
  orgs: [
    { name: "Stratus Labs", slug: "stratus-labs" },
    { name: "Stellar Software", slug: "stellar-software" },
    { name: "Sarasota Design", slug: "sarasota-design" },
  ],
  products: [
    { org: "stratus-labs", name: "Kaboodle", emoji: "🧶" },
    { org: "stratus-labs", name: "2AM", emoji: "🌙" },
    { org: "stratus-labs", name: "AgentBoard", emoji: "📋" },
    { org: "stellar-software", name: "Stellar", emoji: "⭐" },
    { org: "sarasota-design", name: "Agency", emoji: "🎨" },
  ],
};

const insertOrg = db.prepare(
  "INSERT OR IGNORE INTO organizations (name, slug, position) VALUES (?, ?, ?)"
);
const insertProduct = db.prepare(
  "INSERT OR IGNORE INTO products (org_id, name, slug, emoji, position) VALUES (?, ?, ?, ?, ?)"
);
const insertBoard = db.prepare(
  "INSERT OR IGNORE INTO boards (product_id, name, slug, position) VALUES (?, ?, ?, ?)"
);
const insertColumn = db.prepare(
  "INSERT OR IGNORE INTO columns (board_id, name, slug, position, color) VALUES (?, ?, ?, ?, ?)"
);

const seed = db.transaction(() => {
  // Insert orgs
  const orgMap = {};
  seedData.orgs.forEach((org, i) => {
    const result = insertOrg.run(org.name, org.slug, i);
    if (result.changes > 0) {
      orgMap[org.slug] = result.lastInsertRowid;
    } else {
      const row = db.prepare("SELECT id FROM organizations WHERE slug = ?").get(org.slug);
      orgMap[org.slug] = row.id;
    }
  });

  // Insert products with default boards and columns
  seedData.products.forEach((product, i) => {
    const orgId = orgMap[product.org];
    const productSlug = slugify(product.name);
    const result = insertProduct.run(orgId, product.name, productSlug, product.emoji, i);

    let productId;
    if (result.changes > 0) {
      productId = result.lastInsertRowid;
    } else {
      const row = db.prepare("SELECT id FROM products WHERE org_id = ? AND slug = ?").get(orgId, productSlug);
      productId = row.id;
    }

    // Create default boards and columns
    DEFAULT_BOARDS.forEach((boardName, bi) => {
      const boardSlug = slugify(boardName);
      const boardResult = insertBoard.run(productId, boardName, boardSlug, bi);

      let boardId;
      if (boardResult.changes > 0) {
        boardId = boardResult.lastInsertRowid;
      } else {
        const row = db.prepare("SELECT id FROM boards WHERE product_id = ? AND slug = ?").get(productId, boardSlug);
        boardId = row.id;
      }

      DEFAULT_COLUMNS.forEach((col, ci) => {
        insertColumn.run(boardId, col.name, slugify(col.name), ci, col.color);
      });
    });
  });
});

seed();

console.log("Seed data inserted successfully.");
db.close();
