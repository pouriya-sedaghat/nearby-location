# PostgreSQL/PostGIS backup and restore

[Operations](../OPERATIONS.md) · [Privacy](../PRIVACY_AND_RETENTION.md)

## Prepare before launch

Name a database/recovery owner and define RPO, RTO, backup/WAL retention, encryption, access, storage location, expiry, and drill frequency. Record the Postgres/PostGIS versions, schema/migration level, image/configuration compatibility, extension availability, runtime/migration roles, and trusted TLS setup.

Select your database platform's supported backup/PITR procedure. This repository does not configure a backup service. A persistent Docker volume is not a backup, and copying a running database directory is not a substitute for a consistent database backup.

Maintain a restricted external record for consent revocations and erasures that must survive restoring older data. Live deletion does not rewrite existing backups. Backup access and retention should be reviewed independently of `LOCATION_TTL_DAYS`.

## Restore drill

1. Choose a stated recovery point and measure the recovery timer. Preserve the source backup's identity without publishing secrets.
2. Create an isolated database/network target; block publishers, public callers, and unintended scrapers.
3. Restore with your approved platform/tool procedure, including required roles/extension support and WAL when applicable.
4. Verify PostGIS availability, migration state, table/index definitions, integrity, and database permissions. Do not blindly run new migrations over an unknown restored version.
5. Replay relevant erasures/revocations from the external record and apply the approved retention process before disclosing any restored rows. Keep upstream publication paused.
6. Use a compatible application image/configuration, verified TLS, and the restored DB URL. Run readiness and authenticated query checks. Run `inspect:db`, `privacy:audit`, and representative plans with internal handling of output.
7. Test writes/searches/deletion with approved synthetic subjects and verify cleanup, pool capacity, and monitoring. Compare result-coordinate and pagination behavior with the contract.
8. Record actual data-loss interval and elapsed recovery time against RPO/RTO. Obtain environment acceptance before routing callers to the restored database.

Database tools accept a separately configured target. Verify the URL's identity before execution and avoid printing credentials in command logs. Do not run the truncating integration suite or synthetic bulk seed against restored live user data.

## Production recovery

Follow the rehearsed platform plan. Preserve the failing database/recovery evidence as required, keep traffic and publishers contained, and avoid split-brain writes. Confirm the restore-time erasure/retention pass before cutover. Route a controlled amount of traffic, verify useful throughput and error/latency budgets, then expand while observing.

Re-enable publishers only after revocations, queued events, and endpoint configuration are consistent. Verify that delayed upserts cannot recreate subjects that remain revoked. Image/schema rollback, restored DB endpoints, and Secret/ConfigMap changes must be coordinated explicitly.

## Evidence and exit criteria

Record backup/recovery point, restore tool/platform version, environment/image/config revisions, schema/extension verification, erasure replay completion, retention verdict, functional outcomes, RPO/RTO measurement, cutover result, and owners. A successful restore drill must precede production acceptance and be repeated after material database or recovery changes.
