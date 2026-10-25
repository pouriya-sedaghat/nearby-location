import { getRequestContext, responseLanguage } from "../middleware/request-context.middleware";
import { apiMessage, validationErrors, validationOptions } from "../i18n/response";
import { Request, Response } from "express";
import {
  upsertReqSchema,
  findNearbyReqSchema,
} from "../schemas/request.schema";
import Location, { NearbyLocation } from "../models/location.model";
import { timeAgo } from "../helpers/timeAgo.helper";
import {
  buildNearbyQueryHash,
  decodeNearbyCursor,
  encodeNearbyCursor,
  getNearbyCursorAgeStatus,
  isSignedNearbyCursor,
} from "../utils/cursor";
import { rankingProfile } from "../config/ranking";
import { config } from "../config/env";
import { logger } from "../utils/logger";
import { metrics } from "../utils/metrics";
import { admission } from "../utils/admission";

const cursorSecurity = {
  signingSecret: config.CURSOR_SIGNING_SECRET,
  previousSigningSecret: config.CURSOR_SIGNING_PREVIOUS_SECRET,
  requireSignature: config.CURSOR_REQUIRE_SIGNATURE,
};

const elapsedMs = (startedAt: bigint) =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000;

const publicLocation = (location: NearbyLocation, referenceTime: number, res: Response) => ({
  userId: location.userId,
  coordinate: location.coordinate,
  distance: location.distance,
  updatedAt: location.updatedAt,
  updateStatus: timeAgo(new Date(location.updatedAt), referenceTime, responseLanguage(res)),
});

const invalidCursorResponse = (
  res: Response,
  message: import("../i18n/response").PublicMessage = "Invalid cursor",
  reason = "invalid",
) => {
  metrics.recordCursorValidationFailure(reason);
  return res.status(400).json({ success: false, message: apiMessage(res, message) });
};

const encodeResponseCursor = (
  score: number,
  userId: string,
  queryHash: string,
  totalCount: number,
  rankingReferenceTime?: Date,
  issuedAtMs?: number,
) =>
  encodeNearbyCursor(score, userId, queryHash, {
    totalCount,
    issuedAtMs: issuedAtMs ?? rankingReferenceTime?.getTime(),
    security: cursorSecurity,
    ...(rankingProfile.mode === "decay" && rankingReferenceTime
      ? {
          rankingContext: {
            rankedAtMs: rankingReferenceTime.getTime(),
            rankingProfileId: rankingProfile.profileId,
          },
        }
      : {}),
  });

export const upsertLocation = async (req: Request, res: Response) => {
  let dbStartedAt: bigint | undefined;
  try {
    const parse = upsertReqSchema.safeParse(req.body, validationOptions(res));

    if (!parse.success) {
      return res.status(400).json({
        success: false,
        message: apiMessage(res, "Invalid request body"),
        errors: validationErrors(res, parse.error),
      });
    }

    const { userId, coordinate } = parse.data;
    const upsertDbStartedAt = process.hrtime.bigint();
    dbStartedAt = upsertDbStartedAt;
    await Location.upsertLocation(userId, coordinate.lat, coordinate.lng);
    admission.recordDbSuccess("upsert", elapsedMs(upsertDbStartedAt));
    dbStartedAt = undefined;

    return res
      .status(200)
      .json({ success: true, message: apiMessage(res, "Location upserted successfully") });
  } catch (err) {
    if (dbStartedAt) {
      metrics.recordDbError();
      const retryable = admission.recordDbFailure(
        err,
        "upsert",
        elapsedMs(dbStartedAt),
      );
      logger.error("upsert_location_failed", {
        requestId: res.locals.requestId,
        retryable,
        error: err,
      });
      if (retryable) {
        res.setHeader("Retry-After", "1");
        res.setHeader("X-Nearby-Rejection-Reason", "db_retryable");
        return res.status(503).json({
          success: false,
          message: apiMessage(res, "Service temporarily unavailable"),
        });
      }
    } else {
      logger.error("upsert_location_internal_failure", {
        requestId: res.locals.requestId,
        error: err,
      });
    }
    return res
      .status(500)
      .json({ success: false, message: apiMessage(res, "Internal server error") });
  }
};

