import type { AppConfig } from "./env";
import { openApiDefinition } from "./openapi.definition";
import { MAX_CURSOR_LENGTH } from "../utils/cursor";

type Settings = Pick<AppConfig, "BASE_URL" | "DEFAULT_MAX_DISTANCE_METERS" | "MAX_MAX_DISTANCE_METERS" |
  "LOCATION_AUTH_MODE" | "METRICS_AUTH_MODE" | "PRIVACY_API_ENABLED">;
export const canonicalSettings: Settings = {
  BASE_URL: "/", DEFAULT_MAX_DISTANCE_METERS: 10000, MAX_MAX_DISTANCE_METERS: 100000,
  LOCATION_AUTH_MODE: "bearer", METRICS_AUTH_MODE: "bearer", PRIVACY_API_ENABLED: true,
};

/** Build a fresh contract without reading environment files or scanning sources. */
export const buildOpenApiSpec = (settings: Settings = canonicalSettings, { runtime = false } = {}) => {
  const spec = structuredClone(openApiDefinition);
  spec.info.version = require("../../package.json").version;
  spec.info.description += " Human-readable API messages and display ages support English (default) and Persian through Accept-Language. Keys, identifiers, numbers, status codes and ISO timestamps remain unchanged. Documentation and Prometheus exposition remain English.";
  spec.servers[0].url = settings.BASE_URL;
  const radius = spec.components.schemas.NearbyRequest.properties.maxDistance;
  Object.assign(radius, { default: settings.DEFAULT_MAX_DISTANCE_METERS, maximum: settings.MAX_MAX_DISTANCE_METERS });
  Object.assign(spec.paths["/location/nearby"].post.parameters.find((p: { name: string }) => p.name === "maxDistance").schema, radius);
  spec.components.schemas.NearbyRequest.properties.cursor.maxLength = MAX_CURSOR_LENGTH;
  spec.paths["/location/nearby"].post.parameters.find((p: { name: string }) => p.name === "cursor").schema.maxLength = MAX_CURSOR_LENGTH;
  spec.components.schemas.NearbyUser.properties.updateStatus.description = "English or Persian display age recalculated from updatedAt using one server instant captured at request start. Short units are elapsed units; months/years use completed UTC Gregorian calendar anniversaries with month-end clamping in both languages. Future timestamps show zero age. Age is not stored; updatedAt remains exact.";
  spec.components.parameters = { ...(spec.components.parameters ?? {}), ResponseLanguage: {
    in: "header", name: "Accept-Language", required: false,
    description: "en (default) or fa. Regional tags and quality weights are supported; unsupported preferences fall back to English. Machine fields are unchanged.",
    schema: { type: "string", default: "en" }, example: "fa",
  } };
  const operations: Record<string, string> = {
    "/location/upsert": "upsertLocation", "/location/nearby": "findNearbyUsers",
    "/health/live": "getLiveness", "/health/ready": "getReadiness", "/metrics": "getMetrics",
    "/privacy/location/delete": "deleteUserLocation", "/privacy/location/delete-exact": "deleteExactUserLocation",
  };
  const center = { lat: 35.6892, lng: 51.389 };
  spec.paths["/location/upsert"].post.requestBody.content["application/json"].examples = {
    create: { summary: "Create a test location", value: { userId: "demo-user", coordinate: center } },
    update: { summary: "Update the test user", value: { userId: "demo-user", coordinate: { lat: 35.7, lng: 51.4 } } },
    zeroCoordinates: { summary: "Valid zero coordinates", value: { userId: "origin-user", coordinate: { lat: 0, lng: 0 } } },
  };
  spec.paths["/location/nearby"].post.requestBody.content["application/json"].examples = {
    centerOnly: { summary: "Search center only", value: { coordinate: center } },
    cursorFirst: { summary: "First cursor page", value: { coordinate: center, pagination: "cursor", pageSize: 10 } },
    excludeRequester: { summary: "Exclude the test user", value: { coordinate: center, excludeUserId: "demo-user" } },
  };
  for (const [route, item] of Object.entries(spec.paths)) {
    for (const operation of Object.values(item as Record<string, any>)) {
      operation.operationId = operations[route];
      if (route !== "/metrics") operation.parameters = [
        ...(operation.parameters ?? []), { $ref: "#/components/parameters/ResponseLanguage" },
      ];
      for (const response of Object.values(operation.responses) as Array<Record<string, any>>) {
        response.headers = { ...(response.headers ?? {}),
          "Content-Language": { description: "Language used for human-readable response text.", schema: { type: "string", enum: ["en", "fa"] } },
          Vary: { description: "Includes Accept-Language.", schema: { type: "string" }, example: "Accept-Language" },
        };
      }
    }
  }
  if (runtime) {
    if (settings.LOCATION_AUTH_MODE === "disabled") {
      spec.paths["/location/upsert"].post.security = [];
      spec.paths["/location/nearby"].post.security = [];
    }
    if (settings.METRICS_AUTH_MODE === "disabled") spec.paths["/metrics"].get.security = [];
    if (!settings.PRIVACY_API_ENABLED) {
      delete spec.paths["/privacy/location/delete"];
      delete spec.paths["/privacy/location/delete-exact"];
    }
  }
  return spec;
};
