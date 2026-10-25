import { Request, Response } from "express";
import { createUpsertRequestSchema, createNearbyRequestSchema, formatValidationErrors, validationOptions } from "../schemas/request.schema";
import type { LocationRepository } from "../models/location.model";
import type { AppConfig } from "../config/env";
import type { Logger } from "../utils/logger";
import { timeAgo } from "../helpers/timeAgo.helper";
import { message } from "../i18n/messages";
import { getRequestContext, responseLanguage } from "../middleware/request-context.middleware";


export const createLocationController = (
  locations: Pick<LocationRepository, "upsertLocation" | "findNearby">,
  config: AppConfig,
  logger: Logger,
  clock: () => number = Date.now,
) => {
  const schemas = {
    en: { upsert: createUpsertRequestSchema("en"), nearby: createNearbyRequestSchema(config, "en") },
    fa: { upsert: createUpsertRequestSchema("fa"), nearby: createNearbyRequestSchema(config, "fa") },
  };
  const upsertLocation = async (req: Request, res: Response) => {
    const language = responseLanguage(res);
    try {
      const parse = schemas[language].upsert.safeParse(req.body, validationOptions(language));

      if (!parse.success) {
        return res.status(400).json({
          success: false,
          message: message(language, "invalidBody"),
          errors: formatValidationErrors(parse.error),
        });
      }

      const { userId, coordinate } = parse.data;

      await locations.upsertLocation(userId, coordinate.lat, coordinate.lng);

      return res
        .status(200)
        .json({ success: true, message: message(language, "upserted") });
    } catch (err) {
      logger.error("Upsert Location error", err);
      return res
        .status(500)
        .json({ success: false, message: message(language, "internalError") });
    }
  };

  const findNearby = async (req: Request, res: Response) => {
    const language = responseLanguage(res);
    try {
      const referenceTime = getRequestContext(res)?.startedAt ?? clock();
      const params = { ...req.query, ...req.body };
      const parse = schemas[language].nearby.safeParse(params, validationOptions(language));

      if (!parse.success) {
        return res.status(400).json({
          success: false,
          message: message(language, "invalidData"),
          errors: formatValidationErrors(parse.error),
        });
      }

      const {
        coordinate,
        maxDistance,
        excludeUserId,
        page,
        pageSize,
      } = parse.data;

      const skip = (page - 1) * pageSize;

      const { data, totalCount } = await locations.findNearby(
        coordinate.lat,
        coordinate.lng,
        maxDistance,
        skip,
        pageSize,
        excludeUserId,
      );

      const totalPages = Math.ceil(totalCount / pageSize);
      const hasMore = page < totalPages;

      return res.status(200).json({
        success: true,
        page,
        pageSize,
        totalCount,
        totalPages,
        hasMore,
        data: data.map((d) => ({
          userId: d.userId,
          coordinate: d.coordinate,
          distance: d.distance,
          updatedAt: d.updatedAt,
          updateStatus: timeAgo(d.updatedAt, referenceTime, language),
        })),
      });
    } catch (err) {
      logger.error("Find Nearby error", err);
      return res
        .status(500)
        .json({ success: false, message: message(language, "internalError") });
    }
  };
  return { upsertLocation, findNearby };
};
