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
  /**
   * Top-level paths the app serves itself (`signup`, `billing`), on top of
   * the core's own. An organization lives at /<org-slug>, so these are kept
   * from becoming org slugs: a name that would land on one gets `-org`
   * appended, and asking for one outright is refused.
   */
  reservedOrgSlugs?: readonly string[];
  /**
   * Whether the app mounts the org page, app/(board)/[orgSlug]/page. When it
   * does, the org name in a board's breadcrumb links to /<org-slug>; when it
   * doesn't, the name is plain text instead of a link to a 404. Self-hosted
   * AgentBoard, which never calls configure(), has org pages.
   */
  orgPages?: boolean;
};

const STORE = Symbol.for("@stratuslabs/agentboard-core/config");
const OPTIONS = ["tenant", "members", "reservedOrgSlugs", "orgPages"] as const;
const TENANT_KEYS = ["fromRequest", "fromPage"] as const;
const MEMBER_HOOKS = ["beforeTypeChange"] as const;

/** `configured` is false until configure() runs: self-hosted, not an app consuming the core. */
type Store = { config: Readonly<AgentBoardConfig>; configured?: boolean };

function store(): Store {
  const global = globalThis as typeof globalThis & { [STORE]?: Store };
  global[STORE] ??= { config: Object.freeze({}), configured: false };
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

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A list of slugs as they appear in a URL, copied and frozen. */
function slugList(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("reservedOrgSlugs must be an array of slugs");
  for (const slug of value) {
    if (typeof slug !== "string" || !SLUG.test(slug)) {
      throw new TypeError(`reservedOrgSlugs: not a slug: ${JSON.stringify(slug)} (lowercase letters, digits and single hyphens)`);
    }
  }
  return Object.freeze([...value]);
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
  const reservedOrgSlugs = slugList(config.reservedOrgSlugs);
  if (config.orgPages !== undefined && typeof config.orgPages !== "boolean") {
    throw new TypeError("orgPages must be true or false");
  }
  const result: AgentBoardConfig = {};
  if (tenant) result.tenant = tenant;
  if (members) result.members = members;
  if (reservedOrgSlugs) result.reservedOrgSlugs = reservedOrgSlugs;
  if (config.orgPages !== undefined) result.orgPages = config.orgPages;
  return Object.freeze(result);
}

/** Replace the configuration. Calling it again (a dev reload) replaces it, not merges. */
export function configure(config: AgentBoardConfig): void {
  const next = validate(config);
  store().config = next;
  store().configured = true;
}

/** The configuration in force, `{}` when nothing was configured. */
export function getConfig(): Readonly<AgentBoardConfig> {
  return store().config;
}

/**
 * Whether /<org-slug> is mounted: always for self-hosted, and for an app that
 * consumes the core only when it said so with configure({ orgPages: true }).
 */
export function orgPagesMounted(): boolean {
  const { config, configured } = store();
  return config.orgPages ?? !configured;
}
