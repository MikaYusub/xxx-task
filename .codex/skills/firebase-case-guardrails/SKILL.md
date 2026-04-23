# firebase-case-guardrails

Use this skill when touching Firestore rules, Firebase Functions, or the Publisher Client.

## Checklist

- Publisher uses anonymous Firebase Auth.
- Client create shape is exactly `user_id`, `prompt`, and `status: "CREATED"`.
- Firestore rules reject missing prompt, wrong `user_id`, non-`CREATED` status, unauthenticated writes,
  client updates, and client deletes.
- Firebase Functions use v2 APIs.
- Create trigger is on `generation_requests/{document_id}`.
- Cloud Function sets `QUEUED` before inference.
- Firestore remains the source of truth.
- Duplicate trigger delivery is safe.

## Output

Return requirement coverage gaps first. Treat any broken case invariant as P1.
