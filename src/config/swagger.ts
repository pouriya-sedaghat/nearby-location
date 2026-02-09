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
          url: "http://localhost:5000",
        },
      ],
    },
    apis: ["./src/routes/*.ts"],
  };

  const specs = swaggerJsdoc(options);

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));
}
