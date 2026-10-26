import dotenv from "dotenv";
import { z } from "zod";
import cron from "node-cron";

const { databaseUrlError } = require("../../scripts/lib/postgres-options") as {
  databaseUrlError(value: unknown): string | undefined;
};

dotenv.config({
  path: ".env",
  override: false,
  quiet: true,
});

const booleanEnv = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

// Compose can pass an empty value to preserve environment-specific defaults.
const optionalBooleanEnv = z.preprocess(
  (value) => value === "" ? undefined : value,
  booleanEnv.optional(),
);

const optionalUsernameEnv = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/).optional(),
);

const baseUrlEnv = z.string().refine((value) => {
  if (/[\s\\]/.test(value)) return false;
  if (/^\/(?!\/)[^\s?#\\]*$/.test(value)) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}, "BASE_URL must be an HTTP(S) URL or absolute path without credentials, query or fragment");

const optionalSecretEnv = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z.string().min(32).optional(),
);

const optionalBearerTokenEnv = optionalSecretEnv.refine(
  (value) => value === undefined || /^[\u0021-\u007e]+$/u.test(value),
  "Bearer tokens must contain only printable ASCII characters without spaces",
);
// Node timers clamp larger delays to 1 ms; PostgreSQL timeout settings also
// use signed 32-bit milliseconds. Fail configuration rather than clamp it.
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_TIMEOUT_MS = MAX_POSTGRES_INTEGER;

const envObjectSchema = z
  .object({
    NODE_ENV: z.enum(["production", "development", "test"]).default("production"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    BASE_URL: baseUrlEnv.optional(),
    SWAGGER_ENABLED: optionalBooleanEnv,
    SWAGGER_TRY_IT_OUT_ENABLED: optionalBooleanEnv,
    SWAGGER_AUTH_USERNAME: optionalUsernameEnv,
    SWAGGER_AUTH_PASSWORD: optionalBearerTokenEnv.refine(
      (value) => value === undefined || value.length <= 256,
      "Documentation passwords cannot exceed 256 characters",
    ),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).default(10_000),
    SHUTDOWN_DRAIN_DELAY_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(120_000)
      .default(2_000),
    RUN_MIGRATIONS_ON_STARTUP: booleanEnv.default(true),
    DATABASE_URL: z
      .string()
      .min(1)
      .optional(),

    LOCATION_TTL_DAYS: z.coerce.number().int().positive().max(MAX_POSTGRES_INTEGER).default(7),
    CLEANUP_CRON_SCHEDULE: z.string().min(1).refine(value => cron.validate(value), "Invalid cleanup cron schedule").default("0 3 * * *"),
    CLEANUP_BATCH_SIZE: z.coerce.number().int().positive().max(50_000).default(5_000),
    CLEANUP_MAX_BATCHES_PER_RUN: z.coerce
      .number()
      .int()
      .positive()
      .max(10_000)
      .default(100),
    CLEANUP_BATCH_DELAY_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(60_000)
      .default(25),
    CLEANUP_STATEMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(600_000)
      .default(15_000),
    CLEANUP_LOCK_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(60_000)
      .default(1_000),

    DEFAULT_MAX_DISTANCE_METERS: z.coerce
      .number()
      .positive()
      .default(10_000),
    MAX_MAX_DISTANCE_METERS: z.coerce
      .number()
      .finite()
      .positive()
      .max(20_000_000)
      .default(100_000),

    RANKING_MODE: z.enum(["legacy", "decay"]).default("legacy"),
    RANKING_DISTANCE_SCALE_METERS: z.coerce
      .number()
      .finite()
      .positive()
      .max(20_000_000)
      .default(2_000),
    RANKING_FRESHNESS_HALF_LIFE_MINUTES: z.coerce
      .number()
      .finite()
      .positive()
      .max(525_600)
      .default(60),
    RANKING_DISTANCE_WEIGHT: z.coerce
      .number()
      .finite()
      .nonnegative()
      .max(1_000_000)
      .default(0.65),
    RANKING_FRESHNESS_WEIGHT: z.coerce
      .number()
      .finite()
      .nonnegative()
      .max(1_000_000)
      .default(0.35),
    CURSOR_MAX_AGE_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .max(10_080)
      .default(60),
    CURSOR_SIGNING_SECRET: optionalSecretEnv,
    CURSOR_SIGNING_PREVIOUS_SECRET: optionalSecretEnv,
    CURSOR_REQUIRE_SIGNATURE: booleanEnv.default(false),

    PG_POOL_MAX: z.coerce.number().int().positive().default(10),
    PG_APPLICATION_NAME: z.string().trim().min(1).max(63).default("nearby-location"),
    PG_KEEP_ALIVE_INITIAL_DELAY_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(300_000)
      .default(10_000),
    PG_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().max(MAX_TIMEOUT_MS).default(30_000),
    PG_CONN_TIMEOUT_MS: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).default(5_000),
    PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).default(2_000),
    PG_CONNECT_RETRIES: z.coerce.number().int().positive().default(10),
    PG_CONNECT_BASE_DELAY_MS: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).default(1_000),
    PG_SSL: booleanEnv.default(false),
    PG_SSL_REJECT_UNAUTHORIZED: booleanEnv.default(true),

    LOCATION_AUTH_MODE: z.enum(["disabled", "bearer"]).default("disabled"),
    LOCATION_AUTH_TOKEN: optionalBearerTokenEnv,
    LOCATION_AUTH_PREVIOUS_TOKEN: optionalBearerTokenEnv,
    METRICS_AUTH_MODE: z.enum(["disabled", "bearer"]).default("disabled"),
    METRICS_AUTH_TOKEN: optionalBearerTokenEnv,
    METRICS_AUTH_PREVIOUS_TOKEN: optionalBearerTokenEnv,
    PRIVACY_API_ENABLED: booleanEnv.default(false),
    PRIVACY_AUTH_TOKEN: optionalBearerTokenEnv,
    PRIVACY_AUTH_PREVIOUS_TOKEN: optionalBearerTokenEnv,

    HTTP_TRUST_PROXY: booleanEnv.default(false),
    ADMISSION_ENABLED: booleanEnv.default(true),
    NEARBY_MAX_IN_FLIGHT: z.coerce.number().int().positive().max(100_000).default(50),
    UPSERT_MAX_IN_FLIGHT: z.coerce.number().int().positive().max(100_000).default(100),
    ADAPTIVE_ADMISSION_ENABLED: booleanEnv.default(false),
    ADAPTIVE_NEARBY_MIN_IN_FLIGHT: z.coerce
      .number()
      .int()
      .positive()
      .max(100_000)
      .default(5),
    ADAPTIVE_UPSERT_MIN_IN_FLIGHT: z.coerce
      .number()
      .int()
      .positive()
      .max(100_000)
      .default(10),
    ADAPTIVE_NEARBY_LATENCY_TARGET_MS: z.coerce
      .number()
      .finite()
      .positive()
      .max(60_000)
      .default(250),
    ADAPTIVE_UPSERT_LATENCY_TARGET_MS: z.coerce
      .number()
      .finite()
      .positive()
      .max(60_000)
      .default(100),
    ADAPTIVE_INITIAL_LIMIT_PERCENT: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50),
    ADAPTIVE_EWMA_ALPHA: z.coerce
      .number()
      .finite()
      .min(0.05)
      .max(1)
      .default(0.2),
    ADAPTIVE_INCREASE_EVERY: z.coerce
      .number()
      .int()
      .positive()
      .max(100_000)
      .default(20),
    ADAPTIVE_DECREASE_FACTOR: z.coerce
      .number()
      .finite()
      .min(0.1)
      .max(0.95)
      .default(0.8),
    ADAPTIVE_DECREASE_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(60_000)
      .default(1_000),
    PG_POOL_WAITING_REJECT_THRESHOLD: z.coerce
      .number()
      .int()
      .positive()
      .max(100_000)
      .default(10),
    DB_CIRCUIT_FAILURE_THRESHOLD: z.coerce
      .number()
      .int()
      .positive()
      .max(10_000)
      .default(5),
    DB_CIRCUIT_OPEN_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(600_000)
      .default(5_000),
    RATE_LIMIT_ENABLED: booleanEnv.default(false),
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(3_600_000)
      .default(60_000),
    RATE_LIMIT_NEARBY_MAX: z.coerce
      .number()
      .int()
      .positive()
      .max(10_000_000)
      .default(120),
    RATE_LIMIT_UPSERT_MAX: z.coerce
      .number()
      .int()
      .positive()
      .max(10_000_000)
      .default(240),
    RATE_LIMIT_MAX_KEYS: z.coerce
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .default(10_000),
  });

