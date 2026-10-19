# Optional Oracle MySQL Recovery Worker — Phase 6

## Scope and baseline

Implemented on `codex/mysql-recovery-worker` from reviewed main `091ad70`. No commit,
push, merge, release, deployment, production access, secret rotation, enrollment,
repository maintenance, or production database operation was performed.

The Alpine server keeps MariaDB 11.8.8 and PostgreSQL 18.6 imports unchanged. Its
`mysql` alias is still identified as MariaDB and **not** accepted as Oracle MySQL.
Phase 5 dump clients, the Agent protocol, managed/legacy repository boundaries,
Phase 7 outbox, SQLite schema and existing encrypted credentials are unchanged.

The previous architecture required local import executables. Oracle's glibc Debian
client cannot be substituted with Alpine's MariaDB alias. An isolated client-only
Debian worker avoids adding a database server, compatibility shim or Docker control
capability to Pluton.

## Implemented architecture

| Component | Responsibility / boundary |
| --- | --- |
| Existing `RecoveryTestService` | Durable job claim, exact backup/repository/snapshot binding, staging-only restore, artifact size/SHA-256 validation, cancellation, result persistence and cleanup reconciliation. |
| `WorkerRecoveryDatabaseImporter` | Routes **only MySQL** to optional IPC. Calls the original importer for MariaDB/PostgreSQL. No backup execution path changes. |
| `MysqlRecoveryWorkerClient` | Sends one authorized SQL artifact plus dedicated target credentials over a fixed Unix socket. Persists the existing cleanup lease in SQLite before acknowledging CREATE. No import retries. |
| Oracle worker | Revalidates the streamed size/hash, approved endpoint/account/database allowlist, native client, verified TLS, dedicated guard marker, non-admin grants and database absence. Reuses the existing importer, including catalog validation and owner-token cleanup. |
| Existing lease reconciliation | Only confirmed cleanup removes a server lease. Lost connections/restarts retain the lease. Subsequent cleanup verifies the database owner token; never drop an unowned/pre-existing database. |

Sequence: exact snapshot restore → server SQL integrity validation → private IPC
upload → worker SQL integrity validation → target/privilege checks → server durable
lease ACK → create disposable database + ownership marker → native import → catalog
and ownership verification → server-owned cleanup → separate recovery result.

### Security boundaries

- No TCP worker listener, public API, host port, Docker socket, privileged mode or
  arbitrary executable/argv/environment/path operation. Protocol v1 accepts only
  strict `import` and `cleanup` requests.
- Dedicated named IPC volume: directory UID 10001/mode 0700, socket UID 10001/mode
  0600. Only server and worker mount it; server mount is read-only. Unix filesystem
  authorization is the IPC authentication boundary. Host root/Docker administrators
  remain trusted; do not share this volume with another service or tenant.
- Worker application and client are root-owned, runtime UID/GID **10001:10001**,
  read-only image, all capabilities dropped, no-new-privileges, bounded PIDs/CPU/RAM.
  Worker mounts neither `/data`, repository credentials, `.env` nor host root.
- Two admitted socket connections maximum, one active operation. Busy imports fail
  explicitly. Header deadline 5 seconds; lease ACK deadline 15 seconds; upload deadline
  10 minutes; native queries 60 seconds; native import 60 minutes; entire IPC operation
  75 minutes; idle connection 30 seconds with safe 10-second worker heartbeats.
  JSON frames are capped at 96 KiB, SQL chunks at 32 KiB, and artifact size is bounded
  by an administrator-reviewed config limit (never above the existing 100 GiB policy).
- Upload uses backpressure. Worker spools to **private tmpfs**, never shared staging.
  It verifies SHA-256 before executing SQL, so an artifact changed after server validation
  cannot be imported. Artifact and credential files are 0600; workspaces/homes are 0700.
- Password crosses only private IPC and a private credential file. It is absent from
  argv, process environment, logs, errors and URLs. Child environments are allowlisted;
  application `SECRET`, `ENCRYPTION_KEY` and repository/agent credentials are not sent.
- `ssl-mode=VERIFY_IDENTITY` with an administrator-approved root-owned CA file is
  mandatory for the worker, including loopback endpoints. There is no worker `local`
  TLS mode, trust-all switch or retry with weaker transport.
