// The one place this app adapts the core: configure() runs once per server
// process, before any request, and every route bundle sees it.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configure } = await import("@stratuslabs/agentboard-core/configure");
  const { tenant } = await import("@/tenant");
  configure({ tenant });
}
