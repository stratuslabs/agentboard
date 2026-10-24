const { sql, db, end } = require("../src/lib/sql");
const { ensureProductKeys } = require("../src/lib/card-keys");

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const DEFAULT_BOARDS = ["Development", "Marketing", "Sales", "Support"];
const { DEFAULT_COLUMNS } = require("../src/lib/default-columns");

const seedData = {
  orgs: [
    { name: "Acme Corp", slug: "acme-corp" },
    { name: "Side Projects", slug: "side-projects" },
  ],
  products: [
    { org: "acme-corp", name: "Web App", emoji: "🌐" },
    { org: "acme-corp", name: "Mobile App", emoji: "📱" },
    { org: "acme-corp", name: "AgentBoard", emoji: "📋" },
    { org: "side-projects", name: "Marketing Site", emoji: "🎨" },
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
      if (bi === 0) {
        await sql`UPDATE products SET default_board_id = ${boardId} WHERE id = ${productId} AND default_board_id IS NULL`;
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

  // Products inserted here have no key (AB) yet, and the app only fills in
  // missing keys when it starts.
  await ensureProductKeys((text, values) => db.query(text, values));

  console.log("Seed data inserted successfully.");
}

seed()
  .then(() => end())
  .catch(async (err) => {
    console.error("Seed failed:", err.message);
    await end().catch(() => {});
    process.exit(1);
  });
