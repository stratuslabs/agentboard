import { useEffect } from "react";

export const APP_TITLE = "AgentBoard";
const SEPARATOR = " > ";

/**
 * Builds a browser tab title, most specific first and the app name last:
 * `pageTitle("Fix login", "Sprint", "Website")` gives
 * "Fix login > Sprint > Website > AgentBoard". Missing or blank parts are
 * skipped, so a title still reads cleanly while data is loading.
 */
export function pageTitle(...parts: (string | null | undefined)[]): string {
  const named = parts.map((p) => p?.trim()).filter((p): p is string => !!p);
  return [...named, APP_TITLE].join(SEPARATOR);
}

/**
 * Keeps `document.title` in step with what the screen shows. Client pages own
 * their data here, so the title is set from the client rather than through
 * Next metadata. On unmount it goes back to the plain app name, so leaving a
 * board does not leave its name on a page that has no title of its own.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => () => {
    document.title = APP_TITLE;
  }, []);
}
