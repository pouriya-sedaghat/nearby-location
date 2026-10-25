# Operations and troubleshooting

[Documentation index](../README.md)

## Service status

```bash
curl -i http://localhost:8080/health/live
curl -i http://localhost:8080/health/ready
sudo docker compose ps
sudo docker compose logs --tail=100 nearby
sudo docker compose logs --tail=100 postgres
```

Liveness does not access the database. Readiness executes a pool query and returns 503 on failure. The Compose application healthcheck runs every 10 seconds, with a five-second timeout, five retries, and a twenty-second start period. An unhealthy status alone does not trigger a Docker restart; restart policy concerns process exit.

## Logs

Application logs go to stdout/stderr. For direct execution, the process manager must collect them.

| Log text | Meaning |
| --- | --- |
| `Running database migrations...` | Container entrypoint started |
| `PostgreSQL connection attempt ... failed` | Probe failed; startup retry |
| `PostgreSQL connected` | Probe succeeded |
| `Nearby Location Service running on port ...` | HTTP listener opened |
| `Cleanup job removed ... stale location(s) in batches` | Old locations deleted |
| `Cleanup job failed` | Cleanup pass failed; searches still apply TTL filtering |
| `Readiness check failed` | Readiness query failed |
| `Received ... shutting down gracefully...` | Shutdown started |
| `Graceful shutdown failed:` | Shutdown failed; process exits with status 1 |
| `PostgreSQL pool closed` | Pool ended |

This version has no built-in structured logging format, metrics endpoint, or request ID. Monitor health responses and execution-manager logs.

## Troubleshooting reference

| Symptom | First checks | Action |
| --- | --- | --- |
| `Invalid environment configuration` | Required `DATABASE_URL`, variable name and field message | Match types, values, and pairing to [Configuration](CONFIGURATION.md) |
| Database connection failure | URL, DNS, port, and PostgreSQL logs | Verify access from the actual application host or container |
| `EADDRINUSE` or port bind failure | Existing listener and PORT | Choose a free port and update mapping together |
| `type "geography" does not exist` | Extension and migrations | Check PostGIS and migration privileges |
| `relation "locations" does not exist` | Target database and migration history | Run migrations against the application's database |
| Readiness succeeds but location requests fail | Table, extension, and SQL | Readiness is only `SELECT 1`; inspect controller logs and schema |
| Empty nearby results | Center, radius units, TTL, exclusion | Compare stored coordinates and timestamps with [API reference](API.md) |
| 400 | JSON syntax and fields | Distinguish parser errors from schema `errors` |
| 413 | Body size | Keep JSON below the 32 KiB parser limit |
| 415 | Content-Type, charset, encoding | Send JSON with a supported encoding |
| Swagger 404 | Swagger switch and environment | Enable it and recreate the process or container |
| Swagger 401 | Credential pair and Basic header | Check dedicated documentation credentials |
| Environment changes have no effect | Shell precedence and container environment | Check exported variables and recreate the container |
| Statement timeout | Load, radius, candidates, plan | Inspect test benchmark and query plans; see [Performance](PERFORMANCE.md) |
| Slow shutdown | Active requests or queries | Check execution-manager deadlines and timeouts |

## Data maintenance

TTL excludes old data from search. Cleanup performs physical deletion. PostgreSQL time controls freshness; one application-clock instant captured at each request's start controls `updateStatus` across that response. Age is recomputed on every request and never stored. Short units use elapsed time and month/year anniversaries use the UTC Gregorian calendar in both response languages, independent of the server timezone. Synchronize clocks for consistent display. Use the exact `updatedAt` timestamp for arithmetic; the age text is rounded display data. Cron scheduling follows the process timezone. The application owns and destroys its schedule during shutdown; active work drains before pool disposal.

Each replica has a pool bounded by `PG_POOL_MAX`. Include all replica pools, migration tools, and operational sessions when planning database connection capacity.

## Backups

Create a private custom-format backup outside the project directory:

```bash
umask 077
sudo docker compose exec -T postgres \
  pg_dump -U nearby -d nearby -Fc > ../nearby-backup.dump
```

This command does not modify database data. The dump contains location data and requires restricted access. Follow your retention policy and rehearse recovery on a test database with PostGIS.

Example recovery into a prepared test database; replace the URL with the test destination:

```bash
pg_restore --no-owner \
  --dbname='postgresql://restore_user:replace-password@127.0.0.1:55432/nearby_restore_test' \
  ../nearby-backup.dump
```

The target must have the objects and permissions needed for restoration. Do not restore or clean production data without a defined plan and a verified backup.

## Stopping the service

`docker compose stop nearby` stops only the application service. `docker compose down` removes the profile's containers and network, preserving data unless volume removal is requested. Do not remove volumes for an ordinary shutdown.
