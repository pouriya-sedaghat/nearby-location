import { apiMessage } from "../i18n/response";
import { NextFunction, Request, Response } from "express";
import { config } from "../config/env";
import { admission } from "../utils/admission";
import { AdmissionWorkload } from "../utils/admission-core";
import { logger } from "../utils/logger";
import { metrics } from "../utils/metrics";
import { lifecycle } from "../utils/lifecycle";

const clientKey = (req: Request) => req.ip || req.socket.remoteAddress || "unknown";

export const admissionMiddleware = (
  workload: AdmissionWorkload,
  handler: (req: Request, res: Response) => Promise<unknown>,
) => async (req: Request, res: Response, next: NextFunction) => {
  if (lifecycle.isDraining()) {
    metrics.recordAdmissionRejection(workload, "draining");
    res.setHeader("Retry-After", "1");
    res.setHeader("Connection", "close");
    res.setHeader("X-Nearby-Rejection-Reason", "draining");
    return res.status(503).json({
      success: false,
      message: apiMessage(res, "Service is draining"),
    });
  }

  const rate = admission.consumeRateLimit(workload, clientKey(req));
  if (!rate.allowed) {
    metrics.recordRateLimitRejection(workload);
    res.setHeader("Retry-After", String(rate.retryAfterSeconds));
    res.setHeader("X-Nearby-Rejection-Reason", "rate_limit");
    return res.status(429).json({
      success: false,
      message: apiMessage(res, "Too many requests"),
    });
  }

  const decision = admission.tryAcquire(workload);
  if (!decision.accepted) {
    metrics.recordAdmissionRejection(workload, decision.reason);
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    res.setHeader("X-Nearby-Rejection-Reason", decision.reason);
    logger.warn("request_admission_rejected", {
      requestId: res.locals.requestId,
      workload,
      reason: decision.reason,
    });
    return res.status(503).json({
      success: false,
      message: apiMessage(res, "Service temporarily overloaded"),
    });
  }

  try {
    if (config.RATE_LIMIT_ENABLED) {
      res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    }
    await handler(req, res);
  } catch (err) {
    // Express 4 does not automatically forward rejected async handlers.
    next(err);
  } finally {
    // Closing the HTTP socket does not cancel an outstanding PostgreSQL
    // operation. Keep its capacity occupied until the handler has settled.
    decision.release();
  }
};
