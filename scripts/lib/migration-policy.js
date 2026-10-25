const path = require("node:path");

const extractUpBody = (source) => {
  const upIndex = source.indexOf("exports.up");
  if (upIndex < 0) return "";
  const downIndex = source.indexOf("exports.down", upIndex + 1);
  return source.slice(upIndex, downIndex < 0 ? source.length : downIndex);
};

const RULES = [
  {
    id: "drop-table",
    severity: "destructive",
    pattern: /\b(?:pgm\.)?dropTable\s*\(|\bDROP\s+TABLE\b/i,
    message: "drops a table",
  },
  {
    id: "drop-column",
    severity: "destructive",
    pattern: /\b(?:pgm\.)?dropColumns?\s*\(|\bDROP\s+COLUMN\b/i,
    message: "drops one or more columns",
  },
  {
    id: "truncate",
    severity: "destructive",
    pattern: /\bTRUNCATE\b/i,
    message: "truncates data",
  },
  {
    id: "delete-data",
    severity: "destructive",
    pattern: /\bDELETE\s+FROM\b/i,
    message: "deletes data during migration",
  },
  {
    id: "rename-table",
    severity: "breaking",
    pattern: /\b(?:pgm\.)?renameTable\s*\(|\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+TO\b/i,
    message: "renames a table and can break old application replicas",
  },
  {
    id: "rename-column",
    severity: "breaking",
    pattern: /\b(?:pgm\.)?renameColumn\s*\(|\bRENAME\s+COLUMN\b/i,
    message: "renames a column and can break old application replicas",
  },
  {
    id: "alter-column",
    severity: "review",
    pattern: /\b(?:pgm\.)?alterColumn\s*\(|\bALTER\s+COLUMN\b/i,
    message: "alters a column and requires lock/backward-compatibility review",
  },
  {
    id: "drop-index",
    severity: "review",
    pattern: /\b(?:pgm\.)?dropIndex\s*\(|\bDROP\s+INDEX\b/i,
    message: "drops an index and can regress query performance",
  },
];

const analyzeMigrationSource = (source, filename = "migration.js") => {
  const upBody = extractUpBody(source);
  const findings = RULES.filter((rule) => rule.pattern.test(upBody)).map((rule) => ({
    file: path.basename(filename),
    id: rule.id,
    severity: rule.severity,
    message: rule.message,
  }));
  return { file: path.basename(filename), hasUp: upBody.length > 0, findings };
};

const summarizeMigrationPolicy = (analyses) => {
  const findings = analyses.flatMap((analysis) => analysis.findings);
  const bySeverity = findings.reduce((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});
  return {
    filesChecked: analyses.length,
    findings,
    bySeverity,
    hasDestructiveOrBreaking: findings.some((finding) =>
      ["destructive", "breaking"].includes(finding.severity),
    ),
    hasReviewFindings: findings.some((finding) => finding.severity === "review"),
  };
};

module.exports = {
  analyzeMigrationSource,
  extractUpBody,
  summarizeMigrationPolicy,
};
