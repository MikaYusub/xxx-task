# Repository Guidance

This repository is a take-home backend case. The case requirements are the source of truth.
When requirements and implementation preferences conflict, satisfy the case first and document the
trade-off clearly.

## Project Shape

- `services/publisher`: anonymous Firebase Auth Publisher Client.
- `services/functions`: Firebase Functions v2 Firestore triggers and recovery jobs.
- `services/config-service`: TypeScript REST Config Service.
- `services/inference-server`: Python FastAPI Inference Server.
- `README.md`: setup instructions and API documentation.
- `DESIGN.md`: architecture, trade-offs, scaling, retries, recovery, and deployment notes.
- `PLAN.md`: current compact implementation plan.
- `PLANS.md`: execution plans for non-trivial future changes.

## Required Case Invariants

- Firestore is the canonical source of truth for generation request state.
- Firebase Auth, Firestore, and Functions emulators must remain supported locally.
- Publisher Client must use anonymous Firebase Auth.
- Client-created Firestore documents must keep the exact shape:
  `{ "user_id": uid, "prompt": prompt, "status": "CREATED" }`.
- Clients must not update or delete generation request documents.
- Cloud Functions must use Firebase Functions v2.
- The create trigger must run on `generation_requests/{document_id}`.
- The Cloud Function must set `QUEUED` before calling inference.
- Config `404` means no LoRA; timeout and `5xx` are dependency failures.
- Inference must require `Authorization: Bearer <API_KEY>`.
- Inference must set `PROCESSING`, save `outputs/{doc_id}.png`, and set `DONE` or `FAILED`.
- Real inference must use `SimianLuo/LCM_Dreamshaper_v7` with `LCMScheduler`, `steps=4`,
  and `guidance_scale=8.0`.

## Engineering Rules

- Keep code simple, typed, and skimmable.
- Prefer narrow required parameters over optional arguments.
- Use discriminated unions for meaningful multi-state logic.
- Treat Firestore triggers as at-least-once delivery.
- Make status transitions explicit and transaction-safe.
- Make retries idempotent before adding retry behavior.
- Do not silently weaken failure semantics to make tests pass.
- Avoid defensive fallback code when types or validated data already define the state.
- Use asserts when loading required configuration.
- Keep local MVP and production redesign clearly separated in docs and code comments.

## Planning Rules

- For any architecture change, new service, non-trivial refactor, retry semantics change, state-machine
  change, or documentation restructuring, first write or update an ExecPlan in `PLANS.md`.
- Small bug fixes and test-only edits do not need a new ExecPlan unless they change behavior.
- Plans must name the affected requirements, state transitions, failure modes, and docs to update.

## Documentation Rules

- Every behavior change must keep `README.md`, `DESIGN.md`, and `PLAN.md` consistent.
- `README.md` explains how to run and call the system locally.
- `DESIGN.md` explains why the system behaves that way and how production would differ.
- Avoid vague architecture prose. Name the mechanism: transaction, lease, queue, cache, retry budget,
  dead-letter queue, object storage, or emulator.
- Missing assignment requirement coverage is a P1 issue.
- Vague retry or idempotency semantics are a P1 issue.
- README/DESIGN/PLAN inconsistencies are a P1 issue.
- Undocumented trade-offs that affect submission quality are a P1 issue.

## Run And Test Commands

Use Node 20 or Docker. Host Node 16 is not supported for this repo.

```bash
npm install
npm run build
npm test
```

Python inference checks:

```bash
cd services/inference-server
python -m pip install -r requirements.txt
python -m pytest
```

Firebase rules/emulator smoke check:

```bash
npx firebase emulators:exec --project demo-local --only firestore "echo firestore emulator ok"
```

Docker local run:

```bash
cp .env.example .env
docker compose up --build
```

## Definition Of Done

- Case requirements touched by the change are explicitly satisfied.
- State transitions are valid and documented.
- Retry and duplicate-delivery behavior is safe.
- README, DESIGN, and PLAN remain consistent.
- Focused tests or a clear verification note are included.
- Ignored local files such as `.env`, emulator logs, caches, and generated outputs are not staged.
