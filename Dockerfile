# syntax=docker/dockerfile:1
# File header: Multi-target image build for the EE Library team server stack.
#
# All targets share the same dependency layer so one `docker compose build` reuses the
# expensive `npm ci` step across api, worker, web, and migrate images. The api and worker
# run their TypeScript sources directly through tsx (matching how `npm run dev` runs them);
# the web target is a real `next build` + `next start` production server.
#
# Used by compose.team.yaml — see docs/TEAM_SERVER_SETUP.md for the operator walkthrough.

FROM node:22-bookworm-slim AS base
WORKDIR /app

# Install dependencies from the lockfile first so source edits do not bust this layer.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci

# Copy the sources every service can need: apps + packages (workspace imports),
# scripts + infra/postgres (migrations and seeding), and the shared tsconfig.
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY scripts scripts
COPY infra/postgres infra/postgres

# --- API service -------------------------------------------------------------------------
FROM base AS api
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npx", "tsx", "apps/api/src/index.ts"]

# --- Worker daemon -----------------------------------------------------------------------
FROM base AS worker
ENV NODE_ENV=production
CMD ["npx", "tsx", "apps/worker/src/index.ts", "daemon"]

# --- One-shot migration runner (also used for seeding via `docker compose run`) ----------
FROM base AS migrate
ENV NODE_ENV=production
CMD ["node", "scripts/db-migrate.mjs"]

# --- Web app -----------------------------------------------------------------------------
# The /api-proxy rewrite target is baked into the build manifest, so the image is built
# with the in-stack API address. Override the build arg only if the API service name changes.
FROM base AS web
ARG EE_LIBRARY_API_BASE_URL=http://api:4000
ENV EE_LIBRARY_API_BASE_URL=$EE_LIBRARY_API_BASE_URL
# Build-time only: stops Auth.js from rejecting the placeholder host while static shells
# (sign-in, error pages) prerender. Runtime trust comes from .env.team.
ENV AUTH_TRUST_HOST=true
RUN npm run build -w @ee-library/web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@ee-library/web"]
