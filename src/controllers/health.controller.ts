import { Request, Response } from "express";
import type { Database } from "../utils/db";
import type { Logger } from "../utils/logger";


export const createHealthController = (database: Pick<Database, "ping">, logger: Logger) => {
  const liveness = (_req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      status: "ok",
    });
  };

  const readiness = async (_req: Request, res: Response) => {
    try {
      await database.ping();
      return res.status(200).json({
        success: true,
        status: "ready",
      });
    } catch (err) {
      logger.error("Readiness check failed", err);
      return res.status(503).json({
        success: false,
        status: "not_ready",
      });
    }
  };
  return { liveness, readiness };
};
