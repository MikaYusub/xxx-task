# takehome-architecture-review

Use this skill when editing `PLAN.md`, `DESIGN.md`, `PLANS.md`, or architecture-related code.

## Checklist

- Confirm the case requirements remain the source of truth.
- Confirm local MVP and production redesign are separated.
- Confirm Firestore is canonical job state.
- Confirm the state machine is explicit.
- Confirm retries and duplicate delivery are idempotent.
- Confirm stuck `PROCESSING` recovery uses leases or equivalent ownership.
- Confirm Config `404`, timeout, and `5xx` semantics are distinct.
- Confirm 10x to 100x scaling mentions queueing, bounded concurrency, backpressure, retries,
  dead-letter handling, monitoring, and fairness where relevant.
- Confirm security and observability are concrete.

## Output

Return blocking findings first. Treat vague retry/idempotency semantics, missing scaling reasoning,
and README/DESIGN inconsistencies as P1.
