# ==============================
# Build Stage
# ==============================
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache bash python3 make g++
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build


# ==============================
# Production Stage
# ==============================
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json .
RUN npm install --production
COPY --from=build /app/dist ./dist
EXPOSE 5000
CMD ["node", "dist/server.js"]