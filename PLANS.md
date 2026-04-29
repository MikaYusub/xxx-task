# Execution Plans

Use this file for non-trivial future changes. Each ExecPlan should be short, concrete, and updated
before code changes begin.

## ExecPlan Template

### Title

### Requirement Link

Name the assignment requirement or repository invariant affected by the change.

### Goal

State the behavior that will be true after the change.

### Local MVP Scope

List what will actually be implemented in this repository.

### Production Design Notes

Separate production redesign from local MVP work. Mention queues, object storage, distributed cache,
or worker pools only when they are not part of the local implementation.

### State And Failure Semantics

Name valid status transitions, invalid transitions, retry behavior, idempotency behavior, and stuck-job
recovery behavior.

### Documentation Updates

Name the exact README, DESIGN, or PLAN sections that must change.

### Verification

List build, tests, emulator checks, or manual checks required before the work is done.

## Active Plans

No active ExecPlan. The current implementation follows `PLAN.md`.

## Completed Plans

### Static Reviewer Console

### Requirement Link

Firebase Auth, Firestore emulator support, exact client-created document shape, Config `404` as
no-LoRA, and documented local verification.

### Goal

Give reviewers a small browser UI that exercises the same local path as the Publisher and makes the
state transitions visible.

### Local MVP Scope

Add `docs/reviewer-console.html`. It signs in anonymously, optionally seeds local LoRA config, writes
`generation_requests/{doc_id}`, and listens to the document.

### Production Design Notes

This is not a production frontend. Production still uses the queue and worker shape described in
`DESIGN.md`.

### State And Failure Semantics

The console only creates `{ user_id, prompt, status: "CREATED" }`. Server components still own
`CREATED -> QUEUED -> PROCESSING -> DONE | FAILED`, duplicate handling, leases, and recovery.

### Documentation Updates

`README.md`, `DESIGN.md`, and `PLAN.md` mention the console and keep the local MVP separate from the
production scaling path.

### Verification

Run Config Service tests for the local seed CORS path, then run the normal build/test suite.
