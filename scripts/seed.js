const { sql } = require("@vercel/postgres");

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

async function seed() {
  // Insert orgs
  const orgMap = {};
  for (let i = 0; i < seedData.orgs.length; i++) {
    const org = seedData.orgs[i];
    const { rows } = await sql`
      INSERT INTO organizations (name, slug, position)
      VALUES (${org.name}, ${org.slug}, ${i})
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `;
    if (rows.length > 0) {
      orgMap[org.slug] = rows[0].id;
    } else {
      const { rows: existing } = await sql`SELECT id FROM organizations WHERE slug = ${org.slug}`;
      orgMap[org.slug] = existing[0].id;
    }
  }

  // Insert products with default boards and columns
  for (let i = 0; i < seedData.products.length; i++) {
    const product = seedData.products[i];
    const orgId = orgMap[product.org];
    const productSlug = slugify(product.name);

    const { rows } = await sql`
      INSERT INTO products (org_id, name, slug, emoji, position)
      VALUES (${orgId}, ${product.name}, ${productSlug}, ${product.emoji}, ${i})
      ON CONFLICT (org_id, slug) DO NOTHING
      RETURNING id
    `;

    let productId;
    if (rows.length > 0) {
      productId = rows[0].id;
    } else {
      const { rows: existing } = await sql`SELECT id FROM products WHERE org_id = ${orgId} AND slug = ${productSlug}`;
      productId = existing[0].id;
    }

    // Create default boards and columns
    for (let bi = 0; bi < DEFAULT_BOARDS.length; bi++) {
      const boardName = DEFAULT_BOARDS[bi];
      const boardSlug = slugify(boardName);

      const { rows: boardRows } = await sql`
        INSERT INTO boards (product_id, name, slug, position)
        VALUES (${productId}, ${boardName}, ${boardSlug}, ${bi})
        ON CONFLICT (product_id, slug) DO NOTHING
        RETURNING id
      `;

      let boardId;
      if (boardRows.length > 0) {
        boardId = boardRows[0].id;
      } else {
        const { rows: existing } = await sql`SELECT id FROM boards WHERE product_id = ${productId} AND slug = ${boardSlug}`;
        boardId = existing[0].id;
      }

      for (let ci = 0; ci < DEFAULT_COLUMNS.length; ci++) {
        const col = DEFAULT_COLUMNS[ci];
        await sql`
          INSERT INTO columns (board_id, name, slug, position, color)
          VALUES (${boardId}, ${col.name}, ${slugify(col.name)}, ${ci}, ${col.color})
          ON CONFLICT (board_id, slug) DO NOTHING
        `;
      }
    }
  }

  console.log("Seed data inserted successfully.");
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
