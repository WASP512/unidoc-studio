# Container image: Node, the built app and Chromium for PDF export.
#   docker compose up -d --build     (see compose.yaml)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# devDependencies stay installed: Next loads next.config.ts with TypeScript at start
# and would otherwise download it on every container start.
RUN npm run build && rm -rf .next/cache

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
# Chromium's own sandbox needs privileges an unprivileged container does not have.
# The renderer only ever loads this app's own pages (see api/export-pdf).
ENV NODE_ENV=production \
    PORT=3000 \
    CHROME_PATH=/usr/bin/chromium \
    UNIDOC_CHROME_NO_SANDBOX=1 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
# 0.0.0.0 inside the container only; compose.yaml publishes the port on 127.0.0.1 of the host.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
