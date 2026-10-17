# ==============================================================================
# Hardened Multi-Stage Backend Dockerfile (Node.js 20 LTS / Express)
# Conforms to ASVS & CIS Benchmark: Non-root execution, minimal attack surface
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Dependencies (Native modules compilation: argon2, pg)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install native compilation dependencies required by argon2 & cryptographic tools
RUN apk add --no-cache python3 make g++

COPY package*.json ./

# Clean install production-only dependencies
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------------------
# Stage 2: Hardened Runtime Container
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install lightweight init process and curl/wget for health probes
RUN apk add --no-cache dumb-init wget

# Copy production node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src/

# Enforce non-root user permissions (node:node is UID/GID 1000)
RUN chown -R node:node /app

# Mandatory Non-Root User Execution
USER node

EXPOSE 3000

# Periodic Health Check Probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
