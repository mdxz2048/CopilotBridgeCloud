FROM node:22-bookworm-slim AS base
WORKDIR /workspace
RUN npm install -g pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/contract/package.json ./packages/contract/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages

FROM base AS api-build
RUN pnpm --filter @bridge/api build

FROM node:22-bookworm-slim AS api
WORKDIR /workspace
RUN npm install -g pnpm@11.19.0
COPY --from=api-build /workspace ./
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @bridge/db migrate && pnpm --filter @bridge/api seed && node apps/api/dist/server.js"]

FROM base AS web-build
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN pnpm --filter @bridge/web build

FROM node:22-bookworm-slim AS web
WORKDIR /workspace
COPY --from=web-build /workspace/apps/web/.next/standalone ./
COPY --from=web-build /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /workspace/apps/web/public ./apps/web/public
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV API_INTERNAL_URL=http://api:3001
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
