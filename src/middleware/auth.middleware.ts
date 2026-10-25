import { apiMessage } from "../i18n/response";
import { NextFunction, Request, Response } from "express";
import { config } from "../config/env";
import { verifyBearerAuthorization } from "../utils/auth-core";
import { logger } from "../utils/logger";
import { metrics } from "../utils/metrics";

export type AuthSurface = "location" | "metrics" | "privacy";

const settingsFor = (surface: AuthSurface) => {
  if (surface === "location") {
    return {
      mode: config.LOCATION_AUTH_MODE,
      primaryToken: config.LOCATION_AUTH_TOKEN,
      previousToken: config.LOCATION_AUTH_PREVIOUS_TOKEN,
    };
  }

  if (surface === "privacy") {
    return {
      mode: "bearer" as const,
      primaryToken: config.PRIVACY_AUTH_TOKEN,
      previousToken: config.PRIVACY_AUTH_PREVIOUS_TOKEN,
    };
  }

  return {
    mode: config.METRICS_AUTH_MODE,
    primaryToken: config.METRICS_AUTH_TOKEN,
    previousToken: config.METRICS_AUTH_PREVIOUS_TOKEN,
  };
};

export const authorizationMiddleware = (surface: AuthSurface) =>
  (req: Request, res: Response, next: NextFunction) => {
    const settings = settingsFor(surface);
    if (settings.mode === "disabled") return next();

    if (!settings.primaryToken) {
      metrics.recordAuthFailure(surface, "misconfigured");
      logger.error("authorization_misconfigured", {
        requestId: res.locals.requestId,
        surface,
      });
      return res.status(503).json({
        success: false,
        message: apiMessage(res, "Service temporarily unavailable"),
      });
    }

    const result = verifyBearerAuthorization(
      req.header("authorization"),
      settings.primaryToken,
      settings.previousToken,
    );

    if (result.authorized) return next();

    const reason = result.reason ?? "invalid";
    metrics.recordAuthFailure(surface, reason);
    logger.warn("authorization_rejected", {
      requestId: res.locals.requestId,
      surface,
      reason,
    });

    res.setHeader("WWW-Authenticate", 'Bearer realm="nearby-location"');
    return res.status(401).json({
      success: false,
      message: apiMessage(res, "Unauthorized"),
    });
  };
