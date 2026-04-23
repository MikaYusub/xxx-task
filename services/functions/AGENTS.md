# Functions Guidance

This folder owns Firebase Functions v2 behavior. Treat Firestore events as at-least-once delivery.

## Rules

- Keep Firestore as the source of truth for job state.
- Use transaction or compare-and-set semantics for status transitions.
- Do not call inference before the job is moved to `QUEUED`.
- Distinguish Config `404` from Config timeout or `5xx`.
- Do not cache temporary Config failures.
- Do not overwrite `DONE` or terminal `FAILED` jobs from duplicate triggers.
- Recovery may reclaim only expired processing leases.
- Any new retry behavior must define attempt budget and terminal failure behavior.

## Review Priorities

- Missing Functions v2 trigger behavior is P1.
- Non-transactional state transitions are P1.
- Vague or unsafe duplicate-delivery handling is P1.
- Config failures silently becoming no-LoRA is P1.
