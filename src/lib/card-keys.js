"use strict";

/**
 * Human-readable card ids, Linear style: every product has a short key (AB)
 * and its own counter, so a card reads as AB-142 instead of a number shared by
 * every product on the instance.
 *
 * The internal `cards.id` stays the stable identity. A card's number lives in
 * `card_numbers (product_id, number, card_id)`, and the rows are never reused
 * or removed while the product exists. So:
 *
 *  - a card that moves to another product gets that product's next number,
 *    and its old KEY-N still finds it;
 *  - a card that moves back gets its old number back;
 *  - a product whose key changes keeps the old one in `product_keys`, so
 *    links that used it keep working, and no other product can take it.
 *
 * Numbers are assigned by a database trigger, not by the routes, so every way
 * a card is created or moved (API, CLI, a script, the hosted edition) gets
 * one. The counter is a row on `products` bumped with UPDATE ... RETURNING,
 * whose row lock serializes concurrent creates in the same product.
 *
 * CommonJS so `scripts/setup-db.js` can share it with `src/lib/db.ts`.
 */

/** Largest value a Postgres INTEGER can hold. */
const MAX_INT = 2147483647;

/** A product key: a letter, then 1-9 letters or digits. */
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** A card reference: a numeric id, or KEY-N in any case. */
const REF_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,9})-([1-9][0-9]{0,9})$/;
const ID_PATTERN = /^[1-9][0-9]{0,9}$/;

/** Derived keys are kept short. A typed key may be longer. */
const DERIVED_MAX = 5;

/**
 * A key for a product name: the first letter of each word plus any capitals
 * inside a word, so "AgentBoard" is AB, "OpenKB" is OKB and "developer tools"
 * is DT. A single plain word uses its first three letters ("marketing" is
 * MAR). If the result is already taken, the lowest free number is appended
 * (AB2, AB3, ...).
 *
 * @param {string} name
 * @param {Set<string>} [taken] keys any product has or had
 * @returns {string}
 */
function deriveProductKey(name, taken = new Set()) {
  const ascii = String(name ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "");
  const words = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);

  let base = "";
  for (const word of words) {
    base += word[0] + word.slice(1).replace(/[^A-Z]/g, "");
  }
  base = base.toUpperCase();
  if (base.length < 2) base = words.join("").slice(0, 3).toUpperCase();
  if (!base) base = "PRD";
  if (!/^[A-Z]/.test(base)) base = "P" + base;
  base = base.slice(0, DERIVED_MAX);
  if (base.length < 2) base = (base + base).slice(0, 2);

  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * A key someone typed, uppercased, or why it can't be one.
 * @param {unknown} raw
 * @returns {{ key: string } | { error: string }}
 */
function normalizeProductKey(raw) {
  if (typeof raw !== "string") return { error: "key must be a string" };
  const key = raw.trim().toUpperCase();
  if (!KEY_PATTERN.test(key)) {
    return { error: "key must be 2-10 letters or digits and start with a letter, like AB or OPS2" };
  }
  return { key };
}

/**
 * A card reference from a URL segment or CLI argument: `{ id }` for a numeric
 * id, `{ key, number }` for KEY-N (any case), or null for anything else.
 * Strict like parseCardId: a value Postgres can't cast must never reach a
 * query.
 *
 * @param {unknown} raw
 * @returns {{ id: number } | { key: string, number: number } | null}
 */
function parseCardRef(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw);
  if (ID_PATTERN.test(text)) {
    const id = Number(text);
    return id <= MAX_INT ? { id } : null;
  }
  const match = REF_PATTERN.exec(text);
  if (!match) return null;
  const number = Number(match[2]);
  if (number > MAX_INT) return null;
  return { key: match[1].toUpperCase(), number };
}

/**
 * @param {string | null | undefined} productKey
 * @param {number | null | undefined} number
 * @returns {string | null}
 */
function formatCardKey(productKey, number) {
  if (!productKey || number === null || number === undefined) return null;
  return `${productKey}-${number}`;
}

/**
 * Schema, allocator and backfill, as one statement so Postgres applies it
 * atomically. The advisory lock makes a second instance starting at the same
 * time wait, then find nothing left to do. Safe to run on every startup.
 *
 * Shared by `ensureTables()` in src/lib/db.ts and scripts/setup-db.js so the
 * two cannot drift.
 */
