# Deployment overlays, readiness and image rollback

Scope: operator host tooling and container health, not a new development phase.
Base reviewed: `cd18739`. Work is on `codex/deployment-overlay-healthcheck-fix`.
No production host, repository, database, lease, credential or Agent was accessed.
No commit, push, release or real deployment is performed by this task.
Infrastructure names below are synthetic; substitute privately reviewed values.

## 1. Confirmed causes and evidence

| Finding | Evidence and consequence |
| --- | --- |
| Overlays dropped | The previous `compose()` supplied only `-f compose.yml`. Deploy, stop, lookup and rollback therefore ignored installation-local mounts in `compose.lab.yml`. |
| Wrong readiness method | Both the previous source Dockerfile and base Compose used GNU Wget `--spider`, which sends HEAD. Existing `webAccess.machineRequest()` exempts **GET** `/api/health`, not HEAD. With a public canonical origin and no loopback browser origin, HEAD is correctly rejected with 403. New route tests and a real disposable application reproduce GET success/HEAD refusal. |
| Fragile second check | Installer readiness used Wget plus a substring match for `"status":"healthy"`, not bounded parsed JSON. It also waited for the independent Docker check, so a working GET endpoint could not rescue a failing HEAD healthcheck. |
| Stale host bundle | Pulling an image never copies host scripts out of it. The old installer copied files only when source and destination directories differed; running the already installed script did not update its code. |
| Environment template versus host drift | Reviewed main already forwarded all five supported origin/Agent/proxy variables. An older installed base Compose can still omit them. The explicit host-bundle upgrade installs the supported template without silently overwriting unknown local customizations. |
| Insufficient transaction checks | Previous `up` did not select only the application, verified neither image identity nor mount equality, and could misreport a failed SQLite copy as an absent database. Previous history could also retain a mutable tag rather than the actual prior digest. |

These are code/fixture-proven defects. They are not a claim that the historical
production failure had only one cause: no production logs, images or VM were
accessed. Invalid effective config, SQLite migrations, or an unrelated startup
failure can still prevent readiness and must remain failures.

## 2. Before and after

Before: base-only Compose → pull → stop/copy (copy errors ignored) → unscoped
`up` → HEAD Docker health → substring GET check → base-only rollback.

Now: validate approved digest → freeze the approved file stack and `.env` into a
private transaction workspace → validate effective Compose and recorded contract
→ identify current application/image and compare mounts → pull exact digest →
stop **only** `pluton` → copy stopped SQLite DB directory → update only image keys
→ `up -d --no-deps --force-recreate pluton` → Docker health **and** parsed GET
readiness → verify image ID, UID/GID and mounts → record success.

Failure after stopping/recreating preserves its safe category, restores the
previous actual immutable image using the same frozen stack, and verifies both
readiness and mounts. An unchanged healthy digest is an idempotent no-op.

## 3. Changed files

Runtime/readiness:

- `Dockerfile.source`, `.dockerignore`, `deploy/compose.yml`.
- `deploy/healthcheck.cjs`: shared source for image/installer and identical inline
  Compose probe, with a consistency regression test.

Host tools:

- `deploy/install.sh`, `deploy/deploy.sh`, `deploy/lib.sh`, `deploy/rollback.sh`.
- `deploy/status.sh`, `deploy/compose-tools.py`.
- `deploy/upgrade-host.sh`, `deploy/bundle-tools.py`, `deploy/.env.example`.
- `.gitattributes`, `.gitignore`: LF scripts and private local artifacts excluded.

Verification and runbook:

- `backend/__tests__/routes/health.test.ts`.
- `scripts/__tests__/deployment.test.cjs`,
  `scripts/__tests__/deployment_policy_test.py`.
- `scripts/validate-deployment.py`, `scripts/validate-deployment.ps1`,
  `scripts/fixtures/deployment-driver/Dockerfile` and its `.dockerignore`.
- `.github/workflows/container.yml`: real deployment/rollback acceptance gates
  publication; no publication permissions or release process are expanded.
- This report.
- `docs/DEPLOYMENT.md`, the two bundled deployment/rollback articles, and `readme.md`
  link: remove obsolete tag/automatic-key-generation instructions, with no UI refactor.

There is no application dependency, database migration, Agent update, enrollment,
API/wire protocol change, CSRF change or recovery architecture change.

## 4. Approved Compose overlays

One central invocation is used by deployment, stopped DB backup, lookup, status,
automatic rollback and explicit rollback:

