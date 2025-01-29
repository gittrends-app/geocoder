# Stage 1: Base
FROM node:20-alpine AS base
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
RUN yarn install
RUN yarn build

# Stage 4: Release
FROM node:20-alpine AS release
WORKDIR /app

# Copy only the necessary files
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --from=build /app/packages/cli/package.json ./packages/cli/

# Create .cache directory
RUN mkdir -p /app/.cache

# Set environment variables
ENV NODE_NO_WARNINGS=1
ENV CACHE_DIR=/app/.cache CACHE_SIZE=10000
ENV HOST=:: PORT=80 NODE_ENV=production
ENV OSM_SERVER=https://nominatim.geocoding.ai
EXPOSE 80

# Define volume for .cache folder
VOLUME ["/app/.cache"]

WORKDIR /app/packages/cli
ENTRYPOINT [ "node", "dist/cli.cjs" ]
CMD []