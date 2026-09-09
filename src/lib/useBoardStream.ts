"use client";

import { useEffect, useRef } from "react";

/**
 * Live board changes over one shared connection.
 *
 * The server sends invalidation, not data — an event means "something on this
 * board moved" — so `onChange` is a nudge that the caller answers with a delta
 * fetch of its own.
 *
 * Everything on a page shares a single EventSource, and subscribers filter by
 * board id in the client. The board screen and the sidebar badge would
 * otherwise open one stream each, and an SSE connection never closes: over
 * HTTP/1.1 a browser allows six per host, so a second permanent connection
 * costs a third of the page's budget for the lifetime of the tab.
 */

type Subscriber = { boardId: number | null; fire: () => void };

const subscribers = new Set<Subscriber>();
let source: EventSource | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let reopenTimer: ReturnType<typeof setTimeout> | null = null;

function deliver(changed: number | null) {
  for (const sub of subscribers) {
    // A null on either side means "cannot tell, refresh anyway": subscribers
    // watching everything take all events, and the polling fallback reports a
    // global change without a board id.
    if (changed === null || sub.boardId === null || sub.boardId === changed) {
      sub.fire();
    }
  }
}

function open() {
  if (source || typeof EventSource === "undefined") return;

  // Unscoped: one connection serves every subscriber on the page, whatever
  // board each of them cares about.
  source = new EventSource("/api/stream");

  // The server announces every connection, including the ones it opens after
  // hanging up on itself and the ones EventSource recovers on its own. Catching
  // up here rather than on any single path means no reconnection can be missed:
  // the stream carries no replay buffer, so a write committed while the
  // connection was down is otherwise lost until something else happens.
  //
  // The first connection is included, not skipped. Mounting fetches the board
  // and then subscribes, and the two are not coordinated — a write landing in
  // between is missed by both, and in polling mode the server's opening stamp
  // absorbs it as the baseline so it is never reported at all. The cost of
  // covering that is one delta on load, which normally answers "nothing".
  source.addEventListener("hello", () => deliver(null));

  source.addEventListener("change", (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data);
      deliver(typeof data.board_id === "number" ? data.board_id : null);
    } catch {
      deliver(null);
    }
  });

  // The server hangs up on its own schedule so a platform timeout never cuts a
  // response mid-write. Reopening at once keeps that invisible; EventSource's
  // own retry would sit out its backoff first.
  source.addEventListener("reconnect", () => {
    close();
    reopenTimer = setTimeout(() => {
      if (subscribers.size > 0) open();
    }, 0);
  });

  source.onerror = () => {
    // CONNECTING means EventSource is retrying on its own; reopening here as
    // well would race it and leave two streams. Its recovery announces itself
    // with a `hello` like any other connection, so the catch-up is handled.
    if (source?.readyState !== EventSource.CLOSED) return;
    close();
    reopenTimer = setTimeout(() => {
      if (subscribers.size === 0) return;
      open();
    }, 3000);
  };
}

function close() {
  source?.close();
  source = null;
}

export function useBoardStream(
  boardId: number | null,
  onChange: () => void,
  enabled = true
) {
  // Held in a ref so an inline arrow does not tear the subscription down and
  // rebuild it on every render.
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const sub: Subscriber = { boardId, fire: () => handlerRef.current() };
    subscribers.add(sub);

    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    open();

    return () => {
      subscribers.delete(sub);
      if (subscribers.size > 0) return;
      // Deferred: React remounts effects in development, and tearing the
      // connection down only to rebuild it a tick later is pure churn.
      closeTimer = setTimeout(() => {
        if (subscribers.size === 0) {
          if (reopenTimer) clearTimeout(reopenTimer);
          close();
        }
      }, 1000);
    };
  }, [boardId, enabled]);
}
