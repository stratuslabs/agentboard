// A static-markup check for axe's nested-interactive rule (WCAG 4.1.2): an
// interactive element, such as a link or a button, inside another one. A
// screen reader may read the outer element as one control and hide the inner
// ones. Used by tests that server-render a component.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** An attribute's value in an opening tag, or undefined. */
export const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** True when an element is interactive the way axe's nested-interactive rule means it. */
function interactive(name, tag) {
  if (name === "a" && attr(tag, "href") !== undefined) return true;
  if (["button", "input", "select", "textarea"].includes(name)) return true;
  const role = attr(tag, "role");
  if (role && /^(button|link|checkbox|menuitem|option|radio|switch|tab|textbox)$/.test(role)) return true;
  const tabindex = attr(tag, "tabindex");
  return tabindex !== undefined && Number(tabindex) >= 0;
}

/** Each interactive element inside another interactive element, as "outer > inner" opening tags. */
export function nestedInteractive(html) {
  const found = [];
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const [tag, closing, name, selfClosing] = m;
    if (closing) {
      const i = stack.findLastIndex((e) => e.name === name);
      if (i >= 0) stack.length = i;
      continue;
    }
    const isInteractive = interactive(name, tag);
    if (isInteractive) {
      const outer = stack.findLast((e) => e.interactive);
      if (outer) found.push(`${outer.tag} > ${tag}`);
    }
    if (!selfClosing && !VOID.has(name)) stack.push({ name, tag, interactive: isInteractive });
  }
  return found;
}
