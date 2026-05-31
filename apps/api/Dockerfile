# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY nx.json tsconfig.base.json .eslintrc.cjs jest.preset.js ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile=false
RUN pnpm nx build api

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY --from=builder /workspace/dist/apps/api ./
# Module migrations are source-of-truth SQL files; copy them so the api can
# apply them at boot. Path mirrors what each module's onModuleInit looks for.
COPY --from=builder /workspace/packages/modules/catalog/src/db/migrations ./migrations/catalog
COPY --from=builder /workspace/packages/modules/pricing/src/db/migrations ./migrations/pricing
COPY --from=builder /workspace/packages/modules/orders/src/db/migrations ./migrations/orders
RUN if [ -f package.json ]; then pnpm install --prod --frozen-lockfile=false; fi

EXPOSE 3000
CMD ["node", "main.js"]
