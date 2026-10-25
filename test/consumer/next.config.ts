import type { NextConfig } from "next";

// The core ships TypeScript source, not a build, so Next compiles it.
const nextConfig: NextConfig = {
  transpilePackages: ["@stratuslabs/agentboard-core"],
};

export default nextConfig;
