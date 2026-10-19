# Automatic internal recovery container lifecycle

Baseline: aeb36bd; branch codex/automatic-recovery-container-lifecycle.
Disposable-VM follow-up: 2026-10-16. All changes remain uncommitted. No push,
merge, release, production deployment/access, secret rotation, Agent enrollment,
source database access or production Restic repository operation was performed.
Fresh Restic repositories were created only from synthetic data on the approved
disposable guest for the final API acceptance described below.

Latest follow-up: the user confirmed successful Windows-browser visual UAT for
MariaDB and PostgreSQL: Persistent Restore Active/Inspect/Stop/Resume/Delete and
verified cleanup, plus Recovery Testing Passed, SQL validation and infrastructure
cleanup. The status-display refinements below were made afterward; DOM interaction
regressions cover these refinements, not a second user visual acceptance claim.

## Acceptance status

The table below preserves the original MariaDB/PostgreSQL acceptance interval.
The later RC-01 source correction requires migration0016 and matching app/root
code; its deterministic tests are not a new human visual or physical boot pass.
See the RC-01 follow-up at the end before preparing a current release candidate.

| Gate | Result |
| --- | --- |
| Implementation / deterministic regressions | Passed: durable lifecycle, ownership, cancellation and native import boundaries retained. |
| Separate Linux VM namespace / quota rehearsal | Passed for the scenarios below, with synthetic SQL and isolated guest-host Docker/containerd. |
| MariaDB / PostgreSQL, disposable and retained | Real TLS/guard-checked import, content validation, cancellation and owned cleanup passed. |
| Cold guest boot / persistent anchor ordering | Passed: earlier two authorized MariaDB/PostgreSQL boots plus the separately approved final PostgreSQL consumed-Resume boot. Identity/content retained; no auto-resume/re-import; ordered anchors/Docker/operator/application and fresh explicit API Resume. |
| Authenticated HTTP API + real synthetic Restic snapshots | Passed for both engines: preparation, provisioning, verified import, retained Stop/Resume/Delete and Required-import Recovery Testing through the actual application. |
| Visual browser wizard | Passed by the user's explicit manual UAT confirmation for both engines. Subsequent presentation refinements have real DOM interaction tests; not claimed as a new pixel/browser acceptance. |
| Production deployment | **Not authorized or performed.** Requires separate operator/security review and a controlled site-specific deployment, not unrestricted production activation. |

The namespace blockers are resolved without removing isolation. User visual UAT
is complete. Final consumed-Resume cold-boot/cleanup evidence is recorded below.
Do not enable production policy/timer solely because API and unit tests pass.

## Confirmed causes and fixes

| Finding | Before | After / evidence |
| --- | --- | --- |
| Private mount namespace | PrivateTmp/ProtectHome isolate service-side mounts from host/Docker; namespace equality deliberately refused activation. | PID 1 creates fixed transient mount units. Verify identical protected device/source in host, reconciler and Docker before Ready. Installer still requires host namespace. |
| Shared anchor peer group | Self-bind of an already-shared parent could remain in its peer group and duplicate propagated submounts. | Only newly created owned anchors become private first, then dedicated rshared anchors. Duplicate/stacked mounts fail closed. |
| Restrictive umask | UMask 0077 changed intended anchor 0444 to 0400 and a new credential directory 0750 to 0700. | Normalize only just-created owned paths/open anchor descriptor to their exact intended modes. No 0777, global chmod, production ACL or source/repository permission change. |
| Dynamic readonly propagation | A readonly rslave parent did not make later child mounts readonly. Bind-then-remount flags did not propagate either. | Prepare a host-private RO seed, then publish a bind-only clone already RO. A pre-existing UID-10001 observer verified kernel RO and denied writes for both engines/modes. Backend checks actual child mount. |
| Private seed at cleanup | A new sandbox inherited a private seed; PID-1 unmount did not detach its local copy, preventing empty-directory verification. | After positive host absence, detach only the sandbox's own verified stale RO clone. Require different namespaces and matching protected ext4/loop identity. First-pass cleanup passed afterward. |
| PostgreSQL startup | Uppercase Connection refused missed a case-sensitive transient-startup classifier. | Bounded case-insensitive startup classification; auth/TLS/unknown remain terminal. Existing 45-second readiness budget unchanged. |
| Interrupted approval publication | Complete metadata could survive readiness interruption before approval/CA publication. | Republish only the original verified CA/approval. No credential, activation or container regeneration. Changed CA refused. |
| Query/removal uncertainty | Broad findmnt catch could confuse command failure with absence; loop autoclear can be deferred. | Only no-match exit with empty output proves absence. Other failures fail closed. Check loop absence again before image unlink. |
| Nonpersistent boot anchors | Installation-time binds disappear at guest reboot; automatic Docker restart could start the application before mount reconciliation. | Six persistent native mount units, anchor verification, Docker dependency/drop-in and an existing-container-only application launcher establish anchors -> Docker -> initial reconciliation -> application. |
| Stale Active after guest boot | Root lifecycle receipt was Stopped but the retained public target state remained Active, hiding the API/UI Resume action. | Publish Stopped only after verifying the exact storage and container. No automatic DB startup/import. Observed on the first MariaDB reboot; fixed before the PostgreSQL reboot. |
| Premature Deleted / held global slot | Legacy public Removed state could finalize a retained row before the full automatic receipt. Deleted history was then omitted from reconciliation, leaving its automatic reservation Cleaning-up. | Automatic rows await the bound monotonic root Removed receipt; old Deleted rows reconcile receipts only, never provision/import/delete again. Actual API cleanup releases the slot. |
| Consumed Resume replay | Periodic server replay rewrote the same mailbox; root treated Resume as persistent desired state and could start a later-stopped DB again. | Preserve identical request revisions during durable replay; root consumes a Resume revision durably. Explicit authenticated Resume publishes a new revision. Tested with both engine decision layers and real stopped PostgreSQL followed by fresh API Resume/content verification. |
| Poll-triggered form remount | Wizard/confirmation keys used metadata tokens and polling update timestamps; refreshing hid the form entirely. | Key only by plan/backup/exact snapshot/operation. Keep cached form mounted during checks; disable submission on refresh/error and revoke acknowledgements when verified metadata changes. Selection/retention/focus survive without reusing stale approval. |
| Modal animation/layout churn | Inline close callbacks reinstalled the animation effect; content-height measurement could cross the 500px threshold and recenter the modal. | Mount-only listener/entry animation with current callback refs and timer cleanup. Recovery dialogs opt into a fixed bounded scroll plane, stable gutter, focus containment/restoration and reduced-motion support. Other dialogs retain legacy layout. |
| Poll-stepped duration / unclear progress | Recovery duration was calculated only on polling renders; retained views had no smooth progress clock. | A separate one-second display timer derives elapsed time from backend created/completed timestamps, stops at authoritative completion and performs no network work. Stage-only polite announcements and native indeterminate progress never invent a percentage. |
| Misleading manual/current-state wording | Automatic provisioning/Resume could still say manual operator action required; host Ready was confused with an historical import stage. | Automatic intents explicitly await verified host status; manual mode stays distinct. Current host state and historical import stage are separately labelled. Expiry/cancel/cleanup cannot display successful completion while removal is pending. |

### Selected namespace design

Three PID-1-managed mount units per operation; sources/targets/options derive only
from reviewed fixed host profiles and an exact 24-hex operation ID:

    owned 2 GiB ext4 image
      -> view/<id>                   RW; UID-999 database data only
           -> readonly-stage/<id>    host-private RO seed, root-only parent
                -> app-view/<id>    bind-only clone, already RO on propagation
                     -> UID-10001 app readonly rslave view

