import express, { Express } from "express";
import { config } from "./env";
import { swaggerAuthorizationMiddleware } from "../middleware/swagger-auth.middleware";
import { buildOpenApiSpec } from "./openapi";
export const createOpenApiSpec = (options: { runtime?: boolean } = {}) => buildOpenApiSpec(config, options);

export function setupSwagger(app: Express) {
  if (!config.SWAGGER_ENABLED) return;
  const swaggerUi = require("swagger-ui-express");
  const specs = createOpenApiSpec({ runtime: true });
  const router = express.Router();
  router.use(swaggerAuthorizationMiddleware());
  router.use((_req, res, next) => { res.setHeader("Content-Language", "en"); next(); });
  router.get("/openapi.json", (_req, res) => res.json(specs));
  const options = {
    customSiteTitle: "Nearby Location API " + specs.info.version,
    swaggerOptions: {
      url: "./openapi.json",
      validatorUrl: null,
      persistAuthorization: false,
      queryConfigEnabled: false,
      tryItOutEnabled: config.SWAGGER_TRY_IT_OUT_ENABLED,
      deepLinking: true, displayOperationId: true, displayRequestDuration: true,
      filter: true, requestSnippetsEnabled: true, docExpansion: "list",
      supportedSubmitMethods: config.SWAGGER_TRY_IT_OUT_ENABLED ? ["get", "post"] : [],
    },
  };
  router.use(swaggerUi.serveFiles(undefined, options), swaggerUi.setup(null, options));

  app.use("/api-docs", router);
}