const CARD_NUMBER_MIGRATION = `
DO $migration$
DECLARE
  r RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(602602);

  ALTER TABLE products ADD COLUMN IF NOT EXISTS key TEXT;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS card_seq INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX IF NOT EXISTS products_key_idx ON products (key);
  -- Every key a product has ever had, its current one included. One table,
  -- so one primary key keeps a key from ever meaning two products: a
  -- product's old keys stay its own, and links made with them keep working.
  CREATE TABLE IF NOT EXISTS product_keys (
    key TEXT PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE
  );
  INSERT INTO product_keys (key, product_id)
    SELECT key, id FROM products WHERE key IS NOT NULL
    ON CONFLICT (key) DO NOTHING;

  -- products.key is the current key; this records it in product_keys, or
  -- refuses it when another product has ever had it. ON CONFLICT waits for a
  -- concurrent writer and then sees its committed row, so two renames racing
  -- for one key cannot both win.
  CREATE OR REPLACE FUNCTION agentboard_products_key()
  RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    IF NEW.key IS NULL THEN
      RETURN NULL;
    END IF;
    INSERT INTO product_keys (key, product_id) VALUES (NEW.key, NEW.id)
      ON CONFLICT (key) DO UPDATE SET product_id = EXCLUDED.product_id
      WHERE product_keys.product_id = EXCLUDED.product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Key % is already used by another product', NEW.key
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'product_keys_pkey';
    END IF;
    RETURN NULL;
  END
  $fn$;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'products_key' AND tgrelid = 'products'::regclass) THEN
    CREATE TRIGGER products_key AFTER INSERT OR UPDATE OF key ON products
      FOR EACH ROW EXECUTE FUNCTION agentboard_products_key();
  END IF;

  ALTER TABLE cards ADD COLUMN IF NOT EXISTS number INTEGER;
  -- card_id is checked at commit: the trigger below writes this row in a
  -- BEFORE INSERT, before the card row itself exists.
  CREATE TABLE IF NOT EXISTS card_numbers (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    PRIMARY KEY (product_id, number)
  );
  CREATE INDEX IF NOT EXISTS card_numbers_card_idx ON card_numbers (card_id, product_id);

  -- The card's number in a product: the one it already had there, or the
  -- product's next one.
  CREATE OR REPLACE FUNCTION agentboard_card_number(p_product INTEGER, p_card INTEGER)
  RETURNS INTEGER LANGUAGE plpgsql AS $fn$
  DECLARE
    n INTEGER;
  BEGIN
    IF p_product IS NULL OR p_card IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT number INTO n FROM card_numbers
      WHERE product_id = p_product AND card_id = p_card
      ORDER BY number DESC LIMIT 1;
    IF FOUND THEN
      RETURN n;
    END IF;
    UPDATE products SET card_seq = card_seq + 1 WHERE id = p_product RETURNING card_seq INTO n;
    INSERT INTO card_numbers (product_id, number, card_id) VALUES (p_product, n, p_card);
    RETURN n;
  END
  $fn$;

  CREATE OR REPLACE FUNCTION agentboard_cards_number()
  RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    NEW.number := agentboard_card_number(
      (SELECT b.product_id FROM columns c JOIN boards b ON b.id = c.board_id WHERE c.id = NEW.column_id),
      NEW.id
    );
    RETURN NEW;
  END
  $fn$;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cards_number' AND tgrelid = 'cards'::regclass) THEN
    CREATE TRIGGER cards_number BEFORE INSERT OR UPDATE OF column_id ON cards
      FOR EACH ROW EXECUTE FUNCTION agentboard_cards_number();
  END IF;

  -- Cards from before this migration, numbered per product in the order
  -- they were created. Only cards without a number, so this is a no-op once
  -- done.
  FOR r IN
    SELECT c.id, b.product_id
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    JOIN boards b ON b.id = col.board_id
    WHERE c.number IS NULL
    ORDER BY b.product_id, c.created_at, c.id
  LOOP
    UPDATE cards SET number = agentboard_card_number(r.product_id, r.id) WHERE id = r.id;
  END LOOP;
END
$migration$;
`;

/**
 * @typedef {(text: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number | null }>} Query
 */

/** Every key any product has, current or old. @param {Query} query */
async function takenKeys(query) {
  const { rows } = await query("SELECT key FROM product_keys");
  return new Set(rows.map((r) => r.key));
}

/** @param {unknown} err */
function isUniqueViolation(err) {
  return Boolean(err && typeof err === "object" && /** @type {any} */ (err).code === "23505");
}

