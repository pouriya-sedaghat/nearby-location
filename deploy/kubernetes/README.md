# Kubernetes deployment resources

Follow the [deployment guide](../../docs/DEPLOYMENT.md) for the complete first-install procedure, including database, TLS, secrets, migration ordering, verification, and upgrade boundaries. Use the [release guide](release/README.md) for upgrades of an existing stable installation.

## Inventory

| Resource | Included in base kustomization? | Responsibility |
|---|---|---|
| `configmap.yaml` | Yes | Application settings; production environment, separate migrations, verified DB TLS, signed cursors, adaptive admission |
| `deployment.yaml` | Yes | Three replicas, rolling surge of one, probes, security context, resources, termination hooks |
| `service.yaml` | Yes | Stable ClusterIP, port 80 to API port 8080 |
| `pdb.yaml` | Yes | Voluntary disruption budget |
| `secret.example.yaml` | No | Expected secret keys; replace placeholders through your secret process |
| `migration-job.example.yaml` | No | One-shot schema migration; run before API rollout |
| `networkpolicy.example.yaml` | No | Adaptable ingress isolation; requires network-policy enforcement |
| `hpa.example.yaml` | No | CPU autoscaling from three to six replicas; requires metrics support and capacity acceptance |
| `prometheus-rule.example.yaml` | No | Example recording/alert rules; requires Prometheus Operator CRDs and monitoring integration |
| `privacy-audit-cronjob.example.yaml` | No | Aggregate retention audit; requires policy and schedule review |
| `release-rbac.example.yaml` | No | Release runner permissions; adapt subject/namespace |
| `canary-deployment.example.yaml`, `canary-service.example.yaml` | No | Separate candidate workload and service |
| `httproute-canary.example.yaml` | No | Optional weighted route; requires Gateway API and a compatible controller |
| `release/` | No | Migration/capacity/gate templates and image-promotion script |

## Required adaptation

Use immutable images, real secret values, database certificate trust, an authenticated caller boundary, and measured resources/pool budgets. The example Secret's `DATABASE_URL` deliberately has no URL TLS parameters because the base ConfigMap's `PG_SSL=true` and `PG_SSL_REJECT_UNAUTHORIZED=true` own verified TLS; keep it that way in your real Secret. Do not apply the sample Secret unchanged: its credentials are placeholders.

Location/metrics authentication are disabled in the compatibility ConfigMap. Set bearer modes and credentials together, or enforce/document an equivalent private boundary. If metrics bearer authentication is enabled, annotation-based scraping alone does not supply the token; configure the scraper.

The base Deployment has a 40-second platform grace, a five-second preStop hook, and a 25-second application shutdown deadline. Validate this timing with your ingress/controller. HPA maximum replicas, rollout surge, canary, and terminating-pod headroom all consume database connections.

See [configuration differences](../../docs/CONFIGURATION.md#deployment-profile-differences), [security](../../docs/SECURITY.md), [operations](../../docs/OPERATIONS.md), and [production gates](../../docs/PRODUCTION_READINESS.md).
