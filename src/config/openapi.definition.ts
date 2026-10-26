// Canonical contract. Runtime settings are applied by openapi.ts.
export const openApiDefinition: Record<string, any> = {
  "openapi": "3.0.0",
  "info": {
    "title": "Nearby Location API",
    "version": "2.14.1",
    "description": "Microservice to store user location and find nearby users with PostgreSQL + PostGIS"
  },
  "servers": [
    {
      "url": "/",
      "description": "Current API origin or configured base URL"
    }
  ],
  "components": {
    "schemas": {
      "Coordinate": {
        "type": "object",
        "required": [
          "lat",
          "lng"
        ],
        "properties": {
          "lat": {
            "type": "number",
            "minimum": -90,
            "maximum": 90,
            "example": 35.6892
          },
          "lng": {
            "type": "number",
            "minimum": -180,
            "maximum": 180,
            "example": 51.389
          }
        },
        "description": "WGS84 decimal degrees. lat is latitude (Y); lng is longitude (X)."
      },
      "NearbyUser": {
        "type": "object",
        "required": [
          "userId",
          "coordinate",
          "distance",
          "updatedAt",
          "updateStatus"
        ],
        "properties": {
          "userId": {
            "type": "string"
          },
          "coordinate": {
            "$ref": "#/components/schemas/Coordinate"
          },
          "distance": {
            "type": "number",
            "minimum": 0,
            "description": "Distance from the request coordinate in meters."
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          },
          "updateStatus": {
            "type": "string",
            "example": "5 minutes ago",
            "description": "English relative time: just now below one second, completed seconds through years, and future dates as in N units. Months/years approximate 30/365 days. All items share one application-clock reference per response. Use updatedAt for calculations."
          }
        },
        "description": "The coordinate belongs to the result user and is read from their stored current location. Internal ranking scores are omitted."
      },
      "UpsertRequest": {
        "type": "object",
        "required": [
          "userId",
          "coordinate"
        ],
        "properties": {
          "userId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 255,
            "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f]*$",
            "example": "user_123",
            "description": "Trimmed, well-formed Unicode identifier (no lone UTF-16 surrogates). Control characters are rejected. Runtime length is 1-255 UTF-16 code units after trimming; astral characters use two units."
          },
          "coordinate": {
            "$ref": "#/components/schemas/Coordinate"
          }
        }
      },
      "NearbyRequest": {
        "type": "object",
        "required": [
          "coordinate"
        ],
        "properties": {
          "coordinate": {
            "$ref": "#/components/schemas/Coordinate"
          },
          "maxDistance": {
            "type": "number",
            "minimum": 0,
            "exclusiveMinimum": true,
            "maximum": 100000,
            "default": 10000
          },
          "excludeUserId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 255,
            "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f]*$",
            "description": "Trimmed, well-formed Unicode identifier (no lone UTF-16 surrogates). Control characters are rejected. Runtime length is 1-255 UTF-16 code units after trimming; astral characters use two units."
          },
          "pagination": {
            "type": "string",
            "enum": [
              "offset",
              "cursor"
            ],
            "default": "offset"
          },
          "page": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991,
            "default": 1,
            "description": "Offset mode only. (page - 1) * pageSize must be a safe integer."
          },
          "pageSize": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "default": 10
          },
          "cursor": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2400,
            "description": "Opaque nextCursor from a previous response; cannot be combined with page or pagination=offset."
          }
        },
        "description": "Body fields override query fields with the same name. Keep coordinate, maxDistance and excludeUserId identical across cursor pages."
      },
      "NearbyOffsetResponse": {
        "type": "object",
        "required": [
          "success",
          "paginationMode",
          "rankingMode",
          "page",
          "pageSize",
          "totalCount",
          "totalPages",
          "hasMore",
          "nextCursor",
          "data"
        ],
        "properties": {
          "success": {
            "type": "boolean",
            "enum": [
              true
            ]
          },
          "paginationMode": {
            "type": "string",
            "enum": [
              "offset"
            ]
          },
          "rankingMode": {
            "type": "string",
            "enum": [
              "legacy",
              "decay"
            ]
          },
          "page": {
            "type": "integer",
            "minimum": 1
          },
          "pageSize": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "totalCount": {
            "type": "integer",
            "minimum": 0
          },
          "totalPages": {
            "type": "integer",
            "minimum": 0
          },
          "hasMore": {
            "type": "boolean"
          },
          "nextCursor": {
            "type": "string",
            "nullable": true
          },
          "data": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/NearbyUser"
            }
          }
        }
      },
      "NearbyCursorResponse": {
        "type": "object",
        "required": [
          "success",
          "paginationMode",
          "rankingMode",
          "pageSize",
          "totalCount",
          "hasMore",
          "nextCursor",
          "data"
        ],
        "properties": {
          "success": {
            "type": "boolean",
            "enum": [
              true
            ]
          },
          "paginationMode": {
            "type": "string",
            "enum": [
              "cursor"
            ]
          },
          "rankingMode": {
            "type": "string",
            "enum": [
              "legacy",
              "decay"
            ]
          },
          "pageSize": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "totalCount": {
            "type": "integer",
            "minimum": 0
          },
          "hasMore": {
            "type": "boolean"
          },
          "nextCursor": {
            "type": "string",
            "nullable": true
          },
          "data": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/NearbyUser"
            }
          }
        }
      },
      "ErrorResponse": {
        "type": "object",
        "required": [
          "success",
          "message"
        ],
        "properties": {
          "success": {
            "type": "boolean",
            "enum": [
              false
            ]
          },
          "message": {
            "type": "string"
          },
          "errors": {
            "type": "object",
            "additionalProperties": true,
            "description": "Zod formatted field errors, present for request validation failures."
          }
        }
      }
    },
    "securitySchemes": {
      "locationBearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "opaque service token",
        "description": "LOCATION_AUTH_TOKEN for /location only. Enter the token without the Bearer prefix."
      },
      "metricsBearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "opaque service token",
        "description": "METRICS_AUTH_TOKEN for /metrics only. Enter the token without the Bearer prefix."
      },
      "privacyBearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "opaque service token",
        "description": "PRIVACY_AUTH_TOKEN for privacy erasure only. Enter the token without the Bearer prefix."
      }
    }
  },
  "paths": {
    "/privacy/location/delete": {
      "post": {
        "tags": [
          "Privacy"
        ],
        "summary": "Permanently delete a user's current live location",
        "description": "Idempotent privacy erasure command with normalized upsert identifier rules. The privacy API is disabled by default and, when enabled, requires its own bearer token. To delete a stored identifier byte-for-byte, use /privacy/location/delete-exact instead; this route rejects a match field because the pre-fix 2.13.5 build at 014d80e silently ignores it. Other unknown fields are stripped. Ill-formed Unicode is rejected. Stop upstream publishing before invoking this command; a later upsert can create a new live location again.",
        "security": [
          {
            "privacyBearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userId"
                ],
                "properties": {
                  "userId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 255,
                    "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f]*$",
                    "description": "Same rules as upsert: trimmed, well-formed Unicode, control characters rejected (never trimmed away). Length is 1-255 UTF-16 code units after trimming. Deletes the identity an upsert of the same input writes.",
                    "example": "user_123"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Erasure command completed. The response does not reveal whether a row existed."
          },
          "400": {
            "description": "Invalid request body, including any match field"
          },
          "401": {
            "description": "Missing or invalid privacy bearer token"
          },
          "413": {
            "description": "JSON request body exceeds 32 KB"
          },
          "415": {
            "description": "Unsupported request encoding or charset"
          },
          "503": {
            "description": "Database temporarily unavailable"
          }
        }
      }
    },
    "/privacy/location/delete-exact": {
      "post": {
        "tags": [
          "Privacy"
        ],
        "summary": "Permanently delete the live location of an exact stored identifier",
        "description": "Idempotent privacy erasure of the stored identifier byte-for-byte, with no trimming or other normalization: use it for a userId returned by a nearby response or stored under older rules (for example control characters before 2.13.1). Deletes at most one row and never falls back to the normalized route. Builds without this route, including the pre-fix 2.13.5 build at 014d80e, answer 404 without deleting anything; treat 404 as \"not performed\" and retry, never as success. Version 2.14.0 includes this route; identify deployed binaries by version and commit/image digest. Requires the privacy bearer token.",
        "security": [
          {
            "privacyBearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userId"
                ],
                "additionalProperties": false,
                "properties": {
                  "userId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 255,
                    "pattern": "^[^\\u0000]*$",
                    "description": "Stored identifier byte-for-byte. Must be nonblank, well-formed Unicode and free of NUL; other control characters and surrounding whitespace are kept. Length is 1-255 UTF-16 code units without trimming.",
                    "example": " legacy_user"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Erasure command completed. The response does not reveal whether a row existed."
          },
          "400": {
            "description": "Invalid request body, including unknown fields"
          },
          "401": {
            "description": "Missing or invalid privacy bearer token"
          },
          "404": {
            "description": "Route not available (privacy API disabled, or a release without exact erasure). Nothing was deleted."
          },
          "413": {
            "description": "JSON request body exceeds 32 KB"
          },
          "415": {
            "description": "Unsupported request encoding or charset"
          },
          "503": {
            "description": "Database temporarily unavailable"
          }
        }
      }
    },
    "/metrics": {
      "get": {
        "tags": [
          "Monitoring"
        ],
        "summary": "Prometheus metrics",
        "description": "Aggregate metrics without user IDs or coordinates. Requires the metrics surface token when METRICS_AUTH_MODE=bearer.",
        "security": [
          {
            "metricsBearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Prometheus text exposition",
            "content": {
              "text/plain": {
                "schema": {
                  "type": "string"
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid metrics token"
          },
          "503": {
            "description": "Metrics authentication is misconfigured"
          }
        }
      }
    },
    "/location/upsert": {
      "post": {
        "tags": [
          "Location"
        ],
        "summary": "Upsert user location",
        "description": "Create or update the latest location for a user. When LOCATION_AUTH_MODE=bearer, send Authorization: Bearer <token>.",
        "security": [
          {
            "locationBearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/UpsertRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Location upserted successfully",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": [
                    "success",
                    "message"
                  ],
                  "properties": {
                    "success": {
                      "type": "boolean",
                      "enum": [
                        true
                      ]
                    },
                    "message": {
                      "type": "string",
                      "example": "Location upserted successfully"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid request body"
          },
          "401": {
            "description": "Missing or invalid service bearer token when location authentication is enabled"
          },
          "413": {
            "description": "JSON request body exceeds 32 KB"
          },
          "415": {
            "description": "Unsupported request encoding or charset"
          },
          "429": {
            "description": "Too many requests (when the optional per-replica limiter is enabled)",
            "headers": {
              "X-Nearby-Rejection-Reason": {
                "schema": {
                  "type": "string"
                },
                "description": "Machine-readable controlled rejection reason (rate_limit)"
              }
            }
          },
          "500": {
            "description": "Internal server error"
          },
          "503": {
            "description": "Service temporarily overloaded or database unavailable",
            "headers": {
              "X-Nearby-Rejection-Reason": {
                "schema": {
                  "type": "string"
                },
                "description": "Machine-readable controlled rejection reason when the failure is intentionally shed/retryable"
              }
            }
          }
        }
      }
    },
    "/location/nearby": {
      "post": {
        "tags": [
          "Location"
        ],
        "summary": "Find nearby users",
        "description": "Find fresh nearby user locations within a bounded radius. Each data item includes the stored coordinate of that result user. Supports offset and cursor pagination. When LOCATION_AUTH_MODE=bearer, send Authorization: Bearer <token>.",
        "security": [
          {
            "locationBearerAuth": []
          }
        ],
        "parameters": [
          {
            "in": "query",
            "name": "pagination",
            "schema": {
              "type": "string",
              "enum": [
                "offset",
                "cursor"
              ],
              "default": "offset"
            },
            "required": false,
            "description": "Use cursor for deep/streaming pagination. Supplying cursor also selects cursor mode."
          },
          {
            "in": "query",
            "name": "page",
            "schema": {
              "type": "integer",
              "default": 1,
              "minimum": 1,
              "maximum": 9007199254740991
            },
            "required": false,
            "description": "Offset page number. Cannot be combined with cursor mode."
          },
          {
            "in": "query",
            "name": "pageSize",
            "schema": {
              "type": "integer",
              "default": 10,
              "minimum": 1,
              "maximum": 100
            },
            "required": false,
            "description": "Number of items per page"
          },
          {
            "in": "query",
            "name": "cursor",
            "schema": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2400
            },
            "required": false,
            "description": "Opaque nextCursor returned by a previous response"
          },
          {
            "in": "query",
            "name": "maxDistance",
            "schema": {
              "type": "number",
              "default": 10000,
              "minimum": 0,
              "exclusiveMinimum": true,
              "maximum": 100000
            },
            "required": false,
            "description": "Maximum distance in meters"
          },
          {
            "in": "query",
            "name": "excludeUserId",
            "schema": {
              "type": "string",
              "minLength": 1,
              "maxLength": 255
            },
            "required": false,
            "description": "User id to exclude from the result set (typically the requester)"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/NearbyRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Nearby users fetched successfully, including each stored coordinate in data.",
            "content": {
              "application/json": {
                "schema": {
                  "oneOf": [
                    {
                      "$ref": "#/components/schemas/NearbyOffsetResponse"
                    },
                    {
                      "$ref": "#/components/schemas/NearbyCursorResponse"
                    }
                  ]
                }
              }
            }
          },
          "400": {
            "description": "Invalid request data or cursor",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid service bearer token when location authentication is enabled"
          },
          "413": {
            "description": "JSON request body exceeds 32 KB"
          },
          "415": {
            "description": "Unsupported request encoding or charset"
          },
          "429": {
            "description": "Too many requests (when the optional per-replica limiter is enabled)",
            "headers": {
              "X-Nearby-Rejection-Reason": {
                "schema": {
                  "type": "string"
                },
                "description": "Machine-readable controlled rejection reason (rate_limit)"
              }
            }
          },
          "500": {
            "description": "Internal server error"
          },
          "503": {
            "description": "Service temporarily overloaded or database unavailable",
            "headers": {
              "X-Nearby-Rejection-Reason": {
                "schema": {
                  "type": "string"
                },
                "description": "Machine-readable controlled rejection reason when the failure is intentionally shed/retryable"
              }
            }
          }
        }
      }
    },
    "/health/live": {
      "get": {
        "tags": [
          "Health"
        ],
        "summary": "Liveness check",
        "responses": {
          "200": {
            "description": "Process is alive"
          }
        }
      }
    },
    "/health/ready": {
      "get": {
        "tags": [
          "Health"
        ],
        "summary": "Readiness check",
        "description": "Verifies that the process is accepting traffic and PostgreSQL is reachable. Returns 503 during startup/drain.",
        "responses": {
          "200": {
            "description": "Service is ready"
          },
          "503": {
            "description": "Process is starting/draining or database is unavailable"
          }
        }
      }
    }
  },
  "tags": []
};