1. `compose.yml`.
2. `compose.lab.yml` automatically, **if present**.
3. Basenames explicitly listed in operator-local `compose.overlays`, in order.

Example `compose.overlays` (enable only what the installation already uses):

```text
# Files reviewed and owned by the host operator; never selected through an API.
compose.mysql-recovery-worker.yml
compose.persistent-restore.yml
```

Only installation-local `compose.<lower-case-name>.yml`/`.yaml` basenames are
accepted. No traversal, shell execution, duplicate files, symlink files, or
group/world-writable operator files/directories. Files must belong to root or the
invoking operator. Presence under this protected directory is operator approval
of `compose.lab.yml`; content must be reviewed before placing it there.

There is no wildcard overlay discovery. Merely having an Internal DB, persistent
restore or worker Compose file does not activate it. The CLI always targets only
`pluton`, with `--no-deps`; optional workers/DB profiles must be provisioned and
started separately by the operator's existing procedure. Ambient shell settings
cannot override `.env`, add Compose files/profiles, or request orphan removal.

The approved ordered list and project/mount contract are recorded privately in
`.deploy-compose-files.json` and `.deploy-contract.json`. Removing/reordering a
previously used overlay, changing the project or replacing a mount fails closed.
There is no automatic contract-reset switch. Deliberate mount/project migration
requires a separate reviewed operator reconciliation, not deleting these guards
to get a deployment through. Do not edit referenced operator files mid-deployment.

## 5. Environment propagation and precedence

The supported base forwards `APP_URL`, `APP_ALLOWED_ORIGINS`, `AGENT_SERVER_URL`,
`ALLOW_INSECURE_AGENT_HTTP` and `TRUST_PROXY`. Example **operator-local** settings:

```dotenv
APP_URL=https://pluton.example.internal
APP_ALLOWED_ORIGINS=https://pluton.example.internal,http://192.0.2.10:5173
AGENT_SERVER_URL=http://192.0.2.10:5173
ALLOW_INSECURE_AGENT_HTTP=true
TRUST_PROXY=
```

**TRUST_PROXY is not necessary for fixed approved dual-origin web access.** Leave
it disabled for this deployment. Client-IP rate limiting behind a proxy is a
separate narrowly reviewed peer/firewall/header configuration, not `TRUST_PROXY=1`.

Single-origin installations may leave optional variables empty. HTTPS termination
and the private HTTP Agent upstream do not require adding loopback as a browser
origin. Keep HTTP Agent transport explicitly limited to its trusted network.

Application precedence still matters: persisted `/data/config/config.json` values
for `APP_URL`/`APP_ALLOWED_ORIGINS` override environment values. `AGENT_SERVER_URL`
is environment-only for new enrollment instructions; existing agents are not
rewritten. Inspect only these named non-secret keys locally when reconciling
configuration; do not print/copy the whole config, `.env`, Docker inspection or
expanded Compose output into logs, tickets or public reports. The tools suppress
raw CLI/config output and remove their private expanded transaction JSON at exit.
The host script does not rewrite application config or generate/rotate any key.

## 6. Readiness without weakening browser protection

The existing precise unauthenticated **GET** `/api/health` returns only
`{"status":"healthy"}` after a SQLite `SELECT 1`; startup listens only after
migrations, initialization and application construction. This is application
readiness, not availability of every optional external worker/database target.
`/api/health/details` stays authenticated and is not the loopback exemption.
Unknown web Hosts, cross-origin changes and forged forwarded headers still fail.

The probe requires HTTP 200, JSON content type, at most 1,024 response bytes, valid
JSON, and exactly one `status` field equal to `healthy`. It has an absolute
four-second deadline, follows no redirects and prints no sensitive response/error.
403, 404, 503, malformed HTML/JSON, oversized data, a crash or timeout cannot pass.

Docker uses this probe; the installer independently executes it inside the
identified running application. Both Docker `healthy` and the GET result are
required. Image/mount checks and actual UID/GID 10001 are also required before
success. Compose embeds identical JS so **older rollback images do not need a new
probe file**. The Dockerfile itself ships the probe for non-Compose use.

`PLUTON_HEALTH_ATTEMPTS` defaults to 60, accepts 1..300, with two seconds between
attempts and a bounded probe each time. Safe failure categories include
`health-http-status`, `health-invalid-response`, `health-connection-or-timeout`,
`application-not-ready`, `docker-health-not-ready` and `container-not-running`.
The supported container-internal port remains 5173.

## 7. Immutable image references

