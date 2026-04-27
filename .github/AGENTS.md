# GitHub Workflow Guidance

This folder owns repository review and CI configuration.

## Rules

- Keep pull request checks focused on case correctness, not generic style polish.
- CI must use Node 20.
- CI must test the TypeScript services and Python inference server.
- PR templates must remind reviewers to request Codex review before merge.
- Do not store secrets or real API keys in GitHub workflow files.

## Review Priority

- Missing CI for build/test is P1.
- Missing Codex review reminder on pull requests is P1 for submission polish.
