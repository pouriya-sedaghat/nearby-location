import z from "zod";
import type { ResponseLanguage } from "../i18n/language";
import { message } from "../i18n/messages";

export const createCoordinateSchema = (language: ResponseLanguage = "en") => z.object({
  lat: z.number({ error: issue => message(language, issue.input === undefined ? "requiredLatitude" : "invalidLatitude") })
    .min(-90, message(language, "minimumLatitude"))
    .max(90, message(language, "maximumLatitude")),
  lng: z.number({ error: issue => message(language, issue.input === undefined ? "requiredLongitude" : "invalidLongitude") })
    .min(-180, message(language, "minimumLongitude"))
    .max(180, message(language, "maximumLongitude")),
});

export const coordinateSchema = createCoordinateSchema();
