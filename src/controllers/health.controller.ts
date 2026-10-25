import { Request, Response } from "express";
import db from "../utils/db";
import { logger } from "../utils/logger";
import { metrics } from "../utils/metrics";
import { admission } from "../utils/admission";
import { lifecycle } from "../utils/lifecycle";

export const liveness = (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    status: "ok",
  });
};

export const readiness = async (_req: Request, res: Response) => {
  const notReady = () => res.status(503).json({
    success: false,
    status: "not_ready",
    reason: lifecycle.snapshot().state,
  });
  if (!lifecycle.isReady()) return notReady();

  try {
    await db.ping();
    // Shutdown may begin while PostgreSQL is responding to this probe.
    if (!lifecycle.isReady()) return notReady();
    return res.status(200).json({
      success: true,
      status: "ready",
      circuit: admission.snapshot().circuitState,
    });
  } catch (err) {
    metrics.recordDbError();
    admission.recordDbFailure(err);
    logger.warn("readiness_check_failed", {
      requestId: res.locals.requestId,
      error: err,
    });
    return res.status(503).json({
      success: false,
      status: "not_ready",
    });
  }
};
