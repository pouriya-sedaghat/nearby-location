const { successfulMetrics } = require("./benchmark-stats");

const parseCsv = (raw, mapper = (value) => value) => {
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(mapper);
};

const markdownEscape = (value) => String(value).replace(/\|/g, "\\|");

const renderMatrixMarkdown = (report) => {
  const lines = [
    "# Nearby benchmark matrix",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Overall: **${report.passed ? "PASS" : "FAIL"}**`,
    "",
    "| Dataset | Radius (m) | Concurrency | Mode | Successful RPS | Successful p95 ms | Successful p99 ms | Error % | Budget |",
    "| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const item of report.results) {
    const result = item.result ?? {};
    const successful = successfulMetrics(result);
    const errorPercent =
      typeof result.errorRate === "number"
        ? (result.errorRate * 100).toFixed(2)
        : "-";
    lines.push(
      `| ${markdownEscape(item.datasetLabel)} | ${item.radiusMeters} | ${item.concurrency} | ${markdownEscape(item.mode)} | ${successful.requestsPerSecond ?? "-"} | ${successful.latencyMs?.p95 ?? "-"} | ${successful.latencyMs?.p99 ?? "-"} | ${errorPercent} | ${item.passed ? "PASS" : "FAIL"} |`,
    );
  }

  if (report.plans.length > 0) {
    lines.push("", "## Query plans", "");
    lines.push(
      "| Dataset | Radius (m) | Exec ms | GiST | Buffers hit/read |",
      "| ---: | ---: | ---: | --- | --- |",
    );
    for (const plan of report.plans) {
      const summary = plan.result ?? {};
      const hit = summary.buffers?.["Shared Hit Blocks"] ?? 0;
      const read = summary.buffers?.["Shared Read Blocks"] ?? 0;
      lines.push(
        `| ${markdownEscape(plan.datasetLabel)} | ${plan.radiusMeters} | ${summary.executionTimeMs ?? "-"} | ${summary.usesLocationsGistIndex ? "yes" : "no"} | ${hit}/${read} |`,
      );
    }
  }

  if (report.failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const failure of report.failures) {
      lines.push(`- ${failure}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

module.exports = { parseCsv, renderMatrixMarkdown };
