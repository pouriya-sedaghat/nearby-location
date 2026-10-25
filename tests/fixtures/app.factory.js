// Test-only adapter for the service's persistence/health facades.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
const { config, parseConfig } = require("../../dist/config/env");
const { createApp } = require("../../dist/app");
const locations = require("../../dist/models/location.model").default;
const database = require("../../dist/utils/db").default;
exports.createTestApp = (settings = {}) => {
  Object.assign(config, parseConfig({ DATABASE_URL: "postgresql://test.invalid/nearby", NODE_ENV: "test", ...settings }));
  require("../../dist/utils/lifecycle").lifecycle.markReady();
  return { app: createApp(), locations, database, config };
};
