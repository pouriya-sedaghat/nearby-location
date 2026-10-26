import express, { Request, Response, NextFunction } from "express";
import { TextDecoder } from "node:util";
import { requestContextMiddleware } from "./middleware/request-context.middleware";
import { apiMessage } from "./i18n/response";
import healthRoutes from "./routes/health.routes";
import locationRoutes from "./routes/location.routes";
import privacyRoutes from "./routes/privacy.routes";
import metricsRoutes from "./routes/metrics.routes";
import { setupSwagger } from "./config/swagger";
import { observabilityMiddleware } from "./middleware/observability.middleware";
import { logger } from "./utils/logger";
import { config } from "./config/env";
import { lifecycleRequestMiddleware } from "./middleware/lifecycle.middleware";
import { authorizationMiddleware } from "./middleware/auth.middleware";

export const createApp = ({ clock = Date.now }: { clock?: () => number } = {}) => {
const app = express();
app.set("env", config.NODE_ENV);
app.use(requestContextMiddleware(clock));
app.disable("x-powered-by");
if (config.HTTP_TRUST_PROXY) app.set("trust proxy", true);

// Install request identity/metrics before body parsing so malformed JSON is
// still traceable and measured.
app.use(observabilityMiddleware);
app.use(lifecycleRequestMiddleware);
app.use((_req: Request, res: Response, next: NextFunction) => {
  // Location responses should not be cached by browsers or shared proxies.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
// Keep probes independent from application authentication. Protect sensitive
// surfaces before parsing request bodies so unauthorized callers do not consume
// JSON parsing work.
app.use("/health", healthRoutes);
app.use("/metrics", authorizationMiddleware("metrics"), metricsRoutes);
app.use("/location", authorizationMiddleware("location"));
if (config.PRIVACY_API_ENABLED) {
  app.use("/privacy", authorizationMiddleware("privacy"));
}
// Authenticate documentation before inspecting bodies; the UI has no JSON
// request-body contract and must not expose parser errors before login.
setupSwagger(app);
app.use(express.json({ limit: "32kb", verify: (_req, _res, body, encoding) => {
  const charset = encoding.toLowerCase();
  const decoder = charset === "utf-8" ? "utf-8"
    : charset === "utf-16le" || charset === "utf-16be" ? charset
    : charset === "utf-16" ? ((body[0] === 0xfe && body[1] === 0xff) || body[0] === 0 ? "utf-16be" : "utf-16le")
    : undefined;
  // JSON starts with an ASCII code unit (possibly whitespace). Use that unit
  // or the BOM for generic UTF-16; TextDecoder's UTF-16 alias always means LE.
  if (!decoder) throw Object.assign(new Error("Unsupported JSON body encoding"), { status: 415 });
  try { new TextDecoder(decoder, { fatal: true }).decode(body); }
  catch { throw Object.assign(new Error("Invalid JSON body encoding"), { status: 400, type: "entity.parse.failed" }); }
} }));
app.use("/location", locationRoutes);
if (config.PRIVACY_API_ENABLED) {
  app.use("/privacy", privacyRoutes);
}

app.use((_req: Request, res: Response) => {
  return res.status(404).json({
    success: false,
    message: apiMessage(res, "Not found"),
  });
});

type ExpressBodyError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

const errorHandler = (
  err: ExpressBodyError,
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) return next(err);
  const status = err.status ?? err.statusCode;

  if (status === 400) {
    return res.status(400).json({
      success: false,
      message: apiMessage(res, err.type === "entity.parse.failed" ? "Invalid JSON body" : "Invalid request body"),
    });
  }

  if (status === 413) {
    return res.status(413).json({
      success: false,
      message: apiMessage(res, "Request body too large"),
    });
  }

  if (status === 415) {
    return res.status(415).json({
      success: false,
      message: apiMessage(res, "Unsupported request encoding or charset"),
    });
  }

  logger.error("unhandled_http_error", {
    requestId: res.locals.requestId,
    error: err,
  });

  return res.status(500).json({
    success: false,
    message: apiMessage(res, "Internal Server Error"),
  });
};
app.use(errorHandler);

return app;
};

export default createApp();
