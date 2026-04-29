# Design

## Architecture

The local case implementation has four services:

1. Publisher Client signs in with anonymous Firebase Auth and writes a Firestore document.
2. Firebase Functions v2 reacts to new `generation_requests/{doc_id}` documents.
3. Config Service returns a per-user random LoRA config or `404`.
4. FastAPI Inference Server claims the job, generates the image, writes local output, and updates Firestore.

Firestore is the canonical job-state store. The local filesystem only stores image artifacts at
`outputs/{doc_id}.png`.

`docs/reviewer-console.html` is a static reviewer tool, not another backend service. It uses the
same anonymous Firebase Auth and Firestore create path as the Publisher, then listens to the request
document so reviewers can watch the state machine.

The default Docker run uses fake deterministic inference so the full pipeline can be verified
quickly. The real Docker override installs Diffusers with the CPU PyTorch wheel and runs the required
`SimianLuo/LCM_Dreamshaper_v7` model with `LCMScheduler`, `steps=4`, and `guidance_scale=8.0`.
The real inference server preloads the pipeline on startup and persists the Hugging Face cache on
disk so the first request does not spend the Cloud Function timeout budget downloading weights.
Tests also force fake deterministic PNGs.

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

The inference request is one of two shapes: no LoRA fields, or both `lora_url` and `lora_weight`.
Half-LoRA requests are rejected before job claiming.

## Failure Handling

Config lookup distinguishes permanent absence from temporary failure:

- `404`: valid no-config case, call inference without LoRA.
- timeout or `5xx`: retry briefly, then record `CONFIG_UNAVAILABLE`.

Inference failures update Firestore to `FAILED` with `error_code` and `error_message`.
If the process crashes mid-generation, the lease expires and scheduled recovery can reclaim it.
The local Docker stack runs the Pub/Sub emulator so the scheduled Firebase Functions v2 recovery
job is active during emulator demos.

## Scaling Path

The local path is intentionally synchronous:

`Publisher -> Firestore -> Function -> Inference -> Firestore + local outputs`

That is the simplest emulator-friendly implementation, but it is not the production scaling shape.
If 100 users submit at once, Functions wait on slow inference, workers saturate, config lookups add
latency, and retries can create extra load.

Production should add one boundary:

`Publisher -> Firestore -> Function -> Cloud Tasks/Pub/Sub -> workers -> Firestore + Cloud Storage`

Keep ownership simple:

- Firestore owns request state.
- The Function owns validation, config snapshotting, and enqueue.
- The queue owns delivery retries, backoff, dead-letter handling, and backlog visibility.
- Workers own bounded generation concurrency and output writes.

This keeps backpressure out of Firestore triggers and avoids making the synchronous local MVP carry
production concerns.

## Stuck PROCESSING Recovery

Each active job has `processing_owner`, `lease_expires_at`, `attempt_count`, and `updated_at`.
A scheduled recovery function queries expired leases. It requeues jobs below the attempt limit and
marks exhausted jobs `FAILED`. Recovery only reclaims a job if the lease is still expired inside the
transaction.

This also makes `/generate` safe to call more than once for the same `doc_id`. The endpoint uses the
document ID as the idempotency key. A transaction returns the existing result for `DONE`, rejects a
valid `PROCESSING` lease, claims `QUEUED`, and only reclaims `PROCESSING` after the lease expires.
This prevents duplicate output writes and double compute for normal retries.

## Per-User LoRA Serving at Scale

The local inference server downloads LoRAs into a local cache directory keyed by URL hash.
Production should store LoRAs in object storage with versioned or content-addressed paths. Workers
should load adapters on demand, use a bounded disk cache, evict by size and last access, and avoid
keeping thousands of 50-200 MB LoRAs in memory.

For thousands of unique LoRAs, the queued request should snapshot the exact LoRA URL and version.
Workers keep the base model warm, route by `user_id`, `lora_url`, or `model_family` for cache
locality when possible, and still allow any compatible worker to retry the job. Separate worker
pools are useful when model families or GPU shapes differ.

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
Local helper endpoints under `/v1/local/*` are disabled unless `ENABLE_LOCAL_ENDPOINTS=true`.
Security rules are covered by emulator tests for valid create, missing prompt, wrong user, invalid
initial status, update, and delete.

Cloud Function orchestration has focused tests for queueing, config `404`, config `5xx`, inference
`500`, unreachable inference, duplicate create delivery, stale requeue, and max-attempt failure.
Inference has an emulator-backed test for `QUEUED -> PROCESSING -> DONE`, local output creation, and
duplicate `/generate` idempotency.

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
