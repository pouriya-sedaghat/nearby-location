import { apiMessage, validationErrors, validationOptions } from "../i18n/response";
import { Request, Response } from "express";
import Location from "../models/location.model";
import {
  deleteExactLocationReqSchema,
  deleteLocationReqSchema,
} from "../schemas/request.schema";
import { logger } from "../utils/logger";
import { metrics } from "../utils/metrics";
import { lifecycle } from "../utils/lifecycle";
import { classifyDatabaseError } from "../utils/admission-core";

type ErasureMode = "normalized" | "exact";

/**
 * Idempotent privacy erasure command for the live location row.
 *
 * The response intentionally does not reveal whether a row existed. This
 * endpoint also avoids putting userId in the URL so reverse-proxy/access logs
 * do not receive the identifier through the path. Each mode has its own route
 * and deletes at most one stored identity; there is no fallback between them.
 */
const eraseLocation = async (req: Request, res: Response, mode: ErasureMode) => {
  if (lifecycle.isDraining()) {
    res.setHeader("Retry-After", "1");
    res.setHeader("Connection", "close");
    return res.status(503).json({
      success: false,
      message: apiMessage(res, "Service is draining"),
    });
  }

  const parse = (mode === "exact"
    ? deleteExactLocationReqSchema
    : deleteLocationReqSchema).safeParse(req.body, validationOptions(res));

  if (!parse.success) {
    return res.status(400).json({
      success: false,
      message: apiMessage(res, "Invalid request body"),
      errors: validationErrors(res, parse.error),
    });
  }

  const startedAt = process.hrtime.bigint();
  try {
    const deleted = await Location.deleteUserLocation(parse.data.userId);
    const durationSeconds =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    metrics.observeDbOperation("privacy", "success", durationSeconds);
    metrics.recordPrivacyDeletion(deleted ? "deleted" : "not_found");
    logger.info("privacy_location_delete_completed", {
      requestId: res.locals.requestId,
      mode,
      deleted,
    });

    // Idempotent and non-enumerating: callers get the same response whether or
    // not a live row existed for the supplied identifier.
    return res.status(204).end();
  } catch (err) {
    const durationSeconds =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    metrics.observeDbOperation("privacy", "error", durationSeconds);
    metrics.recordPrivacyDeletion("error");
    metrics.recordDbError();

    const retryable = classifyDatabaseError(err).retryable;

    logger.error("privacy_location_delete_failed", {
      requestId: res.locals.requestId,
      retryable,
      error: err,
    });

    if (retryable) {
      res.setHeader("Retry-After", "1");
      return res.status(503).json({
        success: false,
        message: apiMessage(res, "Service temporarily unavailable"),
      });
    }

    return res.status(500).json({
      success: false,
      message: apiMessage(res, "Internal server error"),
    });
  }
};

/** POST /privacy/location/delete: 2.13.5 normalized identifier contract. */
export const deleteUserLocation = (req: Request, res: Response) =>
  eraseLocation(req, res, "normalized");

/** POST /privacy/location/delete-exact: stored identifier byte-for-byte. */
export const deleteExactUserLocation = (req: Request, res: Response) =>
  eraseLocation(req, res, "exact");
