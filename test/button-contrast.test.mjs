// Text on a filled Button stays readable: every variant with a solid
// background keeps its label at 4.5:1 or better (WCAG AA for the 13px text
// the buttons use), at rest and on hover. Reads the colors from the theme in
// globals.css and the classes from Button.tsx, so a token or class change that
// drops below AA fails here instead of in an axe pass on a live dialog.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const button = readFileSync(new URL("../src/components/ui/Button.tsx", import.meta.url), "utf8");

const theme = { white: "#ffffff", black: "#000000" };
for (const [, name, hex] of css.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) theme[name] = hex.toLowerCase();

const block = button.match(/const VARIANTS[^{]*\{([\s\S]*?)\n\};/);
assert.ok(block, "Button.tsx has a VARIANTS map");
const variants = {};
for (const [, name, classes] of block[1].matchAll(/^\s*"?([\w-]+)"?:\s*"([^"]*)",?\s*$/gm)) variants[name] = classes.split(/\s+/);

const channels = (hex) => [16, 8, 0].map((s) => (parseInt(hex.slice(1), 16) >> s) & 255);
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// Tailwind's brightness-N filter scales each channel by N/100.
const brighten = (hex, pct) =>
  "#" + channels(hex).map((c) => Math.min(255, Math.round((c * pct) / 100)).toString(16).padStart(2, "0")).join("");

// A solid color class (no /opacity) for the given prefix, resolved to hex.
function color(classes, prefix) {
  for (const cls of classes) {
    if (!cls.startsWith(prefix)) continue;
    const name = cls.slice(prefix.length);
    if (name.includes("/") || !(name in theme)) continue;
    return theme[name];
  }
  return null;
}

const filled = Object.entries(variants).filter(([, classes]) => color(classes, "bg-"));

test("the theme and the Button variants parse", () => {
  assert.ok(Object.keys(theme).length > 10, "theme colors found in globals.css");
  assert.ok("danger" in variants && "primary" in variants, "danger and primary variants found");
  assert.ok(filled.some(([name]) => name === "danger"), "danger is a filled variant");
});

for (const [name, classes] of filled) {
  const bg = color(classes, "bg-");
  const fg = color(classes, "text-");

  test(`${name} button text is at least 4.5:1 at rest`, () => {
    assert.ok(fg, `${name} sets a solid text color`);
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
  });

  test(`${name} button text is at least 4.5:1 on hover`, () => {
    const hoverFg = color(classes, "hover:text-") ?? fg;
    let hoverBg = color(classes, "hover:bg-") ?? bg;
    const filter = classes.find((c) => /^hover:brightness-\d+$/.test(c));
    if (filter) hoverBg = brighten(hoverBg, Number(filter.split("-").pop()));
    const r = ratio(hoverFg, hoverBg);
    assert.ok(r >= 4.5, `${name}: ${hoverFg} on ${hoverBg} is ${r.toFixed(2)}:1 on hover`);
  });
}
