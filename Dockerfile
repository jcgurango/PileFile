# syntax=docker/dockerfile:1

# ---- build: type-check and bundle the client -------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: Node serves dist/ and /api from one process ------------------
FROM node:24-alpine
WORKDIR /app
ENV PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The server runs TypeScript directly (Node type stripping), so copy sources as-is.
COPY server/src ./server/src
COPY shared ./shared
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787

# /api/me answers 200 (user: null) when signed out, so it doubles as a liveness probe.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/me" >/dev/null || exit 1

CMD ["node", "server/src/index.ts"]
