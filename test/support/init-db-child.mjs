// One app process starting up: runs `initDb()` against POSTGRES_URL and
// exits 0, or prints the error and exits 1. Used by init-db-race-db.test.mjs
// to start two processes on one empty database at the same time.

import { register } from "node:module";

register("./ts-loader.mjs", import.meta.url);

const { initDb } = await import(new URL("../../src/lib/db.ts", import.meta.url).href);
const { end } = await import(new URL("../../src/lib/sql.js", import.meta.url).href);

let code = 0;
try {
  await initDb();
} catch (err) {
  console.error(`${err.code ?? ""} ${err.message}`.trim());
  code = 1;
}
await end();
process.exit(code);
