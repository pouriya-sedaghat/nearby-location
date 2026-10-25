# Location privacy and credential incident

[Security](../SECURITY.md) · [Privacy lifecycle](../PRIVACY_AND_RETENTION.md)

## Trigger

Use for unauthorized coordinate disclosure, compromised API/docs/database credentials, location data in logs/exports, failed erasure guarantees, or restored erased data becoming visible. Assign the incident/privacy owners and affected environment/time range.

## Contain

1. Restrict the affected ingress/surface/caller and pause implicated publishing or export flows.
2. Revoke compromised credentials or keys through the secret source and roll serving processes. In a compromise, remove the old accepted value instead of preserving a rotation overlap.
3. Restrict metrics/docs/support/data access if implicated. Preserve minimal forensic evidence through authorized systems.
4. Coordinate database/network/platform containment with their owners. Do not copy raw location tables into chat, issues, or general logs.

Changing a Kubernetes Secret alone does not update existing environment variables; a rollout is required. Token revocation can interrupt callers; cursor key revocation can invalidate active traversals. Verify every serving replica's recovery state.

## Determine scope

Use timestamps, image/configuration revisions, normalized-route logs, request IDs, aggregate auth/deletion metrics, secret-manager/access audit records, and gateway/DB evidence. Determine which surfaces/callers were exposed, whether IDs/coordinates/cursor payloads entered logs or downstream copies, and whether the retention/erasure ordering failed.

Restrict any subject-level analysis to approved systems and access. Application logging redaction does not establish that gateway/APM/database logs are safe.

## Recover

Correct authorization/visibility and transport/network policy, provision fresh independent credentials, verify unauthorized rejection and expected caller access, and audit retention. For missed erasures, stop publishers and pending retries, complete the dedicated deletion workflow, and reconcile downstream copies. For a restore, replay the relevant external erasure/revocation record before reopening access.

Use approved synthetic subjects to test location publication, disclosure policy, deletion, repeated deletion, delayed-event handling, and safe logging. Confirm metrics/docs privileges independently of location caller privileges.

## Notify and close

Follow the organization's privacy/security escalation, evidence retention, and notification process with its responsible specialists. Record impact, containment, corrected policy/code/configuration, erasure/recovery outcomes, credential revocation completion, and prevention work. Close only after the privacy owner and operating owner accept the corrected boundary and monitoring.
