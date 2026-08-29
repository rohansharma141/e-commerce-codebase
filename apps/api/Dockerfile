# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY nx.json tsconfig.base.json .eslintrc.cjs jest.preset.js ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile=false
RUN pnpm nx build api

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

COPY --from=builder /workspace/dist/apps/api ./
# Module migrations are source-of-truth SQL files; copy them so the api can
# apply them at boot. Path mirrors what each module's onModuleInit looks for.
#
# ADDING A MODULE WITH MIGRATIONS? Add a line here too. There is no glob that
# preserves per-module directory names, so this list is hand-maintained, and
# forgetting it fails ONLY in a built image -- `nx serve` and every test read
# the migrations straight from the source tree, so a developer machine never
# sees it. The channels module shipped without its line and the container
# refused to boot: "channels migrations directory not found".
COPY --from=builder /workspace/packages/modules/catalog/src/db/migrations ./migrations/catalog
COPY --from=builder /workspace/packages/modules/pricing/src/db/migrations ./migrations/pricing
COPY --from=builder /workspace/packages/modules/branding/src/db/migrations ./migrations/branding
COPY --from=builder /workspace/packages/modules/orders/src/db/migrations ./migrations/orders
COPY --from=builder /workspace/packages/modules/channels/src/db/migrations ./migrations/channels
COPY --from=builder /workspace/packages/shared/security/src/db/migrations ./migrations/audit
RUN if [ -f package.json ]; then pnpm install --prod --frozen-lockfile=false; fi

EXPOSE 3000
CMD ["node", "main.js"]