Actual install/deploy/rollback accepts only lower-case `sha256:` plus 64 hex
digits. Tags, including version tags, `main` and `latest`, are not immutable
references and are refused. The normal discovery pull of `:main` is allowed as
an **operator action**; take and approve its digest before passing it to install.

`PLUTON_IMAGE` is an explicit lower-case GHCR repository. The only additional
registry form is loopback `127.0.0.1:<port>/<repository>`, used for disposable
acceptance. Tests never publish to GHCR or pull the pilot's production images.

Before stopping the current service, its project/service labels, mounts and actual
image ID are checked. Rollback is the current container's corresponding repository
digest from local image metadata, not an unverified/mutable `.env` tag. If no
unambiguous prior digest is available, deployment refuses before stopping it.

## 8. A — ONE-TIME HOST SCRIPT UPGRADE

Merging source or pulling/publishing GHCR **does not update VM scripts**. Perform
this once in a scheduled operator window, from a separately reviewed source
checkout/artifact at an exact approved commit. Do not pipe a moving-branch remote
download into a shell. Verify the source/commit through the normal review channel;
a hash computed from an untrusted download does not authenticate it.

Host prerequisites: Docker Engine, Compose v2 with JSON config support, POSIX `sh`,
standard host utilities and Python **3.8+ stdlib**. No global Node replacement or
Python packages are needed. Retain the existing operator UID/access model.

1. Inventory existing approved Compose files and exact mount sources/targets/modes
   privately. Back up operator configuration using the site's protected backup
   process. Keep `.env`, config keys, state, overlays and `/data` intact.
2. Review `deploy/` from the exact approved checkout, not the installed old bundle.
   Ensure LF shell files, protected ownership and no group/world write access.
3. Review the base/template diff and optional overlay list (section 9 if customized).
4. Obtain/independently approve the exact bundle hash. Run locally:

```sh
sh /path/to/reviewed-checkout/deploy/upgrade-host.sh --print-digest
# Compare with the bundle from the independently approved source/commit.
sh /path/to/reviewed-checkout/deploy/upgrade-host.sh /opt/pluton \
  --approve-bundle sha256:<REVIEWED_BUNDLE_HASH>
```

The command checks the digest, shell syntax, complete effective Compose and current
mount contract **before replacement**. It refuses concurrent deployment/upgrade.
It recognizes the exact public uncustomized templates from `cf36856` and `cd18739`,
or the new template. All other base contents need explicit reconciliation.

Old files go to private `.bundle-backups/bundle-<id>/`, with an integrity manifest.
Files are replaced through same-directory atomic renames under a lock; a copy
exception restores the backup. No containers are stopped/recreated by the bundle
upgrade. `.env`, `.deploy-state`, local overlays, volumes and application config
remain unchanged; only local overlay/mount guard metadata is established.

Record the backup name and approval digest printed by the upgrade. Emergency
**script-only** rollback, again using the reviewed checkout, is:

```sh
sh /path/to/reviewed-checkout/deploy/upgrade-host.sh \
  --restore /opt/pluton bundle-<RECORDED_ID> \
  --approve-backup sha256:<RECORDED_BACKUP_HASH>
```

This does not recreate an image or replace SQLite. Restoring old tools also
restores their known overlay/HEAD defects: do not resume ordinary deployments
with them until the approved fix is reinstated. Keep the reviewed checkout.

## 9. Customized base Compose reconciliation

Do not overwrite an unknown `compose.yml`. The upgrade intentionally refuses it.
Review the static base diff **locally**. Move legitimate installation-specific
settings into the approved `compose.lab.yml` or explicit overlays, preserving all
mount sources, destinations, volume names, modes and any already configured IPC.
Do not replace the current `.env` with the example or reset the volume name.

After reviewing the complete reconciliation, independently approve the old base
file's SHA-256 and use:

```sh
sha256sum /opt/pluton/compose.yml
sh /path/to/reviewed-checkout/deploy/upgrade-host.sh /opt/pluton \
  --approve-bundle sha256:<REVIEWED_BUNDLE_HASH> \
  --accept-existing-compose sha256:<REVIEWED_OLD_BASE_HASH>
```

The extra approval does **not** waive image, health or mount safety. A candidate
that drops an existing mount still fails even with the correct custom-file hash.
The full previous base is retained in the protected backup. If reconciliation
cannot preserve the current contract, stop for a separate migration review.

## 10. B — NORMAL FUTURE IMAGE DEPLOYMENT

Only after the one-time approved bundle upgrade:

