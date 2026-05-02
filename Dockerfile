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

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app
USER nodejs

EXPOSE ${PORT:-5000}
CMD ["node", "dist/server.js"]