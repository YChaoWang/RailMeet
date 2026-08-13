# syntax=docker/dockerfile:1
# Build from repository root:
#   docker build -f apps/api/Dockerfile -t railmeet-api .

ARG NODE_VERSION=20
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
RUN pnpm dlx turbo@2.10.8 prune @railmeet/api --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store-api,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm fetch --frozen-lockfile

FROM base AS builder
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/full/ .
# turbo prune omits the shared TS base config at repo root
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN --mount=type=cache,id=pnpm-store-api,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile --prefer-offline
RUN find . -name 'tsconfig.tsbuildinfo' -delete \
  && pnpm --filter @railmeet/api... --workspace-concurrency=1 run build
RUN pnpm deploy --filter=@railmeet/api --prod --legacy /prod/api

FROM base AS runner
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0

RUN groupadd --system --gid 1001 railmeet \
  && useradd --system --uid 1001 --gid railmeet --home-dir /app railmeet

WORKDIR /app
COPY --from=builder --chown=railmeet:railmeet /prod/api ./

USER railmeet

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const port=process.env.API_PORT||process.env.PORT||3001;fetch('http://127.0.0.1:'+port+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
