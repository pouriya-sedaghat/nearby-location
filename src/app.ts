import express, { Request, Response, NextFunction } from "express";
import { TextDecoder } from "util";
import { createHealthRoutes } from "./routes/health.routes";
import { createLocationRoutes } from "./routes/location.routes";
import { setupSwagger } from "./config/swagger";

import type { AppConfig } from "./config/env";
import type { Database } from "./utils/db";
import type { LocationRepository } from "./models/location.model";
import type { Logger } from "./utils/logger";
import { createHealthController } from "./controllers/health.controller";
import { createLocationController } from "./controllers/location.controller";
import { requestContextMiddleware, responseLanguage } from "./middleware/request-context.middleware";
import { message } from "./i18n/messages";
import type { MessageKey } from "./i18n/messages";

export interface AppDependencies {
  config: AppConfig;
  database: Pick<Database, "ping">;
  locations: Pick<LocationRepository, "upsertLocation" | "findNearby">;
  logger?: Logger;
  clock?: () => number;
}

/** Builds HTTP handlers only; no environment loading, timers or sockets. */
export const createApp = ({ config, database, locations, logger = console, clock = Date.now }: AppDependencies) => {
  const app = express();
  app.set("env", config.NODE_ENV);
  app.disable("x-powered-by");
  app.use(requestContextMiddleware(clock));
  app.use(express.json({
    limit: "32kb",
    verify: (_req, _res, body, encoding) => {
      // A permissive UTF-8 decoder can replace distinct invalid byte sequences
      // with the same character before identifier validation sees the input.
      if (encoding.toLowerCase() !== "utf-8") return;
      try { new TextDecoder("utf-8", { fatal: true }).decode(body); }
      catch { throw Object.assign(new Error("Invalid JSON body encoding"), { status: 400 }); }
    },
  }));

  app.use("/health", createHealthRoutes(createHealthController(database, logger)));
  app.use("/location", createLocationRoutes(createLocationController(locations, config, logger, clock)));

  setupSwagger(app, config);

  app.use((_req: Request, res: Response) => {
    return res.status(404).json({
      success: false,
      message: message(responseLanguage(res), "notFound"),
    });
  });

  const errorHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (res.headersSent) return next(err);

    // Preserve JSON parser client errors without returning the submitted body.
    const clientMessages: Record<number, MessageKey> = {
      400: "invalidJson",
      413: "bodyTooLarge",
      415: "unsupportedEncoding",
    };
    const status = typeof err === "object" && err !== null && "status" in err
      ? (err as { status?: unknown }).status : undefined;
    if (typeof status === "number" && clientMessages[status]) {
      return res.status(status).json({
        success: false,
        message: message(responseLanguage(res), clientMessages[status]),
      });
    }

    logger.error(err instanceof Error ? err.stack ?? err.message : err);

    return res.status(500).json({
      success: false,
      message: message(responseLanguage(res), "unexpectedError"),
    });
  };
  app.use(errorHandler);

  return app;
};
