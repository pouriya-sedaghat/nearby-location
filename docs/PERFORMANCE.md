# Performance validation

[Documentation index](README.md)

Use the current [Testing and tooling guide](TESTING.md) for seeded workloads, SQL equivalence, EXPLAIN analysis, HTTP benchmarks, matrix runs and evidence recording. [Operations](OPERATIONS.md) covers pool capacity, controlled rejections, adaptive admission and monitoring.

Compare the same data distribution, settings, hardware and exact image/commit. Report successful throughput/latency separately from fast rejected requests. Passing unit tests or a capacity formula does not establish a production throughput target; see [Production readiness](PRODUCTION_READINESS.md).
