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

export type AgentBoardConfig = {
  /**
   * Which team, and which user, a request acts for. Either half may be left
   * out to keep the self-hosted behavior for it.
   */
  tenant?: Partial<TenantResolver>;
};

const STORE = Symbol.for("@stratuslabs/agentboard-core/config");
const TENANT_KEYS = ["fromRequest", "fromPage"] as const;

type Store = { config: Readonly<AgentBoardConfig> };

function store(): Store {
  const global = globalThis as typeof globalThis & { [STORE]?: Store };
  global[STORE] ??= { config: Object.freeze({}) };
  return global[STORE];
}

function validate(config: AgentBoardConfig): Readonly<AgentBoardConfig> {
  if (config === null || typeof config !== "object") {
    throw new TypeError("configure() takes an options object");
  }
  for (const key of Object.keys(config)) {
    if (key !== "tenant") throw new TypeError(`Unknown configure() option: ${key}`);
  }
  const tenant = config.tenant;
  if (tenant === undefined) return Object.freeze({});
  if (tenant === null || typeof tenant !== "object") {
    throw new TypeError("tenant must be an object with fromRequest and/or fromPage");
  }
  for (const [key, value] of Object.entries(tenant)) {
    if (!(TENANT_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`Unknown tenant resolver: ${key}`);
    }
    if (value !== undefined && typeof value !== "function") {
      throw new TypeError(`tenant.${key} must be a function`);
    }
  }
  return Object.freeze({ tenant: Object.freeze({ ...tenant }) });
}

/** Replace the configuration. Calling it again (a dev reload) replaces it, not merges. */
export function configure(config: AgentBoardConfig): void {
  store().config = validate(config);
}

/** The configuration in force, `{}` when nothing was configured. */
export function getConfig(): Readonly<AgentBoardConfig> {
  return store().config;
}
