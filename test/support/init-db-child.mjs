// One app process starting up: runs `initDb()` against POSTGRES_URL and
// exits 0, or prints the error and exits 1. init-db-race-db.test.mjs starts
// two of these on one empty database at the same time, passing --start.
//
// `node --test test/` also picks up files under test/support/ and runs them
// as test files. Without --start this does nothing, so that run passes.

if (process.argv.includes("--start")) {
  const { register } = await import("node:module");
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
}
