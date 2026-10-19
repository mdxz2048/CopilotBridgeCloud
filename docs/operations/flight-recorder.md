# Five-minute diagnostic flight recorder

The API records authenticated `/v1/responses` traffic for every user in a bounded, encrypted RAM ring. This is diagnostic capture of traffic already passing through Cloud, not a second agent executor. It does not capture local-only desktop activity or replay commands.

Each request preserves its tool inventory separately from conversation text, plus the prepared canonical request, native upstream events, final response and failure markers. Existing signed desktop failure uploads also freeze a snapshot, even when the upstream HTTP request completed. Request, response and trace aliases associate feedback with the affected request. A DeepSeek tool-name audit records declared names and candidate bindings without changing tool execution.

Snapshots freeze the user's preceding five minutes across conversations. Active request declarations/context may be older than the window and are retained as anchors. Embedded history is the context sent with that request. Newly enabled recording cannot recover earlier traffic. Recognized credentials and binary attachments are omitted; conversation text can still contain private material.

## Bounds and persistence

- RAM: 8 MiB encrypted/compressed per user, 32 MiB total, 1,024 request records.
- Individual serialized record: 16 MiB before compression. Tool inventories have priority during eviction.
- Pending snapshot payloads: 32 MiB total.
- Disk: encrypted AES-256-GCM frames and manifest under `RELEASE_STORAGE_DIR/flight-recorder` (or `FLIGHT_RECORDER_DIR`). Existing `PROVIDER_MASTER_KEY` protects records; preserve that key to read retained snapshots.
- Retention: 24 hours, latest three snapshots per user, at most 20 snapshots and 128 MiB globally. Cleanup runs on startup, after writes and every minute.
- RAM is volatile. Startup, capacity eviction, oversized records, missing request associations and queue limits are recorded in manifest gaps. `failedWrites` exposes persistence failures. Recorder errors do not fail the model request.

Default: enabled outside tests. Set `FLIGHT_RECORDER_ENABLED=false` to disable; test environments require explicit `true`. No schema migration or client upgrade is required.

## Administrator access

- `GET /api/v1/admin/diagnostics/flight-snapshots?userId=<uuid>`: status and manifests.
- `GET /api/v1/admin/diagnostics/flight-snapshots/<id>`: one manifest.
- `GET /api/v1/admin/diagnostics/flight-snapshots/<id>/download`: streamed NDJSON, no-store, attachment disposition. Requires existing administrator authentication and writes `FLIGHT_SNAPSHOT_DOWNLOADED` to the audit log.

Existing failure feedback metadata includes a matching `snapshotId`; the admin feedback list/detail links to the download. Snapshots can exist without a client report (server-side detection); inspect the snapshot list endpoint in that case. Feedback deletion and snapshot expiry have independent retention policies.

## Validation

Core tests cover encryption, user isolation, five-minute boundaries, large inventories/text, capacity gaps, deduplication, restart recovery, expiration and unavailable disk. Fastify tests cover server error capture, completed HTTP plus client failure, protected exports and filtering. The isolated PostgreSQL integration test exercises actual signed gateway failure, signed client feedback, admin association/download, ordinary-user rejection and persisted export audit without requesting a provider or billing usage.

This recorder supplies evidence for tool-binding diagnosis. It does not itself fix or safely substitute `exec_command` for a custom `functions.exec` wrapper.
