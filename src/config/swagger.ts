import { Express } from "express";

export function setupSwagger(app: Express) {
  if (process.env.NODE_ENV !== "development") return;

  const swaggerJsdoc = require("swagger-jsdoc");
  const swaggerUi = require("swagger-ui-express");

  const options = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "Nearby Location API",
        version: "1.0.1",
        description:
          "Microservice to store user location and find nearby users",
      },
      servers: [
        {
          url:
            process.env.BASE_URL ??
            `http://localhost:${process.env.PORT ?? 5000}`,
          description:
            "For Docker (compiled JS) or local development with ts-node",
        },
      ],
    },
    apis: ["./dist/routes/*.js"], // For Docker (compiled JS)
    // apis: ["./src/routes/*.ts"], // For local development with ts-node
  };

  const specs = swaggerJsdoc(options);

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));
}
