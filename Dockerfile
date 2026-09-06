# Stage 1: Base
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json yarn.lock ./
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/

# Stage 2: Dependencies
FROM base AS deps
RUN yarn install --production --frozen-lockfile --ignore-scripts

# Stage 3: Build
FROM base AS build
COPY . .
RUN yarn install --frozen-lockfile
RUN yarn build

# Stage 4: Release
FROM node:22-alpine AS release
WORKDIR /app

# Copy only the necessary files
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --from=build /app/packages/cli/package.json ./packages/cli/

# Create .cache directory and let the unprivileged runtime user write to it
RUN mkdir -p /app/.cache && chown -R node:node /app

# Set environment variables
ENV NODE_NO_WARNINGS=1
ENV CACHE_DIR=/app/.cache CACHE_SIZE=10000 CONCURRENCY=1
ENV HOST=0.0.0.0 PORT=8080 NODE_ENV=production
ENV OSM_SERVER=https://nominatim.geocoding.ai
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

# Define volume for .cache folder
VOLUME ["/app/.cache"]
USER node

WORKDIR /app/packages/cli
ENTRYPOINT [ "node", "dist/cli.js" ]
CMD []
