const boolean = (env, name, fallback) => {
  const value = env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
};

// Pure validation shared by configuration, server pools, migration and tools.
// Never include the supplied URI in a diagnostic: it may contain credentials.
const databaseUrlError = (value) => {
  if (value === undefined) return undefined;
  const invalid = 'DATABASE_URL must be a valid PostgreSQL URI with URL-encoded credentials and no fragment';
  if (typeof value !== 'string' || !/^postgres(?:ql)?:\/\//i.test(value)
      || /[\s\\\u0000-\u001f\u007f]/.test(value) || !value.isWellFormed()
      || /%(?![0-9a-f]{2})/i.test(value) || value.includes('#')) return invalid;
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(value).includes('\u0000')) return invalid;
  } catch { return invalid; }
  return undefined;
};

const validateConnectionString = (value) => {
  const error = databaseUrlError(value);
  if (error) throw new Error(error);
};

const tlsOptions = (env = process.env) => {
  const enabled = boolean(env, "PG_SSL", false);
  const rejectUnauthorized = boolean(env, "PG_SSL_REJECT_UNAUTHORIZED", true);
  // Explicit false prevents ambient PGSSLMODE from changing the policy. A
  // connection URI can still own TLS when PG_SSL=false, as documented below.
  return enabled ? { rejectUnauthorized } : false;
};

// Operational tools must honor the same TLS switches as the application.
const withPostgresOptions = (options, env = process.env) => {
  const connectionTimeoutMillis = Number(env.PG_CONN_TIMEOUT_MS ?? 5000);
  if (!Number.isSafeInteger(connectionTimeoutMillis) || connectionTimeoutMillis <= 0 || connectionTimeoutMillis > 2147483647) {
    throw new Error("PG_CONN_TIMEOUT_MS must be an integer from 1 to 2147483647");
  }
  const ssl = tlsOptions(env);
  validateTlsConnectionString(options.connectionString, ssl);
  return { ...options, connectionTimeoutMillis, ssl };
};

// pg parses URL TLS parameters after the options object and replaces its ssl
// value. Refuse ambiguous configuration instead of silently disabling TLS or
// certificate verification. A URL can own TLS when PG_SSL=false; otherwise use
// PG_SSL/PG_SSL_REJECT_UNAUTHORIZED without URL TLS parameters.
const validateTlsConnectionString = (connectionString, ssl) => {
  validateConnectionString(connectionString);
  if (!ssl || !connectionString) return;
  const url = new URL(connectionString);
  const tlsKeys = new Set(['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword', 'uselibpqcompat', 'sslnegotiation']);
  if ([...url.searchParams.keys()].some((key) => tlsKeys.has(key))) {
    throw new Error('DATABASE_URL TLS parameters conflict with PG_SSL=true; remove URL TLS parameters and configure PG_SSL/PG_SSL_REJECT_UNAUTHORIZED');
  }
};

const migrationTlsArgs = (args, env = process.env) => {
  const ssl = tlsOptions(env);
  validateTlsConnectionString(env.DATABASE_URL, ssl);
  if (!ssl || args.some((arg) => /^--(?:no-)?reject-unauthorized(?:=|$)/.test(arg))) return [];
  // Setting this CLI option enables TLS in node-pg-migrate's connection config.
  return ["--reject-unauthorized", String(ssl.rejectUnauthorized)];
};

module.exports = { withPostgresOptions, migrationTlsArgs, databaseUrlError };
