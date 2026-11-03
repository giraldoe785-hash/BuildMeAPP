# ==============================================================================
# BuildMeAPP - Multi-stage Production Dockerfile
# ==============================================================================
# Base image: Official Node.js 24 on Debian Bookworm Slim
# Debian-based runtime guarantees OpenSSL and glibc compatibility for
# Prisma ORM 7 (@prisma/adapter-pg and Prisma Client).
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Base runtime environment
# ------------------------------------------------------------------------------
FROM node:24.22.2-bookworm-slim AS base
WORKDIR /app

# Install security certificates and OpenSSL required by Prisma and PostgreSQL SSL connections
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------------------
# Stage 2: Dependencies installation (reproducible with npm ci)
# ------------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app

# Ensure devDependencies are installed for build tools and TypeScript compilation
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

# ------------------------------------------------------------------------------
# Stage 3: Linux Prisma Client Generation
# ------------------------------------------------------------------------------
FROM deps AS prisma-client
WORKDIR /app

COPY prisma ./prisma
COPY prisma7.config.ts ./

# Generate Prisma Client inside Linux (targeting generated/prisma)
# Dummy database URL provided strictly for build-time schema validation
ENV DATABASE_URL="postgresql://buildmeapp_test_user:build_dummy@localhost:5432/buildmeapp_orders_test?schema=public"
RUN npx prisma generate

# ------------------------------------------------------------------------------
# Stage 4: Application Builder (Next.js Standalone Compilation)
# ------------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma7.config.ts ./
COPY --from=prisma-client /app/generated ./generated

# Copy application source code (excluding items in .dockerignore)
COPY . .

# Build-time public arguments (no secrets or private credentials)
ARG NEXT_PUBLIC_SHOW_DEMO_LOGIN=false
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=""
ARG NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=""
ARG NEXT_PUBLIC_WOMPI_PUBLIC_KEY=""

ENV NEXT_PUBLIC_SHOW_DEMO_LOGIN=$NEXT_PUBLIC_SHOW_DEMO_LOGIN
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=$NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
ENV NEXT_PUBLIC_WOMPI_PUBLIC_KEY=$NEXT_PUBLIC_WOMPI_PUBLIC_KEY

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Dummy environment variables strictly for build-time Next.js static page collection
ENV DATABASE_URL="postgresql://buildmeapp_test_user:build_dummy@localhost:5432/buildmeapp_orders_test?schema=public"
ENV AUTH_SECRET="build_time_dummy_auth_secret_minimum_32_characters_for_static_analysis"

# Compile Next.js with standalone output
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 5: Dedicated Prisma Migrator Container (Profile: migration)
# Independent of builder - does NOT require Next.js compilation
# ------------------------------------------------------------------------------
FROM base AS migrator
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma7.config.ts ./
COPY --from=prisma-client /app/generated ./generated

ENV NODE_ENV=development
USER node

# Default command displays current migration status without executing writes
CMD ["npx", "prisma", "migrate", "status"]

# ------------------------------------------------------------------------------
# Stage 6: Production Dependencies Preparation
# Prunes devDependencies to isolate clean production runtime dependencies
# ------------------------------------------------------------------------------
FROM deps AS prod-deps
WORKDIR /app
ENV NODE_ENV=production
RUN npm prune --omit=dev

# ------------------------------------------------------------------------------
# Stage 7: Production Runtime Container
# ------------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Prepare persistent file uploads directory with non-root ownership
RUN mkdir -p /app/storage && chown -R node:node /app/storage

# Copy standalone distribution from builder
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Overlay complete production dependencies (including @prisma/adapter-pg, pg, and runtime utils)
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# Ensure custom Prisma generated client and schema definitions are accessible to runtime
COPY --from=prisma-client --chown=node:node /app/generated ./generated
COPY --from=prisma-client --chown=node:node /app/prisma ./prisma
COPY --from=prisma-client --chown=node:node /app/prisma7.config.ts ./prisma7.config.ts

# Build-time module resolution verification (non-destructive, zero network, zero DB connection)
RUN node -e " \
  const { PrismaPg } = require('@prisma/adapter-pg'); \
  const { PrismaClient } = require('./generated/prisma/client.js'); \
  const pg = require('pg'); \
  const runtimeUtils = require('@prisma/client-runtime-utils'); \
  if (typeof PrismaPg !== 'function') throw new Error('PrismaPg is not a function'); \
  if (typeof PrismaClient !== 'function') throw new Error('PrismaClient is not a function'); \
  if (typeof pg.Pool !== 'function') throw new Error('pg.Pool is not a function'); \
  if (!runtimeUtils) throw new Error('@prisma/client-runtime-utils is missing'); \
  const adapter = new PrismaPg({ connectionString: 'postgresql://build_dummy:build_dummy@localhost:5432/build_dummy' }); \
  const client = new PrismaClient({ adapter }); \
  if (!client) throw new Error('PrismaClient instance creation failed'); \
  console.log('Build-time Prisma & PG module resolution verified successfully.'); \
"

# Run with non-root node user (UID 1000)
USER node

EXPOSE 3000

# Next.js standalone entrypoint
CMD ["node", "server.js"]
