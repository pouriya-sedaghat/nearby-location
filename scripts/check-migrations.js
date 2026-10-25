const fs = require("node:fs");
const path = require("node:path");
const {
  analyzeMigrationSource,
  summarizeMigrationPolicy,
} = require("./lib/migration-policy");

const migrationsDir = path.resolve(process.env.MIGRATIONS_DIR ?? "migrations");
const allowDestructive = process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === "true";
const failOnReview = process.env.MIGRATION_POLICY_FAIL_ON_REVIEW === "true";
const approvalReason = (process.env.MIGRATION_APPROVAL_REASON ?? "").trim();

if (!fs.existsSync(migrationsDir)) {
  throw new Error(`Migrations directory not found: ${migrationsDir}`);
}

const files = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".js"))
  .sort();
const analyses = files.map((file) =>
  analyzeMigrationSource(
    fs.readFileSync(path.join(migrationsDir, file), "utf8"),
    file,
  ),
);
const summary = summarizeMigrationPolicy(analyses);

const result = {
  version: 1,
  migrationsDir,
  ...summary,
  policy: {
    allowDestructive,
    failOnReview,
    approvalReasonPresent: approvalReason.length >= 10,
  },
};

const blockingDestructive =
  summary.hasDestructiveOrBreaking &&
  !(allowDestructive && approvalReason.length >= 10);
const blockingReview = failOnReview && summary.hasReviewFindings;
result.passed = !blockingDestructive && !blockingReview;

if (process.env.MIGRATION_POLICY_OUTPUT === "json") {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Migration policy: checked ${summary.filesChecked} file(s).`);
  if (summary.findings.length === 0) {
    console.log("No risky operations detected in exports.up.");
  } else {
    for (const finding of summary.findings) {
      console.log(`- [${finding.severity}] ${finding.file}: ${finding.message} (${finding.id})`);
    }
  }
  if (blockingDestructive) {
    console.error(
      "Destructive/breaking migration blocked. Set ALLOW_DESTRUCTIVE_MIGRATIONS=true and provide MIGRATION_APPROVAL_REASON (>=10 chars) only after a reviewed expand/contract or maintenance plan.",
    );
  }
  if (blockingReview) {
    console.error("Migration review finding blocked by MIGRATION_POLICY_FAIL_ON_REVIEW=true.");
  }
}

if (!result.passed) process.exitCode = 2;
