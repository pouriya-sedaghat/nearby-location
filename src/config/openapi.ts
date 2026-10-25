import type { AppConfig } from "./env";
import { message } from "../i18n/messages";

type OpenApiSettings = Pick<AppConfig,
  "BASE_URL" | "DEFAULT_MAX_DISTANCE_METERS" | "MAX_MAX_DISTANCE_METERS">;

const center = { lat: 35.6892, lng: 51.389 };
const ref = (section: string, name: string) => ({ $ref: "#/components/" + section + "/" + name });
const schema = (name: string) => ref("schemas", name);
const response = (name: string) => ref("responses", name);
const example = (name: string) => ref("examples", name);
const json = (name: string, examples: Record<string, unknown>) => ({
  "application/json": { schema: schema(name), examples },
});

export function createOpenApiDefinition(version: string, config: OpenApiSettings) {
  const userId = {
    type: "string", minLength: 1, maxLength: 255, pattern: "^[^\\u0000]*$",
    description: "Trimmed identifier containing well-formed Unicode and no NUL. Length is measured after trimming, in UTF-16 code units. Identifier ownership is enforced by the deployment, not this service.",
  };
  const radius = {
    type: "number", minimum: 0, exclusiveMinimum: true,
    maximum: config.MAX_MAX_DISTANCE_METERS, default: config.DEFAULT_MAX_DISTANCE_METERS,
    example: config.DEFAULT_MAX_DISTANCE_METERS,
    description: "Inclusive search radius in meters. Positive numeric strings are also accepted at runtime. Defaults and limits reflect this process configuration.",
  };
  const page = {
    type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 1, example: 1,
    description: "One-based page. Both page and (page - 1) * pageSize must be safe integers. Separate pages do not share a database snapshot.",
  };
  const pageSize = {
    type: "integer", minimum: 1, maximum: 100, default: 10, example: 10,
    description: "Number of results per page, from 1 through 100.",
  };
  const success = { type: "boolean", enum: [true] };
  const failure = { type: "boolean", enum: [false] };
  const nearbyData = {
    success: true, page: 1, pageSize: 10, totalCount: 1, totalPages: 1, hasMore: false,
    data: [{
      userId: "demo-user", coordinate: center, distance: 0,
      updatedAt: "2026-10-25T12:00:00.000Z", updateStatus: "0 seconds ago",
    }],
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "Nearby Location API", version,
      description: [
        "Store the latest user location and search nearby users with PostgreSQL and PostGIS.",
        "## Execute requests",
        "Expand an operation, select a request example or edit the JSON, then click Execute. Requests are sent to the selected server. Location upserts modify that database. Start with liveness/readiness, write a test location, then search the same center.",
        "## Authentication",
        "Documentation login is dedicated HTTP Basic Auth when configured; it protects /api-docs and its assets/specification. The standalone location API does not enforce that login or a bearer token. Existing upstream access controls still apply to API requests.",
        "## Coordinates, radius and ordering",
        "Coordinates are WGS84 decimal degrees: lat is latitude, lng is longitude. Radius and distance use meters. Fresh candidates inside the inclusive radius are ordered by the existing distance/recency score, then userId; ordering is not distance-only.",
        "## Input precedence and pagination",
        "Body fields override entire query fields of the same name. Use the Search center only example to control radius and pagination through query inputs. Numeric strings are accepted for numeric options; booleans, arrays, objects, null and blank strings are rejected. The JSON parser limit is 32 KiB.",
        "## Responses",
        "Examples are illustrative. Schema validation errors include a formatted errors tree; malformed/compressed JSON may return 400, oversized JSON 413 and unsupported encodings 415. Unknown routes or methods return 404 outside these operations. Readiness checks database connectivity, not schema or spatial-query correctness.",
        "## Response language and display age",
        "Set Accept-Language to en or fa (regional tags and quality weights are accepted). English is the default and fallback. Human-readable messages, validation errors and updateStatus follow the selected language; JSON keys, health status codes, numbers and ISO timestamps remain unchanged. Content-Language reports the selection and Vary includes Accept-Language. Documentation stays in English.",
        "updateStatus is recalculated from the stored updatedAt at the start of every server request, with one reference instant for all results. It is not stored or based on a client clock. Language changes formatting only; both languages use the same elapsed-time and UTC Gregorian calendar policy.",
      ].join("\n\n"),
      license: { name: "ISC" },
    },
    servers: [{ url: config.BASE_URL, description: "Current origin or configured API base URL" }],
    tags: [
      { name: "Health", description: "Process liveness and database connectivity. Run these checks before testing location requests." },
      { name: "Location", description: "Write a current user location and search fresh nearby users. Upsert is a real database write." },
    ],
    security: [],
    components: {
      parameters: {
        ResponseLanguage: {
          name: "Accept-Language", in: "header", required: false,
          description: "Response language: en (default) or fa. Regional tags such as fa-IR and quality weights are supported. Unsupported or missing preferences fall back to English. Only human-readable text is localized.",
          schema: { type: "string", default: "en" }, example: "fa",
        },
      },
      headers: {
        ContentLanguage: { description: "Selected response language.", schema: { type: "string", enum: ["en", "fa"] } },
        VaryLanguage: { description: "Includes Accept-Language so caches distinguish language variants.", schema: { type: "string" }, example: "Accept-Language" },
      },
      schemas: {
        Coordinate: {
          type: "object", required: ["lat", "lng"],
          description: "WGS84 decimal degrees. Runtime accepts JSON numbers, not numeric strings. Storage uses longitude/latitude order internally.",
          properties: {
            lat: { type: "number", minimum: -90, maximum: 90, example: center.lat, description: "Latitude in decimal degrees, inclusive bounds." },
            lng: { type: "number", minimum: -180, maximum: 180, example: center.lng, description: "Longitude in decimal degrees, inclusive bounds." },
          },
          example: center,
        },
        UpsertRequest: {
          type: "object", required: ["userId", "coordinate"],
          description: "Create or replace the current location for one identifier. The database assigns update time; created time is preserved on updates. Extra request fields are ignored by runtime validation.",
          properties: { userId, coordinate: schema("Coordinate") },
        },
        NearbyRequest: {
          type: "object", required: ["coordinate"],
          description: "Search center plus optional filters. Body fields override query fields. Only coordinate is required; omit other fields to use the query controls or server defaults. A safe computed offset is required.",
          properties: {
            coordinate: schema("Coordinate"), maxDistance: radius, page, pageSize,
            excludeUserId: { ...userId, description: "Optional identifier to omit. The requester is not excluded automatically. " + userId.description },
          },
        },
        NearbyUser: {
          type: "object", required: ["userId", "coordinate", "distance", "updatedAt", "updateStatus"],
          properties: {
            userId: { type: "string", description: "Matched user's stored identifier.", example: "demo-user" },
            coordinate: schema("Coordinate"),
            distance: { type: "number", minimum: 0, example: 0, description: "Spheroidal distance in meters from the requested center." },
            updatedAt: { type: "string", format: "date-time", example: "2026-10-25T12:00:00.000Z", description: "Database update timestamp. Use this field for calculations." },
            updateStatus: { type: "string", example: "0 seconds ago", description: "English or Persian display age, recalculated at each server request's start from updatedAt. One server reference instant is shared by all results. Seconds through weeks use elapsed time (24-hour days); months and years use completed UTC Gregorian calendar anniversaries with month-end clamping in both languages. Future timestamps show zero age; updatedAt remains exact. This display string is not stored." },
          },
          description: "coordinate is the matched user's stored location, not a copy of the request center.",
        },
        NearbyResponse: {
          type: "object", required: ["success", "page", "pageSize", "totalCount", "totalPages", "hasMore", "data"],
          properties: {
            success, page: { type: "integer", minimum: 1, example: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, example: 10 },
            totalCount: { type: "integer", minimum: 0, example: 1, description: "All candidates matching radius, freshness and exclusion." },
            totalPages: { type: "integer", minimum: 0, example: 1, description: "ceil(totalCount / pageSize); zero when no candidates match." },
            hasMore: { type: "boolean", example: false, description: "True when page is less than totalPages." },
            data: { type: "array", items: schema("NearbyUser"), description: "Results for the requested page; may be empty beyond the last page." },
          },
        },
        UpsertResponse: {
          type: "object", required: ["success", "message"],
          properties: {
            success,
            message: { type: "string", enum: [message("en", "upserted"), message("fa", "upserted")] },
          },
        },
        ValidationErrors: {
          type: "object", required: ["_errors"],
          properties: { _errors: { type: "array", items: { type: "string" } } },
          additionalProperties: true,
          description: "Formatted validation tree. Each invalid field contains its own localized _errors array; nested fields contain nested objects. Field names are unchanged in both languages.",
        },
        ErrorResponse: {
          type: "object", required: ["success", "message"],
          properties: {
            success: failure,
            message: { type: "string", description: "Human-readable failure description." },
            errors: schema("ValidationErrors"),
          },
          description: "errors is present for schema validation failures and omitted for parser or internal errors.",
        },
        LivenessResponse: {
          type: "object", required: ["success", "status"],
          properties: { success, status: { type: "string", enum: ["ok"] } },
        },
        ReadinessResponse: {
          type: "object", required: ["success", "status"],
          properties: { success, status: { type: "string", enum: ["ready"] } },
        },
        NotReadyResponse: {
          type: "object", required: ["success", "status"],
          properties: { success: failure, status: { type: "string", enum: ["not_ready"] } },
        },
      },
      examples: {
        UpsertTehran: { summary: "Create a test location in Tehran", value: { userId: "demo-user", coordinate: center } },
        UpsertUpdate: { summary: "Update the same test user", value: { userId: "demo-user", coordinate: { lat: 35.7, lng: 51.4 } } },
        UpsertOrigin: { summary: "Valid zero coordinates", value: { userId: "origin-user", coordinate: { lat: 0, lng: 0 } } },
        SearchCenterOnly: { summary: "Search center only (use query controls)", value: { coordinate: center } },
        SearchWithOptions: {
          summary: "Explicit radius and pagination in the body",
          value: { coordinate: center, maxDistance: config.DEFAULT_MAX_DISTANCE_METERS, page: 1, pageSize: 10 },
        },
        SearchExcludingRequester: {
          summary: "Exclude the test user",
          value: { coordinate: center, maxDistance: Math.min(5000, config.DEFAULT_MAX_DISTANCE_METERS), excludeUserId: "demo-user", page: 1, pageSize: 10 },
        },
        SearchNextPage: { summary: "Second page", value: { coordinate: center, page: 2, pageSize: 5 } },
        Upserted: { summary: "Location stored", value: { success: true, message: "Location upserted successfully" } },
        UpsertedPersian: { summary: "Location stored (Accept-Language: fa)", value: { success: true, message: message("fa", "upserted") } },
        NearbyMatches: { summary: "One matching location", value: nearbyData },
        NearbyMatchesPersian: {
          summary: "One matching location (Accept-Language: fa)",
          value: { ...nearbyData, data: nearbyData.data.map(row => ({ ...row, updateStatus: "۰ ثانیه پیش" })) },
        },
        NearbyEmpty: {
          summary: "No candidates match",
          value: { success: true, page: 1, pageSize: 10, totalCount: 0, totalPages: 0, hasMore: false, data: [] },
        },
        NearbyBeyondLastPage: {
          summary: "Page beyond the last page",
          value: { success: true, page: 3, pageSize: 10, totalCount: 1, totalPages: 1, hasMore: false, data: [] },
        },
        InvalidUpsert: {
          summary: "Empty user identifier",
          value: { success: false, message: "Invalid request body", errors: { _errors: [], userId: { _errors: ["User id cannot be empty"] } } },
        },
        InvalidUpsertPersian: {
          summary: "Empty user identifier (Accept-Language: fa)",
          value: { success: false, message: message("fa", "invalidBody"), errors: { _errors: [], userId: { _errors: [message("fa", "emptyUserId")] } } },
        },
        InvalidNearby: {
          summary: "Non-positive radius",
          value: { success: false, message: "Invalid request data", errors: { _errors: [], maxDistance: { _errors: ["Max distance must be a positive number"] } } },
        },
        InvalidJson: { summary: "Malformed or corrupt compressed JSON", value: { success: false, message: "Invalid JSON body" } },
        InvalidJsonPersian: { summary: "Malformed JSON (Accept-Language: fa)", value: { success: false, message: message("fa", "invalidJson") } },
        BodyTooLarge: { summary: "JSON parser limit exceeded", value: { success: false, message: "Request body too large" } },
        UnsupportedEncoding: { summary: "Unsupported charset or content encoding", value: { success: false, message: "Unsupported request body encoding" } },
        InternalError: { summary: "Location operation failed", value: { success: false, message: "Internal server error" } },
        Live: { summary: "Process is running", value: { success: true, status: "ok" } },
        Ready: { summary: "Database query succeeded", value: { success: true, status: "ready" } },
        NotReady: { summary: "Database query failed", value: { success: false, status: "not_ready" } },
      },
      requestBodies: {
        UpsertLocation: {
          required: true,
          description: "JSON body, up to 32 KiB after decompression. Execute writes to the selected database.",
          content: json("UpsertRequest", {
            create: example("UpsertTehran"), update: example("UpsertUpdate"), zeroCoordinates: example("UpsertOrigin"),
          }),
        },
        NearbySearch: {
          required: true,
          description: "Choose Search center only when editing query filters. Explicit body options take precedence over the query controls.",
          content: json("NearbyRequest", {
            centerOnly: example("SearchCenterOnly"), explicitOptions: example("SearchWithOptions"),
            excludeRequester: example("SearchExcludingRequester"), nextPage: example("SearchNextPage"),
          }),
        },
      },
      responses: {
        LocationUpserted: { description: "The current location was created or updated.", content: json("UpsertResponse", { stored: example("Upserted"), storedPersian: example("UpsertedPersian") }) },
        NearbyResults: {
          description: "Matching fresh locations and pagination metadata. Out-of-range pages succeed with an empty data array and the matching count.",
          content: json("NearbyResponse", { matches: example("NearbyMatches"), matchesPersian: example("NearbyMatchesPersian"), empty: example("NearbyEmpty"), beyondLastPage: example("NearbyBeyondLastPage") }),
        },
        InvalidUpsert: { description: "Invalid request fields or malformed JSON.", content: json("ErrorResponse", { validation: example("InvalidUpsert"), validationPersian: example("InvalidUpsertPersian"), malformedJson: example("InvalidJson"), malformedJsonPersian: example("InvalidJsonPersian") }) },
        InvalidNearby: { description: "Invalid search fields, unsafe pagination offset, or malformed JSON.", content: json("ErrorResponse", { validation: example("InvalidNearby"), malformedJson: example("InvalidJson"), malformedJsonPersian: example("InvalidJsonPersian") }) },
        RequestTooLarge: { description: "JSON body exceeds the 32 KiB parser limit.", content: json("ErrorResponse", { tooLarge: example("BodyTooLarge") }) },
        UnsupportedEncoding: { description: "Unsupported JSON charset or content encoding.", content: json("ErrorResponse", { unsupported: example("UnsupportedEncoding") }) },
        InternalError: { description: "The operation failed internally; inspect server logs.", content: json("ErrorResponse", { failure: example("InternalError") }) },
        Live: { description: "The HTTP process is alive. No database query is executed.", content: json("LivenessResponse", { live: example("Live") }) },
        Ready: { description: "SELECT 1 succeeded through the database pool.", content: json("ReadinessResponse", { ready: example("Ready") }) },
        NotReady: { description: "The database connectivity query failed.", content: json("NotReadyResponse", { unavailable: example("NotReady") }) },
      },
    },
  };
}