export const findNearby = async (req: Request, res: Response) => {
  const referenceTime = getRequestContext(res)?.startedAt ?? Date.now();
  let dbStartedAt: bigint | undefined;
  try {
    const params = { ...req.query, ...req.body };
    const parse = findNearbyReqSchema.safeParse(params, validationOptions(res));

    if (!parse.success) {
      return res.status(400).json({
        success: false,
        message: apiMessage(res, "Invalid request data"),
        errors: validationErrors(res, parse.error),
      });
    }

    const {
      coordinate,
      maxDistance,
      excludeUserId,
      pagination,
      cursor,
      pageSize,
    } = parse.data;

    const paginationMode: "offset" | "cursor" = cursor
      ? "cursor"
      : (pagination ?? "offset");
    const queryHash = buildNearbyQueryHash(
      {
        lat: coordinate.lat,
        lng: coordinate.lng,
        maxDistance,
        excludeUserId,
      },
      rankingProfile.mode === "decay" ? rankingProfile.profileId : undefined,
    );

    if (paginationMode === "cursor") {
      let decodedCursor: ReturnType<typeof decodeNearbyCursor> | undefined;
      let rankingReferenceTime: Date | undefined;
      let cursorIssuedAtMs: number | undefined;

      if (cursor) {
        try {
          decodedCursor = decodeNearbyCursor(cursor, cursorSecurity);

          if (decodedCursor.version === 3) {
            const cursorAgeStatus = getNearbyCursorAgeStatus(
              decodedCursor.issuedAtMs,
              config.CURSOR_MAX_AGE_MINUTES,
            );
            if (cursorAgeStatus === "future") {
              return invalidCursorResponse(
                res,
                "Cursor has an invalid timestamp",
                "timestamp",
              );
            }
            if (cursorAgeStatus === "expired") {
              return invalidCursorResponse(res, "Cursor expired", "expired");
            }
            cursorIssuedAtMs = decodedCursor.issuedAtMs;
          }

          const cursorRankingContext =
            decodedCursor.version === 2
              ? {
                  rankedAtMs: decodedCursor.rankedAtMs,
                  rankingProfileId: decodedCursor.rankingProfileId,
                }
              : decodedCursor.version === 3 &&
                  decodedCursor.rankedAtMs !== undefined &&
                  decodedCursor.rankingProfileId !== undefined
                ? {
                    rankedAtMs: decodedCursor.rankedAtMs,
                    rankingProfileId: decodedCursor.rankingProfileId,
                  }
                : undefined;

          if (rankingProfile.mode === "legacy" && cursorRankingContext) {
            return invalidCursorResponse(
              res,
              "Cursor was created for a different ranking profile",
              "ranking_profile",
            );
          }

          if (rankingProfile.mode === "decay") {
            if (!cursorRankingContext) {
              return invalidCursorResponse(
                res,
                "Cursor was created for a different ranking profile",
                "ranking_profile",
              );
            }

            const {
              rankedAtMs: cursorRankedAtMs,
              rankingProfileId: cursorRankingProfileId,
            } = cursorRankingContext;

            if (cursorRankingProfileId !== rankingProfile.profileId) {
              return invalidCursorResponse(
                res,
                "Cursor was created for a different ranking profile",
                "ranking_profile",
              );
            }

            const cursorAgeStatus = getNearbyCursorAgeStatus(
              cursorRankedAtMs,
              config.CURSOR_MAX_AGE_MINUTES,
            );
            if (cursorAgeStatus === "future") {
              return invalidCursorResponse(
                res,
                "Cursor has an invalid timestamp",
                "timestamp",
              );
            }
            if (cursorAgeStatus === "expired") {
              return invalidCursorResponse(res, "Cursor expired", "expired");
            }

            rankingReferenceTime = new Date(cursorRankedAtMs);
          }

          if (decodedCursor.queryHash !== queryHash) {
            return invalidCursorResponse(
              res,
              "Cursor does not match the current nearby search",
              "query_mismatch",
            );
          }
        } catch {
          return invalidCursorResponse(res);
        }
      }

      const knownTotalCount =
        cursor &&
        isSignedNearbyCursor(cursor) &&
        decodedCursor?.version === 3
          ? decodedCursor.totalCount
          : undefined;

      const cursorDbStartedAt = process.hrtime.bigint();
      dbStartedAt = cursorDbStartedAt;
      const result = await Location.findNearbyByCursor(
        coordinate.lat,
        coordinate.lng,
        maxDistance,
        pageSize,
        decodedCursor?.score,
        decodedCursor?.userId,
        excludeUserId,
        rankingReferenceTime,
        knownTotalCount,
      );
      admission.recordDbSuccess("nearby", elapsedMs(cursorDbStartedAt));
      dbStartedAt = undefined;

      const last = result.data[result.data.length - 1];
      const responseRankingReferenceTime =
        result.rankingReferenceTime ?? rankingReferenceTime;
      const nextCursor =
        result.hasMore && last
          ? encodeResponseCursor(
              last.score,
              last.userId,
              queryHash,
              result.totalCount,
              responseRankingReferenceTime,
              cursorIssuedAtMs,
            )
          : null;

      metrics.recordNearbySearch(
        "cursor",
        rankingProfile.mode,
        result.data.length,
      );


      return res.status(200).json({
        success: true,
        paginationMode: "cursor",
        rankingMode: rankingProfile.mode,
        pageSize,
        totalCount: result.totalCount,
        hasMore: result.hasMore,
        nextCursor,
        data: result.data.map((location) => publicLocation(location, referenceTime, res)),
      });
    }

    const page = parse.data.page ?? 1;
    const skip = (page - 1) * pageSize;
    const offsetDbStartedAt = process.hrtime.bigint();
    dbStartedAt = offsetDbStartedAt;
    const {
      data,
      totalCount,
      rankingReferenceTime,
    } = await Location.findNearby(
      coordinate.lat,
      coordinate.lng,
      maxDistance,
      skip,
      pageSize,
      excludeUserId,
    );
    admission.recordDbSuccess("nearby", elapsedMs(offsetDbStartedAt));
    dbStartedAt = undefined;

    const totalPages = Math.ceil(totalCount / pageSize);
    const hasMore = page < totalPages;
    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeResponseCursor(
            last.score,
            last.userId,
            queryHash,
            totalCount,
            rankingReferenceTime,
          )
        : null;

    metrics.recordNearbySearch("offset", rankingProfile.mode, data.length);


    return res.status(200).json({
      success: true,
      paginationMode: "offset",
      rankingMode: rankingProfile.mode,
      page,
      pageSize,
      totalCount,
      totalPages,
      hasMore,
      nextCursor,
      data: data.map((location) => publicLocation(location, referenceTime, res)),
    });
  } catch (err) {
    if (dbStartedAt) {
      metrics.recordDbError();
      const retryable = admission.recordDbFailure(
        err,
        "nearby",
        elapsedMs(dbStartedAt),
      );
      logger.error("find_nearby_failed", {
        requestId: res.locals.requestId,
        retryable,
        error: err,
      });
      if (retryable) {
        res.setHeader("Retry-After", "1");
        res.setHeader("X-Nearby-Rejection-Reason", "db_retryable");
        return res.status(503).json({
          success: false,
          message: apiMessage(res, "Service temporarily unavailable"),
        });
      }
    } else {
      logger.error("find_nearby_internal_failure", {
        requestId: res.locals.requestId,
        error: err,
      });
    }
    return res
      .status(500)
      .json({ success: false, message: apiMessage(res, "Internal server error") });
  }
};
