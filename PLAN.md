# Codeway Barcelona Backend Case Plan

See `DESIGN.md` for the implemented architecture and production scaling notes. The implementation
follows the agreed plan: Firestore is canonical, Firebase emulators are required locally, and the
four case components are implemented separately. The default Docker demo path runs fast fake
inference; the real Docker override runs the required CPU model. Local recovery runs with the Pub/Sub
emulator; Firestore rules, Cloud Function orchestration, recovery, LoRA request validation, and
inference idempotency are covered by focused tests. Local helper endpoints are explicitly gated by
`ENABLE_LOCAL_ENDPOINTS`. `docs/reviewer-console.html` is the small reviewer-facing smoke-test UI
for the same anonymous Auth and Firestore create path.
