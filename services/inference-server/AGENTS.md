# Inference Guidance

This folder owns `/generate`, image output, LoRA caching, and Firestore processing leases.

## Rules

- Require `Authorization: Bearer <API_KEY>` for `/generate`.
- Claim work with Firestore transaction semantics.
- Use `processing_owner` and `lease_expires_at` before starting generation.
- If `DONE` and `outputs/{doc_id}.png` exists, return the existing result.
- If `PROCESSING` has a valid lease, do not start duplicate work.
- If a lease is expired, reclaim only through the controlled claim path.
- Write output through a temp file and atomic replace.
- Validate LoRA host and `lora_weight`.
- Keep fake inference deterministic for tests.
- Keep real inference compatible with the required model and scheduler.

## Review Priorities

- Missing bearer auth is P1.
- Duplicate generation under valid lease is P1.
- Non-atomic output writes are P1.
- Real inference drifting from required model settings is P1.
