# Database reference

[Documentation index](README.md)

The initial [migration](../migrations/1706300000000_init.js) remains unchanged. It defines `locations`, its unique user identifier, `geography(Point,4326)` coordinate, creation/update timestamps and spatial/cleanup indexes.

Read [Architecture](ARCHITECTURE.md) for current spatial SQL, ranking and pagination, [Privacy and retention](PRIVACY_AND_RETENTION.md) for eligibility/deletion semantics, [Configuration](CONFIGURATION.md) for pool/TLS settings and [Backup and restore](runbooks/BACKUP_RESTORE.md) for recovery obligations. Do not roll back the initial migration to roll back an application image.