/** The same explicit definition serves runtime UI and canonical export. */
export function createOpenApiSpec(config: OpenApiSettings) {
  const { version }: { version: string } = require("../../package.json");
  const definition = createOpenApiDefinition(version, config);
  for (const item of Object.values(definition.components.responses)) {
    Object.assign(item, { headers: {
      "Content-Language": ref("headers", "ContentLanguage"), Vary: ref("headers", "VaryLanguage"),
    } });
  }
  const languageParameter = ref("parameters", "ResponseLanguage");
  const properties = definition.components.schemas.NearbyRequest.properties;
  const parameters = (["page", "pageSize", "maxDistance", "excludeUserId"] as const)
    .map((name) => ({ in: "query", name, description: properties[name].description,
      schema: { ...properties[name] } }));
  return {
    ...definition,
    paths: {
      "/location/upsert": { post: { tags: ["Location"], parameters: [languageParameter],
        operationId: "upsertLocation", summary: "Create or update a user's location",
        description: "Stores one current location per userId. Reusing an identifier updates coordinate and updatedAt, preserving createdAt. Identifiers are trimmed and must contain well-formed Unicode without NUL. Coordinate values must be JSON numbers. Execute performs a real write.",
        requestBody: ref("requestBodies", "UpsertLocation"),
        responses: { "200": response("LocationUpserted"), "400": response("InvalidUpsert"), "413": response("RequestTooLarge"), "415": response("UnsupportedEncoding"), "500": response("InternalError") },
      } },
      "/location/nearby": { post: { tags: ["Location"], parameters: [languageParameter, ...parameters],
        operationId: "findNearbyUsers", summary: "Search fresh nearby locations",
        description: "Start with Search center only to use query inputs. Body fields override matching query fields. Radius is inclusive and measured in meters; stale rows are excluded before ranking. Results use the existing distance/recency score, then userId, and include each matched user's stored coordinates. The requester is excluded only when excludeUserId is supplied.",
        requestBody: ref("requestBodies", "NearbySearch"),
        responses: { "200": response("NearbyResults"), "400": response("InvalidNearby"), "413": response("RequestTooLarge"), "415": response("UnsupportedEncoding"), "500": response("InternalError") },
      } },
      "/health/live": { get: { tags: ["Health"], parameters: [languageParameter],
        operationId: "getLiveness", summary: "Check process liveness",
        description: "Returns immediately without using PostgreSQL. A successful response proves only that the HTTP process can answer.",
        responses: { "200": response("Live") },
      } },
      "/health/ready": { get: { tags: ["Health"], parameters: [languageParameter],
        operationId: "getReadiness", summary: "Check database connectivity",
        description: "Runs SELECT 1 through the pool. It does not verify migrations, the locations table, or spatial queries. After deployment, also test upsert and nearby operations.",
        responses: { "200": response("Ready"), "503": response("NotReady") },
      } },
    },
  };
}
