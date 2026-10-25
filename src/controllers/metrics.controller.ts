import { Request, Response } from "express";
import { metrics } from "../utils/metrics";

export const prometheusMetrics = (_req: Request, res: Response) => {
  res.setHeader("Content-Language", "en");
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return res.status(200).send(metrics.renderPrometheus());
};
