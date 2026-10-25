import z from "zod";
import { config } from "../config/env";
import { coordinateSchema } from "./coordinate.schema";
import { MAX_CURSOR_LENGTH } from "../utils/cursor";
import {
  MAX_USER_ID_LENGTH,
  USER_ID_PATTERN,
  WELL_FORMED_USER_ID_PATTERN,
} from "../utils/user-id";

const userIdString = () => z
  .string({
    error: issue => issue.input === undefined ? "Required user id" : "Invalid user id",
  })
  .regex(WELL_FORMED_USER_ID_PATTERN, "User id must be well-formed Unicode text");

export const userIdSchema = userIdString()
  .regex(USER_ID_PATTERN, "User id cannot contain control characters")
  .trim()
  .min(1, "User id cannot be empty")
  .refine(value => value.length <= MAX_USER_ID_LENGTH, "User id cannot exceed 255 characters");

// A stored identifier taken verbatim: no trimming or other normalization. It
// accepts exactly what the cursor codec accepts (isStoredUserId), including
// control characters stored before 2.13.1. NUL is never storable in PostgreSQL.
export const exactStoredUserIdSchema = userIdString()
  .regex(/^[^\u0000]*$/u, "User id cannot contain NUL characters")
  .refine(value => value.length <= MAX_USER_ID_LENGTH, "User id cannot exceed 255 characters")
  .refine((value) => value.trim().length > 0, "User id cannot be blank");

export const upsertReqSchema = z.object({
  userId: userIdSchema,
  coordinate: coordinateSchema,
});

// Releases up to 2.13.5 strip unknown fields, so a selector such as `match`
// would be silently ignored by older replicas during a rolling deployment.
// Refuse it here; exact erasure has its own path that older releases 404.
const UNSUPPORTED_SELECTOR =
  "match is not supported; send exact stored identifiers to POST /privacy/location/delete-exact";

/**
 * POST /privacy/location/delete: the 2.13.5 normalized contract. The upsert
 * rules apply, including trimming, so it deletes the identity an upsert of the
 * same input writes; control characters are rejected, never trimmed away.
 */
export const deleteLocationReqSchema = z.object({
  userId: userIdSchema,
  match: z.undefined({ error: UNSUPPORTED_SELECTOR }).optional(),
});

/**
 * POST /privacy/location/delete-exact: the stored identifier byte-for-byte.
 * Unknown fields are rejected so a request never means something different
 * from what its sender intended.
 */
export const deleteExactLocationReqSchema = z
  .object({ userId: exactStoredUserIdSchema })
  .strict();

// Query parameters arrive as strings, but JSON booleans/arrays/objects are not
// numeric input. z.coerce.number alone would accept true and [1] as the number 1.
const numericInput = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(
  (value) => typeof value === "string" && value.trim() !== "" ? Number(value)
    : typeof value === "number" || value === undefined ? value : NaN,
  schema,
);

export const findNearbyReqSchema = z
  .object({
    coordinate: coordinateSchema,
    maxDistance: numericInput(z
      .number({
        error: "Invalid max distance",
      })
      .positive({
        message: "Max distance must be a positive number",
      })
      .max(config.MAX_MAX_DISTANCE_METERS, {
        message: `Max distance cannot exceed ${config.MAX_MAX_DISTANCE_METERS} meters`,
      })
      .default(config.DEFAULT_MAX_DISTANCE_METERS)),
    excludeUserId: userIdSchema.optional(),
    pagination: z.enum(["offset", "cursor"]).optional(),
    cursor: z
      .string({ error: "Invalid cursor" })
      .trim()
      .min(1, "Cursor cannot be empty")
      .max(MAX_CURSOR_LENGTH, "Cursor is too long")
      .optional(),
    page: numericInput(z
      .number({ error: "Invalid page" })
      .int({ message: "Page must be an integer" })
      .positive({ message: "Page must be a positive number" })
      .max(Number.MAX_SAFE_INTEGER, "Page exceeds the safe integer range")
      .optional()),
    pageSize: numericInput(z
      .number({
        error: "Invalid page size",
      })
      .int({
        message: "Page size must be an integer",
      })
      .positive({
        message: "Page size must be a positive number",
      })
      .max(100, { message: "Page size cannot exceed 100" })
      .default(10)),
  })
  .superRefine((value, ctx) => {
    const mode = value.cursor ? "cursor" : (value.pagination ?? "offset");

    if (mode === "offset" && !Number.isSafeInteger(((value.page ?? 1) - 1) * value.pageSize)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["page"],
        message: "Pagination offset exceeds the safe integer range",
      });
    }

    if (mode === "cursor" && value.page !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["page"],
        message: "page cannot be used with cursor pagination",
      });
    }

    if (value.cursor && value.pagination === "offset") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pagination"],
        message: "pagination=offset cannot be used together with cursor",
      });
    }
  });
