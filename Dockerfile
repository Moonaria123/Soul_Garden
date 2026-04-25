# ============================================
# Soul Upload - Multi-stage Docker Build
# ============================================

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# sharp (transitive: @xenova/transformers): use system vips and build from source to avoid
# GitHub prebuild download timeouts in Docker (linuxmusl)
RUN apk add --no-cache vips vips-dev fftw-dev build-base python3

COPY package.json package-lock.json* ./
# Reduce hangs on flaky registry (npmmirror / network)
ENV NPM_CONFIG_FETCH_TIMEOUT=600000
ENV NPM_CONFIG_FETCH_RETRIES=10
# During npm install, force sharp to link against globally-installed libvips (triggers `npm run build` in sharp, not prebuild fetch)
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
RUN npm config set registry https://registry.npmmirror.com && \
  if [ -f package-lock.json ]; then npm ci; \
  else npm install; \
  fi

# Stage 2: Build the application
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache vips

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Stage 3: Production runner
FROM node:20-alpine AS runner
WORKDIR /app
# Runtime libs for sharp native addon linked to system vips
RUN apk add --no-cache vips

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME="0.0.0.0"
ENV SOUL_UPLOAD_DATA_DIR=/data

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets
COPY --from=builder /app/public ./public

# Set correct permissions for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy drizzle migration files (needed at runtime for schema setup)
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

# Create persistent data directory with correct ownership
RUN mkdir -p /data && chown nextjs:nodejs /data

USER nextjs

EXPOSE 3002

CMD ["node", "server.js"]
