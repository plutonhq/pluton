# Database recovery clients in the Pluton Server image

Audit date: 2026-10-14. Branch: `codex/database-recovery-clients`, based on reviewed
`origin/main` at `d8e4fa6`. All changes are uncommitted. No commit, push, merge,
release, deployment, production access, secret rotation, repository maintenance,
agent re-enrollment, or production plan creation was performed.

## Findings and implementation

The fork's GHCR workflow builds **Dockerfile.source**, not the top-level Debian
release-asset Dockerfile. The unchanged baseline source image actually runs
Alpine **3.24.1**, Node **24.16.0**, as `pluton` UID/GID **10001**, and contained
none of `mariadb`, `mysql`, `psql`, or `pg_restore`. The inherited executable
release workflow is separately guarded for forks and is not changed here.

Phase 6 already required root-owned, non-service-writable clients from fixed
administrator paths, rejected a MariaDB banner for engine `mysql`, required MariaDB
`--sandbox`, and used patched `psql` with a fresh private `\restrict` envelope.
The importer handles **plain SQL**, not PostgreSQL custom/tar archives. Missing
clients were a runtime packaging gap, not a need to change the recovery design.

The final source image now installs signed stable Alpine packages
`mariadb-client>=11.8.8-r0` and `postgresql18-client>=18.6-r0`, plus required runtime
dependencies. No edge repository, unsigned download, glibc shim, database server,
init service, or startup daemon is added. Floors permit subsequent Alpine security
revisions on rebuild rather than freezing a vulnerable APK revision.

Build-time verification runs **after USER pluton**, using the real compiled Phase 6
detector. It checks UID/GID, native flags/version execution, MySQL rejection, and
absence of server executables/init services. It imports only validation utilities;
it does not start Pluton, generate keys/SQLite data, connect to a DB, or modify `/data`.

The workflow now loads a local validation image and tests real imports before
publication is eligible, on both PR and main/tag builds. Publication still uses
the invoking repository's existing GHCR destination and event/permission guards;
no inherited upstream registry integration is enabled. No workflow was dispatched
or image published during this task.

## Actual clients and compatibility

| Engine/format                 | Installed client                                             | Acceptance and limitation                                                                                      |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| MariaDB plain SQL             | `mariadb` 11.8.8, native client 15.2; APK 11.8.8-r0          | Real UID-10001 import, catalog/content verification and owned cleanup passed against disposable MariaDB 11.8.8 |
| PostgreSQL plain SQL          | `psql` 18.6; APK postgresql18-client 18.6-r0 / libpq 18.6-r0 | Real UID-10001 import and cleanup passed against disposable PostgreSQL 18.6                                    |
| PostgreSQL custom/tar archive | `pg_restore` 18.6 bundled with the required client package   | Binary executes, but Phase 5/6 does not produce/import this format; no archive support is claimed or added     |
| Genuine Oracle MySQL          | **Not installed**                                            | Required MySQL imports remain explicitly rejected; genuine MySQL import acceptance **not validated**           |

`/usr/bin/mysql` resolves to `/usr/bin/mariadb`; it is **not** Oracle MySQL.
`/usr/bin/psql` and `/usr/bin/pg_restore` resolve into `/usr/libexec/postgresql18/`.
Version, path, root ownership and flags are checked under the final non-root account.
Bundled ancillary utilities are client-only; no server package is installed.

### Oracle MySQL investigation and necessary next implementation