```sh
cd /opt/pluton
docker pull ghcr.io/<fork-owner>/pluton:main
# Review the pull result; approve the immutable digest, never pass :main to install.
sh ./install.sh sha256:<APPROVED_DIGEST>
sh ./status.sh
docker ps
curl -i http://127.0.0.1:5173/api/health
```

Do not run another `docker compose ... up -d` afterward: the approved local overlay
stack was already applied and verified. Inspect the sanitized exit/outcome first.
`install.sh` invoked inside the installed directory delegates to deploy. Invoking
a checkout's installer against an existing directory refuses to overwrite it and
directs the operator to the explicit bundle upgrade instead.

For a genuinely **new** directory, the source installer copies the bundle and
example, stops without starting Pluton, and asks for offline local configuration.
It never generates keys. A reused data volume always requires its original keys,
not new-install credentials. Do not use this path for an existing deployment.

## 11. Automatic and explicit image rollback

Automatic rollback after a failed changed image uses the previous actual immutable
reference and the same frozen approved stack. It uses `--no-deps`, stops no other
service, and does not remove orphans. Success means running, Docker healthy, valid
GET readiness, correct image, UID/GID and identical mounts, not merely 'started'.
The original failure category and `ROLLBACK=healthy|failed|not-available` are stored
in private `.deploy-result`; the failed deployment exits nonzero even when rollback
succeeds. `.deploy-state` records only successful image history.

An operator can request the previous successful image through:

```sh
cd /opt/pluton
sh ./rollback.sh
sh ./status.sh
```

Neither path restores older SQLite, deletes migrations/ownership records/leases,
rekeys repositories, reenrolls agents or performs Restic maintenance. A stopped
SQLite backup is retained for separately reviewed recovery. A new image's schema
may not be compatible with an old application; rollback health can therefore fail
honestly. Do not delete tables or overwrite the DB to force a green result.

## 12. Mount and volume validation

The effective Compose contract is compared with the real current and final
container: project/service identity, every named volume/bind target, source/name,
read-only flag and bind propagation. `/data` must remain a writable **named**
volume; anonymous/subpath volumes and missing bind sources are refused. Image
overrides, root/privileged runtime, missing sandbox settings or a direct engine
socket mount are refused. Referenced operator content remains a trusted host
administration boundary, never browser input.

The checks cover all actual installation mounts, not a hardcoded pilot inventory.
Use `create_host_path: false` in reviewed bind declarations to avoid accidental
empty directories; the preflight also rejects missing sources. Do not run chmod,
chown, ACL changes or create missing repository/source paths merely to pass.

SQLite copies are made only after `pluton` is confirmed stopped, copying the DB
directory with any WAL/SHM, into private unique `backups/` directories. Copy failure
is fatal and attempts image rollback; it is never silently treated as 'no DB'.
No `compose down -v`, volume recreation, automatic SQLite restore or repository
mutation exists in these helpers.

## 13. Verification results

Local checks performed for this task (overlapping suites are listed separately,
not summed into a fabricated total):

| Check | Result |
| --- | --- |
| Backend full Jest suite | 164 suites passed; 3,201 tests passed, 4 skipped, 0 failed |
| Linux Agent full suite | 120 passed, 0 skipped/failed |
| Linux focused Recovery/Persistent Restore backend suites | 12 suites; 307 passed, 1 skipped, 0 failed |
| Script JS suite, including deployment/probe tests | 61 passed, including 15 new probe/deployment tests |
| Frontend utility/component suite | 95 passed, 0 failed |
| Linux policy/real Compose parser tests | 21 passed, 0 failed |
| Real disposable deployment/rollback simulation | 17 scenarios passed; actual single-argument install, deploy, status, rollback and bundle helpers; fixture containers/networks/test volumes removed |
| Compiled HTTPS/LAN session + restore/recovery preparation | Passed, UID 10001, trust proxy disabled |
| Phase 5/6 real SFTP/Restic/DB/restore fixture | All 5 modes passed, including expected DB-auth failure/cleanup; exact SQL-only staging tested |
| Genuine Oracle MySQL worker/server regression | All 12 disposable TLS/import/failure/cancel/restart scenarios passed |
| Phase 7 real isolated HTTP/HMAC/SMTP/restart/TLS | Passed |
| Backend/frontend/Agent typecheck; backend lint | Passed |
| POSIX shell syntax and ShellCheck (shared-library resolution) | All 6 scripts passed; no ShellCheck warnings |
| Workspace production build | Passed (3 tasks, 0 cache hits on final run; docs 12 + Fumadocs 8 tests also passed) |
| Source Docker image build | Passed; MariaDB 11.8.8 / PostgreSQL 18.6 runtime client check under UID 10001 |
| Whitespace/inventory review | `git diff --check` and all 28 changed-file whitespace checks passed; no pilot identifiers introduced |
| Frontend lint | **Existing baseline failure**: ESLint 10/typescript-eslint rejects string `extends: eslint-config-prettier`; no frontend lint/config file changed |

