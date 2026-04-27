## Summary

- 

## Requirement Coverage

- [ ] Publisher Client uses anonymous Firebase Auth.
- [ ] Firestore remains the canonical job-state store.
- [ ] Client create shape stays exactly `user_id`, `prompt`, `status: "CREATED"`.
- [ ] Cloud Function uses Firebase Functions v2 and sets `QUEUED` before inference.
- [ ] Config `404` is handled separately from timeout or `5xx`.
- [ ] Inference requires bearer auth, uses safe retries, and writes `outputs/{doc_id}.png`.
- [ ] README, DESIGN, and PLAN are consistent with the code.

## Verification

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `python -m pytest` in `services/inference-server`
- [ ] `docker compose build`

## Codex Review

- [ ] Codex review requested before merge.

If automatic Codex review is not enabled for this repository, comment on the PR:

```text
@codex review
```
