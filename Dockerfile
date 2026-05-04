# ==============================
# Base Stage
# ==============================
FROM node:20-alpine AS base

WORKDIR /app
RUN apk add --no-cache bash python3 make g++


# ==============================
# Dependencies Stage
# ==============================
FROM base AS dependencies

COPY package*.json ./
RUN npm ci


# ==============================
# Build Stage
# ==============================
FROM dependencies AS build

COPY . .
RUN npm run build


# ==============================
# Development Stage
# ==============================
FROM base AS development

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
COPY .env.development .env

EXPOSE ${PORT:-5000}
CMD ["npm", "run", "dev"]


# ==============================
# Production Stage
# ==============================
FROM base AS production

# COPY package*.json ./
# RUN npm ci --only=production && npm cache clean --force
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY .env .env

RUN apk del python3 make g++ && \
    rm -rf /root/.npm /tmp/*

RUN addgroup -g 1001 -S nearby && \
    adduser -S nearby -u 1001 && \
    chown -R nearby:nearby /app
USER nearby

EXPOSE ${PORT:-5000}

# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD node -e "require('http').get('http://localhost:${PORT:-5000}/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

CMD ["node", "dist/server.js"]