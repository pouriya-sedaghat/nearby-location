import z from "zod";
import { coordinateSchema } from "./coordinate.schema";

export const upsertReqSchema = z.object({
  userId: z.string({
    invalid_type_error: "Invalid user id",
    required_error: "Required user id",
  }),
  coordinate: coordinateSchema,
});

export const findNearbyReqSchema = z.object({
  coordinate: coordinateSchema,
  maxDistance: z.coerce
    .number({
      invalid_type_error: "Invalid max distance",
    })
    .positive({
      message: "Max distance must be a positive number",
    })
    .optional()
    .refine((v) => v === undefined || !Number.isNaN(v), {
      message: "Invalid max distance",
    }),
  page: z.coerce
    .number({ invalid_type_error: "Invalid page" })
    .int({ message: "Page must be an integer" })
    .positive({ message: "Page must be a positive number" })
    .default(1),
  pageSize: z.coerce
    .number({
      invalid_type_error: "Invalid limit",
    })
    .int({
      message: "Limit must be an integer",
    })
    .positive({
      message: "Limit must be a positive number",
    })
    .min(5, { message: "Limit must be at least 5" })
    .max(100, { message: "Limit cannot exceed 100" })
    .default(10),
});