The app reads the root-owned identity anchor but not UID-999 mode-0700 DB data.
Both child mount planes retain nodev/nosuid/noexec. The automatic overlay uses
app-view for retained and disposable storage. The backend kernel-RO check applies
only to automatic records; manual/Custom contracts remain compatible.

The reconciler retains PrivateTmp, ProtectHome, NoNewPrivileges, UMask 0077,
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6, LockPersonality and bounded
service/subprocess timeouts. No nsenter, shell API, MountFlags=shared workaround,
application Docker/system-D-Bus socket or privileged container is added.
Docker must share PID 1's mount namespace; a private-daemon topology is refused,
not automatically weakened.

Root verifies exact transient unit description, source, target, type and options.
Systemd-normalized /dev/loopN is accepted only with independent exact backing-file
proof. Inode/device/UUID/anchor, fully allocated size and capacity checks remain.
Timeout, partial creation or unknown resource never permits a plain-directory,
new formatting, ownership adoption or unbounded-volume fallback.

The operator remains a trusted root/Docker-administrator component. Its filesystem
sandbox does not make unreviewed root code safe. Package checksums, ownership and
host activation require separate operator review.

Reviewed alternatives: removing PrivateTmp/ProtectHome or entering the host
namespace would broadly weaken/escape isolation; another privileged socket broker
would add a new control protocol. PID-1 units avoid both changes.

References:

