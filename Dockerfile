# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
# Prisma needs a syntactically valid URL to load its config during generation.
# This placeholder is build-only; no database connection or real credential is needed.
RUN --mount=type=cache,target=/root/.npm \
    DATABASE_URL=mysql://build:build@127.0.0.1:3306/build npm ci \
    && DATABASE_URL=mysql://build:build@127.0.0.1:3306/build npm run db:generate

# This target runs once per deployment, separately from the web process.
FROM dependencies AS migrator
ARG BUILD_COMMIT
LABEL org.opencontainers.image.revision=$BUILD_COMMIT
ENV NODE_ENV=production \
    DEV_LOGIN_ENABLED=false
COPY --chown=node:node src/core ./src/core
COPY --chown=node:node src/server ./src/server
COPY --chown=node:node src/shared ./src/shared
USER node
CMD ["sh", "-c", "npm run db:migrate && exec npm run db:seed"]

FROM dependencies AS builder
ARG BUILD_COMMIT
ENV NODE_ENV=production \
    NEXT_PUBLIC_BUILD_COMMIT=$BUILD_COMMIT
COPY . .
# public/ is optional in this repository; create it so the runtime COPY is stable.
RUN test -n "$BUILD_COMMIT" \
    && mkdir -p public \
    && npm run build

FROM base AS runtime
ARG BUILD_COMMIT
LABEL org.opencontainers.image.revision=$BUILD_COMMIT
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DEV_LOGIN_ENABLED=false
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(4000) }).then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
