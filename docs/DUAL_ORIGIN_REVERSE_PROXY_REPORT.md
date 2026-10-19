# Dual-origin web access and reverse-proxy compatibility

## 1. Baseline and confirmed original 403

Baseline: reviewed `origin/main` commit
`2a4daf3f80dad377088e17f0ffb45603ba016517`.
Branch: `codex/dual-origin-reverse-proxy`. No commit, push, merge, release,
deployment, production connection, secret rotation or repository operation was
performed. Examples below use synthetic infrastructure.

The exact response came from `databaseRestoreAdmin` in
`backend/src/routes/databaseRestores.ts`, before preparation/service execution.
The previous allowed-origin set was:

```ts
new Set([`${req.protocol}://${req.get("host")}`, new URL(APP_URL).origin]);
```

The operator confirmed that canonical configuration still selected private HTTP
and proxy trust was not enabled. With HTTPS terminated upstream, Express saw
HTTP. For the public request the two comparisons therefore represented:

- HTTP with the public Host;
- configured HTTP with the private Host/port.

Neither matched the browser's HTTPS public Origin. A synthetic regression
reproduces the same 403 from this exact branch. This was not a database,
lease, resource-admission or failed SQL-import response. Healthy health/backup
endpoints did not exercise this additional guard.

## 2. Effective configuration and precedence

Existing precedence remains: defaults < environment < recognized fields in
`/data/config/config.json`. Both `APP_URL` and `APP_ALLOWED_ORIGINS` support that
persistent override. Updating only a Compose environment value does not override
an old persistent value.

`AGENT_SERVER_URL` and `ALLOW_INSECURE_AGENT_HTTP` are environment/operator
transport settings, not new browser-editable credentials. The existing
`TRUST_PROXY` setting may also be overridden by persistent config.

Origins are validated during ConfigService initialization, before secret
generation/persistence, then reused when creating web middleware. Invalid
origin overrides fail closed instead of silently reverting to environment.
Invalid URL exceptions do not echo the supplied value, including embedded
credentials. No production configuration was read or modified.

## 3. Would changing APP_URL alone fix it?

Setting the effective `APP_URL` to the public HTTPS origin would fix that
particular old comparison. It would not provide a complete safe dual-origin
solution: cookies previously used a global Secure flag based solely on APP_URL,
so a public HTTPS setting prevented ordinary HTTP LAN login. The previous Host
fallback also admitted caller-selected origins, and two allowed origins were
not required to match the actual requested authority.

The fix combines explicit configuration with shared origin/session middleware.
Enabling broad proxy trust is neither the fix nor a prerequisite.

## 4. Explicit origin configuration

`APP_URL` remains one canonical web origin. `APP_ALLOWED_ORIGINS` is an optional
comma-separated list of explicitly approved browser origins; the canonical
origin is always included. Repeating it once in the list is supported, matching
the example below.

Rules:

- Exact HTTP(S) origins only; at most eight distinct origins.
- Normalize host case and default ports; an optional trailing root slash is
  normalized. No non-root paths, queries, fragments, userinfo or wildcards.
- Reject duplicate list entries after normalization, empty entries, malformed
  URLs, ambiguous authority/scheme mappings, or HTTP/HTTPS on the same hostname
  even at different ports. This also avoids mixed-scheme host-only cookie overlap.
- In explicit multi-origin configuration, plain HTTP is restricted to private
  IP literals/loopback/localhost; non-routable documentation addresses are
  accepted for examples/tests. Public HTTP and arbitrary HTTP DNS aliases are
  not added as LAN exceptions.
- An existing single HTTP APP_URL remains supported. No HTTP origin or LAN
  alias is enabled automatically.

Correctly configured single-origin deployments retain that operation without a
new setting. Previously implicit, unlisted Host aliases now need explicit
operator approval; retaining arbitrary Host reflection would violate the
security requirement.

## 5. Origin, CSRF, CORS and authorization rules

The requested raw Host/port must match exactly one configured authority. Its
fixed approved scheme identifies the effective browser origin even when a
trusted private upstream uses HTTP. Request headers cannot add an authority or
choose another scheme.

For browser mutations, Origin must equal that effective origin, not merely
appear somewhere in the allowlist. Present Sec-Fetch-Site must be same-origin.
Requests with bodies require JSON; empty-body operations such as logout retain
their existing support. Database Restore and notification mutations retain their
stricter JSON requirements and existing body/rate limits.

Thus public-Origin → private-Host and private-Origin → public-Host both fail.
Duplicate/malformed Host, unknown Host, foreign Origin and inconsistent
forwarding metadata fail. CORS reflects only the exact matching request origin,
never `*`; preflight cannot authorize crossing between approved sites.
Production CSP connect-src is `'self'`, without an untrusted dynamic Host
expression or a public-page HTTP LAN allowance.

Existing authenticated sessions, configured-administrator restore authorization,
resource restrictions, route-specific API-key permissions and rate limits remain.
The shared web boundary does not turn an approved Origin into authentication.
Denials never log cookies, JWTs, credentials or request bodies.

## 6. Is TRUST_PROXY required? SafeLine requirements

**No: TRUST_PROXY is not required for this implementation's web origin,
HTTPS cookie or dual-origin CSRF behavior.** Source and compiled-image TLS tests
pass with Express proxy trust disabled.

X-Forwarded-Proto/Host/Port are optional consistency checks only. If present they
must be a single value matching the already-approved mapping; they never confer
trust. No request-derived forwarded host/protocol becomes a trusted origin.
The actual Express request's transport properties are not rewritten.

This is an explicit virtual-host mapping, not cryptographic proof that a request
traversed the WAF. A raw HTTP client can manufacture headers but still needs
valid authentication; it cannot make a browser send another hostname's cookies.
Backend firewall isolation and public-edge HTTPS enforcement remain essential.

TRUST_PROXY may separately be needed for correct original-client IP attribution
and per-client rate limiting when SafeLine sends X-Forwarded-For. Without it,
public clients can share the last proxy's rate-limit bucket, and
express-rate-limit may warn about an untrusted forwarded-IP header.
Only enable it after reviewing the actual last-hop peer seen by the container,
firewall restrictions, and header replacement. With simultaneous direct LAN
and proxy paths, a blind `TRUST_PROXY=1` is not a safe general recommendation.
Never use `true`, `0.0.0.0/0` or a broad private subnet merely to remove a warning.
These constraints follow the
[Express proxy trust guidance](https://expressjs.com/en/guide/behind-proxies/).

SafeLine/edge contract:

1. Enforce HTTPS on the public site and preserve the original approved public
   Host, not the private upstream IP/port.
2. Remove/overwrite client-supplied forwarding headers. If supplied, use one
   original-browser `X-Forwarded-Proto: https`, one matching public
   X-Forwarded-Host, and `X-Forwarded-Port: 443`, not upstream port 5173.
   Do not append comma-separated chains to these three fields.
3. A proxy that already preserves Host and omits these optional headers needs no
   origin-specific change. A proxy that rewrites Host or sends inconsistent
   metadata must be corrected; do not compensate with permissive application trust.
4. Firewall application port 5173 to the WAF/private trusted administrative
   network and approved Agent sources. Do not publish it as a public WAF bypass.
5. Plain backend HTTP must remain inside the trusted network. Prefer verified
   TLS on that leg where infrastructure supports it.

No SafeLine, Cloudflare or firewall configuration was changed or inspected live.

## 7. Public HTTPS session behavior

Both JWT and temporary 2FA session cookies are HttpOnly, SameSite=Lax,
host-only, Path=/, and Secure on the approved public HTTPS site. Cookie security
is not globally downgraded for LAN compatibility.

The express-session wrapper supplies a request facade whose Secure determination
is the validated fixed origin. The underlying request still reports its real
HTTP transport; Agent authentication never sees a fabricated secure transport.
The existing production memorystore and session duration remain in use.
Anonymous API reads do not allocate saved session state.

Successful password or OTP login regenerates the temporary session, uses a fresh
JWT ID, and binds new signed tokens to the exact web origin. A token copied to
the other approved origin is rejected. Temporary session ownership is also
checked and regenerated if replayed at another origin.

## 8. Private HTTP session behavior and logout

An explicitly approved private HTTP authority gets its own host-only HttpOnly,
SameSite=Lax cookies without Secure, allowing HTTP LAN login. It does not receive
or downgrade the public hostname's cookies. Logout clears matching token/session
cookies and destroys that temporary server-side session.

Existing signed unbound JWTs remain compatible until expiry. On validated use,
legacy cookie flags are upgraded for the current origin without extending the
signed token lifetime or rotating secrets. New logins obtain origin-bound tokens.
Administrators should log out/in separately on each site after deployment.

HTTP does not encrypt passwords, cookies or content against LAN interception.
This is only appropriate on the operator-approved trusted private network.
Use private HTTPS/split DNS instead if the LAN cannot be trusted.
Stateless JWT logout continues to clear the browser cookie; it does not introduce
a new durable revocation service for already-copied tokens.

## 9. Remote Agent compatibility and canonical links

Agent requests retain their own HMAC/body/nonce/lease authentication and existing
transport exception. They do not require browser Origin headers or receive web
sessions. The exception covers only the actual `/api/agent` route boundary
(including case-insensitive routing), never `/api/agent-admin` or restore APIs.
Web HTTPS mapping cannot bypass Agent HTTPS policy.

Agents continue using their locally saved server URL; no server heartbeat,
enrollment identity or protocol message rewrites it. New enrollment instructions
may use optional `AGENT_SERVER_URL`; otherwise they retain the APP_URL fallback.
Changing APP_URL therefore need not point new instruction snippets at the public
domain either. Both Agent and server still require their existing explicit
trusted-LAN HTTP exceptions.

The server flag now parses `true/false/1/0` explicitly. JavaScript Boolean
coercion must not accidentally treat the string `"false"` as authorization for
insecure HTTP. Carry forward an intentionally enabled LAN exception as `true`;
do not rely on that previous coercion bug.

Existing canonical notifications/absolute links continue using APP_URL.
Production frontend API requests already use window.location.origin, so LAN
navigation/downloads do not redirect to the public site or introduce mixed content.
No Agent update/re-enrollment, worker protocol change or schema migration is needed.

## 10. Safe environment example

Replace these synthetic addresses with reviewed local values only in private
operator configuration, never tracked files:

```dotenv
APP_URL=https://pluton.example.internal
APP_ALLOWED_ORIGINS=https://pluton.example.internal,http://192.0.2.10:5173
AGENT_SERVER_URL=http://192.0.2.10:5173
ALLOW_INSECURE_AGENT_HTTP=true
TRUST_PROXY=
```

The HTTP Agent exception is deliberate for this example's private LAN, not a
new default. Keep the Agent's own HTTP permission unchanged. Do not add or
regenerate SECRET, ENCRYPTION_KEY, passwords or keys as part of this change.
Align/remove only stale APP_URL/APP_ALLOWED_ORIGINS overrides in existing
config.json; do not replace the entire config file.

## 11. Files modified

```text
.env.template
.github/workflows/container.yml
backend/src/utils/webOrigins.ts
backend/src/middlewares/webAccess.ts
backend/src/middlewares/authMiddleware.ts
backend/src/controllers/UserController.ts
backend/src/controllers/SettingsController.ts
backend/src/routes/databaseRestores.ts
backend/src/routes/notifications.ts
backend/src/services/ConfigService.ts
backend/src/services/AgentService.ts
backend/src/types/express-session.d.ts
backend/src/utils/helpers.ts
backend/src/createApp.ts
backend/__tests__/utils/webOrigins.test.ts
backend/__tests__/routes/dualOrigin.test.ts
backend/__tests__/routes/users.test.ts
backend/__tests__/routes/databaseRestores.test.ts
backend/__tests__/routes/notifications.test.ts
backend/__tests__/controllers/UserController.test.ts
backend/__tests__/services/ConfigService.test.ts
backend/__tests__/services/AgentService.test.ts
backend/__tests__/integration/dualOriginTransport.smoke.ts
deploy/compose.yml
deploy/.env.example
scripts/validate-dual-origin.ps1
scripts/__tests__/dualOrigin.test.cjs
docs/DUAL_ORIGIN_REVERSE_PROXY_REPORT.md
```

No changes to Agent source, package versions/lockfile, database migrations,
restore leases/importers, MySQL worker or repository maintenance code.

## 12. Added regression coverage

- 57 focused configuration/origin/session/route cases: original mismatch,
  normalization, invalid/wildcard/credential/path/duplicate origin input,
  both web origins, cross-origin refusal, forged Host/forwarding headers,
  JSON, auth/admin boundaries, password/OTP login, host-only Secure flags,
  legacy-cookie upgrade, fixation prevention, logout and actual HMAC heartbeat.
- Additional ConfigService tests prove persistent override precedence, fail-closed
  startup before key persistence, independent Agent URL and false HTTP flag behavior.
- AgentService verifies new enrollment instructions without touching identities.
- Three deployment/fixture contracts check middleware/CSP wiring and absence of
  new ports, privileges, Docker socket or persistent-data fixture mounts.
- Native fixture performs real verified TLS termination → HTTP upstream,
  direct HTTP access, cookie/login/logout and both preparation routes, as UID
  10001 with no proxy trust, network none and temporary synthetic data.
  It can import the production image's compiled JS instead of source, and CI
  now runs that compiled variant before publishing gates.

Preparation service results are synthetic in the web transport fixture: it
proves the HTTP/auth boundary, not a production SQL import. Native Phase 5/6
fixtures separately cover actual database/SFTP/Restic and staged restoration.

## 13. Validation results

| Check                                                               | Result                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Full backend                                                        | 163 suites; 3,194 passed, 4 existing skips, 0 failed                                            |
| Focused origin/session/route suites                                 | 57 passed, 0 failed                                                                             |
| Frontend utility/render + script contracts                          | 141 passed, 0 failed                                                                            |
| Linux Agent, correct non-root fixture with init and synthetic tools | 120 passed, 0 skipped, 0 failed                                                                 |
| Linux Phase 6/persistent focused backend                            | 12 suites; 307 passed, 1 skip, 0 failed                                                         |
| Native Phase 5/6                                                    | Five modes passed: filesystem, MariaDB, PostgreSQL, mixed, expected mixed failure/cleanup       |
| Native Phase 7                                                      | HTTP/HMAC/timeout/SMTP/restart/verified and untrusted TLS fixture passed                        |
| Existing Oracle MySQL worker                                        | All 12 native disposable TLS/import/cleanup/restart scenarios passed                            |
| Source and compiled image web transport                             | Verified HTTPS/HTTP, login, Secure flags, preparation, CSRF and logout passed                   |
| Typechecks                                                          | Backend, frontend and Agent passed                                                              |
| Backend lint                                                        | Passed                                                                                          |
| Production build                                                    | Frontend/docs/backend/Agent passed                                                              |
| Docker source image                                                 | Built locally; UID/GID 10001 and native recovery clients verified                               |
| Compose                                                             | Dual-origin settings validated using synthetic values, without startup                          |
| Frontend lint baseline                                              | Existing ESLint 10/typescript-eslint string-extends configuration error; not a source lint pass |

The initial ad-hoc Agent run omitted the init-reaper and tool fixture, producing
zombie-process timeout assertions and skipped lifecycle tests. Re-running the
unchanged suite in its proper non-root fixture yielded all 120 passes; no Agent
code or test was weakened. A legacy login fixture also needed explicit valid Host
headers and the updated JWT claims. Existing documentation CSS/chunk and Node
loader warnings are non-fatal and unrelated.

Commands, with pinned pnpm 10.20.0, include:

```powershell
pnpm --filter @plutonhq/core-backend test --runInBand --silent --verbose=false
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-backend lint
pnpm --filter @plutonhq/core-frontend exec tsc -b
pnpm --filter @plutonhq/pluton-agent typecheck
pnpm build
node --experimental-strip-types --test frontend/__tests__/*.test.ts scripts/__tests__/*.test.cjs
docker build --load -f Dockerfile.source -t pluton-dual-origin:local .
./scripts/validate-dual-origin.ps1 -Image pluton-dual-origin:local -Compiled
./scripts/validate-phase6.ps1 -BackendTests -Image pluton-phase6-tests:local
./scripts/validate-phase6.ps1 -Modes phase6-filesystem,phase6-mariadb,phase6-postgresql,phase6-mixed,phase6-mixed-failure
./scripts/validate-phase7.ps1
git diff --check
```

Fixture-image prerequisites are unchanged. The mounted Agent dist suite ran in
`pluton-product-agent-tests:local` with `--init`, non-root, read-only source and
network none. No production end-to-end or browser-automation acceptance is claimed.

## 14. Safe deployment and acceptance

This is a runbook, not a deployment performed by this task.

1. Preserve the current image digest, private environment/Compose files and all
   overlays. Keep the same /data volume, SECRET/keys.json, ENCRYPTION_KEY, SQLite
   including migrations 0011/0012, restore leases, repositories/snapshots,
   Agent identities and notification outbox. Do not reset/reinstall.
2. Review/build an immutable server image through the normal approved process.
   Keep optional MySQL/internal/persistent Compose overlays unchanged.
   The supported source-image path is `deploy/compose.yml`. The separate root
   `docker-compose.yml` is an older upstream release-asset example, not a way to
   obtain this fork's fix; do not switch deployment paths or volumes as a shortcut.
3. Privately set the canonical HTTPS APP_URL, explicit public+private
   APP_ALLOWED_ORIGINS, optional private AGENT_SERVER_URL, and intentional existing
   HTTP Agent exception. Check persistent overrides as described above.
4. Verify SafeLine Host/header replacement and firewall rules. Do not expose a
   new port or set TRUST_PROXY merely to make login work.
5. Validate Compose with the existing private environment, avoiding printing
   expanded configuration/secrets. Recreate only the application container through
   an approved deployment window; no volume removal or database rollback is needed.
6. Separately log in on both sites. Check cookie attributes locally without
   sharing values. Verify authenticated health/dashboard, snapshot browse/download,
   staged restore and preparation for Recovery Testing/Database Restore.
   Do not start an import or change saved policies merely to test the 403 fix.
7. Confirm Agent heartbeat/polling at the unchanged private URL. Check no enrollment,
   identity or route migration occurred. Verify existing scheduled backups normally.
8. Negative-test both cross-origin directions and invalid/missing auth using
   disposable selections, never production SQL or repository maintenance commands.

No environment, network, container or credential changes on the real deployment
were made here.

## 15. Rollback

Restore the previous application image and its reviewed APP_URL/origin settings,
preserving all volumes, keys, SQLite, repository mounts, workers and overlays.
There is no migration to undo and no need to restore/delete database leases.
Older code ignores extra JWT claims; secrets remain identical.
Temporary in-memory 2FA setup sessions may require starting setup again after a
container restart, as before.

Remove/restore only the new configuration keys if returning to an older image.
Expect the old public-restore 403/global-cookie limitation to return with the
original configuration. Do not “fix” rollback by disabling CSRF or setting broad
proxy trust. Do not use `down -v`, create a new data volume, re-enroll an Agent,
rotate a key or modify snapshot data.

## 16. Remaining limitations and operational requirements

- Both HTTPS-public and explicit HTTP-private web paths are implemented and
  transport-tested; actual Cloudflare/SafeLine/header/firewall acceptance remains
  operator work because production was deliberately not accessed.
- HTTP LAN confidentiality is not provided. Use private HTTPS/split DNS if needed.
- Unlisted browser aliases, external HTTP DNS aliases and ambiguous same-host
  HTTP/HTTPS pairs are refused, not inferred from request headers.
- Different-origin development servers must use a same-origin development proxy;
  this does not add a permissive cross-origin credential exception.
- Legacy JWTs retain their existing lifetime/semantics. New tokens are bound;
  logout does not add durable token revocation for copies already stolen.
- Per-client proxy IP attribution/rate limiting still requires a separately
  reviewed narrow TRUST_PROXY and edge-header policy. It is not necessary for
  this fix's origin/session behavior.
- No new persistent MySQL functionality, recovery target provisioning or live
  database acceptance is introduced by this focused change.
