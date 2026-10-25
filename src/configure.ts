/**
 * How a Next app that consumes the core adapts it.
 *
 * Self-hosted AgentBoard never calls this: with nothing configured, every
 * request acts for the one self-hosted team. An app that serves several teams
 * (the hosted edition, test/consumer) calls it once at startup, normally from
 * instrumentation.ts:
 *
 *   export async function register() {
 *     if (process.env.NEXT_RUNTIME !== "nodejs") return;
 *     const { configure } = await import("@stratuslabs/agentboard-core/configure");
 *     configure({ tenant: { fromRequest, fromPage } });
 *   }
 *
 * Next compiles instrumentation and every route into separate bundles, each
 * with its own copy of this module, so the configuration is kept on
 * globalThis, where every copy in the server process sees the same one.
 *
 * Gating (an inactive subscription, a plan limit) belongs in the resolver:
 * throw a TenantError with the status to return (402, 403) and the route
 * never runs.
 */
import type { TenantResolver } from "./lib/tenant";

/** A member's type is about to change. */
export type MemberTypeChange = {
  teamId: number;
  memberId: number;
  from: string;
  to: string;
};

export type AgentBoardConfig = {
  /**
   * Which team, and which user, a request acts for. Either half may be left
   * out to keep the self-hosted behavior for it.
   */
  tenant?: Partial<TenantResolver>;
  /** Hooks into member changes. */
  members?: {
    /**
     * Runs before a member's type changes (agent to human or back). Throw a
     * TenantError to refuse it with that status; the member is left as it
     * was.
     */
    beforeTypeChange?: (change: MemberTypeChange) => void | Promise<void>;
  };
};

const STORE = Symbol.for("@stratuslabs/agentboard-core/config");
const OPTIONS = ["tenant", "members"] as const;
const TENANT_KEYS = ["fromRequest", "fromPage"] as const;
const MEMBER_HOOKS = ["beforeTypeChange"] as const;

type Store = { config: Readonly<AgentBoardConfig> };

function store(): Store {
  const global = globalThis as typeof globalThis & { [STORE]?: Store };
  global[STORE] ??= { config: Object.freeze({}) };
  return global[STORE];
}

/** An object of functions, every key one of `allowed`, frozen; undefined stays undefined. */
function functions<T extends object>(
  value: unknown,
  allowed: readonly string[],
  name: string,
  shape: string,
  unknownLabel: string,
): Readonly<T> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${name} must be an object with ${shape}`);
  }
  for (const [key, fn] of Object.entries(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${unknownLabel}: ${key}`);
    if (fn !== undefined && typeof fn !== "function") {
      throw new TypeError(`${name}.${key} must be a function`);
    }
  }
  return Object.freeze({ ...value }) as Readonly<T>;
}

function validate(config: AgentBoardConfig): Readonly<AgentBoardConfig> {
  if (config === null || typeof config !== "object") {
    throw new TypeError("configure() takes an options object");
  }
  for (const key of Object.keys(config)) {
    if (!(OPTIONS as readonly string[]).includes(key)) throw new TypeError(`Unknown configure() option: ${key}`);
  }
  const tenant = functions<NonNullable<AgentBoardConfig["tenant"]>>(
    config.tenant, TENANT_KEYS, "tenant", "fromRequest and/or fromPage", "Unknown tenant resolver",
  );
  const members = functions<NonNullable<AgentBoardConfig["members"]>>(
    config.members, MEMBER_HOOKS, "members", "beforeTypeChange", "Unknown members hook",
  );
  const result: AgentBoardConfig = {};
  if (tenant) result.tenant = tenant;
  if (members) result.members = members;
  return Object.freeze(result);
}

/** Replace the configuration. Calling it again (a dev reload) replaces it, not merges. */
export function configure(config: AgentBoardConfig): void {
  store().config = validate(config);
}

/** The configuration in force, `{}` when nothing was configured. */
export function getConfig(): Readonly<AgentBoardConfig> {
  return store().config;
}