const envSchema = envObjectSchema
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "DATABASE_URL is required in production" });
    }
    if (env.DATABASE_URL) {
      const error = databaseUrlError(env.DATABASE_URL);
      if (error) ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: error });
    }
    const swaggerEnabled = env.SWAGGER_ENABLED ?? env.NODE_ENV === "development";
    const hasSwaggerUsername = Boolean(env.SWAGGER_AUTH_USERNAME);
    const hasSwaggerPassword = Boolean(env.SWAGGER_AUTH_PASSWORD);
    if (hasSwaggerUsername !== hasSwaggerPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SWAGGER_AUTH_PASSWORD"],
        message: "SWAGGER_AUTH_USERNAME and SWAGGER_AUTH_PASSWORD must be configured together",
      });
    }
    if (swaggerEnabled && env.NODE_ENV !== "development" && !hasSwaggerPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SWAGGER_AUTH_PASSWORD"],
        message: "Enabling Swagger outside development requires dedicated documentation credentials",
      });
    }
    if (env.SHUTDOWN_DRAIN_DELAY_MS >= env.SHUTDOWN_TIMEOUT_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SHUTDOWN_DRAIN_DELAY_MS"],
        message: "SHUTDOWN_DRAIN_DELAY_MS must be less than SHUTDOWN_TIMEOUT_MS",
      });
    }

    if (env.DEFAULT_MAX_DISTANCE_METERS > env.MAX_MAX_DISTANCE_METERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEFAULT_MAX_DISTANCE_METERS"],
        message:
          "DEFAULT_MAX_DISTANCE_METERS cannot exceed MAX_MAX_DISTANCE_METERS",
      });
    }

    if (env.RANKING_DISTANCE_WEIGHT + env.RANKING_FRESHNESS_WEIGHT <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RANKING_DISTANCE_WEIGHT"],
        message:
          "At least one ranking weight must be greater than zero",
      });
    }

    if (env.CURSOR_REQUIRE_SIGNATURE && !env.CURSOR_SIGNING_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CURSOR_SIGNING_SECRET"],
        message:
          "CURSOR_SIGNING_SECRET is required when CURSOR_REQUIRE_SIGNATURE=true",
      });
    }

    if (env.CURSOR_SIGNING_PREVIOUS_SECRET && !env.CURSOR_SIGNING_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CURSOR_SIGNING_PREVIOUS_SECRET"],
        message:
          "CURSOR_SIGNING_PREVIOUS_SECRET requires CURSOR_SIGNING_SECRET",
      });
    }

    if (env.LOCATION_AUTH_MODE === "bearer" && !env.LOCATION_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LOCATION_AUTH_TOKEN"],
        message: "LOCATION_AUTH_TOKEN is required when LOCATION_AUTH_MODE=bearer",
      });
    }

    if (env.LOCATION_AUTH_PREVIOUS_TOKEN && !env.LOCATION_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LOCATION_AUTH_PREVIOUS_TOKEN"],
        message: "LOCATION_AUTH_PREVIOUS_TOKEN requires LOCATION_AUTH_TOKEN",
      });
    }

    if (env.METRICS_AUTH_MODE === "bearer" && !env.METRICS_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["METRICS_AUTH_TOKEN"],
        message: "METRICS_AUTH_TOKEN is required when METRICS_AUTH_MODE=bearer",
      });
    }

    if (env.METRICS_AUTH_PREVIOUS_TOKEN && !env.METRICS_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["METRICS_AUTH_PREVIOUS_TOKEN"],
        message: "METRICS_AUTH_PREVIOUS_TOKEN requires METRICS_AUTH_TOKEN",
      });
    }

    if (env.PRIVACY_API_ENABLED && !env.PRIVACY_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PRIVACY_AUTH_TOKEN"],
        message: "PRIVACY_AUTH_TOKEN is required when PRIVACY_API_ENABLED=true",
      });
    }

    if (env.PRIVACY_AUTH_PREVIOUS_TOKEN && !env.PRIVACY_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PRIVACY_AUTH_PREVIOUS_TOKEN"],
        message: "PRIVACY_AUTH_PREVIOUS_TOKEN requires PRIVACY_AUTH_TOKEN",
      });
    }

    if (
      env.ADAPTIVE_ADMISSION_ENABLED &&
      env.ADAPTIVE_NEARBY_MIN_IN_FLIGHT > env.NEARBY_MAX_IN_FLIGHT
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADAPTIVE_NEARBY_MIN_IN_FLIGHT"],
        message:
          "ADAPTIVE_NEARBY_MIN_IN_FLIGHT cannot exceed NEARBY_MAX_IN_FLIGHT",
      });
    }

    if (
      env.ADAPTIVE_ADMISSION_ENABLED &&
      env.ADAPTIVE_UPSERT_MIN_IN_FLIGHT > env.UPSERT_MAX_IN_FLIGHT
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADAPTIVE_UPSERT_MIN_IN_FLIGHT"],
        message:
          "ADAPTIVE_UPSERT_MIN_IN_FLIGHT cannot exceed UPSERT_MAX_IN_FLIGHT",
      });
    }
  });