Reproducible Linux checks (all use disposable data):

```sh
node --test scripts/__tests__/deployment.test.cjs
python3 scripts/__tests__/deployment_policy_test.py
for script in deploy/*.sh; do sh -n "$script"; done
docker build -f Dockerfile.source -t pluton-deploy-hardening:local .
python3 scripts/validate-deployment.py pluton-deploy-hardening:local
```

The last command runs the actual `install.sh`, `deploy.sh`, `status.sh`,
`rollback.sh` and bundle upgrade/restore helpers against a real Pluton/SQLite
image, immutable digests in a disposable daemon-loopback registry, and randomized
local volumes/mounts. A deliberately unhealthy image writes a new SQLite marker
before failing; automatic rollback must preserve it. No production image/digest
is used. It also tests an old exact public base, script absence, custom-base hash
refusal/reconciliation, unrelated services, optional profiles, bad/missing overlays
and no secret output. JS tests cover false-positive health/error responses.

On Windows, build the driver and run `scripts/validate-deployment.ps1` only with
explicit permission for its temporary local Docker socket access. The driver is
read-only/capability-dropped with private scratch space. Only the disposable
registry uses daemon-host networking, bound to 127.0.0.1; Pluton has neither host
network nor socket/privilege. Fixture bind paths under the driver's Docker volume
explicitly declare Docker's enforced `rslave`; production propagation checks were
not relaxed to make this pass. Random test containers, networks and volumes are
removed; no global Docker cleanup/prune occurs.
Locally built source/driver images remain available as reproducible build artifacts.

## 14. Production acceptance checklist (operator, not performed here)

- Schedule a change window; pause new work through the normal approved operational
  process and confirm no active backup/recovery/import is being interrupted.
- Preserve SECRET/ENCRYPTION_KEY, keys/config, `.env`, SQLite, leases, named volume,
  source/repository mounts, image history and approved overlays. Verify backups
  without displaying credential contents.
- Complete **A: one-time host script upgrade** and reconcile any custom base.
- Confirm configured versus persisted origin settings privately, both public and
  private allowed origins, correct private Agent URL, and trust proxy still off.
- Record the previous immutable image and complete mount contract privately.
- Perform **B: normal immutable image deployment**; require exit 0 and `status.sh`.
- Check loopback GET health and Docker health; both must pass without adding a
  loopback browser origin. Confirm all pre-existing mounts/volume/modes unchanged.
- Check public HTTPS and permitted private HTTP login, browser restore preparation,
  and existing Agent online/identity/allowed roots without reenrollment.
- Validate a separately approved ordinary backup and staged/recovery operation
  against the existing plans; no source overwrite or production DB import.
- If failed, read only safe `.deploy-result`; confirm the automatic rollback's
  verified status. If not healthy, stop for investigation, preserve DB backups and
  durable records; do not repeatedly deploy or restore old SQLite automatically.

## 15. Remaining risks and boundaries

- No end-to-end production acceptance is claimed from local tests. WAF, host
  inventory, ACLs, external storage and operator-customized settings remain local
  infrastructure responsibilities.
- Host Python 3.8+, Compose v2 and the reviewed bundle are explicit prerequisites.
  Digest-only deploy replaces the old tag-accepting interface intentionally.
- This is an image transaction, not a transactional filesystem/database downgrade.
  Disk exhaustion, SIGKILL/power loss or concurrent external admin changes require
  manual investigation. A leftover `.deployment-lock` is not auto-deleted; first
  verify no deployment/upgrade process is alive. Never delete guard/history files
  or restore a SQLite copy as an automatic retry step.
- DB backups contain sensitive state and remain private operator-managed files;
  establish a protected retention policy separately. The task does not delete them.
- Optional worker/DB services are deliberately not restarted automatically. Review
  their version compatibility and controlled update procedures separately.
- Legacy read-only constraints, managed repositories/snapshots, Phase 5 dump
  semantics, Phase 6 imports/restores, Phase 7 outbox and Agent identity/protocol
  are unchanged. No global Node upgrade, secret rotation or backup cutover occurs.
