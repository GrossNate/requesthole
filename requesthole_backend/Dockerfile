# syntax=docker/dockerfile:1

# trixie (Debian 13) base: better-sqlite3's bundled linux prebuilds need
# glibc >= 2.38, newer than bookworm-based node:24-slim ships.

# --- Build stage: compile TypeScript to dist/ ---
# python3/make/g++ live only in this stage: better-sqlite3's install script runs
# node-gyp unconditionally, even when its bundled prebuild is the binary used.
FROM node:24-trixie-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# --- Runtime stage: production deps + compiled output only ---
FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
