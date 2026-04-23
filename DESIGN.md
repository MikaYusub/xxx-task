# Design

## Architecture

The local case implementation has four services:

1. Publisher Client signs in with anonymous Firebase Auth and writes a Firestore document.
2. Firebase Functions v2 reacts to new `generation_requests/{doc_id}` documents.
3. Config Service returns a per-user random LoRA config or `404`.
4. FastAPI Inference Server claims the job, generates the image, writes local output, and updates Firestore.

Firestore is the canonical job-state store. The local filesystem only stores image artifacts at
`outputs/{doc_id}.png`.

## State and Idempotency

Valid status flow:

`CREATED -> QUEUED -> PROCESSING -> DONE | FAILED`

The recovery path may move stale `PROCESSING -> QUEUED` when the processing lease expires.
All correctness-sensitive transitions use Firestore transactions. The inference server claims work
with `processing_owner` and `lease_expires_at`, so duplicate delivery does not start duplicate work.

Duplicate `/generate` behavior:

- `DONE` with an existing output returns the existing PNG.
- `PROCESSING` with a valid lease returns conflict and does not start work.
- expired `PROCESSING` may be reclaimed in a transaction.
- `FAILED` is not restarted unless recovery explicitly requeues it.

## Failure Handling

Config lookup distinguishes permanent absence from temporary failure:

- `404`: valid no-config case, call inference without LoRA.
- timeout or `5xx`: retry briefly, then record `CONFIG_UNAVAILABLE`.

Inference failures update Firestore to `FAILED` with `error_code` and `error_message`.
If the process crashes mid-generation, the lease expires and scheduled recovery can reclaim it.

## Scaling Answers

The local synchronous Function-to-inference call matches the case and is easy to run in emulators.
It does not scale because slow CPU inference keeps Function instances open, concurrent requests can
overload the inference server, and retries amplify load.

For 10x to 100x production traffic, the Cloud Function should enqueue jobs into Cloud Tasks or
Pub/Sub instead of calling inference directly. Workers should consume with bounded concurrency,
exponential backoff, dead-letter handling, queue depth monitoring, and optional per-user rate limits.
Backpressure belongs at the queue and worker pool, not inside Firestore triggers.

## Stuck PROCESSING Recovery

Each active job has `processing_owner`, `lease_expires_at`, `attempt_count`, and `updated_at`.
A scheduled recovery function queries expired leases. It requeues jobs below the attempt limit and
marks exhausted jobs `FAILED`. Recovery only reclaims a job if the lease is still expired inside the
transaction.

## Per-User LoRA Serving at Scale

The local inference server downloads LoRAs into a local cache directory keyed by URL hash.
Production should store LoRAs in object storage with versioned or content-addressed paths. Workers
should load adapters on demand, use a bounded disk cache, evict by size and last access, and avoid
keeping thousands of 50-200 MB LoRAs in memory.

## Cost and Latency Drivers

The largest costs are inference compute, LoRA download time, and repeated config lookups.
The local MVP uses an instance-local TTL config cache and local LoRA disk cache. Production should
use Memorystore/Redis or version-aware config records for shared caching and Cloud Storage/CDN for
artifact delivery.

## Security

Firestore rules let users create and read only their own jobs. Clients cannot update or delete
generation documents. The inference API requires `Authorization: Bearer <API_KEY>`. Production
stores secrets in Secret Manager and uses least-privilege service accounts.

LoRA URLs are restricted to trusted hosts. Prompt and `lora_weight` are validated before processing.

## Deployment

Production target:

- Firestore Native Mode for job state.
- Firebase Auth for users.
- Firebase Functions v2/Eventarc for ingestion and recovery.
- Config Service on Cloud Run.
- Inference workers on Cloud Run for simple compute or GKE for specialized GPU scheduling.
- Cloud Tasks or Pub/Sub for async dispatch.
- Cloud Storage for outputs and LoRA artifacts.
- Secret Manager for API keys.
- Memorystore/Redis if shared low-latency caching is needed.
- Cloud Logging and Monitoring for latency, queue lag, retries, failures, and stale recoveries.
