#!/usr/bin/env node
// End-to-end check that another Next app can consume the core as a package.
//
//   POSTGRES_URL=postgres://... node scripts/verify-consumer.mjs [--next <version>] [--keep]
//
// Packs this repository with `npm pack` (what a `github:` or registry install
// gets), installs the tarball into a copy of test/consumer in a temporary
// directory next to the given Next version, builds it with `next build`,
// starts it, and drives it over HTTP:
//
//   - a request with no team is refused by the consumer's own resolver (401),
//     thrown from its instrumentation bundle and caught in a route bundle
//   - a team creates an org, a product and a card through the re-exported API
//     and reads the card back
//   - another team cannot read that card (404)
//   - the re-exported card permalink page resolves the card for its team and
//     404s for the other one, through configure()'s fromPage
//   - the re-exported board page renders, with the core's Tailwind classes
//     compiled into its stylesheet
//   - the consumer's own layout and settings page fill the core's UI slots:
//     a sidebar footer item, the settings scope, an extra settings section,
//     a default section left out and the consumer's own agent setup prompt
//   - the default-columns setting saves and reads back, and a member is renamed
//     and removed (and another team can't remove it), through the mounted routes
//
// The database must be one this run may create tables in. Team slugs are
// unique per run, so a database other runs used is fine.

import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const nextVersion = flag("--next") ?? pkg.devDependencies.next.replace(/^[\^~]/, "");
const keep = args.includes("--keep");
const databaseUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set POSTGRES_URL to a database this check may create tables in.");
  process.exit(2);
}

