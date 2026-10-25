const { parseConfig } = require("../../dist/config/env");
const { createApp } = require("../../dist/app");
const quietLogger = { log() {}, error() {} };

const createTestApp = (values = {}, options = {}) => {
  const config = parseConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://test.invalid/nearby", SWAGGER_ENABLED: "false", ...values });
  const locations = {
    upsertLocation: async () => {},
    findNearby: async () => ({ data: [], totalCount: 0 }),
  };
  const database = { ping: async () => {} };
  const app = createApp({ config, locations, database, logger: quietLogger, ...options });
  return { app, config, locations, database };
};
module.exports = { createTestApp, quietLogger };
