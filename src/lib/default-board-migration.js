"use strict";

/**
 * Adds `products.default_board_id` and, in the same statement, gives every
 * product that already existed its `development` board as the default (the
 * board the CLI used to assume).
 *
 * It is one `DO` block on purpose. Postgres runs a single statement
 * atomically, so the column and the backfill land together or not at all. If
 * they were separate statements, a crash between them would leave the column
 * in place and every later startup would see it and skip the backfill for
 * good. Once the column exists this does nothing, so a default someone
 * cleared stays cleared.
 *
 * Shared by `ensureTables()` in src/lib/db.ts and scripts/setup-db.js so the
 * two cannot drift.
 */
const DEFAULT_BOARD_MIGRATION = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'products'
      AND column_name = 'default_board_id'
  ) THEN
    ALTER TABLE products ADD COLUMN IF NOT EXISTS default_board_id INTEGER REFERENCES boards(id) ON DELETE SET NULL;
    UPDATE products p SET default_board_id = b.id
    FROM boards b
    WHERE b.product_id = p.id AND b.slug = 'development' AND p.default_board_id IS NULL;
  END IF;
END
$$;
`;

module.exports = { DEFAULT_BOARD_MIGRATION };
