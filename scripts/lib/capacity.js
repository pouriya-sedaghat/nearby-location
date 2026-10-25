const calculateConnectionCapacity = ({
  maxConnections,
  superuserReservedConnections = 0,
  reservedConnections = 0,
  expectedReplicas,
  poolMax,
  externalReserve = 20,
  maxUtilizationPercent = 70,
}) => {
  const serverReserved = superuserReservedConnections + reservedConnections;
  const usableConnections = Math.max(0, maxConnections - serverReserved);
  const utilizationCap = Math.floor(
    usableConnections * (maxUtilizationPercent / 100),
  );
  const serviceConnectionBudget = Math.max(0, utilizationCap - externalReserve);
  const configuredServiceConnections = expectedReplicas * poolMax;
  const headroom = serviceConnectionBudget - configuredServiceConnections;
  const maxSafeReplicas = poolMax > 0
    ? Math.max(0, Math.floor(serviceConnectionBudget / poolMax))
    : 0;

  return {
    maxConnections,
    serverReserved,
    usableConnections,
    maxUtilizationPercent,
    utilizationCap,
    externalReserve,
    serviceConnectionBudget,
    expectedReplicas,
    poolMax,
    configuredServiceConnections,
    maxSafeReplicas,
    headroom,
    utilizationOfBudgetPercent:
      serviceConnectionBudget > 0
        ? Number(
            ((configuredServiceConnections / serviceConnectionBudget) * 100).toFixed(2),
          )
        : null,
    passed: configuredServiceConnections <= serviceConnectionBudget,
  };
};

module.exports = { calculateConnectionCapacity };
