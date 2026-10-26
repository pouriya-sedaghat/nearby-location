# Documentation

These English guides describe version **2.14.1**. See [Release review](REVIEW_2.14.1.md) for executed checks and [Upgrading](UPGRADING.md) for migration from the published 1.0.0 or supplied 2.13.5 source. Identify deployments by commit and immutable image digest. Commands run from the repository root unless a guide says otherwise.

## Reading paths

| Reader | Recommended order |
|---|---|
| New team member | [Overview](OVERVIEW.md) → [Architecture](ARCHITECTURE.md) → [Development](DEVELOPMENT.md) |
| API integrator | [API](API.md) → [Security](SECURITY.md) → [Configuration](CONFIGURATION.md) |
| Deployment owner | [Deployment](DEPLOYMENT.md) → [Configuration](CONFIGURATION.md) → [Production acceptance](PRODUCTION_READINESS.md) |
| VM evaluator | [VM procedure](VM_TESTING.md) → [Testing](TESTING.md) → [Operations](OPERATIONS.md) |
| Operator | [Operations](OPERATIONS.md) → [Privacy](PRIVACY_AND_RETENTION.md) → [Runbooks](#runbooks) |
| Presenter | [Presentation](PRESENTATION.md) → [Overview](OVERVIEW.md) → [Architecture](ARCHITECTURE.md) |

## Reference and procedures

| Document | Contents |
|---|---|
| [Overview](OVERVIEW.md) | Purpose, boundaries, capabilities, and supported modes |
| [Architecture](ARCHITECTURE.md) | System topology, request routing, data model, SQL, ranking, cursors, cleanup, and shutdown |
| [API](API.md) | Endpoints, request/response examples, validation, pagination, errors, and relative time |
| [OpenAPI JSON](openapi.json) | Generated machine-readable contract; includes optional features |
| [Configuration](CONFIGURATION.md) | Every application environment variable, defaults, constraints, and profile differences |
| [Development](DEVELOPMENT.md) | Local setup, source map, migrations, contribution workflow, and documentation maintenance |
| [Deployment](DEPLOYMENT.md) | Production container setup, first Kubernetes installation, and upgrade boundaries |
| [VM procedure](VM_TESTING.md) | Authenticated VM evaluation, checks, measurements, persistence, and diagnostics |
| [Kubernetes entry point](../deploy/kubernetes/README.md) | Manifest inventory and cluster adaptation |
| [Kubernetes release](../deploy/kubernetes/release/README.md) | Existing-install release automation, canary gate, rollback, and recovery |
| [Operations](OPERATIONS.md) | Probes, logs, metrics, alerts, capacity, secrets, and troubleshooting |
| [Testing](TESTING.md) | Test isolation, CI coverage, benchmark tools, and evidence recording |
| [Security](SECURITY.md) | Authentication surfaces, caller authorization, TLS, networking, and data exposure |
| [Privacy](PRIVACY_AND_RETENTION.md) | TTL, deletion ordering, retention audits, backup implications |
| [Presentation](PRESENTATION.md) | Ten-slide outline, English speaker notes, demo, and anticipated questions |
| [Production acceptance](PRODUCTION_READINESS.md) | Evidence required before approving a target environment |
| [Documentation review](DOCUMENTATION_REVIEW.md) | Verified gaps, source anchors, replacement mapping, and remaining limitations |

## Runbooks

- [Service incident response](runbooks/SERVICE_INCIDENT.md): overload, database failure, failed rollout, and recovery checks.
- [Backup and restore](runbooks/BACKUP_RESTORE.md): recovery preparation, isolated restore, erasure replay, and acceptance.
- [Location privacy incident](runbooks/LOCATION_PRIVACY_INCIDENT.md): containment, minimal evidence, credential rotation, and recovery.

## Diagram catalogue

GitHub renders the fenced Mermaid diagrams directly. Their surrounding text explains implementation details and limits.

| Diagram | Location |
|---|---|
| System and trust boundaries | [Architecture](ARCHITECTURE.md#system-context) |
| HTTP routing and rejection paths | [Architecture](ARCHITECTURE.md#http-request-routing) |
| Database entity | [Architecture](ARCHITECTURE.md#data-model) |
| Cursor page sequence | [Architecture](ARCHITECTURE.md#cursor-pagination) |
| Database circuit transitions | [Architecture](ARCHITECTURE.md#overload-protection) |
| Startup and shutdown states | [Architecture](ARCHITECTURE.md#process-lifecycle) |
| First deployment and migration order | [Deployment](DEPLOYMENT.md#first-kubernetes-installation) |
| Canary promotion and rollback | [Kubernetes release](../deploy/kubernetes/release/README.md#release-flow) |
| Privacy erasure ordering | [Privacy](PRIVACY_AND_RETENTION.md#explicit-erasure) |
| Presentation architecture | [Presentation](PRESENTATION.md#slide-3--architecture) |

## Source and maintenance

The supplied [historical documentation review](DOCUMENTATION_REVIEW.md) records earlier source work. The current [release review](REVIEW_2.14.1.md) and exact deployed commit/image define acceptance evidence. Update guides alongside source changes using the [maintenance workflow](DEVELOPMENT.md#maintain-the-documentation).

The [changelog](../CHANGELOG.md) preserves release history. Superseded narrative guides and dated evaluation reports are available through Git history; their historical measurements are not current acceptance evidence.

## Release and compatibility

- [Release review](REVIEW_2.14.1.md): executed checks and remaining acceptance work.
- [Upgrading to 2.14.1](UPGRADING.md): existing VM credentials/volume and supplied-source compatibility.
- [Ubuntu VM deployment](VM_UBUNTU.md): private default deployment.
- [Interactive Swagger](SWAGGER.md): language, authentication and execution workflow.
