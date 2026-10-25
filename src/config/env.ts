import dotenv from "dotenv";
import { z } from "zod";
import cron from "node-cron";

const booleanEnv = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const isBaseUrl = (value: string) => {
  if (/[\s\\]/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) {
    return !/[\s?#\\]/.test(value);
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
};

const isDatabaseUrl = (value: string): boolean => {
  if (/[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return false;
    for (const part of [url.username, url.password, url.pathname]) decodeURIComponent(part);
    return true;
  } catch { return false; }
};

const radiusEnv = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? NaN : value,
  z.coerce.number().positive().max(20_000_000),
);

const envSchema = z
  .object({
    NODE_ENV: z.string().min(1).default("production"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    BASE_URL: z.string().refine(isBaseUrl, "Use an HTTP(S) URL or absolute path without credentials, query or fragment").default("/"),
    SWAGGER_ENABLED: booleanEnv.optional(),
    SWAGGER_TRY_IT_OUT_ENABLED: booleanEnv.optional(),
    SWAGGER_AUTH_USERNAME: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional(),
    SWAGGER_AUTH_PASSWORD: z.string().min(32).max(256).regex(/^[\x21-\x7e]+$/).optional(),
    DATABASE_URL: z.string().min(1).refine(isDatabaseUrl, "Use a valid PostgreSQL connection URI with URL-encoded credentials"),

    LOCATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    CLEANUP_CRON_SCHEDULE: z.string().min(1)
      .refine((value) => cron.validate(value), "Invalid cleanup cron schedule")
      .default("0 3 * * *"),
    CLEANUP_BATCH_SIZE: z.coerce.number().int().positive().max(50_000).default(5_000),

    DEFAULT_MAX_DISTANCE_METERS: radiusEnv.default(10_000),
    MAX_MAX_DISTANCE_METERS: radiusEnv.default(100_000),

    PG_POOL_MAX: z.coerce.number().int().positive().default(10),
    PG_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().max(2_147_483_647).default(30_000),
    PG_CONN_TIMEOUT_MS: z.coerce.number().int().positive().max(2_147_483_647).default(5_000),
    PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().max(2_147_483_647).default(2_000),
    PG_CONNECT_RETRIES: z.coerce.number().int().positive().default(10),
    PG_CONNECT_BASE_DELAY_MS: z.coerce.number().int().positive().default(1_000),
    PG_SSL: booleanEnv.default(false),
    PG_SSL_REJECT_UNAUTHORIZED: booleanEnv.default(true),
  })
  .transform((env) => ({
    ...env,
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV === "development",
    SWAGGER_TRY_IT_OUT_ENABLED: env.SWAGGER_TRY_IT_OUT_ENABLED ?? true,
  }))
  .superRefine((env, ctx) => {
    if (env.DEFAULT_MAX_DISTANCE_METERS > env.MAX_MAX_DISTANCE_METERS) {
      ctx.addIssue({
        code: "custom",
        path: ["DEFAULT_MAX_DISTANCE_METERS"],
        message:
          "DEFAULT_MAX_DISTANCE_METERS cannot exceed MAX_MAX_DISTANCE_METERS",
      });
    }
    if (Boolean(env.SWAGGER_AUTH_USERNAME) !== Boolean(env.SWAGGER_AUTH_PASSWORD)) {
      ctx.addIssue({ code: "custom", path: ["SWAGGER_AUTH_PASSWORD"],
        message: "Set SWAGGER_AUTH_USERNAME and SWAGGER_AUTH_PASSWORD together" });
    }
    if (env.SWAGGER_ENABLED && env.NODE_ENV !== "development"
      && (!env.SWAGGER_AUTH_USERNAME || !env.SWAGGER_AUTH_PASSWORD)) {
      ctx.addIssue({ code: "custom", path: ["SWAGGER_AUTH_USERNAME"],
        message: "Swagger outside development requires dedicated Basic Auth credentials" });
    }
  });

export type AppConfig = z.output<typeof envSchema>;

/** Validate values without reading files or changing process state. */
export const parseConfig = (values: Record<string, unknown>): AppConfig => {
  const parsed = envSchema.safeParse(values);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
};

/** Called only by an executable entrypoint; exported values win over .env. */
export const loadConfig = (): AppConfig => {
  dotenv.config({ path: ".env", override: false, quiet: true });
  return parseConfig(process.env);
};
