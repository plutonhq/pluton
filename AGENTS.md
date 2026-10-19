# Instructions for coding agents

These instructions apply to the entire public fork of `plutonhq/pluton`.

## Public repository and attribution

- Never commit secrets: passwords, API tokens, SSH/private keys, Restic passwords,
  SMTP/database credentials, credential files, or decrypted application data.
  Do not include them in fixtures, screenshots, logs, documentation, or PR text.
- Never introduce real production identifiers or inventories, including actual
  IP addresses, internal hostnames, organization domains, or account usernames.
  Use synthetic infrastructure fixtures such as `app-01`, `192.0.2.10`,
  `example.internal`, and `/srv/example-app`. Sanitize command output before
  sharing it publicly.
- Keep local configuration and generated backup/restore data out of Git. Review
  both tracked and untracked changes before committing; `.gitignore` does not
  protect files already tracked or replace a review for sensitive content.
- Preserve upstream Apache-2.0 licensing, attribution, copyright notices, and
  acknowledgments. Do not rename the application or imply upstream endorsement.
- Never use, copy, reverse engineer, reproduce, or depend on proprietary Pluton
  PRO/Business source code or binaries. Implement extensions independently using
  this open-source codebase, public Restic/Rclone interfaces, and independently
  written code. Public extension hooks do not authorize using proprietary code.

## Workflow and validation

- Work on a feature branch (normally `codex/<task>`), not directly on `main`.
- Inspect the relevant code and summarize findings before modifying it. Follow
  existing conventions and keep changes focused on the requested phase.
- Add tests for every new backend behavior, including error paths and permission
  boundaries. Use generic fixtures and disposable test data, never production
  repositories or infrastructure. Do not weaken existing tests to obtain a pass.
- Use the pnpm version pinned in `package.json` and the existing lockfile. Add
  dependencies only when required for the task.
- Run the relevant checks documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
  Report commands, results, and environment limitations accurately. Do not start
  the application against real data merely to validate documentation changes.
- Preserve the existing `.env.template` convention. Example files must contain
  placeholders only; do not add settings for features that do not exist yet.

## Restic operation boundaries

- Treat imported/legacy Restic repositories as read-only by default. Initial
  adoption must not initialize, migrate, re-key, tag, copy into, or back up to them.
- Clearly separate repository inspection operations from repository mutation
  operations in APIs, services, command builders, jobs, tests, and documentation.
  A future legacy adapter must enforce an operation allowlist on the backend;
  hiding controls in the frontend is insufficient.
- Never automatically run `restic forget`, `restic prune`, or `restic unlock`
  against a legacy repository. Initial adoption has no retention, prune, unlock,
  repair, or other repository mutation path, even as error recovery.
- Account for lock files: an operation that reads snapshot data can still write
  repository locks. Validate supported `--no-lock` behavior and read-only storage
  access before allowing a legacy operation. Fail safely if the contract cannot
  be met; never fall back to write credentials or automatic unlock.
- Avoid destructive restore behavior by default. Require an explicitly selected,
  validated staging directory; reject in-place restore, path escape, overlap with
  the repository/live source, and overwrite/delete behavior during initial
  adoption. Restoring writes destination files even when the repository is read-only.
- Keep imported repositories separate from managed backup plans and their
  initialization, scheduler, retention, replication, and recovery hooks. Never
  route legacy access through a managed lifecycle just to reuse its UI.
- Changes to managed backup behavior require a separate, explicitly scoped task
  and appropriate regression tests. Preserve existing retention behavior during
  repository preparation and legacy design work.

## Phase boundaries

[docs/ROADMAP.md](docs/ROADMAP.md) records planned work, not delivered features.
Phase 0 is documentation and guardrails only: no runtime changes, Restic repository
writes, or implementation of later phases. The legacy design in
[docs/LEGACY_REPOSITORY_DESIGN.md](docs/LEGACY_REPOSITORY_DESIGN.md) is a proposal;
implement only the phase requested in a subsequent task.
