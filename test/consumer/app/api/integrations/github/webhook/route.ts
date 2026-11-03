// Route segment config has to be literal in the route file; Next does not
// read it through a re-export.
export const runtime = "nodejs";

export { POST } from "@stratuslabs/agentboard-core/app/api/integrations/github/webhook/route";
