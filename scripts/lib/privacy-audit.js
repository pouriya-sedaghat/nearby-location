const evaluatePrivacyAudit = ({
  overdueRows,
  futureRows,
  maxOverdueRows = 0,
  maxFutureRows = 0,
}) => {
  const failures = [];
  if (overdueRows > maxOverdueRows) {
    failures.push(
      `overdue_rows ${overdueRows} exceeds allowed ${maxOverdueRows}`,
    );
  }
  if (futureRows > maxFutureRows) {
    failures.push(`future_rows ${futureRows} exceeds allowed ${maxFutureRows}`);
  }
  return { passed: failures.length === 0, failures };
};

module.exports = { evaluatePrivacyAudit };