// z.coerce.number() turns "" and whitespace into 0, which would silently
// replace a documented default (for example, lock_timeout=0 disables the
// limit). Booleans already reject blank values; numbers must fail the same way.
const unwrapOptional = (schema: z.ZodTypeAny): z.ZodTypeAny =>
  schema instanceof z.ZodDefault || schema instanceof z.ZodOptional
    ? unwrapOptional(schema.unwrap() as z.ZodTypeAny)
    : schema;
export const parseConfig = (values: Record<string, unknown>) => {
const blankNumericIssues = Object.entries(envObjectSchema.shape)
  .filter(([key, schema]) =>
    unwrapOptional(schema) instanceof z.ZodNumber &&
    typeof values[key] === "string" && (values[key] as string).trim() === "")
  .map(([key]) => `${key}: Numeric settings cannot be empty`);
const parsed = envSchema.safeParse(values);
if (!parsed.success || blankNumericIssues.length > 0) {
  const details = [...blankNumericIssues, ...(parsed.success ? [] : parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`))].join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}
return {
  ...parsed.data,
  DATABASE_URL: parsed.data.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/nearby-location",
  BASE_URL: parsed.data.BASE_URL ?? "/",
  SWAGGER_ENABLED: parsed.data.SWAGGER_ENABLED ?? parsed.data.NODE_ENV === "development",
  SWAGGER_TRY_IT_OUT_ENABLED: parsed.data.SWAGGER_TRY_IT_OUT_ENABLED ?? parsed.data.NODE_ENV === "development",
};
};
export const config = parseConfig(process.env);
export type AppConfig = ReturnType<typeof parseConfig>;
