import { apiMessage } from "../i18n/response";
import { createHash, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { config } from "../config/env";

/** Browser-native documentation login, separate from API service credentials. */
export const swaggerAuthorizationMiddleware = () => {
  const username = config.SWAGGER_AUTH_USERNAME;
  const password = config.SWAGGER_AUTH_PASSWORD;
  const expected = username && password
    ? createHash("sha256")
      .update(Buffer.from(`${username}:${password}`, "utf8").toString("base64"))
      .digest()
    : undefined;

  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (!expected) return next();

    const header = req.header("authorization");
    const supplied = header && header.length <= 4096
      ? /^Basic[\t ]+([A-Za-z0-9+/]+={0,2})$/i.exec(header)?.[1]
      : undefined;
    if (supplied && timingSafeEqual(
      createHash("sha256").update(supplied).digest(), expected,
    )) return next();

    res.setHeader("WWW-Authenticate", 'Basic realm="nearby-api-docs", charset="UTF-8"');
    return res.status(401).json({ success: false, message: apiMessage(res, "Unauthorized") });
  };
};