Alpine documents `mysql-client` as a transitional MariaDB package.
[Alpine MySQL packaging guidance](https://wiki.alpinelinux.org/wiki/MySQL).
Oracle's generic Linux distributions target GLIBC and its supported-platform
matrix does not list Alpine/musl.
[Oracle generic binaries](https://dev.mysql.com/doc/refman/8.4/en/binary-installation.html),
[supported platforms](https://www.mysql.com/support/supportedplatforms/database.html).

No vendor-supported, signed native Oracle client package suitable for this Alpine
image was established. Copying a glibc binary into Alpine or relabeling MariaDB
would not satisfy the engine/TLS requirements. MySQL validation/import semantics
are preserved: this image produces `database-client-incompatible`, before
credential preparation or SQL. Synthetic Oracle-banner tests validate recognition
only, not native MySQL support.

A separately reviewed path is a verified official MySQL 8.4 LTS client-only musl
build: pinned/checksummed sources, authentication/TLS plugins, root-owned libraries,
SBOM/license review, fixed-path validation, and real Oracle-server import/security
tests. Alternatively, an explicitly approved glibc image variant could use Oracle's
supported packages, but changing the current base/native-module ABI is outside this
task. Do not use unofficial APKs, arbitrary glibc compatibility downloads, or weaken
the MariaDB-banner rejection.

### PostgreSQL security floor

The old floor covered CVE-2025-8714 but not its later `\unrestrict` input-expansion
bypass. Validation now requires patched supported lines: **14.24, 15.19, 16.15,
17.11 or 18.6**, or later minors of those lines. Unpatched, unsupported/EOL, beta,
and unreviewed future-major clients fail closed. The native test proves an archived
backquote argument cannot create a file or execute a shell command.
[PostgreSQL CVE-2026-18408](https://www.postgresql.org/support/security/CVE-2026-18408/).

Independently customized server images with old clients may now need a client
update. This does not prohibit compatible older source-server SQL dumps from
being restored with the new client. Source/server versions, extensions, roles/ACLs,
definers and SQL compatibility still require operator acceptance; native evidence
covers only the fixture server versions listed above.

Native DB import fixtures use container-local loopback (`tls: local`). Remote DB
TLS remains mandatory under the unchanged policy; actual private-CA/hostname
handshake acceptance is an operator deployment gate, not claimed by these local
import tests. No certificate-verification bypass was introduced.

## Preserved safety

The importer and process runner are unchanged: `shell:false`, bounded probes and
output, connection/import deadlines, cancellation/process-tree termination, private
credential files 0600 and client HOME 0700. Passwords do not appear in argv, URLs,
`MYSQL_PWD` or `PGPASSWORD`; child environments exclude `SECRET`/`ENCRYPTION_KEY`.
Provider stderr is classified rather than logged.

Dedicated-target markers, restricted non-admin grants/roles, rejection of existing
or unknown databases, durable leases and ownership-token cleanup remain mandatory.
Exact-snapshot staging/binding, SQL artifact paths/digests, source-agent separation,
and no restore/import to the original source are preserved. Opt-in policies are
not silently enabled; artifact-only success is not relabeled as successful import.

There is **no schema migration, agent/protocol update, dependency/lockfile change,
new recovery format or Legacy write path**. `/data`, SQLite, keys/credentials,
plans, repositories/snapshots, identity and the Phase 7 outbox remain compatible.
**An agent update is not needed**: its dump clients are separate from server import
clients. No production data was read or changed.

## Files changed

| File                                                               | Purpose                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `Dockerfile.source`                                                | Runtime client packages and non-root build verification         |
| `.github/workflows/container.yml`                                  | Local image loading and native import publication gate          |
| `backend/src/utils/recoveryDatabaseClients.ts`                     | Patched-psql floor and release-only version matching            |
| `backend/__tests__/utils/recoveryDatabaseClientDetection.test.ts`  | Ownership/flags/alias/version regressions                       |
| `scripts/verify-database-recovery-clients.mjs`                     | Safe image version/UID/server-absence diagnostic                |
| `scripts/__tests__/databaseRecoveryImage.test.cjs`                 | Packaging, volume/entrypoint, CI and isolation guards           |
| `scripts/validate-database-recovery-clients.ps1`                   | Final-image import runner and exact-name cleanup                |
| `backend/__tests__/fixtures/recovery-clients/Dockerfile`           | Separate disposable DB-only fixture, never production           |
| `backend/__tests__/integration/databaseRecoveryClients.server.mjs` | Dedicated marker/grant bootstrap; private generated credentials |
| `backend/__tests__/integration/databaseRecoveryClients.smoke.mjs`  | Actual compiled importer as UID 10001                           |
| `docs/DATABASE_RECOVERY_CLIENTS_REPORT.md`                         | Report and operator handoff                                     |

## Tests and evidence

| Check                                                | Result                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Complete backend Jest suite                          | **154 suites passed; 2,989 passed, 4 skipped, 0 failed**                |
| Backend lint/types; frontend types; `pnpm build`     | Passed                                                                  |
| Image guards + existing release tests                | **16 passed, 0 failed**                                                 |
| Agent Windows tests/types                            | 45 passed, 75 Linux-only skipped, 0 failed                              |
| Agent Linux execution/permissions                    | **120 passed, 0 failed, 0 skipped**                                     |
| Baseline/final source Docker builds                  | Passed; final verification executed as UID/GID 10001                    |
| Final-image MariaDB/PostgreSQL imports               | Passed: catalog/content, private credentials and owned cleanup          |
| MySQL native integration                             | **Not validated**; real alias rejection passed before SQL               |
| PostgreSQL archived `\unrestrict` attack             | Rejected; no shell/file escape                                          |
| Existing Phase 5/6 real SFTP/Restic matrix           | All eight modes passed, including expected required-import auth failure |
| Existing Phase 7 native notifications/outbox/restart | Passed                                                                  |
| Diff and sensitive-content/scope review              | Passed; tracked/untracked files reviewed, unrelated paths unchanged     |

The eight-mode matrix includes filesystem-only, multiple MariaDB and mixed
MariaDB/PostgreSQL backups, required native imports, exact-snapshot Browse/Download/
staged Restore, source DB shutdown, cleanup and unchanged repository manifests.
Configuration-bootstrap logs belong solely to disposable test keys/tmpfs, not
production secret rotation.

The new test uses the **final production image**, not the DB fixture image, for
imports. Its separate DB-only container has `--network none`; the application
shares only that fixture's loopback network namespace, not its PID namespace.
Both run read-only with private tmpfs; no host ports, production network, Docker
socket or production volumes are mounted. Generated fixture credentials remain in
a private ephemeral control volume, never argv/logs/Git/image layers. The real
importer's credentials remain 0600; control resources are removed by validated
exact names. No DB server process exists in the application container.

An intermediate fixture bootstrap failed because MariaDB's default `/var/tmp`
was correctly read-only. The DB-only fixture now uses its private tmpfs explicitly
via `--tmpdir`; no application permission was weakened. All final checks pass.
Existing non-fatal Fumadocs CSS/browser-externalization, Browserslist and test
listener warnings remain outside this task; there is no unexplained baseline failure.

### Reproduction

```powershell
pnpm --filter @plutonhq/core-backend test --runInBand --silent --verbose=false
pnpm --filter @plutonhq/core-backend lint
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-frontend exec tsc -b
pnpm --filter @plutonhq/pluton-agent test
pnpm --filter @plutonhq/pluton-agent typecheck
pnpm build
node --test scripts/__tests__/databaseRecoveryImage.test.cjs scripts/__tests__/releasePlease.test.cjs
docker build -f Dockerfile.source -t pluton-recovery-clients:local .
docker build -f backend/__tests__/fixtures/recovery-clients/Dockerfile -t pluton-recovery-db-only:local .
./scripts/validate-database-recovery-clients.ps1
./scripts/validate-phase6.ps1 -Modes @('single','two-mariadb','mixed','phase6-filesystem','phase6-mariadb','phase6-postgresql','phase6-mixed','phase6-mixed-failure')
./scripts/validate-phase7.ps1
git diff --check
```

## Docker image size impact

Final local linux/amd64 Docker-reported `.Size`, using the same base images:

| Image                  | Bytes       | MiB                |
| ---------------------- | ----------- | ------------------ |
| Reviewed main baseline | 159,148,314 | 151.78             |
| Final modified image   | 171,316,724 | 163.38             |
| Increase               | 12,168,410  | **11.60 (+7.65%)** |

These are local Docker image-accounting values, not process RAM, uncompressed
package footprint or a promise about another platform/registry's transfer size.
The real build uses Alpine 3.24.1, MariaDB 11.8.8 and PostgreSQL 18.6. Future patch
rebuilds can change sizes/versions; record the reviewed digest/package inventory.
The existing release workflow publishes linux/amd64; arm64 was not newly validated.

## Deployment and manual recovery acceptance — operator action only

1. Review/approve the branch and retain the previous immutable server image.
   Pause new recovery dispatch with existing operational controls; let imports
   and owned cleanup finish and check that no in-flight import leases remain.
2. Securely preserve the current environment/configuration and persistent `/data`:
   SQLite, `SECRET`/`ENCRYPTION_KEY`, encrypted repository/DB credentials, plans,
   notification outbox and CA mounts. Do not recreate volumes or regenerate keys.
3. Replace **only the existing server image** with the reviewed immutable build.
   Keep UID/GID 10001, the same volume/env/CA mapping. No agent reinstall,
   re-enrollment or new plan is needed. No such deployment was performed here.
4. Verify clients without a data mount or network connection:

   ```sh
   docker run --rm --network none --read-only --user 10001:10001 --entrypoint node <reviewed-image> --loader ./backend/loader.mjs /usr/local/libexec/pluton/verify-database-recovery-clients.mjs
   ```

5. Check health, existing plans/history, same agent identity and notification
   delivery/outbox. Browse/download an existing exact snapshot and restore only
   to validated private staging, never the live source.
6. Provision/review a **separate recovery-only DB endpoint**, never a source or
   production application DB. Follow [Phase 6 target guards](PHASE6_RECOVERY_TESTING.md):
   purpose marker, restricted non-admin grants/roles, required archived roles,
   and no pre-existing application DB. Remote targets require verified TLS and a
   trusted CA; do not disable certificate verification or expand global privileges.
7. In the **existing plan's Recovery Testing** settings, save the dedicated target
   and select **Required — all databases must import**. Use saved-credential UI,
   not passwords in CLI argv/URLs/logs. Every required multi-DB engine needs a
   compatible target; this image's MariaDB alias cannot satisfy Oracle MySQL.
8. Manually test an existing completed backup/exact snapshot with valid SQL
   artifacts. Expect matching snapshot ID, artifact SHA/size passed, native
   imports passed, catalog/content acceptance and **Cleanup Complete**. Backup
   Complete remains separate from Recovery Test status; no new plan is necessary.
9. On dedicated disposable acceptance targets only, confirm bad credentials,
   missing marker, existing DB and cancellation fail safely without touching
   unrelated DBs or exposing secrets. Resume automation only after acceptance.
   If import remains Disabled, say artifact integrity passed but **SQL import
   NOT TESTED**, not successful semantic database recovery.

The pilot's real MariaDB import acceptance remains a manual post-deployment gate.
Disposable success is not production end-to-end acceptance. Source/version,
extension, role/definer, collation and SQL-mode differences may still require
manual infrastructure work. No SQL rewrite or broader privilege was added.

## Rollback

Drain work and finish owned target cleanup **before** rollback. Switch back to
the retained immutable server image with the same environment, CA trust, UID and
`/data` volume. There is no new schema to reverse. Do not delete volumes, replace
current keys with stale copies, rotate secrets, reset identities or roll back
repository/snapshot data. Check SQLite, plans/history, agents and the outbox after
restart. The old image lacks import clients, so required DB imports become
unavailable again; leave them paused/explicitly disabled until a compatible image
is restored. Artifact-only checks and existing backup functionality remain separate.
