# Codeway Barcelona Backend Case Plan

See `DESIGN.md` for the implemented architecture and production scaling notes. The implementation
follows the agreed plan: Firestore is canonical, Firebase emulators are required locally, and the
four case components are implemented separately. The Docker demo path runs the real required model;
local recovery runs with the Pub/Sub emulator; Firestore rules, Cloud Function orchestration,
recovery, LoRA request validation, and inference idempotency are covered by focused tests.
