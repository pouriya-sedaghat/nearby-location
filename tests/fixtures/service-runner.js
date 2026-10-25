const { setTimeout: delay } = require("node:timers/promises");
const { createService, runService } = require("../../dist/runtime");
const { createTestApp } = require("./app.factory");
const options = JSON.parse(process.argv[2]);
const { app, locations } = createTestApp();
locations.upsertLocation = async () => {
  console.log("REQUEST_STARTED");
  await delay(options.requestDelay || 0);
  console.log("REQUEST_FINISHED");
};
const database = {
  connect: async signal => {
    if (options.connectDelay) {
      console.log("CONNECTING");
      await delay(options.connectDelay, undefined, { signal });
    }
  },
  disconnect: async () => {
    console.log("DB_CLOSED");
    if (options.disconnectFailure) throw new Error("disconnect failed");
  },
};
const startCleanup = () => {
  if (options.cleanupFailure) throw new Error("cleanup startup failed");
  console.log("CLEANUP_STARTED");
  return { stop: async () => { await delay(options.cleanupDelay || 25); console.log("CLEANUP_STOPPED"); } };
};
void runService(createService({ app, port: options.port, database, startCleanup }));
