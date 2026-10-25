import z from "zod";

const latitudeSchema = z
  .number({
    error: issue => issue.input === undefined ? "Required latitude" : "Invalid latitude",
  })
  .min(-90, "The minimum latitude is -90")
  .max(90, "The maximum latitude is 90.");

const longitudeSchema = z
  .number({
    error: issue => issue.input === undefined ? "Required longitude" : "Invalid longitude",
  })
  .min(-180, "The minimum longitude is -180")
  .max(180, "The maximum longitude is 180");

export const coordinateSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
});
