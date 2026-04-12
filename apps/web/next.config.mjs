/**
 * File header: Configures Next.js to consume local workspace packages.
 */

import { fileURLToPath } from "node:url";

/** workspaceRoot pins tracing to this monorepo instead of a parent user directory. */
const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@ee-library/shared", "@ee-library/ui"]
};

export default nextConfig;
