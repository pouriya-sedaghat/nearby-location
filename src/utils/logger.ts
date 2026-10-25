import { config } from "../config/env";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const weights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const sensitiveKeyPattern = /(password|secret|token|authorization|database_?url|user_?id|coordinate|latitude|longitude)/i;

const serializeError = (error: Error) => ({
  name: error.name,
  ...("code" in error && typeof error.code === "string" && /^[A-Z0-9_]{2,64}$/.test(error.code)
    ? { code: error.code }
    : {}),
  ...(config.NODE_ENV !== "production" ? { message: error.message } : {}),
  ...(config.NODE_ENV !== "production" && error.stack
    ? { stack: error.stack }
    : {}),
});

const sanitize = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[REDACTED]" :
        config.NODE_ENV === "production" && key === "error" && !(item instanceof Error)
          ? { name: "UnknownError" }
          : sanitize(item, seen),
    ]),
  );
};

const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
  if (weights[level] < weights[config.LOG_LEVEL as LogLevel]) return;

  const sanitizedFields = sanitize(fields) as LogFields;
  const payload = {
    ...sanitizedFields,
    timestamp: new Date().toISOString(),
    level,
    service: "nearby-location",
    env: config.NODE_ENV,
    message,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};
