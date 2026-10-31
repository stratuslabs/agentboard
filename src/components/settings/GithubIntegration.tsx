"use client";

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button, GithubIcon } from "../ui";

interface Installation { installation_id: string; account_login: string | null; created_at: string }
type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; enabled: boolean; installations: Installation[] };
type Notice = { kind: "connected" } | { kind: "error"; message: string } | null;

const ENV_VARS = ["GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_WEBHOOK_SECRET"];

/**
 * Take ?github=connected or ?github_error=<message> (where the install callback
 * lands) off the URL, keeping the rest of it, and return what it said.
 */
function takeReturnNotice(): Notice {
  const url = new URL(window.location.href);
  const error = url.searchParams.get("github_error");
  const connected = url.searchParams.get("github") === "connected";
  if (error === null && !connected) return null;
  url.searchParams.delete("github_error");
  url.searchParams.delete("github");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  return error !== null ? { kind: "error", message: error || "GitHub didn't finish connecting." } : { kind: "connected" };
}

/**
 * Settings → GitHub (card 1000): connect the AgentBoard GitHub App so a merged
 * pull request moves its linked cards to Done. Shows how to turn it on when
 * the server has no App configured.
 */
export default function GithubIntegration() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [notice, setNotice] = useState<Notice>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/github");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setLoad({ kind: "ready", enabled: !!data.enabled, installations: data.installations ?? [] });
    } catch {
      setLoad({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    setNotice(takeReturnNotice());
    refresh();
  }, [refresh]);

  async function disconnect(id: string) {
    setRemoving(id);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/integrations/github?installation_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Disconnect failed (${res.status})`);
      }
      setConfirming(null);
      await refresh();
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setRemoving(null);
    }
  }

  if (load.kind === "loading") return <div className="text-xs text-text-3">Loading…</div>;
  if (load.kind === "error") return <div role="alert" className="text-xs text-danger">Couldn&apos;t load the GitHub integration.</div>;

  if (!load.enabled) {
    return (
      <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-1 p-3.5 text-[12.5px] text-text-2">
        <p>GitHub isn&apos;t set up on this server. Register a GitHub App, set these environment variables, and restart:</p>
        <ul className="flex flex-wrap gap-1.5">
          {ENV_VARS.map((v) => <li key={v}><code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-text-1">{v}</code></li>)}
        </ul>
        <p className="text-text-3">The README&apos;s &ldquo;GitHub App&rdquo; section lists the exact App settings.</p>
      </div>
    );
  }

  const { installations } = load;
  return (
    <>
      {notice?.kind === "connected" && (
        <p role="status" className="inline-flex items-center gap-1.5 text-[12.5px] text-success"><Check className="h-3.5 w-3.5" />GitHub connected.</p>
      )}
      {notice?.kind === "error" && (
        <p role="alert" className="text-[12.5px] text-danger">{notice.message}</p>
      )}

      {installations.length === 0 ? (
        <p className="text-[12.5px] text-text-3">No GitHub accounts connected yet.</p>
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-border bg-surface-1">
          {installations.map((inst) => {
            const name = inst.account_login || `Installation ${inst.installation_id}`;
            const asking = confirming === inst.installation_id;
            const busy = removing === inst.installation_id;
            return (
              <li key={inst.installation_id} className="flex min-h-11 flex-wrap items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0">
                <GithubIcon className="h-4 w-4 shrink-0 text-text-2" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-text-1">{name}</span>
                {asking ? (
                  <span className="flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>Cancel</Button>
                    <Button size="sm" variant="danger" onClick={() => disconnect(inst.installation_id)} disabled={busy} aria-label={`Disconnect ${name}`}>
                      {busy ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="danger-ghost" onClick={() => { setConfirming(inst.installation_id); setRemoveError(null); }}>Disconnect</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {removeError && <p role="alert" className="text-xs text-danger">{removeError}</p>}

      <div>
        {/* A full-page load on purpose: the route sets a cookie and redirects to github.com. <Link> would prefetch it. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/integrations/github/connect"
          className="inline-flex h-[34px] items-center gap-2 rounded-[7px] bg-ivory px-3.5 text-[13px] font-medium text-on-ivory transition-colors hover:bg-ivory-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ivory/30"
        >
          <GithubIcon className="h-3.5 w-3.5" />
          {installations.length ? "Connect another account" : "Connect GitHub"}
        </a>
      </div>
      <p className="text-xs text-text-4">
        When a pull request merges, every card it&apos;s linked to moves to Done and gets a History line. A card is linked
        through its PR field, a card link, or a card URL in the PR description. A PR closed without merging only adds a note.
        Disconnecting here stops it for this team; uninstall the App on GitHub to remove its access.
      </p>
    </>
  );
}
