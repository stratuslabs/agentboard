// Route segment config has to be literal in the route file; Next does not
// read it through a re-export.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export { GET } from "@stratuslabs/agentboard-core/app/api/stream/route";
