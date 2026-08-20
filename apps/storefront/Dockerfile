# syntax=docker/dockerfile:1.7
#
# Storefront image — built and shipped independently of the api image.
# Neither image contains the other's code, which is the packaging half of the
# sellable-separately rule (ADR-0010): the api is a complete product on its
# own, and this is the optional second deployable.
#
# The build needs the whole workspace because the storefront imports
# @platform/api-client through the pnpm workspace link. It needs nothing from
# packages/modules or packages/shared — the ESLint boundary enforces that, and
# the runner stage below carries only what Next traced.

FROM node:22-alpine AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY nx.json tsconfig.base.json .eslintrc.cjs jest.preset.js ./
COPY apps ./apps
COPY packages ./packages

ENV NEXT_TELEMETRY_DISABLED=1
# Switches next.config.mjs to `output: 'standalone'`. Off by default so the
# symlink-heavy standalone assembly doesn't break local builds on Windows.
ENV NEXT_OUTPUT_STANDALONE=1
RUN pnpm install --frozen-lockfile=false
RUN pnpm nx build storefront

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# `output: 'standalone'` emits a minimal server plus only the node_modules
# Next traced as reachable. With outputFileTracingRoot set to the monorepo
# root, the bundle keeps its workspace-relative layout, hence the nested path
# in the CMD below.
COPY --from=builder /workspace/apps/storefront/.next/standalone ./
COPY --from=builder /workspace/apps/storefront/.next/static ./apps/storefront/.next/static

# Run as the image's unprivileged user rather than root.
USER node

ENV PORT=3001
ENV HOSTNAME=0.0.0.0
EXPOSE 3001

CMD ["node", "apps/storefront/server.js"]
