# Nearby location

Microservice for storing user location and finding nearby users.

This is a [node.js](https://nodejs.org/en) project bootstrapped with [`installer nodejs`](https://nodejs.org/en/download).

## Requirements

1. node.js
2. typescript
3. mongodb (database)

## Getting Started

First, install the dependencies:

```javascript
npm install
```

then, run the development server:

```javascript
npm run dev
```

Open [http://localhost:5000/api-docs](http://localhost:5000/api-docs) with your browser to see the api documention.

# Deployment Document - Nearby Location Service

## Overview

This service receives a user's current location, identifies a list of other users who are nearby, and provides it as output. The information displayed for each nearby user in the output includes the following:

* User ID: A unique identifier for each user.
* Updated At: The exact date and time the user's location was last recorded or updated.
* Distance: The distance between the nearby user and the requesting user, calculated in meters (default).
* Update Status: The amount of time since the last location update (e.g., in seconds or minutes).

**example:**

``` json
{
    "success": true,
    "page": 1,
    "pageSize": 10,
    "totalCount": 3,
    "totalPages": 1,
    "hasMore": false,
    "data": [
        {
            "_id": "69f81ad7ba0672747d1dc6ae",
            "userId": "vania",
            "updatedAt": "2026-05-04T04:04:39.764Z",
            "distance": 638763.978455917,
            "updateStatus": "14 seconds ago"
        },
        {
            "_id": "69f81aafba0672747d1dc6a4",
            "userId": "vergil",
            "updatedAt": "2026-05-04T04:03:59.858Z",
            "distance": 638763.978455917,
            "updateStatus": "2 minutes ago"
        },
        {
            "_id": "69f73c26f08739364056aa76",
            "userId": "vector",
            "updatedAt": "2026-05-04T04:03:35.892Z",
            "distance": 655624.4488614606,
            "updateStatus": "5 hours ago"
        }
    ]
}
```

## Requirement

1. Setting up and configuring the Nexus platform:

   * Nexus version: Make sure you have [insert Nexus version number here, e.g. v2.5.1] or higher installed.

   * Required configurations:

     * Activate the Nexus Gateway service with the necessary settings to route requests to the "Nearby Location" service.
     * Configure Service Discovery on Nexus to automatically detect the "Nearby Location" service by other services.
     * Set up security policies on Nexus to control access to the Nearby Location service APIs (e.g., determine which services or users are allowed to call location APIs).
     * Ensure the availability of the required Nexus database (if used).
     * Load Balancing settings if you need to distribute the load across multiple instances of the "Nearby Location" service.

   * Documentation: For detailed guidance on installing, configuring, and maintaining Nexus, refer to the following documentation:

     [here]

## Application Architecture

The “Nearby Location” service consists of two main components:

* Nearby Service: A Node.js application that implements the core logic of location processing and finding nearby users. This service is responsible for communicating with the database and providing the necessary APIs.
* MongoDB (Mongo): A database that stores information about users and their locations.

These two services communicate with each other through an internal network (nearby-net) and are managed by `docker compose`.

## Deployment Steps

Deploying the “Nearby Location” service includes the following steps:

### **Step 1: Build the Node.js image**

**Goal:** Create an optimized Docker image for a Node.js (`nearby`) service.

**Method:** Using a multi-stage `Dockerfile`.

A multi-stage `Dockerfile` for a Node.js application that separates development and production environments.

#### 1. Base Stage

``` dockerfile
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache bash python3 make g++
```

* Uses the `node:20-alpine` style image.
* Installs the tools needed to build native packages (such as `bcrypt`)

#### 2. Dependencies Stage

``` dockerfile
FROM base AS dependencies
COPY package*.json ./
RUN npm ci
```

* Only copies `package.json` (to use Docker cache)
* With `npm ci` it installs dependencies exactly according to `package-lock.json` (faster and more reliable)

#### 3. Build Stage

``` dockerfile
FROM dependencies AS build
COPY . .
RUN npm run build
```

* Copies the entire code.
* Builds the application (usually TypeScript to JavaScript)

#### 4. Development Stage

``` dockerfile
FROM base AS development
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
COPY .env.development .env
EXPOSE ${PORT:-5000}
CMD ["npm", "run", "dev"]
```

* It starts from the base stage.
* Copies node_modules from the dependencies stage.
* Copies the entire source code (for hot-reload)
* Runs the `npm run dev` command (usually with `nodemon` or similar)

#### 5. Production Stage

``` dockerfile
FROM base AS production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY .env .env
```

**Important security and optimization tips:**

* Removes build tools: `apk del python3 make g++`

* Creates a non-root user:

  ```dockerfile
  addgroup -g 1001 -S nearby
  adduser -S nearby -u 1001
  USER nearby
  ```

* Only copies built (`dist`) files and production dependencies.

#### Execute to build the production image

```bash
docker build --target production -t nearby:latest .
```

This command runs the production stage in the `Dockerfile` and builds the final image with the tag `nearby:latest`.

### Step 2: Configure and launch with Docker Compose

#### 1. Create project directory:

* Create a main directory called `nearby`.
* Place the `docker-compose.yaml`, `.env`, and `mongo-init.js` files inside this directory.

#### 2. Configuring services in `docker-compose.yaml`:

* **`nearby` service:**
* `image`: `nearby:latest` (image created in the first step).
* `container_name`: `nearby`.
* `ports`: Mapping of host port to container port (default 8080). `${PORT:-8080}:${PORT:-8080}`
* `env_file`: Read environment variables from `.env` file.
* `user`: `"1001:1001"` (Definition of a non-root user for increased security).
* `depends_on`: Specifies that this service depends on `mongo` and should be run after it.
* `networks`: Connect to the `nearby-net` network.
* `restart`: Set the restart policy (`unless-stopped`).
* `healthcheck`: (Optional) Check the health status of the service by calling the `/health` endpoint via HTTP.

* **`mongo` Service:**
* `image`: `mongo:6.0`.
* `container_name`: `nearby-mongo`.
* `environment`: Set the root username and password for MongoDB and the default database (`nearby`).
* `MONGO_INITDB_ROOT_USERNAME`: `root`
* `MONGO_INITDB_ROOT_PASSWORD`: `example`
* `MONGO_INITDB_DATABASE`: `nearby`
* `volumes`:
  * `mongo-data:/data/db`: MongoDB data directory mapping for data persistence.
  * `./mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro`: Copy of the `mongo-init.js` script to create a non-root user on the first MongoDB run (read-only).
* `networks`: Connect to the `nearby-net` network.
* `restart`: Set the restart policy.
* `healthcheck`: (optional) Check the health status with the `ping` command via `mongosh`.
* **`networks`:**
  * `nearby-net`: Defines the internal network for communication between containers.
* **`volumes`:**
  * `mongo-data`: Defines a volume for persistent storage of MongoDB data.

**`docker-compose.yaml`:**

``` yaml
services:
  nearby:
    image: nearby:latest
    container_name: nearby
    ports:
      - "${PORT:-8080}:${PORT:-8080}"
    env_file:
      - .env
    user: "1001:1001"
    depends_on:
      - mongo
    networks:
      - nearby-net
    restart: ${RESTART_POLICY:-unless-stopped}
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "require('http').get('http://localhost:${PORT:-8080}/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})",
        ]
      interval: 30s
      timeout: 10s
      retries: 3

  mongo:
    image: mongo:6.0
    container_name: nearby-mongo
    environment:
      MONGO_INITDB_ROOT_USERNAME: root
      MONGO_INITDB_ROOT_PASSWORD: example
      MONGO_INITDB_DATABASE: nearby
    volumes:
      - mongo-data:/data/db
      - ./mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro
    networks:
      - nearby-net
    restart: ${RESTART_POLICY:-unless-stopped}
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

networks:
  nearby-net:
    name: nearby-net

volumes:
  mongo-data:
    name: mongo-data
```



#### 3. Execute deployment command:

``` bash
docker compose up -d
```

This command builds and runs containers in the background (`-d`).

#### Additional details:

* **MongoDB Security:** The database security has been enhanced by not mapping the MongoDB port to the host and using volumes for data and initial script. Also, the `mongo-init.js` script is used to create a non-root user in the database, which is a good security practice.
* **Non-root user:** Defining `user: "1001:1001"` for the `nearby` service causes the application to run with more restricted permissions and has less impact if a security issue occurs in the container.
* **Health Check:** The `healthcheck` feature allows Docker Compose to monitor the health status of services and take necessary actions (such as restarting) if a problem occurs.