/**
 * Give every product without a key one derived from its name. Idempotent, and
 * safe against another instance doing the same: a key is only set where none
 * is, and a key someone else took first is retried.
 *
 * @param {Query} query
 */
async function ensureProductKeys(query) {
  const { rows } = await query("SELECT id, name FROM products WHERE key IS NULL ORDER BY id");
  for (const product of rows) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = deriveProductKey(product.name, await takenKeys(query));
      try {
        await query("UPDATE products SET key = $1 WHERE id = $2 AND key IS NULL", [key, product.id]);
        break;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
  }
}

/**
 * A key for a new product: the one asked for, or one derived from its name.
 *
 * @param {Query} query
 * @param {string} name
 * @param {unknown} requested `undefined` to derive one
 * @returns {Promise<{ key: string } | { error: string, status: number }>}
 */
async function keyForNewProduct(query, name, requested) {
  const taken = await takenKeys(query);
  if (requested === undefined || requested === null || requested === "") {
    return { key: deriveProductKey(name, taken) };
  }
  const parsed = normalizeProductKey(requested);
  if ("error" in parsed) return { error: parsed.error, status: 400 };
  if (taken.has(parsed.key)) {
    return { error: `Key ${parsed.key} is already used by another product`, status: 409 };
  }
  return parsed;
}

/**
 * Create a product with a key: the one asked for, or one derived from its
 * name. `insert(key)` writes the row and returns it.
 *
 * @template T
 * @param {Query} query
 * @param {string} name
 * @param {unknown} requested `undefined` to derive one
 * @param {(key: string) => Promise<T>} insert
 * @returns {Promise<{ product: T, key: string } | { error: string, status: number }>}
 */
async function createProductWithKey(query, name, requested, insert) {
  const key = await keyForNewProduct(query, name, requested);
  if ("error" in key) return key;
  try {
    return { product: await insert(key.key), key: key.key };
  } catch (err) {
    if (isKeyConflict(err)) return { error: `Key ${key.key} is already used by another product`, status: 409 };
    throw err;
  }
}

/**
 * Change a product's key. The old key stays the product's, so AB-142 links
 * made before the change still resolve, and the product can take it back.
 * The products_key trigger refuses a key another product has ever had.
 *
 * Run it inside the caller's transaction to make it part of a larger change.
 *
 * @param {Query} query
 * @param {number} productId
 * @param {unknown} rawKey
 * @returns {Promise<{ product: any } | { error: string, status: number }>}
 */
async function changeProductKey(query, productId, rawKey) {
  const parsed = normalizeProductKey(rawKey);
  if ("error" in parsed) return { error: parsed.error, status: 400 };
  const { key } = parsed;
  try {
    const { rows } = await query("UPDATE products SET key = $2 WHERE id = $1 RETURNING *", [productId, key]);
    return rows.length > 0 ? { product: rows[0] } : { error: "Not found", status: 404 };
  } catch (err) {
    if (isKeyConflict(err)) return { error: `Key ${key} is already used by another product`, status: 409 };
    throw err;
  }
}

/**
 * Whether an error is a product key that is already taken, as opposed to
 * some other unique constraint.
 * @param {unknown} err
 */
function isKeyConflict(err) {
  if (!isUniqueViolation(err)) return false;
  const constraint = /** @type {any} */ (err).constraint;
  return constraint === "products_key_idx" || constraint === "product_keys_pkey";
}

/**
 * The internal id a card reference points at, or null when it points at
 * nothing. KEY-N matches a product's current key or one of its old ones, and
 * a number the card had before it moved to another product.
 *
 * @param {Query} query
 * @param {unknown} raw
 * @returns {Promise<number | null>}
 */
async function resolveCardRef(query, raw) {
  const ref = parseCardRef(raw);
  if (!ref) return null;
  if ("id" in ref) return ref.id;
  const { rows } = await query(
    `SELECT cn.card_id
     FROM card_numbers cn
     JOIN cards c ON c.id = cn.card_id
     WHERE cn.number = $2
       AND cn.product_id = (SELECT product_id FROM product_keys WHERE key = $1)`,
    [ref.key, ref.number]
  );
  return rows.length > 0 ? rows[0].card_id : null;
}

module.exports = {
  CARD_NUMBER_MIGRATION,
  KEY_PATTERN,
  deriveProductKey,
  normalizeProductKey,
  parseCardRef,
  formatCardKey,
  ensureProductKeys,
  keyForNewProduct,
  createProductWithKey,
  changeProductKey,
  isKeyConflict,
  resolveCardRef,
};