- Fixed approved host/port/username and 1..8 exact database names are checked before
  database contact. The server additionally rejects a configured MySQL source endpoint
  match. DNS aliases are not proof of target separation: a dedicated target deployment,
  certificate, non-admin account, grants, guard marker and existing-database checks
  remain mandatory. Do not mark a source or production database server as recovery-only.
- Native stdin uses `--binary-mode`, `--local-infile=0`, `--commands=OFF`, private
  defaults/home, no reconnect, no shell and bounded process-tree execution. Binary mode
  is the effective client-command protection; Oracle documents that it takes precedence
  over `--commands`. Charset/delimiter remain usable for ordinary dump transport.
- Worker responses contain only closed stages/codes, catalog counts and private lease
  control frames. Neither native output nor arbitrary exception text is returned/logged.
- Existing non-empty/pre-existing database, global/role/admin/wildcard grant, marker,
  owner-token, cancellation and cleanup protections are not weakened. An ambiguous
  CREATE/owner-marker interruption is retained for manual investigation, never guessed
  safe to DROP. Worker restart does not resume/replay imports.

Unconfigured/unavailable/busy/malformed worker failures are explicit:
`mysql-worker-not-configured`, `mysql-worker-unavailable`, `mysql-worker-busy`,
`mysql-worker-protocol-failed`. MySQL recovery fails; ordinary backup jobs and local
MariaDB/PostgreSQL recovery do not depend on the worker. Cleanup briefly retries
busy/unavailable workers, then retains its durable lease and warning.

## Native client provenance

Reviewed and executed client: **Oracle MySQL Community 8.4.11**, Debian package
version `8.4.11-1debian12`, linux/amd64. Client-only packages:

| Package | Reviewed SHA-256 |
| --- | --- |
| mysql-community-client-core | `19c6e1d38f95fa77ebb675c01c0b3c50554026adc5ed0c114cee2a72520c2fea` |
| mysql-community-client-plugins | `95b66f6ba68e2b064e175fa7368ae6d6d52919b92b7d69e6b48d949af642eb07` |

Base: `node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203`.
The Dockerfile verifies Oracle's signing certificate fingerprint
`BCA43417C3B485DD128EC6D4B7B3B788A8D3785C`, configures a repository-scoped
`signed-by` key, verifies signed APT metadata and its package hashes, and additionally
checks the reviewed package SHA-256 values. No expired-signature bypass,
`trusted=yes`, unauthenticated APT, floating MySQL version or MariaDB substitution.
Debian runtime libraries use Debian's signed stable/security repositories.

Build/runtime verification checks package versions, genuine Community banner,
required security flags, UID/GID and absent database-server binaries. Worker startup
also verifies the root-owned executable and reviewed 8.4.11 banner. Pluton Apache-2.0
licensing/attribution is retained; bundled Zod licensing is included separately.

