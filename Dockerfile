# SENAIA-IA Studio — 3D operator studio for the SENAIA-IA gateway.
#
# Multi-stage: production deps -> Next.js build -> runtime with the custom server.
#
# The custom server (server/index.js) also hosts the same-origin websocket
# proxy to the gateway, so this image cannot be replaced by Next's standalone
# output — standalone generates its own server.js and would drop the proxy.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Baked into the client bundle, so it must be a build arg rather than runtime env.
# The browser normally talks to the same-origin proxy at /api/gateway/ws and never
# uses this; it is only the initial value shown in the connection settings UI.
ARG NEXT_PUBLIC_GATEWAY_URL=""
ENV NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Without this the server binds 127.0.0.1 (server/network-policy.js) and the
# published port connect-refuses. Binding a public host additionally requires
# STUDIO_ACCESS_TOKEN, which the server enforces at startup — supply it at run time.
ENV HOST=0.0.0.0
ENV PORT=3000

# All persistent state (settings.json holding the gateway URL and token, uploads,
# office layout, task board) is written under this directory. Mount a volume here
# or it is lost on every container recreate.
ENV OPENCLAW_STATE_DIR=/data

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server ./server
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# .mjs, not .ts — the runtime image has no TypeScript to transpile a .ts config.
COPY --from=builder /app/next.config.mjs ./next.config.mjs

# The base image ships an unprivileged `node` user (uid 1000). The upstream
# image ran as root, which also put state in /root.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000

# The access gate covers every route including /api/health, and rate-limits to
# 10 failures a minute — so the probe must present the cookie or it would both
# report unhealthy and lock itself out.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "const t=process.env.STUDIO_ACCESS_TOKEN||'';fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{headers:t?{cookie:'studio_access='+t}:{}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
