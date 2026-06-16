/**
 * File header: Configures Next.js to consume local workspace packages and proxy browser API calls.
 */

import { fileURLToPath } from "node:url";

/** workspaceRoot pins tracing to this monorepo instead of a parent user directory. */
const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * apiBaseUrl is where the /api-proxy rewrite forwards browser requests. Rewrites are baked
 * into the build manifest, so a container image must be built with the API address it will
 * use at runtime (the team stack builds with http://api:4000); `next dev` reads the local .env.
 */
const apiBaseUrl = process.env.EE_LIBRARY_API_BASE_URL ?? "http://127.0.0.1:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  /** ESLint is not wired into package scripts; CI-style checks use `npm run typecheck`. */
  eslint: {
    ignoreDuringBuilds: true
  },
  outputFileTracingRoot: workspaceRoot,
  /**
   * Browser-side code calls the API through this same-origin path so the only address an
   * engineer's machine ever needs is the web app itself. Server-side code keeps calling
   * EE_LIBRARY_API_BASE_URL directly and never goes through the rewrite.
   */
  async rewrites() {
    return [
      {
        destination: `${apiBaseUrl}/:path*`,
        source: "/api-proxy/:path*"
      }
    ];
  },
  transpilePackages: ["@ee-library/db", "@ee-library/shared", "@ee-library/ui"]
};

export default nextConfig;
