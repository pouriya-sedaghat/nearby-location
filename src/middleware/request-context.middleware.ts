import type { RequestHandler, Response } from "express";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "../i18n/language";
import type { ResponseLanguage } from "../i18n/language";

export interface RequestContext {
  readonly language: ResponseLanguage;
  readonly startedAt: number;
}

/** Capture trusted server time and language once, before body parsing or I/O. */
export const requestContextMiddleware = (clock: () => number = Date.now): RequestHandler => (req, res, next) => {
  const selected = req.acceptsLanguages([...SUPPORTED_LANGUAGES]);
  const language: ResponseLanguage = selected === "fa" ? "fa" : DEFAULT_LANGUAGE;
  const context: RequestContext = Object.freeze({ language, startedAt: clock() });
  res.locals.requestContext = context;
  res.setHeader("Content-Language", language);
  res.vary("Accept-Language");
  next();
};

export const getRequestContext = (res: Response): RequestContext | undefined =>
  (res.locals as { requestContext?: RequestContext } | undefined)?.requestContext;

export const responseLanguage = (res: Response): ResponseLanguage => getRequestContext(res)?.language ?? DEFAULT_LANGUAGE;
