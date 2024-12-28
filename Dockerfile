# Stage 1: Base
FROM node:22 AS base
WORKDIR /app
COPY . .

# Stage 2: Dependencies
FROM base AS dependencies
RUN yarn install --production

# Stage 3: Build
FROM base AS build
RUN yarn install
RUN npm run build

# Stage 4: Release
FROM node:22-alpine AS release
WORKDIR /app

# Copy only the necessary files
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY package*.json ./

# Create .cache directory
RUN mkdir -p /app/.cache

# Set environment variables
ENV NODE_NO_WARNINGS=1
ENV CACHE_DIR=/app/.cache CACHE_SIZE=10000
ENV HOST=:: PORT=80 NODE_ENV=production
EXPOSE 80

# Define volume for .cache folder
VOLUME ["/app/.cache"]

WORKDIR /app/packages/cli
ENTRYPOINT [ "node", "dist/cli.js" ]
CMD []