- [systemd filesystem isolation](https://github.com/systemd/systemd/blob/v255/man/systemd.exec.xml)
- [systemd-mount schedules units through PID 1](https://github.com/systemd/systemd/blob/v255/man/systemd-mount.xml)
- [Linux shared-subtree propagation](https://docs.kernel.org/filesystems/sharedsubtree.html)
- [Docker bind propagation](https://docs.docker.com/engine/storage/bind-mounts/#configure-bind-propagation)

## Existing lifecycle and security boundaries

The authenticated, authorized, same-origin UI/API confirms an exact snapshot.
SQLite commits a reservation before the UID-10001 mode-0700 mailbox publishes a
mode-0600 request. Root accepts version-1 provision/inspect/stop/resume/delete;
no caller image, executable, path, mount, network, Docker endpoint or unit
property is accepted. No new TCP control listener exists.

Immutable binding includes mode/engine/operation, snapshot, stable DB IDs/names,
artifact SHA-256/bytes and TTL, hashed together with a random owner token.
Root journal precedes mutations. Labels, activation/storage identity, SQL owner
markers and leases must agree: a matching name alone is never ownership proof.
Root-owned receipts have monotonic sequence numbers. Sticky cancellation cannot
be overwritten by late provision/Resume. Uncertain imports are cleaned, not replayed.

| Property | Recovery Testing | Persistent Database Restore |
| --- | --- | --- |
| Purpose | pluton-phase6-recovery-only | pluton-persistent-database-restore-v1 |
| Guard | pluton_recovery_guard | pluton_restore_guard |
| Successful result | SQL validation and exact physical cleanup, then Passed | Validated database remains Active |
| Lifetime | Two-hour bounded intent; immediate normal cleanup | Explicit TTL, default 24 hours |
| Restart | Durable sessions/leases and physical receipts | Preserve identity/data; explicit Resume if stopped |

Legacy/manual records are not silently adopted. Existing after-backup policy,
exact snapshot/artifact verification, credential files, verified TLS, non-admin
grants, ownership cleanup, production-target refusal and Phase 7 outbox remain.
No source-Agent contact, restore-to-original or repository maintenance is added.
Internal MySQL remains unsupported; existing Custom MySQL/Oracle worker unchanged.

Root approvals/CA/receipts are readonly app binds. Logs/UI expose positive safe
fields, never passwords, native output, SQL, cookies/JWTs, mailbox tokens or
temporary config contents. Do not export target metadata, SQLite or keys.

Resume revision recognition uses only an already validated mailbox descriptor's
device/inode/nanosecond modification/change times and a content digest. The root
reader rejects concurrent in-place changes. No caller-supplied path, nonce,
command or Agent protocol field was added. Uncertain consumed Resume is not
replayed; the administrator must explicitly request it again.

## Resource policy

Reviewed immutable images remain MariaDB 11.8.8 and PostgreSQL 18.6 Bookworm,
pinned in deploy/persistent-restore/operator.cjs. DBs run UID/GID 999, readonly
root, no added capabilities/privileged mode/host ports, verified TLS, 2 GiB RAM/no
swap, 1 CPU, 128 PIDs and bounded tmpfs. Pluton stays UID/GID 10001 without a socket.

A verified installation-owned lock volume and one unremoved automatic reservation
limit heavy Internal work globally, including retained Active data. Running manual
activations refuse admission. SQL default stays **128 MiB**, not a historical
pilot's larger dump size. Any increase requires independent root/engine policy
and capacity review. The 4x SQL + 256 MiB estimate does not replace real quota.
Memory/cgroup v2/CPU/PSI/disk reserve/capacity remain independently checked; unknown
measurements fail closed. Backups are not paused or reconfigured.

Storage is fully allocated 2 GiB ext4, not tmpfs or unbounded DB volumes.
Bounds: 8 KiB requests, 64 mailbox entries, 8 artifacts, 4096 root audit records.
Audit archival is explicit. Per-job cleanup does not remove installation control
volumes/networks. Unknown partial creation remains Cleanup Required, never adopted.

## Real disposable-VM evidence

Read-only SSH checks confirmed a separate KVM Ubuntu 24.04 guest, kernel 6.8,
systemd 255, 4 vCPU, approximately 4 GB RAM, approximately 30 GB free on a dedicated
ext4 test disk, Docker 29.9.1 and Compose 5.6.0. No hypervisor or production host
was accessed. Actual addresses/accounts/SSH material are omitted from this public
report.

Private Node 24.16.0 was checksum verified; no global Node upgrade or apt install.
Successful rehearsal Docker AND containerd had their own socket/namespace/data/
state/config/logs inside a manifest-owned fixture-disk directory. Default daemon
was not used for imports. An initial bootstrap selected system containerd despite
custom Docker data-root; caught before image/workload creation and corrected to
an independent containerd. Default daemon inventory remained unchanged.

Fresh working-tree compiled backend/migrations were readonly binds into a cached
native-client runtime, not a newly released production image. App/store processes
were UID 10001 and DBs UID 999. Only the guest-host operator had root/mount/loop
authority. The observer predated target creation and had no network/socket,
additional capability or writable DB bind.

| Real scenario | MariaDB | PostgreSQL |
| --- | --- | --- |
| Disposable provision -> TLS/guard -> SQL content -> native SQL cleanup -> Removed | Passed | Passed |
| Retained import -> new app/store process -> same SQL content | Passed | Passed |
| Docker restart -> Stopped -> explicit Resume; same CID/inode/UUID/data | Passed | Passed |
| Existing observer sees new kernel-RO child and cannot write | Both modes passed | Both modes passed |
| Dense 2 GiB ext4, actual ENOSPC, valid data after filler removal/Resume | Passed | Passed |
| Cancel before provisioning: positive absence, no creation | Both modes passed | Both modes passed |
| Cancel during active real provisioning: no import, owned cleanup | Both modes passed | Both modes passed |
| Cancel running artifact-stream import: native cleanup, no leases/credential files | Both modes passed | Both modes passed |
| Kill root cleanup after durable deletion intent: fresh reconciler reaches Removed | Both modes passed | Both modes passed |
| Wrong token/snapshot/digest/mode: target/journal/receipt unchanged | Passed | Passed |
| Retained backend binding/resource/kernel-RO admission before import | Passed | Passed |

Every quota image measured **2,147,483,648 bytes**, fully allocated; actual ext4
capacity was **2,040,373,248 bytes** (metadata is not usable DB storage). Final
cycles hit ENOSPC with fillers of 1,873,649,664 bytes (MariaDB) and 1,966,858,240
bytes (PostgreSQL), plus native DB data. Less than one free block remained, host
test-disk reserve stayed protected, and SQL content survived filler removal/Resume.

Initial buffered-write fixture attempts were OOM-killed in their small cgroup:
**not** ENOSPC passes. Final non-root helper uses bounded allocation/small writes
and requires a real ENOSPC syscall. Known partial filler/storage resources were
individually verified before removal; no unknown resource was deleted.

An initial cleanup-interruption harness treated systemctl nonzero dispatch to an
already-killed secondary process as failure. Final proof requires a frozen main
PID before SIGKILL, absent PID/inactive unit after it, durable deletion intent,
and successful fresh reconciliation. A subprocess/daemon error is never empty
inventory. Other initial fixture schema/session errors were repaired in fixtures,
not by bypassing production guards.

The sanitized journal records 117 successful app phases, 16 live kernel-RO
observations, 24 rejected binding/token substitutions, four real ENOSPC cycles,
four provisioning cancellations, four import cancellations, four interrupted
cleanups, and two identity-preserving Docker restarts. These are event counters,
not 117 independent end-to-end tests. Eleven refused attempts during investigation
are retained as failure evidence; they are not relabeled successful runs.

### Earlier namespace/quota rehearsal cleanup

**Verified complete.** All 28 root journals reached Removed; no pending mailbox
requests remained. Final fixture inventory: **0 containers, 0 volumes, 0 test
networks, 0 Docker images, 0 mounts, 0 loop devices, 0 ext4 disk images**.
Both exact manifest-owned fixture directories (including the interrupted first
bootstrap), private Node installations, image-transfer archives and private
Docker/containerd data were removed after absence/process checks. Private daemon
and transient test-service inventory was zero.

An independent final host check confirmed zero fixture mounts, zero loop devices,
both directories absent, and unchanged default-Docker inventory: 0 containers and
0 images. Test-disk free space returned to 31,899,197,440 bytes. Root SSH was closed.
No VM deletion was used as a substitute for cleanup verification.

Cleanup initially refused four unexpected anonymous volumes. These were traced
to the observer's immutable runtime VOLUME /data: fresh isolated daemon, exactly
four observer starts, Docker anonymous labels, creation window, exact volume paths
and untouched UID-10001 empty image-directory skeletons. Only after this proof
were they removed. Future observers explicitly override /data with bounded tmpfs.
Image provenance was checked against the original SHA-verified export: its OCI
index ID and classic-store config ID differ, but config/layer identities matched.

The cleanup runner refuses unknown/non-Removed resources and does not use Docker
prune or broad disk-root deletion. Only sanitized event evidence was exported,
never SQL, credential files, private keys or application SQLite. Saved event-journal
SHA-256: 33c846764b584fc6052f5f333866ca25ce8bd5399ab10e4532404e1eff793015.
Thirty exact local temporary transfer archives were also removed after path and
evidence-checksum verification; the two sanitized event journals were preserved.

### Cold-boot and real HTTP API acceptance

A fresh isolated installation on the same disposable guest used two new Restic
0.19.1 repositories and actual full-ID snapshots, with filesystem data plus valid
synthetic MariaDB/PostgreSQL SQL artifacts. Plan/backup/agent metadata was seeded
offline for this test; this is **not evidence of a new Agent source backup**.
The running application used the genuine resolver, encryption, exact-snapshot
metadata binding, readonly SFTP repository transport, digest checks, migrations,
SQLite stores, authenticated routes, lifecycle reconciler and native importers.
No production repository, snapshot, source or credential was contacted.

For each engine the actual API completed:

1. Login and exact-snapshot preparation with SQL artifact/resource availability.
2. Explicit persistent Internal restore confirmation -> host provisioning ->
   verified TLS/non-admin native import -> Active and catalog/content validation.
3. Stop -> Stopped -> explicit Resume -> same content, then confirmed Delete ->
   Deleted with cleanup verified and the bound root receipt Removed.
4. Required-import Recovery Testing -> actual Restic restore -> filesystem and
   SQL digest validation -> native import/catalog validation -> SQL/workspace/
   infrastructure cleanup -> Passed. SQL success alone does not mean Passed:
   the interim cleanup-required result resolves only after the root receipt.

Unauthenticated API requests returned 401; cross-origin, forged Host/forwarded
origin and non-JSON requests returned 403. No cookie, password or request token
was included in saved evidence. Database containers had no published ports.

Exactly two approved guest reboots were performed: one retained MariaDB and one
retained PostgreSQL. Each boot changed the kernel boot ID and preserved container
ID, snapshot binding and full storage identity (device/inode/UUID). Per-boot
systemd monotonic timestamps/journal verified anchors before Docker, initial root
reconciliation before the application. The retained DB was not imported again.
Explicit API Resume restored verified TLS/content access, with the actual child
mount read-only to UID 10001 and a denied write probe.

Qualification: the first MariaDB boot exposed stale public Active state; its
state-publication fix was applied after that boot. PostgreSQL then cold-booted
with that fix. The consumed-Resume replay fix was added after both reboots, tested
in both engine decision layers and against a real later-stopped PostgreSQL with
the running application replay loop, then fresh API Resume/content verification.
The separate final, subsequently approved boot is documented in the final
follow-up below; it closes that consumed-Resume timing qualification. Long natural TTL expiry was not waited
end-to-end; stored 24-hour retention, retained data across downtime, explicit
deletion and deterministic expiry/refusal tests were verified.

The guest's fixture application unit starts only its recorded container IDs on
the private daemon; it intentionally does not use a production Compose directory.
The production sealed-Compose launcher is covered by the 9 boot-policy and 21
deployment-policy tests, not claimed as a production Compose installation/reboot.
A site's actual overlay/service contract still requires its own staging review.

The earlier private browser fixture used normal login and an SSH-forwarded loopback-only
endpoint, without credentials in URLs or authentication bypass. The browser
client refused navigation (ERR_BLOCKED_BY_CLIENT), while the same endpoint's
HTTP health returned 200. That automation attempt alone was **not a visual pass**;
the later user-performed visual UAT is recorded separately below. No screenshot is claimed.
The temporary browser proxy is test-only code, never an application/deployment
service. Run the manual wizard acceptance below before final production sign-off.

### Earlier cold-boot/API fixture cleanup

**Verified complete.** All **8** automatic root journals reached Removed. Actual
application SQLite read-only queries proved zero non-Deleted retained restores,
active recovery tests, native import leases and unfinished lifecycle records.
Only then were the identified application/SFTP containers and volumes removed.
The private daemon inventory was zero containers, volumes, test networks and
images. All six installation anchors were unmounted after verifying zero target
mounts/loops/disk images. Both private daemons were stopped, and all **13**
hash-recorded persistent test unit/drop-in files were removed. No unknown resource
was adopted, force-unmounted or erased.

After exporting only the sanitized event journal, the exact verified fixture
directory (including synthetic repositories, SQL, generated credentials, private
Node and daemon data) was removed. An independent host check found zero fixture
child mounts, loop backing files, unit files or active fixture units. The dedicated
disk contained only its pre-existing root-owned `lost+found`; available space
returned to **31,899,197,440 bytes**. Default Docker remained unchanged at zero
containers/images. The SSH tunnel and root SSH session were closed.

Saved final event-journal SHA-256:
`24da8647d8ed09de617eb67117d177075175b35b7df0130b9dee52244c15fe58`.
It contains event counts, not secrets or SQL: two real boot identity/order proofs,
four persistent restore requests, four recovery-test requests, eight TLS/content/
readonly import proofs and the verified cleanup. Refused/interim attempts remain
in the evidence; they are not silently converted into independent test passes.

### Final visual-UAT / consumed-Resume acceptance and cleanup

After the user's explicit visual-completion confirmation, read-only SQLite
inspection of the held fixture independently found both engine restores Deleted
with verified cleanup, both Recovery Tests Passed, zero import leases and four
Removed lifecycle records. No status/lease was edited to obtain these results.

The final approved **one** PostgreSQL guest reboot passed with the existing
architecture: real exact-snapshot restore, preboot Stop/Resume, unchanged container
ID and ext4 device/inode/UUID, bound snapshot and mailbox hash, unchanged consumed
Resume revision, Stopped after boot across repeated reconciliation, unchanged
preboot import timestamps, and ordered persistent anchors/Docker/reconciler/app.
A fresh authenticated Resume returned Active. Native TLS/content/catalog checks
again verified the synthetic table and denied application writes through the
kernel-readonly view. Inspect succeeded; Delete reached Deleted/cleanup verified
only after the automatic Removed receipt. Verified quota remained exactly
**2,147,483,648 bytes**. No additional reboot was performed in this follow-up.

The final ownership-checked cleanup is **complete**, not intentionally held:

- All **5** root lifecycle journals reached Removed; application read-only
  assertions found zero non-Deleted retained rows, active recovery tests, import
  leases and unfinished lifecycle records before removing the application.
- Exact identified application/SFTP containers and fixture-owned volumes were
  removed. The private daemon had zero containers, volumes, test networks and
  images, and zero target disk images or loop devices. Six verified anchors
  were unmounted, both private daemons stopped, and **13** hash-recorded unit/
  drop-in files removed.
- Only the sanitized event journal was exported. After positive resource/process
  absence and exact directory/manifest checks, the fixture directory including
  synthetic SQL, repositories, credentials, root journals, private Node and
  daemon storage was removed. Independent checks found zero fixture mounts,
  loop backing files, processes, unit files or active units. The dedicated disk
  contained only pre-existing `lost+found`, with **31,899,197,440 bytes** free.
  Default host Docker remained unchanged at zero containers/images.
- Guest systemd audit history is intentionally retained; global journald was not
  erased. Only the fixture's private root journals/data were removed. The root
  SSH session was closed. A forwarding terminal started by the user can now be
  closed; it is not a remaining application service.

Final exported sanitized journal SHA-256:
`23d69ab3b74559bae03f2cb5968919e33bad3ba7704a52789eb6c1e89edd53b0`.
Its two postboot identity checks describe the **same single reboot**, not two
reboots. It also contains three real SQL/TLS/kernel-RO content proofs and cleanup
events. User browser actions were not routed through the fixture API helper;
manual UAT is supported by the user's confirmation and the read-only application
results, not fabricated helper-event counts. The independent post-removal check
occurred after the export; its zero-resource result is recorded here, not claimed
as an event inside that immutable journal.

Acceptance verdict: the requested disposable-host lifecycle, quota, native
MariaDB/PostgreSQL API/manual UAT and final consumed-Resume boot gates passed.
Ready for branch/security review and a separately approved site-specific staged
deployment. No production installation or universal host compatibility is
certified. Remaining limitations: frontend lint's existing toolchain failure;
no second manual visual/assistive-technology pass of the final presentation
refinement; no long natural TTL wait (deterministic expiry tests only); and the
actual production Compose/host security contract still requires review. MySQL
implementation was not started on this branch.

## UI stability and honest progress follow-up

The display-only changes do not alter backend job stages, polling intervals,
admission, SQL size/quota, cancellation, ownership, cleanup receipts or API payload
authorization. No new schema or Agent/protocol change is introduced here.

- Stable modal layout is opt-in for the Restore Wizard, Recovery confirmation
  and Recovery result. Polling cannot re-trigger entry animation or switch the
  height-based centering mode. One bounded scroll plane and stable scrollbar
  gutter preserve position. Focus is initially contained/restored; if a terminal
  stage removes the focused cancel button, focus falls back to the dialog without
  scrolling rather than to the document body. Close/Escape/backdrop are blocked
  while an explicitly pending confirmation is non-dismissible.
- Refresh retains the form and selection/retention. Only changed verified
  metadata revokes acknowledgements; it does not remount the controls. Confirm
  remains unavailable while checking, on an error, or without current approval.
  The local verified-token bookkeeping is not submitted in the request body.
- A one-second **local** display clock uses backend `createdAt` and terminal
  timestamps. The label explicitly includes queued time; import duration freezes
  at `completedAt`. Missing/invalid timestamps say Not recorded, negative/skewed
  durations are not invented, and terminal jobs release the interval. Browser
  clock skew can affect the live estimate; authoritative final duration wins.
- Provision/restore/import/validate/cleanup use actual backend stage labels and
  native indeterminate progress, without an invented percent, rate or stage ETA.
  Successful completion is binary and comes from the reported backend result;
  pending/uncertain cleanup or failure cannot fill the progress bar. Stage changes
  have a polite live region outside the busy track; the per-second clock is not
  announced repeatedly. Reduced-motion styles and theme tokens are retained.
- Host Ready/Stopped is separate from the historical import stage. Automatic
  intents say they await the reconciler, not that a manual provision/deactivation
  has to be done, and not that Stop/Resume has already completed. Manual targets
  retain their truthful manual instructions.

The seven added tests exercise actual React 18 DOM updates, forms, controls,
focus, scroll, timers, native progress semantics, refresh/token changes and
completion using jsdom. jsdom `30.1.3` is development-only; React/ReactDOM are
explicitly pinned as development peers to the existing `18.3.1`, not upgraded
to documentation's isolated React 19. Frozen-lockfile install passed. No runtime
dependency, polling endpoint or background lifecycle task was added. These DOM
tests are **not a pixel-layout, browser/OS focus or screen-reader certification**;
the user's successful visual UAT preceded the refinements.

## Automated validation

| Check in this follow-up | Result |
| --- | --- |
| Complete backend Jest | 169 suites: 3311 passed, 4 existing skipped, 0 failed; includes Phase 5/6/7, authorization/CSRF, legacy and MySQL regressions. |
| Host/operator/security, deployment and origin, 12 files | 88 passed, 0 failed, 0 skipped (includes three visual-fixture/proxy tests). |
| Python boot / deployment policy on Linux | 9 + 21 passed, 0 failed. |
| Frontend utility/component/DOM | 143 passed, 0 failed; seven new progress/dialog interaction regressions. |
| Agent on Windows | 45 passed, 75 Linux-only skipped, 0 failed; Agent source/protocol unchanged. |
| Agent in disposable Linux as non-root | 85 passed, 35 skipped, 0 failed. Remaining skips require fixture native tools not installed in the host test PATH; not claimed as full native Agent integration. |
| Backend/frontend typecheck and backend lint | Passed. |
| pnpm build | 3 tasks passed, 0 cache hits; frontend/docs, backend and Agent production builds. Clean standalone frontend build also passed. An initial concurrent install/build replaced Windows command shims mid-run; rerun after installation completed passed. |
| Operator/fixture syntax, git diff --check | Passed. |
| Frontend lint | Existing ESLint 10/typescript-eslint string-extends configuration failure. Not disabled or claimed passed. |

Previous unprivileged native/Internal and Oracle MySQL/Custom integrations are
historical evidence, not new real-MySQL or production acceptance claims here.
No real source Agent backup was run. An initial Linux Agent attempt omitted the
private Node directory from PATH and failed fixture subprocess creation; fixing
the fixture PATH produced the result above, without relaxing tests. One initial
Python deployment-policy run lacked the transferred Compose fixture; it passed
after transferring that source file. Existing bundle,
Browserslist, loader and MaxListeners warnings are separate from failed tests.

Reproduction, Node 24 and pinned pnpm 10.20.0:

    pnpm --filter @plutonhq/core-backend test --runInBand --silent --verbose=false
    pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
    pnpm --filter @plutonhq/core-backend lint
    pnpm --filter @plutonhq/core-frontend exec tsc -b
    node --experimental-strip-types --test frontend/__tests__/*.test.ts
    node --test scripts/__tests__/automaticRecovery*.test.cjs scripts/__tests__/persistentRestore.test.cjs scripts/__tests__/internalRecovery*.test.cjs scripts/__tests__/databaseRecoveryImage.test.cjs scripts/__tests__/mysqlRecoveryWorkerImage.test.cjs scripts/__tests__/deployment.test.cjs scripts/__tests__/dualOrigin.test.cjs
    python3 scripts/__tests__/automaticRecoveryBoot.test.py
    python3 scripts/__tests__/deployment_policy_test.py
    pnpm --filter @plutonhq/pluton-agent typecheck
    pnpm --filter @plutonhq/pluton-agent test
    pnpm build
    git diff --check

## Disposable-only rehearsal tools

scripts/automatic-recovery-vm-* and the automaticRecoveryVm.smoke.mjs integration
are test tools, not app endpoints or production installers. Allowed disk prefix:
/srv/pluton-fixture/lifecycle-lab-<random-32-hex>. Trusted host-code profiles are
not UI/mailbox/environment selectors.

Use a separately approved KVM/systemd guest with 4 vCPU/4 GB/10 GB free dedicated
ext4. Transfer only enumerated source/compiled code and reviewed image exports;
verify SHA-256. Never transfer .env, /data, real SQL, keys, repositories or production
config. Obtain root without passwords in files, shell history, arguments or env.

Bootstrap provides private pinned Node and isolated Docker/containerd. Init runs
in the guest host namespace; capability/tick/inspect/quota/interruption run in
transient systemd units retaining the reviewed production sandbox. App actions
use real compiled backend as UID 10001. Normal case: capability, case, app request,
sandbox tick, context, app import, app cleanup, sandbox tick, app receipt.
The observer must be running before target creation.

Use ownership-checked cleanup resources/finalize/remove phases, stop only exact
manifest-owned daemon units, export sanitized evidence, then independently verify
absence. Failed pre-install bootstrap has a separate strict cleanup path. Never
erase a VM/directory to hide failed cleanup. The acceptance runner installs
hash-recorded fixture-only persistent anchor/service units for the approved
reboots; cleanup removes only those exact verified units. It does not relax a
private Docker daemon's isolation.

## Deployment prerequisites and rollback

**Not performed here.** Production requires fresh authorization and the remaining
gates in the first table.

1. Package both operator directories together, including systemdStorage.cjs and
   bootstrap.sh, under root-owned non-writable parents. Record private checksums.
   Review trusted Node >=20, Docker CLI, OpenSSL, util-linux/ext4 tools; no global
   Node replacement.
2. Cache/verify exact engine digests (creation uses pull=never). Drain manual
   activations; do not adopt resources by renaming.
3. Init requires host namespace and refuses an existing automatic installation.
   Do not erase identity/journals or rerun init to silence refusals.
4. Install the persistent boot contract below before application use. Live
   installation binds/transient target units alone are NOT a durable boot recipe.
   Keep admission/policy/timer off until local security and acceptance review.
5. Preserve all old Compose overlays, volumes and networks. Automatic overlay
   is opt-in alongside persistent-restore; retained storage bind changes to
   app-view. Recreate app for the reviewed new bind contract. Old RW automatic
   views now fail closed.
6. First activation changes the sealed deployment mount contract: explicitly
   compare/approve effective config at an immutable digest with the existing
   deployment tooling. Do not delete .deploy-contract.json or automatically
   reseal a changed /data mapping. Ordinary updates must still reject drift.
7. Review both root policies/SQL budgets; automatic enabled defaults false.
   Enable timer/policy/PLUTON_AUTOMATIC_RECOVERY only after acceptance. First
   validate a new synthetic recovery-only job, not a production import.

### Safe host installation of persistent boot ordering

This is an operator-reviewed installation procedure, **not** a command for the
application, an automatic deployment hook, or permission to change production.
The normal Docker service gets a fail-closed dependency on the six anchors:
missing storage prevents Docker startup. This affects the entire host Docker
service, not only Pluton. Use a dedicated host or explicitly review the impact
on every co-located workload and approve a maintenance window first.

1. Keep automatic admission disabled; drain owned targets and record Removed
   receipts. Review existing manual/retained installations before any conversion.
   Never rerun `init` against existing config or remove installation identities.
   For a genuinely new installation only, run the reviewed operator `init` once
   in the host namespace; its two root policies default disabled. Persist the
   storage filesystem in the host's reviewed boot configuration before anchors.
2. Install the complete reviewed package at `/opt/pluton-recovery-operator`,
   including both operator directories, `deploy/compose-tools.py` and
   `deploy/healthcheck.cjs`. All parents/code must be root-owned and not group/
   world-writable, with recorded hashes. Use a verified Node >=20 at the reviewed
   ExecStart path, Python 3, systemd, Docker/Compose, OpenSSL, util-linux and ext4
   tools. A private Node path is allowed only by reviewed host unit/package edits,
   never a mailbox/environment selector. Do not replace unrelated system Node.
3. Create root-only mode-0600
   `/etc/pluton-automatic-recovery/application.json`, containing only
   `{"version":1,"deploymentDirectory":"/opt/pluton"}` (use the existing approved
   deployment directory). Do not copy secrets into it. Preserve the deployment's
   `.env`, `compose.overlays`, `.deploy-compose-files.json` and
   `.deploy-contract.json`; its immutable image and /data mapping must agree.
4. Render `deploy/automatic-recovery/bootUnits.cjs` as a review-only JSON manifest.
   It does **not** install anything. Inspect each of the six `.mount` unit names
   and paths, the anchors/application units and Docker drop-in. Install only
   reviewed non-conflicting unit text under `/etc/systemd/system` (root:root,
   0644), along with the supplied lifecycle service/timer. Never overwrite an
   unrelated unit/drop-in. Record names/hashes for rollback. View/app-view anchors
   use `bind,private,rshared`; readonly-stage uses `bind,private`. Preserve
   PrivateTmp, ProtectHome, NoNewPrivileges and UMask in all root services.
5. During the approved stopped/drained maintenance window, verify ownership and
   absence of target mounts before converting installation anchors to these
   persistent mount units. Never recursively unmount/delete an unknown mount.
   Reload systemd and run `systemd-analyze verify` on the installed units. Verify
   the host mount namespace topology; private-Docker mount namespaces fail closed.
6. Add the automatic overlay **after all existing approved overlays** and the
   persistent-restore overlay. Review/seal the intentional contract change through
   existing deployment tooling without deleting its previous contract or /data.
   Create/recreate Pluton only through that reviewed deployment procedure.
   `restart: on-failure` is intentional: Docker must not cold-start it before
   systemd reconciliation. Do not restore `unless-stopped` in a later overlay.
7. Root policy admission may be enabled only after budgets/engine digests are
   approved and cached. Start/verify the anchors, Docker, lifecycle service and
   application service in that dependency order. Enable the lifecycle timer.
   Docker's reviewed drop-in Wants the application boot service. On cold boot
   the launcher validates the sealed overlays, immutable image, existing
   UID-10001 container, mounts and restart policy, then only `compose start`.
   It never pulls, recreates, rotates credentials, runs migrations explicitly or
   activates optional dependency profiles. Ordinary image deployment remains
   the existing separately authorized deploy transaction.
8. Check application health, mount child RO flags and sanitized root receipts.
   Test new synthetic MariaDB/PostgreSQL jobs. Reboot only after separate explicit
   authorization; verify ordering, retained IDs, Stopped, explicit Resume and
   content before admitting real work. Operator package updates must stop the
   timer, wait for bounded reconciliation, and restart the application boot
   service if its required lifecycle service was stopped. Do not kill imports.

### Repeatable manual visual acceptance

On a fresh disposable fixture (the completed fixture is cleaned, not retained as
a hidden service), use a normal browser and administrator session. Select the
synthetic completed snapshot, open Restore Database Wizard, verify engine,
stable DB ID/full snapshot, Internal availability, resource and security
acknowledgements, and retention. Confirm restore, observe Active, inspect catalog,
Stop/Resume, then Delete and wait for verified physical cleanup. Repeat for the
other engine. Run Recovery Testing with import Required/Internal; verify the
same snapshot, artifact/import pass and all cleanup fields before Passed. Check
the Stopped/Resume display after the separately approved boot rehearsal.
Do not use production artifacts just to finish this visual gate.

### Operator-held Windows visual fixture

The new fixture uses the same reviewed isolated host Docker/containerd, root
operator/systemd isolation, non-privileged containers, 2 GiB ext4 quota and
128 MiB SQL limit. Only fixture code/data changed: paused synthetic plans now
contain normal interval/prune/stats/history structures rather than API-only `{}`
settings, and measured counters/full snapshot IDs come from actual Restic JSON.
No application, import, Agent, storage or lifecycle architecture was changed.

The test-only proxy is now transparent and **cannot auto-login**. It does not
load credentials or create tokens; `/__fixture/*` returns 404. It listens only on
guest `127.0.0.1:15174`, validates the exact incoming Host and loopback peer, strips
forwarded headers, and preserves normal Origin/cookie/authentication behavior.
No application or database host ports are published. The authorized SSH session
is the only network access path. Synthetic credentials are root-only mode-0600
on the guest and must be read privately via SSH, never copied into Git/chat/docs.

On the operator's Windows laptop, substitute only the separately provided lab
SSH account/key (these public documentation addresses are deliberately synthetic):

```powershell
ssh -N -i "$env:USERPROFILE\.ssh\lab_key" `
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
  -L 127.0.0.1:15173:127.0.0.1:15174 operator@192.0.2.10
```

Keep that terminal open and use a private browser window at
`http://127.0.0.1:15173`. Do not replace the address with `localhost`, a LAN IP,
HTTPS or a different port: APP_URL is exactly the loopback HTTP origin and no
additional origin/TRUST_PROXY is enabled. Normal host-only token cookies retain
HttpOnly, SameSite=Lax and Path=/, with Secure=false only for this approved HTTP
loopback origin. Laptop-to-guest transport is encrypted by SSH; production HTTPS
and its Secure cookies are unchanged. Use a separate browser session to avoid
cookies/service workers from another localhost application.

Readiness verified through this actual Windows forwarding path: app/health 200,
anonymous session 401, auto-login path 404, forged Host 403. Normal API login via
the proxy verified cookie attributes and both paused plans/history/exact-snapshot
preparations with automatic lifecycle available. No restore was pre-created:
zero lifecycle journals/mailbox requests and empty Restore Management were
verified before handoff. These checks do not replace the user's visual test.

Test `Synthetic mariadb fixture`, then `Synthetic postgresql fixture`:

1. Plan -> Backups -> row menu -> Restore Database. Check the stable database ID,
   full snapshot, SQL digest, Internal automatic destination, budgets and required
   acknowledgements. Use 24-hour retention for a retained/manual test.
2. In `/database-restores`, wait for Active, inspect, Stop -> Stopped, Resume ->
   Active, then confirm Delete using the exact displayed restore ID. Wait for
   Deleted, cleanup verified and host Removed before the next heavy Internal job.
3. Back in the same backup row menu, Run Recovery Test with database import
   Required and Internal. Wait for artifact/import pass and all cleanup fields
   before accepting Passed. Repeat sequentially for the other engine.

One unremoved Internal restore (even Stopped) intentionally reserves the global
heavy-work slot. Do not work around this refusal or alter quotas/permissions.
Do not enable the paused plans, use Backup Now, run repository maintenance or
change resource/security settings. Normal per-restore TTL still applies while
the fixture is held; it is not disabled to make a test indefinite.

The user explicitly confirmed both visual UATs complete and authorized **one
additional guest reboot** after completion, because consumed-Resume handling
postdated the earlier two boots. This approved follow-up was performed: a new
synthetic PostgreSQL retained restore completed, Stop/Resume/content passed, then
its exact container/storage/snapshot/request hash and consumed-Resume revision
were checkpointed. After the single reboot they all matched, the database stayed
Stopped across repeated reconciliation, and API import timestamps still preceded
the boot (no re-import). Per-boot journal verified anchors before Docker before
initial reconciliation before the application. PrivateTmp/ProtectHome remained
enabled. Fresh explicit Resume and final cleanup are detailed below.

Existing additive migration **0015** supplies the separate lifecycle ledger/
reservation, receipt sequence and nullable recovery stage. Namespace follow-up
adds no further migration. Existing plans/snapshots/credentials/leases/outbox are
not rewritten. **No Agent update or Agent protocol change.** The additive v1
file-mailbox is server-to-root-operator only.

Rollback: stop admitting new automatic jobs but keep the current app/operator
able to finish owned cleanup. Do not turn root policy off before draining: that
also blocks cleanup. Obtain exact Removed receipts or independently reviewed
retained-data ownership handoff. Then disable automatic flag/policy/timer and
restore the old approved overlay contract/immutable server image. Retain a capable
operator/journal until any retained-data handoff is complete.

Preserve SECRET, ENCRYPTION_KEY, /data, SQLite, installation identity, approvals,
leases, volumes, repositories/snapshots, Agent identities and Phase 7 outbox.
Never use compose down -v, drop migration 0015, overwrite current ownership SQLite
with stale data, delete unknown storage, rotate credentials or re-enroll Agents.
Root operator package rollback is separate from the server image.

After draining and recording Removed (or an independently approved ownership
handoff), stop the timer and application boot service in a maintenance window.
Remove only recorded owned boot units/Docker drop-in, reload systemd, and restore
the previous approved Compose restart/mount contract and immutable server image.
Review the Docker-host impact before restarting it. Keep anchor/storage/owner
metadata intact whenever any retained database still exists; never unmount it as
a shortcut. No automatic reboot or database reset is part of rollback.

## Changed files

Changed/new paths in the complete uncommitted feature are listed below. The VM follow-up focuses
on systemdStorage, narrow operator/storage fixes, kernel-RO backend checks,
automatic Compose binds, regressions/VM tools and this report. Earlier lifecycle,
UI and additive schema work is preserved.

    .dockerignore
    .env.template
    .github/workflows/container.yml
    backend/__tests__/integration/automaticRecoveryNative.prepare.mjs
    backend/__tests__/integration/automaticRecoveryApi.inspect.mjs
    backend/__tests__/integration/automaticRecoveryApi.seed.mjs
    backend/__tests__/integration/automaticRecoveryVisual.fixture.mjs
    backend/__tests__/integration/automaticRecoveryNative.smoke.mjs
    backend/__tests__/integration/automaticRecoveryVm.smoke.mjs
    backend/__tests__/services/DatabaseRestoreService.test.ts
    backend/__tests__/services/RecoveryTestService.test.ts
    backend/__tests__/utils/automaticRecoveryLifecycle.test.ts
    backend/drizzle/0015_automatic_recovery_lifecycle.sql
    backend/drizzle/meta/_journal.json
    backend/src/createApp.ts
    backend/src/db/schema/recoveryTests.ts
    backend/src/services/DatabaseRestoreService.ts
    backend/src/services/RecoveryTestService.ts
    backend/src/stores/DatabaseRestoreStore.ts
    backend/src/types/recoveryTests.ts
    backend/src/utils/automaticRecoveryLifecycle.ts
    backend/src/utils/internalRecoveryTargets.ts
    backend/src/utils/persistentRestoreTargets.ts
    backend/src/utils/recoveryDatabaseImport.ts
    deploy/automatic-recovery/operator.cjs
    deploy/automatic-recovery/application.cjs
    deploy/automatic-recovery/bootUnits.cjs
    deploy/automatic-recovery/pluton-recovery-lifecycle.service
    deploy/automatic-recovery/pluton-recovery-lifecycle.timer
    deploy/automatic-recovery/systemdStorage.cjs
    deploy/compose.automatic-recovery.yml
    deploy/compose-tools.py
    deploy/persistent-restore/operator.cjs
    deploy/persistent-restore/storage.cjs
    docs/AUTOMATIC_RECOVERY_CONTAINER_LIFECYCLE.md
    frontend/__tests__/databaseRestores.test.ts
    frontend/__tests__/recoveryProgress.test.ts
    frontend/package.json
    frontend/src/@types/databaseRestores.ts
    frontend/src/@types/recoveryTests.ts
    frontend/src/components/Plan/RecoveryTesting/RecoveryConfirmation.tsx
    frontend/src/components/Plan/RecoveryTesting/RecoveryResult.tsx
    frontend/src/components/Restore/DatabaseRestore/DatabaseRestoreWizard.tsx
    frontend/src/components/common/Modal/Modal.tsx
    frontend/src/components/common/Modal/Modal.module.scss
    frontend/src/components/common/OperationProgress/OperationProgress.tsx
    frontend/src/components/common/OperationProgress/OperationProgress.module.scss
    frontend/src/routes/DatabaseRestores/DatabaseRestores.tsx
    frontend/src/utils/databaseRestores.ts
    frontend/src/utils/recoveryConfirmation.ts
    frontend/src/utils/recoveryProgress.ts
    pnpm-lock.yaml
    scripts/__tests__/automaticRecoveryLifecycle.test.cjs
    scripts/__tests__/automaticRecoveryBoot.test.cjs
    scripts/__tests__/automaticRecoveryBoot.test.py
    scripts/__tests__/automaticRecoveryVisual.test.cjs
    scripts/__tests__/automaticRecoveryNamespace.test.cjs
    scripts/__tests__/automaticRecoveryPublication.test.cjs
    scripts/__tests__/automaticRecoveryRequests.test.cjs
    scripts/__tests__/runtimeReleaseBoundaries.test.cjs
    scripts/verify-runtime-release-boundaries.cjs
    scripts/automatic-recovery-vm-bootstrap.sh
    scripts/automatic-recovery-vm-acceptance.cjs
    scripts/automatic-recovery-vm-api.cjs
    scripts/automatic-recovery-vm-browser.cjs
    scripts/automatic-recovery-vm-cleanup.cjs
    scripts/automatic-recovery-vm-enospc.cjs
    scripts/automatic-recovery-vm-host.cjs
    scripts/validate-automatic-recovery-native.ps1
    scripts/validate-internal-recovery.ps1

## Final code/security review — 2026-10-17

Fresh second-pass review of the complete **70 changed/new files**, including
untracked implementation and tests, against the fork's live `main` verified as
`aeb36bd2dcdb5b4de05f9ad23560d49c86984dcf` (also the local branch/base HEAD).
The feature is still entirely uncommitted; review did not create a PR, push,
merge, release, access production, recreate the disposable VM or alter a target.

| Classification | Finding and disposition |
| --- | --- |
| **Blocker — fixed** | The privileged mailbox reader checked size before an unbounded `readFileSync`, so a racing writer could exceed the allocation budget; opening a FIFO could block before file-type validation. Fault-injection tests reproduced both missing defenses. It now validates the ID before opening, uses O_NOFOLLOW/O_NONBLOCK, reads at most 8193 bytes to enforce the 8192-byte limit, and rechecks size/mtime/ctime before accepting the same revision/hash. Four regressions cover valid/exact-limit input, invalid paths, special files/growth and concurrent mutation. Actual Linux UID-10001 checks passed for valid 8192-byte input, prompt FIFO rejection, symlinks and oversize. No added capability or root/VM action was needed. |
| **Blocker — fixed** | The new fire-and-forget `RecoveryTestService` stage write could reject without a handler. A forced advisory-write failure reproduced an unhandled promise rejection before the fix. The rejection now logs only a fixed safe event/code and stage; no raw error/provider output. Stage display is advisory; durable ownership, import lease, cancellation, terminal result and cleanup writes remain awaited and authoritative. The regression proves cleanup still verifies and sensitive diagnostic text is absent. |
| **Blocker — fixed** | CI previously typechecked/built the frontend but did not execute the polling/state/focus/progress regressions. All frontend tests are now a required `validate` step. The existing frontend lint exception is not applied to these tests. |
| **Non-blocker — verified / hardened** | Runtime packaging was already separated from privileged host code. Added a required UID/GID-10001, network-none, read-only, bounded artifact inspection in `build-pr`, plus its regression tests. VM rehearsal helpers are now excluded even from the Docker build context. Publication still requires both validation and runtime/import jobs. |
| **Non-blocker — verified** | Root mailbox fields remain an exact bounded allowlist: no caller paths, images, commands, Docker endpoint or SQL. Root-owned code/profiles, token/snapshot/artifact bindings, durable consumed Resume, monotonic receipts, ownership checks, private DB networks, pinned engines, SQL budget and exact 2 GiB storage boundaries remain intact. Malformed-input handling was hardened without changing valid lifecycle/wire/hash semantics or service isolation. |
| **Non-blocker — verified** | Migration 0015 is additive and preserves existing credentials/plans/snapshots; delete guards retain unresolved ownership. Existing manual/Custom targets, Legacy read-only, Phase 5/6 and notification behavior remain covered. Automatic rollback requires draining/handoff, preserving keys, /data, ownership records/leases and compatible cleanup code; an older image alone cannot safely retire retained infrastructure. |
| **Known limitation** | Frontend ESLint still fails at the unchanged baseline ESLint 10/typescript-eslint string-extends configuration. It is explicitly non-blocking in CI; not claimed passed or disabled by this review. |
| **Known limitation** | The final presentation refinement has DOM regression coverage, not a fresh manual browser/assistive-technology certification. Live elapsed time uses the browser clock relative to backend timestamps; no per-stage ETA/percentage is fabricated. |
| **Known limitation / deployment prerequisite** | Root/Docker dependency affects the host, so site-specific security/maintenance approval remains mandatory. Unknown/partially provisioned resources are intentionally retained for operator review. The 4096-entry root audit capacity fails closed and needs operator capacity planning. Clean guest reboot evidence does not certify abrupt power-loss recovery or every possible filesystem/topology. |

### Release-content and fixture isolation evidence

A fresh **local review-only** `Dockerfile.source` image was built from this
working tree. Its image identity was
`sha256:dc4dc20182408999a8d0865ebb038c08f32159bfe78054fa180e31f55edf2042`.
Actual non-root read-only inspection checked **1570 application/migration files**:
no application test fixtures, root host operator package, rehearsal helpers,
persisted DB/SQL artifacts, local configuration, private keys or developer/lab
paths were present. Intentional Drizzle SQL migrations remain. The development-only
jsdom package was absent from the production store and automatic lifecycle was
not enabled in the image. Image environment contained no SECRET, ENCRYPTION_KEY,
user/database/repository password or equivalent credential key.
After validation, the exact unused review image/tag was removed only after its
identity matched the recorded ID. Existing images and build cache were not pruned.

All changed/new source files were also scanned for known private infrastructure
identifiers, literal private keys, token-like values and personal developer paths;
none were found. Fixture generators and synthetic assertions intentionally remain
in the public **source test tree**, not the runtime release. The artifact scan
does not constitute a vulnerability audit of third-party production packages.

Four real local unprivileged native cases were rerun against that exact new
image: MariaDB and PostgreSQL, each disposable and retained. Bootstrap, SQL
content, credential-file 0600, no credential argv/environment, native ownership,
store restart/inspection and cleanup passed. This runner uses bounded tmpfs,
not privileged host ext4/loop mounts; it does not replace the earlier independent
VM quota/boot proof. No MySQL import or implementation was started. Subsequent
inventory confirmed zero matching test containers, volumes or networks.

The prior disposable-VM cleanup context remains Complete and its saved sanitized
journal SHA-256 still matches
`23d69ab3b74559bae03f2cb5968919e33bad3ba7704a52789eb6c1e89edd53b0`.
The VM was not accessed or re-created for this review; this is revalidation of
saved evidence, not a newly claimed host reboot/cleanup observation.
The reader hardening was verified by deterministic adversarial-file tests and
real Linux file operations in a separate UID-10001 official Node test container.
That container had no capabilities, network, host operator startup or Docker/
systemd socket. No additional privileged guest boot/mount rehearsal was claimed;
the valid request bytes/hash and lifecycle decision engine are unchanged.

### Review validation and PR recommendation

| Fresh check | Result |
| --- | --- |
| Backend full Jest | 169 suites, **3312 passed**, 4 existing skipped, 0 failed after fixes. The initial pre-fix rejection reproduction failed as expected. |
| Frontend utility/component/DOM | **143 passed**, 0 failed. |
| Operator/security/deployment/release boundaries | **95 passed**, 14 files, 0 failed. |
| Real MariaDB/PostgreSQL native cases | **4 passed**, owned fixture cleanup verified. |
| Actual Linux request-file boundary | Passed as UID/GID 10001 with no capabilities/network: valid exact-limit file, FIFO/symlink/oversize rejection. Separate disposable official Node test container, never the Pluton application or privileged root operator. |
| Agent compatibility | 45 passed, 75 platform/tool-specific skips on Windows; typecheck passed. No Agent change. |
| Backend/frontend typecheck, backend lint | Passed. |
| Production workspace build | 3 tasks successful; fresh local Docker runtime build/client validation and artifact inspection also passed. |
| Workflow syntax, formatting, patch whitespace | Passed. |
| Frontend lint | Known unchanged baseline failure, not passed. |

**GO to prepare the PR; not production deployment approval.** No unresolved
confirmed blocker remains. This review adds no migration, protocol change,
credential rotation, image publication or lifecycle behavior change. Required
GitHub checks before merge remain backend lint/tests/typechecks, all frontend
regressions, build/diff checks, host operator/boot/deployment policy tests, runtime
artifact inspection, native MariaDB/PostgreSQL imports/cleanup, dual-origin
authentication/CSRF and immutable deploy/rollback checks. Existing Oracle worker
and MySQL Custom regression checks remain mandatory for compatibility; their
implementation is unchanged. Privileged guest cold-boot/ext4/ENOSPC acceptance
is separately recorded evidence, not something this unprivileged CI can claim.

## RC-01 follow-up — durable explicit Resume — 2026-10-18

The earlier review/boot results above are historical evidence for their original
code. A later source audit found that an automatically reconstructed mailbox
could renew inode-based Resume authority. The separately authorized correction
adds migration0016 and a versioned Resume request. It does not rewrite applied
0015, installation identity, native leases or the historical acceptance record.

`automatic_recovery_lifecycle.resume_sequence` starts at0 for old rows. Only a
new authenticated explicit persistent Resume increments it, atomically with its
action under SQLite synchronous FULL. Background replay reconstructs the same
sequence. Values are bounded safe integers and cannot decrease. Existing Delete
precedence and immutable owner/snapshot/artifact binding remain enforced.

Legacy v1 provision/inspect/stop/delete retain their existing contract. A legacy
v1 Resume can only observe exact owned Ready/Stopped, never Start. New v2 Resume
requires a positive sequence. Root durably stores its maximum
`consumedResumeSequence` before Start, including when a target is already running;
equal/older requests never Start regardless of inode changes. A consumed Resume
also prevents an older Provision from restarting a created-but-never-ready target.
Native cleanup Start during normal authorized Delete remains separate and still
requires exact ownership before physical removal.

The root journal writer already fsyncs file and parent. Application publication
now fsyncs its private temporary file, renames and fsyncs the no-follow request
directory. A sync failure retains the durable intent and reports uncertainty;
it cannot allocate another sequence. Identical-byte replay retries directory
sync. Root may have observed a renamed intent already, so a failed response is
not proof that it never executed. Never retry uncertain SQL or infer consumption
from a physical Start or the old inode revision.

Crash after consumption but before Start intentionally leaves a burned sequence
and stopped target. After fresh host-state/binding and exact validated retained
lease verification, uncancelled/unexpired completed operations can return from
host-only uncertainty to Stopped. Recovery is a new human explicit Resume with
normal authentication and resource admission, allocating sequence+1. Recovery
does not auto-increment, Start, reimport, reset counters or erase journals. Any
unknown identity, lease, host state, cancellation or expiry remains fail-closed.

Deploy matching corrected app/root code and migration0016; old root rejects v2,
while new root refuses v1 Start. Receipts/worker SQL RPC stay unchanged. Existing
sealed host bundles/digests must be reviewed again; these mixed versions are not
a usable deployment even though they refuse safely. The VM evidence helper now
asserts exact requested/consumed sequence equality and preservation across boot;
the helper was not executed against a VM for this source correction.

Rollback remains drain-first. Keep cleanup-capable app/worker/root/timer active
until native leases and exact target removals or approved ownership handoffs are
resolved. Never drop0016, rewrite0015, restore old ownership SQLite or downgrade
to inode-only Resume while retained resources remain. The migration is additive
for older non-Resume SQL, which is not permission to bypass this rollback gate.

Deterministic unit/regression evidence covers all three engines, missing/replaced
mailbox, older-sequence replay, consumption/start crash models, concurrent Delete,
migration preservation and fsync failure. It is not a physical power-loss, new
human UAT or new cold-boot acceptance claim. No Docker, VM, sudo, real TTL hour,
reboot, source publication or production operation was performed. The historical
Docker discrepancy and hosted CI/reviewer/production blockers remain unchanged.
