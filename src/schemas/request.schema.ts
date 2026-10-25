import z from "zod";
import type { AppConfig } from "../config/env";
import { createCoordinateSchema } from "./coordinate.schema";
import type { ResponseLanguage } from "../i18n/language";
import { message, maximumDistanceMessage } from "../i18n/messages";

const userIdSchema = (language: ResponseLanguage) => z
  .string({
    error: (issue) => message(language, issue.input === undefined ? "requiredUserId" : "invalidUserId"),
  })
  .trim()
  .min(1, message(language, "emptyUserId"))
  .max(255, message(language, "longUserId"))
  .refine((value) => !value.includes("\u0000"), message(language, "nulUserId"))
  .refine((value) => Buffer.from(value, "utf8").toString("utf8") === value,
    message(language, "unicodeUserId"));

export const createUpsertRequestSchema = (language: ResponseLanguage = "en") => z.object({
  userId: userIdSchema(language),
  coordinate: createCoordinateSchema(language),
});
export const upsertReqSchema = createUpsertRequestSchema();

const persianLocaleError = z.locales.fa().localeError;
const persianErrors: typeof persianLocaleError = issue => {
  if (issue.code === "invalid_type" && issue.expected === "object") {
    return issue.input === undefined ? "این بخش از درخواست الزامی است" : "مقدار باید یک شیء JSON باشد";
  }
  return persianLocaleError(issue);
};
const localeErrors = { en: z.locales.en().localeError, fa: persianErrors };
export const validationOptions = (language: ResponseLanguage) => ({ error: localeErrors[language] });

// Preserve numeric query/body strings, but do not coerce booleans or arrays
// into a radius (true -> 1, [1000] -> 1000).
const numericInput = <T extends z.ZodType>(schema: T) => z.preprocess(
  (value) => typeof value === "string" && value.trim() !== "" ? Number(value)
    : typeof value === "number" || value === undefined ? value : NaN,
  schema,
);

export const createNearbyRequestSchema = (config: Pick<AppConfig,
  "DEFAULT_MAX_DISTANCE_METERS" | "MAX_MAX_DISTANCE_METERS">, language: ResponseLanguage = "en") => z.object({
  coordinate: createCoordinateSchema(language),
  maxDistance: numericInput(z
    .number({
      error: message(language, "invalidDistance"),
    })
    .positive({
      error: message(language, "positiveDistance"),
    })
    .max(config.MAX_MAX_DISTANCE_METERS, {
      error: maximumDistanceMessage(language, config.MAX_MAX_DISTANCE_METERS),
    })
    .default(config.DEFAULT_MAX_DISTANCE_METERS)),
  excludeUserId: userIdSchema(language).optional(),
  page: numericInput(z
    .number({ error: message(language, "invalidPage") })
    .int({ error: message(language, "integerPage") })
    .positive({ error: message(language, "positivePage") })
    .max(Number.MAX_SAFE_INTEGER, message(language, "safePage"))
    .default(1)),
  pageSize: numericInput(z
    .number({
      error: message(language, "invalidPageSize"),
    })
    .int({
      error: message(language, "integerPageSize"),
    })
    .positive({
      error: message(language, "positivePageSize"),
    })
    .max(100, { error: message(language, "maximumPageSize") })
    .default(10)),
}).superRefine((value, ctx) => {
  if (!Number.isSafeInteger((value.page - 1) * value.pageSize)) {
    ctx.addIssue({ code: "custom", path: ["page"],
      message: message(language, "safeOffset") });
  }
});

// Keep the public _errors tree stable across validator major versions.
export interface ValidationErrors {
  _errors: string[];
  [field: string]: string[] | ValidationErrors;
}
export const formatValidationErrors = (error: z.ZodError): ValidationErrors => {
  const node = (): ValidationErrors => Object.assign(Object.create(null), { _errors: [] });
  const result = node();
  for (const issue of error.issues) {
    let current = result;
    for (const part of issue.path) {
      const key = String(part);
      current[key] ??= node();
      current = current[key] as ValidationErrors;
    }
    current._errors.push(issue.message);
  }
  return result;
};
