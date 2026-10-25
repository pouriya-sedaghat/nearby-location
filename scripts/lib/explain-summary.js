const summarizePlan = (root) => {
  const nodeTypes = new Set();
  const indexes = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node["Node Type"]) nodeTypes.add(node["Node Type"]);
    if (node["Index Name"]) indexes.add(node["Index Name"]);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(root);
  // Node buffer counters already include their children. Use the root once;
  // summing across the tree counts the same buffer accesses multiple times.
  const buffers = Object.fromEntries([
    "Shared Hit Blocks", "Shared Read Blocks", "Shared Dirtied Blocks",
    "Shared Written Blocks", "Local Hit Blocks", "Local Read Blocks",
    "Local Dirtied Blocks", "Local Written Blocks", "Temp Read Blocks", "Temp Written Blocks",
  ].map((key) => [key, Number(root[key] ?? 0)]));
  return { nodeTypes: [...nodeTypes].sort(), indexes: [...indexes].sort(), buffers };
};

module.exports = { summarizePlan };
