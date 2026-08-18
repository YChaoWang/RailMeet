# syntax=docker/dockerfile:1
# Production migration image.
# Build from repository root:
#   docker build -f infra/migration.Dockerfile -t railmeet-migration .

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.8.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.10.8 prune @railmeet/database --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN --mount=type=cache,id=pnpm-store-migration,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile --prefer-offline
RUN find . -name 'tsconfig.tsbuildinfo' -delete \
  && pnpm --filter @railmeet/database... --workspace-concurrency=1 run build
RUN pnpm deploy --filter=@railmeet/database --prod --legacy /prod/database

FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production

RUN groupadd --system --gid 1001 railmeet \
  && useradd --system --uid 1001 --gid railmeet --home-dir /app railmeet

WORKDIR /app
COPY --from=builder --chown=railmeet:railmeet /prod/database ./

USER railmeet

CMD ["node", "dist/migrate-cli.js"]
