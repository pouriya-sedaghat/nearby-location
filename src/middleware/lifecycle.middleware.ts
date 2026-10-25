import { NextFunction, Request, Response } from "express";
import { lifecycle } from "../utils/lifecycle";

const excludedPaths = new Set(["/health/live", "/health/ready", "/metrics"]);

/** Tracks application work without counting probes/scrapes as active traffic. */
export const lifecycleRequestMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (excludedPaths.has(req.path)) return next();

  const release = lifecycle.beginRequest();
  let released = false;
  const done = () => {
    if (released) return;
    released = true;
    release();
  };

  res.once("finish", done);
  res.once("close", done);
  next();
};
