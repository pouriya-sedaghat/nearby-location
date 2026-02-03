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
});