const run = (cmd, cmdArgs, cwd) => {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`);
  if (!ok) failures += 1;
}

const work = mkdtempSync(join(tmpdir(), "agentboard-consumer-"));
const app = join(work, "app");
let server;

try {
  run("npm", ["pack", "--silent", "--pack-destination", work], ROOT);
  const tarball = join(work, `stratuslabs-agentboard-core-${pkg.version}.tgz`);

  cpSync(join(ROOT, "test", "consumer"), app, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|\.next)([\\/]|$)/.test(src),
  });
  // Pinned so the run is reproducible; the peers come from the flags.
  const fixture = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  fixture.dependencies = {
    "@stratuslabs/agentboard-core": `file:${tarball}`,
    next: nextVersion,
    react: pkg.devDependencies.react,
    "react-dom": pkg.devDependencies["react-dom"],
    tailwindcss: pkg.devDependencies.tailwindcss,
    "@tailwindcss/postcss": pkg.devDependencies["@tailwindcss/postcss"],
    // The fixture's own components use the same icon set.
    "lucide-react": pkg.dependencies["lucide-react"],
  };
  fixture.devDependencies = {
    typescript: pkg.devDependencies.typescript,
    "@types/node": pkg.devDependencies["@types/node"],
    "@types/react": pkg.devDependencies["@types/react"],
    "@types/react-dom": pkg.devDependencies["@types/react-dom"],
  };
  writeFileSync(join(app, "package.json"), JSON.stringify(fixture, null, 2) + "\n");

  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], app);
  run("npx", ["next", "build"], app);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: app,
    env: { ...process.env, POSTGRES_URL: databaseUrl, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(`${base}/api/orgs`);
      break;
    } catch {
      if (Date.now() > deadline || server.exitCode !== null) throw new Error(`server did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const suffix = `${process.pid}-${Date.now().toString(36)}`;
  const teamA = `alpha-${suffix}`;
  const teamB = `bravo-${suffix}`;
  const call = async (team, path, { method = "GET", body } = {}) => {
    const headers = { "content-type": "application/json" };
    if (team) headers["x-team"] = team;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data, location: res.headers.get("location") };
  };

  const anonymous = await call(null, "/api/orgs");
  check("no team: the consumer's resolver refuses with 401", anonymous.status === 401, JSON.stringify(anonymous));

  const org = await call(teamA, "/api/orgs", { method: "POST", body: { name: "Consumer Org" } });
  check("team A creates an org", org.status === 201, JSON.stringify(org));
  const product = await call(teamA, "/api/products", { method: "POST", body: { org_id: org.data.id, name: "Consumer Product" } });
  check("team A creates a product", product.status === 201, JSON.stringify(product));
  const board = await call(teamA, `/api/board?product_id=${product.data.id}`);
  const column = board.data?.columns?.[0];
  check("the product has its default board and columns", board.status === 200 && !!column, JSON.stringify(board));

  const title = `Made through the consumer ${suffix}`;
  const card = await call(teamA, "/api/cards", { method: "POST", body: { column_id: column?.id, title } });
  check("team A creates a card", card.status === 201, JSON.stringify(card));
  const read = await call(teamA, `/api/cards/${card.data.id}`);
  check("team A reads the card back", read.status === 200 && read.data?.title === title, JSON.stringify(read));

  const other = await call(teamB, `/api/cards/${card.data.id}`);
  check("team B cannot read team A's card", other.status === 404, JSON.stringify(other));
  const otherOrgs = await call(teamB, "/api/orgs");
  check("team B sees none of team A's orgs", otherOrgs.status === 200 && Array.isArray(otherOrgs.data) && otherOrgs.data.length === 0, JSON.stringify(otherOrgs));

  const permalink = await call(teamA, `/c/${card.data.id}`);
  const expected = `/${org.data.slug}/${product.data.slug}?card=${card.data.id}`;
  check(
    "the card permalink page resolves the card for team A",
    [303, 307, 308].includes(permalink.status) && (permalink.location ?? "").endsWith(expected),
    `${permalink.status} ${permalink.location} (want ${expected})`,
  );
  const otherPermalink = await call(teamB, `/c/${card.data.id}`);
  check("the card permalink page is a 404 for team B", otherPermalink.status === 404, String(otherPermalink.status));

  const page = await call(teamA, `/${org.data.slug}/${product.data.slug}`);
  check(
    "the board page renders with the core's layout",
    page.status === 200 && typeof page.data === "string" && page.data.includes("<title>AgentBoard</title>"),
    `${page.status} ${String(page.data).slice(0, 200)}`,
  );

  const bySlug = await call(teamA, `/api/products/by-slug?org_slug=${org.data.slug}&product_slug=${product.data.slug}`);
  check("the board page's product lookup finds team A's product", bySlug.status === 200 && bySlug.data?.id === product.data.id, JSON.stringify(bySlug));

  const html = String(page.data);
  check(
    "the consumer's sidebar footer slot renders in the core's sidebar",
    html.includes('data-consumer-slot="sidebar-footer"') && html.includes("Consumer Team") && html.includes(">Settings<"),
    html.slice(0, 200),
  );

  const settings = await call(teamA, "/settings");
  const settingsHtml = String(settings.data);
  check(
    "the settings page shows the consumer's scope and its own section next to the core's",
    settings.status === 200 &&
      settingsHtml.includes('data-consumer-slot="settings-scope"') &&
      settingsHtml.includes("Consumer billing") &&
      settingsHtml.includes("Default columns"),
    `${settings.status} ${settingsHtml.slice(0, 200)}`,
  );
  check(
    "the connect section shows the consumer's agent setup prompt instead of the core's",
    settingsHtml.includes("Consumer setup prompt") && !settingsHtml.includes("npm install -g agentboard"),
    settingsHtml.includes("npm install -g agentboard") ? "found the core's prompt" : "no consumer prompt",
  );
  check("a section the consumer left out is not rendered", !settingsHtml.includes("Agent default board"), "found Agent default board");

  // The settings sections and the members section the consumer keeps call
  // these routes; a fixture that doesn't mount them 404s behind the UI.
  const saved = await call(teamA, "/api/settings", { method: "PATCH", body: { key: "default_columns", value: ["Todo", "Doing", "Done"] } });
  const settingsBack = await call(teamA, "/api/settings");
  check(
    "a default-columns setting saves and reads back through the consumer",
    saved.status === 200 && JSON.stringify(settingsBack.data?.default_columns) === JSON.stringify(["Todo", "Doing", "Done"]),
    `${saved.status} ${JSON.stringify(settingsBack.data)}`,
  );
  const member = await call(teamA, "/api/members", { method: "POST", body: { name: `Consumer Agent ${suffix}`, type: "agent" } });
  const renamed = await call(teamA, `/api/members/${member.data?.id}`, { method: "PATCH", body: { name: `Renamed Agent ${suffix}` } });
  check("a member is renamed through the consumer", member.status === 201 && renamed.status === 200 && renamed.data?.name === `Renamed Agent ${suffix}`, `${member.status} ${renamed.status} ${JSON.stringify(renamed.data)}`);
  const otherRemove = await call(teamB, `/api/members/${member.data?.id}`, { method: "DELETE" });
  check("team B cannot remove team A's member", otherRemove.status === 404, String(otherRemove.status));
  const removed = await call(teamA, `/api/members/${member.data?.id}`, { method: "DELETE" });
  const membersAfter = await call(teamA, "/api/members");
  check(
    "a member is removed through the consumer",
    removed.status === 200 && Array.isArray(membersAfter.data) && !membersAfter.data.some((m) => m.id === member.data?.id),
    `${removed.status} ${JSON.stringify(membersAfter.data)}`,
  );

  // Tailwind skips node_modules unless told otherwise, so check the compiled
  // stylesheet has a class only the core's components use.
  const sheets = [...String(page.data).matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
  let css = "";
  for (const href of sheets) css += await (await fetch(new URL(href, base))).text();
  check("the stylesheet includes the core's classes", /\.bg-bg\b/.test(css) && /\.bg-surface-1\b/.test(css), `${sheets.length} sheet(s), ${css.length} bytes`);

  if (failures) console.log(`\nserver log:\n${log}`);
} catch (err) {
  console.error(err);
  failures += 1;
} finally {
  if (server && server.exitCode === null) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  if (keep) console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed (next ${nextVersion})` : `\nconsumer fixture ok (next ${nextVersion})`);
process.exit(failures ? 1 : 0);
