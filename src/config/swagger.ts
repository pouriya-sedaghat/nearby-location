import express, { Express } from "express";
import swaggerUi from "swagger-ui-express";
import type { AppConfig } from "./env";
import { swaggerAuthorizationMiddleware } from "../middleware/swagger-auth.middleware";
import { createOpenApiSpec } from "./openapi";
export { createOpenApiSpec } from "./openapi";

export function setupSwagger(app: Express, config: AppConfig) {
  if (!config.SWAGGER_ENABLED) return;
  const router = express.Router();
  const spec = createOpenApiSpec(config);
  router.use(swaggerAuthorizationMiddleware(config));
  router.use((_req, res, next) => { res.setHeader("Content-Language", "en"); next(); });
  router.get("/openapi.json", (_req, res) => res.json(spec));
  const options = {
    customSiteTitle: "Nearby Location API " + spec.info.version,
    customCss: [
      ".swagger-ui .topbar { background: #13263b; }",
      ".swagger-ui .wrapper { max-width: 1440px; }",
      ".swagger-ui .info { margin: 30px 0; }",
      ".swagger-ui .info .title { color: #13263b; }",
      ".swagger-ui .opblock { border-radius: 8px; }",
    ].join("\n"),
    swaggerOptions: {
      url: "./openapi.json", validatorUrl: null,
      deepLinking: true, displayOperationId: true,
      displayRequestDuration: true, filter: true,
      docExpansion: "list", defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 2, defaultModelRendering: "example",
      showCommonExtensions: true, requestSnippetsEnabled: true,
      tryItOutEnabled: config.SWAGGER_TRY_IT_OUT_ENABLED,
      persistAuthorization: false, queryConfigEnabled: false,
      supportedSubmitMethods: config.SWAGGER_TRY_IT_OUT_ENABLED ? ["get", "post"] : [],
    },
  };
  router.use(swaggerUi.serveFiles(undefined, options), swaggerUi.setup(null, options));
  app.use("/api-docs", router);
}