Primary sources: [Oracle APT installation](https://dev.mysql.com/doc/refman/8.4/en/linux-installation-apt-repo.html),
[Oracle signature/fingerprint guidance](https://dev.mysql.com/doc/refman/8.4/en/checking-gpg-signature.html),
[official package metadata](https://repo.mysql.com/apt/debian/dists/bookworm/mysql-8.4-lts/binary-amd64/Packages),
[native client command protections](https://dev.mysql.com/doc/refman/8.4/en/mysql-command-options.html).
Review package, base digest and signing certificate updates together; do not silently
relax pins when a future package disappears or its signing certificate changes.

## Compatibility

| Engine | Execution | Validation in this task |
| --- | --- | --- |
| MariaDB | Existing Alpine local client 11.8.8 | Real final-image import/content/catalog/cleanup and Phase 5/6 regressions passed. |
| PostgreSQL | Existing Alpine local psql 18.6 | Real final-image import/content/catalog/cleanup, restrict protection and Phase 5/6 regressions passed. pg_restore remains unused for Phase 6 SQL artifacts. |
| Oracle MySQL | Optional separate Debian worker, genuine client 8.4.11 | Real private-IPC imports into disposable Oracle MySQL 8.4.11 with verified TLS passed. Not production-pilot acceptance. |
| Alpine MariaDB `mysql` alias | Never used as Oracle client | Still refused by the original detector. |

No schema migration or Agent update. No breaking Agent or public HTTP API change;
four additive sanitized recovery error codes and a new internal IPC protocol only.
Existing plans, ciphertext, snapshots, repositories and stable database identities
are reused without re-enrollment or data migration.

## Automated validation

| Check | Result |
| --- | --- |
| Full backend Jest | **155 suites, 3,007 passed, 0 failed, 4 platform/native skips**. Includes new worker boundary/orchestration and Phase 5/6/7 regressions. |
| Complete Linux Agent suite, `--init`, disposable/no network | **120 passed, 0 failed, 0 skipped**. |
| Windows Agent suite | **45 passed, 0 failed, 75 Linux-only skips**; not used as native acceptance. |
| Worker/server image and release definitions | **21 passed, 0 failed** (9 container/inspection safety + 12 existing release tests). |
| Actual worker/server/Oracle target | **12 scenarios passed, 0 failed**: import + constrained SQL content/catalog assertions, wrong credentials, invalid guard marker, existing DB, partial SQL failure, client-command escape refusal, digest mismatch, target mismatch, cancellation, restart, untrusted TLS, unavailable worker. |
| Direct worker process/files inspection | UID 10001, private SQL/credential files 0600, homes/workspaces 0700, no password argv/environment; cancellation and restart verified. |
| Final-server local client regression | MariaDB and PostgreSQL native import/content/catalog/cleanup passed; MariaDB alias rejected; no DB server in application image. |
| Real Phase 5/6 pipeline | **8 scenarios passed**: single, two-MariaDB, mixed, filesystem-only recovery, MariaDB recovery, PostgreSQL recovery, mixed recovery and expected mixed-import failure. Disposable real SFTP/Restic snapshots, Browse/Download/staged Restore, SQL hashes, source DB shutdown, cleanup and unchanged repository inspection verified. |
| Phase 7 native integration | Passed private HTTP/HMAC/timeout, SMTP/auth/rejection, durable dedup/restart and verified/untrusted TLS. |
| Build/type/lint/Compose | Backend lint, backend/frontend/Agent types, production workspace build, both Docker builds, merged optional Compose and `git diff --check` passed. |

Initial harness issue: a manually invoked Linux Agent run omitted Docker `--init`;
seven PID-reaping assertions failed because killed descendants remained zombies.
The complete corrected `--init` run passed all 120 tests; no Agent code or test was
weakened. An initial new-schema TypeScript optional-password mismatch was corrected
with a strict required worker password schema before final builds. Sandbox attempts
to access package-manager/Docker caches failed before testing; approved local tooling
was then used. Existing Node loader/deprecation, frontend chunk-size/Browserslist and
test listener warnings are not new runtime failures.

An interim native rerun hit the process inspector's argument-matcher assertion. The
old unanchored `-p` expression also matches non-password options such as `--protocol`
and `--get-server-public-key`; this was independently reproduced in the added matcher
regression. The inspector now checks anchored password options **and the actual
private fixture credential's absence** over repeated native samples, without printing
its value. The final 12-scenario run and repeated cancellation/restart inspection passed.
No runtime client flags or credential protection were relaxed to make that test pass.

The final runner overrides the test server image's `/data` declaration with tmpfs,
as well as its SQL staging tmpfs. Earlier iterations omitted that `/data` override;
Docker can retain empty anonymous test-server data volumes after container deletion.
No blanket pruning of unidentifiable volumes was attempted. Only exactly identified
named fixtures were deleted; the corrected runner avoids those anonymous volumes.

Representative reproducible commands (local disposable test environment only):

```sh
pnpm --filter @plutonhq/core-backend test --runInBand
pnpm --filter @plutonhq/core-backend lint
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-frontend exec tsc -b
pnpm --filter @plutonhq/pluton-agent typecheck
pnpm --filter @plutonhq/pluton-agent test
pnpm build
node --test scripts/__tests__/mysqlRecoveryWorkerImage.test.cjs scripts/__tests__/databaseRecoveryImage.test.cjs scripts/__tests__/releasePlease.test.cjs
docker build -f Dockerfile.source -t pluton-mysql-server:local .
docker build -f Dockerfile.mysql-recovery-worker -t pluton-mysql-worker:local .
pwsh ./scripts/validate-mysql-recovery-worker.ps1
pwsh ./scripts/validate-database-recovery-clients.ps1 -RuntimeImage pluton-mysql-server:local
pwsh ./scripts/validate-phase6.ps1
pwsh ./scripts/validate-phase6.ps1 -Modes single,two-mariadb,mixed
pwsh ./scripts/validate-phase7.ps1
git diff --check
```

The new runner creates only randomized named fixtures on an internal Docker network,
uses a digest-pinned disposable `mysql:8.4.11` target, has no host ports, and deletes
only its own containers/network/volumes. Server and worker are separate final runtime
images; the server's test container has **no network** and uses read-only Unix IPC.
Generated test credentials/CA/private keys are not saved in Git or this report.
Full-duration one-hour production imports and real application semantic recovery
have not been claimed from these tests.

## Deployment procedure (operator action; NOT executed)

1. Review branch/diff, run CI and retain the last working server image digest. Back up
   the existing persistent volume/SQLite consistently and preserve the **same** SECRET,
   ENCRYPTION_KEY, repository credentials, volume name and deployment overrides.
   Never use `down -v`, replace keys, delete plans or re-enroll Agents.
2. Provision a **separate empty Oracle MySQL 8.4 recovery target**, not source/production.
   Require TLS, a SAN matching the approved hostname and a reviewed CA. Restrict network
   access to the worker. A private worker bridge is not an egress firewall: deny source,
   production and unrelated endpoints with infrastructure policy.
3. Using a secure administrator session on that disposable target only, create
   `pluton_recovery_guard.pluton_recovery_guard(purpose VARCHAR(80))`, containing exactly
   `pluton-phase6-recovery-only`. Create a separate TLS-required recovery account.
   Grant only SELECT on that guard and database-scoped privileges on each exact archived
   database name. Do **not pre-create** those application databases. No global admin,
   role inheritance, wildcard scope or GRANT OPTION. For names with `_`/`%`, use properly
   escaped exact MySQL grant scope; do not turn on partial-revokes semantics casually.
   Provision any required application definers/roles safely on the disposable target;
   never fix an import by granting global administrator privileges or rewriting dumps.
4. Create public, root-owned, non-writable worker config/CA files outside the repository:

   ```json
   {
     "host": "mysql-recovery.example.internal",
     "port": 3306,
     "username": "recovery_user",
     "databases": ["example_db"],
     "maxArtifactBytes": 536870912
   }
   ```

   The config must contain **no password**. Suggested root:root 0644 files in a root-owned
   traversable directory; approved CA PEM at `/etc/pluton/mysql-worker/ca.pem` and JSON
   at `/etc/pluton/mysql-worker/target.json`. File/ancestor ownership and write permissions
   are checked. Put the recovery password only in Pluton's encrypted Recovery Target UI.
   The worker account's grant set must match this plan's MySQL artifact database set.
5. Review immutable server and worker digests from the fork's container workflow. Worker
   publication uses `ghcr.io/<owner>/<repo>-mysql-recovery-worker`, separate from the server.
   CI builds both and runs real imports before either publication job can proceed. This
   task did **not** run publication or create a release.
6. Explicitly opt in using the existing Compose file plus the new overlay and all existing
   site overrides. Set `PLUTON_MYSQL_WORKER_IMAGE_REF` to the reviewed worker **digest**,
   `PLUTON_MYSQL_WORKER_CONFIG`/`PLUTON_MYSQL_WORKER_CA` to reviewed host file paths and
   `PLUTON_IMAGE_REF` to the compatible server digest. Do not dump resolved Compose/env
   output publicly. First validate with `docker compose ... config --quiet`.
7. Start only this reviewed deployment after an approved change window. The overlay adds
   the private IPC volume, worker-only DB egress network and `PLUTON_MYSQL_WORKER=enabled`
   on Pluton. It does not alter `/data` or existing override mounts. A fresh IPC volume
   gets 10001/0700 ownership from the worker image before the server is created. Refuse
   an incorrectly owned/pre-existing IPC volume; inspect its exact inactive scope rather
   than making it world-writable. Do not share it across independent Pluton deployments.
8. Only after worker/target approval, save/enable the existing plan's separate MySQL
   Recovery Target with the matching endpoint/account, verified TLS and dedicated flag.
   Run one **manual** test of a completed exact snapshot before enabling any automatic
   required import policy. Existing backup scheduling continues unchanged.

Default overlay resources: one CPU, 64 PIDs, 3 GiB memory limit, 2 GiB private tmpfs.
Memory is a cap, not preallocation. Set artifact cap and resource limits consistently:
allow SQL size plus Node/client overhead. A larger dump needs an explicitly reviewed
tmpfs/RAM override; do not attach server `/data` or a repository to solve space limits.

## Manual production-pilot acceptance (still required)

- Confirm approved server/worker digests, genuine client, non-root user, no public
  worker port and no additional application-container DB server. Inspect only safe
  stage/code diagnostics; do not paste config, credential files or `/proc/environ`.
- Reuse an existing completed backup and verify the recovery result is bound to its
  exact snapshot. SQL size/SHA-256 must pass before import. Backup Complete is separate
  from Recovery Passed; import disabled remains NOT TESTED.
- Verify native MySQL import and catalog result on the dedicated disposable target;
  independently check representative application tables/content/schema semantics there.
  The automated generic catalog result is not a guarantee of full application behavior.
- Require database and workspace Cleanup Complete; confirm only the test-owned database
  disappears. Leave production/source databases and old snapshots untouched.
- Exercise wrong TLS/credential/marker and worker outage using **disposable** fixtures,
  not by damaging live configuration. Confirm explicit failure and ordinary backups
  unaffected. Review warnings/leases after cancellation or restart.
- Retest existing MariaDB/PostgreSQL recovery and notification delivery during the
  approved pilot. No cutover, import into production or original-source restore.

## Rollback and limitations

Finish/cancel active recovery jobs and clear ownership-checked cleanup while the
compatible worker is available. If the worker was unavailable, retain its existing
approved target/config/CA, bring it back and restart the compatible server to invoke
existing interrupted-lease reconciliation; do not delete a lease/owner marker to
silence a warning. A cleanup ownership mismatch needs explicit manual investigation.

Disable MySQL import requirements (or automatic recovery policy) before server-only
rollback. Remove only the optional worker overlay/enable flag and use the last reviewed
server digest with the same original Compose overrides, `/data` volume and secrets.
Stop/remove only the optional worker after no cleanup lease remains. Do not remove
volumes, repository data, snapshot data, plans, Agent state or notification outbox.
Leaving the optional IPC volume inactive is harmless; its removal is not required.

Limitations: Linux/amd64 and the pinned 8.4.11 client are the reviewed worker platform;
no Windows socket, arbitrary client version, multi-tenant API, worker autoscaling or
general command proxy. One worker approves one endpoint/account and at most eight
database names, with concurrency one. Existing dumps that require unavailable definers,
privileges or unsupported SQL still fail closed. No automatic SQL rewriting, insecure
TLS fallback, timeout inflation, source contact or import replay. No new development
phase. A real production-pilot acceptance remains operator work.

## Changed files

- `Dockerfile.mysql-recovery-worker`
- `.github/workflows/container.yml`
- `.gitignore` (generated worker bundle only)
- `backend/src/mysql-worker/index.ts`
- `backend/src/mysql-worker/protocol.ts`
- `backend/src/mysql-worker/server.ts`
- `backend/src/utils/mysqlRecoveryWorkerClient.ts`
- `backend/src/services/RecoveryTestService.ts`
- `backend/src/types/recoveryTests.ts`
- `backend/__tests__/utils/mysqlRecoveryWorker.test.ts`
- `backend/__tests__/services/RecoveryTestService.test.ts`
- `backend/__tests__/integration/mysqlRecoveryWorker.prepare.mjs`
- `backend/__tests__/integration/mysqlRecoveryWorker.smoke.mjs`
- `backend/__tests__/integration/mysqlRecoveryWorker.observe.mjs`
- `deploy/compose.mysql-recovery-worker.yml`
- `scripts/build-mysql-recovery-worker.mjs`
- `scripts/verify-mysql-recovery-worker.mjs`
- `scripts/validate-mysql-recovery-worker.ps1`
- `scripts/__tests__/mysqlRecoveryWorkerImage.test.cjs`
- `docs/MYSQL_RECOVERY_WORKER_REPORT.md`

## Measured image impact

Docker's local uncompressed image-size measurement, linux/amd64:

| Image | Bytes | Approximate size |
| --- | --- | --- |
| Previous validated client-enabled server | 171,316,724 | 163.38 MiB |
| Server with worker integration | 171,350,530 | 163.41 MiB |
| Optional Oracle MySQL worker | 93,157,797 | 88.84 MiB |

Server growth: **33,806 bytes (~33.0 KiB)**. The optional worker adds ~88.84 MiB as a
separate image, not a database server or package installation in Pluton. These are
local image-size sums, not compressed registry download sizes; shared layers and
future signed OS security updates can change them. Final image rebuilds and repeated
real MySQL acceptance passed; no image was published or deployed.
