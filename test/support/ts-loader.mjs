// Lets a test import the app's TypeScript (route handlers, src/lib/*.ts) the
// way Next does: `@/…` resolves to src/, extensionless imports find their
// .ts/.tsx/.js file, and TypeScript is transpiled on load. Type-checking is
// tsc's job, not this one's.
//
// Register it before importing app code:
//
//   import { register } from "node:module";
//   register("./support/ts-loader.mjs", import.meta.url);
//   const route = await import("../src/app/api/orgs/route.ts");

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import ts from "typescript";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = pathToFileURL(resolvePath(ROOT, "src") + "/").href;

function withExtension(url) {
  if (/\.(m?[jt]sx?|json)$/i.test(url)) return url;
  for (const candidate of [`${url}.ts`, `${url}.tsx`, `${url}.js`, `${url}/index.ts`, `${url}/index.tsx`]) {
    if (existsSync(new URL(candidate))) return candidate;
  }
  return url;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(withExtension(SRC + specifier.slice(2)), context);
  }
  // next/server and friends are CommonJS files without an exports map, which
  // Next's bundler finds and Node's ESM resolver doesn't.
  if (/^next\/[a-z-]+$/.test(specifier)) {
    return nextResolve(`${specifier}.js`, context);
  }
  if (specifier.startsWith(".") && /\.tsx?$/.test(context.parentURL ?? "")) {
    return nextResolve(withExtension(new URL(specifier, context.parentURL).href), context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // The bundler imports JSON without an attribute; Node wants one.
  if (url.endsWith(".json")) {
    return nextLoad(url, { ...context, importAttributes: { ...context.importAttributes, type: "json" } });
  }
  if (!/\.tsx?$/.test(url)) return nextLoad(url, context);
  const source = await readFile(new URL(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
