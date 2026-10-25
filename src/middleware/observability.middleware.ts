import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";
import { metrics } from "../utils/metrics";

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

const normalizeRoute = (path: string): string => {
  switch (path) {
    case "/health/live":
    case "/health/ready":
    case "/location/upsert":
    case "/location/nearby":
    case "/privacy/location/delete":
    case "/privacy/location/delete-exact":
    case "/metrics":
      return path;
    default:
      return "/not_found";
  }
};

export const observabilityMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const incomingRequestId = req.header("x-request-id");
  const requestId =
    incomingRequestId && requestIdPattern.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();

  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const startedAt = process.hrtime.bigint();
  const route = normalizeRoute(req.path);

  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    metrics.observeHttpRequest(
      req.method,
      route,
      res.statusCode,
      durationMs / 1_000,
    );

    if (!["/health/live", "/health/ready", "/metrics"].includes(route)) {
      logger.info("http_request", {
        requestId,
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      });
    }
  });

  next();
};
