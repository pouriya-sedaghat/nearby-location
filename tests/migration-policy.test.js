const assert = require("node:assert/strict");
const test = require("node:test");
const {
  analyzeMigrationSource,
  summarizeMigrationPolicy,
} = require("../scripts/lib/migration-policy");

test("safe additive migration passes without findings", () => {
  const analysis = analyzeMigrationSource(`
    exports.up = (pgm) => {
      pgm.addColumns("locations", { accuracy_meters: { type: "integer" } });
      pgm.createIndex("locations", "updated_at");
    };
    exports.down = (pgm) => pgm.dropColumns("locations", ["accuracy_meters"]);
  `, "safe.js");
  assert.equal(analysis.findings.length, 0);
});

test("down migration destructive operations are ignored", () => {
  const analysis = analyzeMigrationSource(`
    exports.up = (pgm) => pgm.createTable("x", { id: "id" });
    exports.down = (pgm) => pgm.dropTable("x");
  `, "down-only.js");
  assert.equal(analysis.findings.length, 0);
});

test("destructive up migration is detected", () => {
  const analysis = analyzeMigrationSource(`
    exports.up = (pgm) => { pgm.dropColumn("locations", "legacy"); };
    exports.down = () => {};
  `, "drop.js");
  assert.deepEqual(analysis.findings.map((finding) => finding.id), ["drop-column"]);
});

test("rename and alter operations are classified", () => {
  const summary = summarizeMigrationPolicy([
    analyzeMigrationSource(`exports.up = (pgm) => { pgm.renameColumn("locations", "a", "b"); pgm.alterColumn("locations", "b", { type: "text" }); };`, "change.js"),
  ]);
  assert.equal(summary.hasDestructiveOrBreaking, true);
  assert.equal(summary.hasReviewFindings, true);
});
