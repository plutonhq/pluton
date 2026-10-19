# Fumadocs migration report

Audit date: 2026-10-13. Scope: documentation presentation/build only. No commit,
push, merge, release, deployment, production access, or repository operation was
performed. Work is on `codex/selfhosted-product-hardening-docs`.

## A. Audit and architecture decision

The checkout initially contained clean `main` at `eedf4fe`. The existing requested
feature branch at `21fe706` had the same source tree, so it was reused without
discarding files or rewriting commits. The earlier product hardening is committed
baseline work, not newly implemented or removed by this migration.

The original documentation was a custom React/SCSS renderer. Current installed
Fumadocs Core/UI 16.17.1 require React 19.2 or newer. The application is React 18
and Vite 6. Direct integration A would change its React runtime. Approach B was
selected: a docs-only React Router SPA in `documentation/`, compiled into static
files and copied into the existing application build. This is NOT Next.js and
does not add a production server, port, container or public origin.

The official React Router provider uses `useRevalidator`, so the docs document
uses `createBrowserRouter`/`RouterProvider`. The application's existing router and
authentication architecture remain intact. App-to-doc links use ordinary anchors
to cross the document boundary; the app's `/docs/*` compatibility redirect keeps
the pathname, query and fragment and prevents stale-service-worker reload loops.
The main service worker excludes docs navigations from its application fallback.

The backend serves its static assets first, then `/docs/*` with the docs HTML
entry, and other application routes with the original HTML entry. Missing docs
modules, search JSON and license assets return 404, not HTML. Registered API/auth
handlers stay ahead of these fallbacks. Docs load no authenticated settings,
devices, plans, credentials or inventory. A public HEAD request reads existing
version/revision response headers only.

Official references consulted: [React Router installation](https://www.fumadocs.dev/docs/manual-installation/react-router),
[Vite MDX integration](https://www.fumadocs.dev/docs/mdx/vite),
[Docs layout](https://www.fumadocs.dev/docs/ui/layouts/docs),
[Docs page](https://www.fumadocs.dev/docs/ui/layouts/page),
[static deployment](https://www.fumadocs.dev/docs/deploying/static),
and [search](https://www.fumadocs.dev/docs/search).

## B. Dependencies, isolation and licenses

| Area                      | Pinned dependency                                                            | Reason                                                     |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Official documentation UI | fumadocs-core / fumadocs-ui 16.17.1                                          | Framework, official layout/page/TOC/search/components      |
| Compiler                  | fumadocs-mdx 15.4.7                                                          | Official Vite collection compiler and lazy article modules |
| Docs runtime              | react / react-dom 19.3.0, react-router 7.13.0                                | Supported Fumadocs React/data-router context               |
| Docs build                | vite 7.3.7, @vitejs/plugin-react 5.2.0                                       | Separate supported docs compiler                           |
| Docs styling              | tailwindcss / @tailwindcss/vite 4.3.3                                        | Official Fumadocs CSS preset pipeline                      |
| Theme/icons/types         | next-themes 0.4.6, lucide-react 1.55.0, React types 19.3.0, MDX types 2.0.14 | Official components and isolated typechecking              |

The application retains React 18.3.1 and Vite 6.4.1. pnpm remains 10.20.0, with a
consistent frozen lockfile. No Next.js dependency was added. React Router and
affected declaration packages receive optional React-type peer metadata so a
clean pnpm installation cannot resolve React 19 types inside React 18 application
components. This changes dependency resolution metadata, not package source or
application APIs. Regression tests check both runtime versions and declaration
peer contexts; the clean source-image build also typechecks the application.

Fumadocs, React, React Router, Tailwind and next-themes are MIT; Lucide is ISC.
The build includes their actual package license texts at
`/docs/licenses/third-party.txt`. Linux license discovery handles `license.md`
case-sensitively and fails if a required notice is missing. Pluton Apache-2.0,
upstream attribution, names and acknowledgments are preserved. No proprietary
Pluton PRO/Business code or binaries were used.

## C. Content preservation and security

All 77 original Bahasa Indonesia article files and the manifest are unchanged.
There are still 15 manifest-ordered categories. No title, slug, content body or
article order was rewritten. The manifest supplies page metadata, sidebar tree,
home cards and previous/next order; a second metadata inventory is not maintained.

The official compiler builds trusted checked-in `.md` only, in plain Markdown
mode. A plugin converts raw HTML into escaped text and refuses executable MDX
nodes before framework-generated exports. The first article H1 is represented by
DocsTitle, not duplicated in the body. Original unique heading IDs survive,
including duplicate-heading suffixes, and all compiled TOCs are checked against
the original parser. Unsafe protocols, credential URLs and remote images remain
blocked by the existing URL policy. No runtime Markdown/JSX fetching, eval-based
browser renderer, external font/CDN, cloud search account or credential is added.

Search is the actual Fumadocs static search API/client, generated from article
titles, headings and body content into `/docs/search-index.json`. Ctrl/Cmd+K uses
the official dialog components. No search-server API or external provider is
configured. Core may emit optional provider chunks, but none is configured or
used. The main backend CSP is unchanged; the disposable preview applies the same
script/style/image/font restrictions and an even narrower same-origin connect
policy for browser testing.

## D. UI and integration behavior

Official RootProvider, DocsLayout, DocsPage, DocsTitle, DocsDescription, DocsBody,
breadcrumb, sidebar, TOC, pagination, cards, callouts, MDX components, highlighted
CodeBlock and Pre are used. Only narrow Pluton metadata, link-policy, theme and
clipboard adapters are custom. This is not a visual recreation of Fumadocs.

Docs styles and React runtime exist in a separate HTML document. They never wrap
app dashboards/forms or import Tailwind's reset into application pages. The docs
theme maps the app's `themeSetting` (including `auto` → system) to its own
next-themes storage key before rendering, and propagates explicit changes back to
the shared preference. Code copy uses the native clipboard API where available,
then a cleaned-up user-gesture textarea fallback for trusted-LAN HTTP. The copy
adapter is not used for passwords or application secrets.

The source build compiles docs, compiles the app, copies docs into
`frontend/dist/docs`, then the existing backend build copies the combined static
output into `backend/public`. Docker's builder includes docs source/tests; its
production runtime needs only the compiled assets, not a docs Node server.
Generated `.source`, dist and preview screenshots are not tracked.

## E. Changed files

New workspace files:

- `documentation/index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`, `source.config.ts`
- `documentation/plugins/content.ts`
- `documentation/src/App.tsx`, `Search.tsx`, `clipboard.ts`, `main.tsx`, `mdx.tsx`, `source.ts`, `styles.css`, `theme.tsx`
- `documentation/tests/documentation.test.ts`

Other additions:

- `frontend/src/docs/DocumentationRedirect.tsx`
- `scripts/copy-docs-build.mjs`, `scripts/preview-documentation.mjs`
- `docs/FUMADOCS_MIGRATION_REPORT.md`

Modified:

- `.dockerignore`, `.gitignore`, `Dockerfile.source`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/router.tsx`
- `frontend/src/components/App/Footer/Footer.tsx`, `frontend/src/components/App/SideNav/SideNav.tsx`
- `frontend/__tests__/docs.test.ts`, `frontend/__tests__/productIdentity.test.ts`
- `backend/src/utils/spaFallback.ts`, `backend/__tests__/utils/spaFallback.test.ts`
- `docs/ARCHITECTURE.md`

Retired custom renderer files: `frontend/src/docs/Docs.tsx`, `Markdown.tsx`,
`Docs.module.scss`, `content.ts`. Their security/rendering coverage is replaced by
real Fumadocs compilation/SSR and synthetic hostile Markdown tests. The original
manifest, articles and reusable validation model remain.

## F. Validation results

| Command / check                                                           | Result                                                                                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete backend Jest, `--runInBand --silent --verbose=false`             | 153 suites passed; 2,968 tests passed, 4 skipped, 0 failed                                                                                            |
| Frontend Node utility/component suite                                     | 81 passed, 0 failed                                                                                                                                   |
| `pnpm test:fumadocs`                                                      | 8 passed, 0 failed; includes all 77 compiled article TOCs and actual official layout SSR                                                              |
| Frontend docs/identity build checks                                       | 12 passed, 0 failed; included in the frontend suite above                                                                                             |
| Static document/API/search HEAD boundary tests                            | 9 passed; included in backend total above                                                                                                             |
| Agent suite on Windows                                                    | 43 passed, 53 Linux-only skipped, 0 failed                                                                                                            |
| Agent suite, isolated non-root Linux fixture                              | 96 passed, 0 skipped, 0 failed                                                                                                                        |
| Product hardening native fixture                                          | 7 Restic parent/restore groups and 3 historical installer guards passed                                                                               |
| Phase 5/6 native fixture                                                  | 8 modes passed: single, two-mariadb, mixed, filesystem recovery, MariaDB recovery, PostgreSQL recovery, mixed recovery, expected mixed-import failure |
| Phase 7 native fixture                                                    | HTTP/HMAC/status/timeout, SMTP/auth/rejection, lifecycle/dedup, process restart and trusted/untrusted TLS groups passed                               |
| Backend / frontend / docs / agent typechecks                              | Passed                                                                                                                                                |
| Backend lint                                                              | Passed                                                                                                                                                |
| Frontend lint                                                             | Baseline configuration failure: typescript-eslint rejects string `eslint-config-prettier` in its extends array; configuration is unchanged            |
| Frontend and backend production builds                                    | Passed                                                                                                                                                |
| Clean source Docker build                                                 | Passed; frozen install, both production builds and embedded docs tests/typechecks succeeded                                                           |
| Protected article/manifest/agent/core-service diff and `git diff --check` | Passed                                                                                                                                                |

No production end-to-end success is claimed. All native fixtures use disposable
synthetic data, separate repositories/DB targets and local receiver infrastructure.
An expected recovery failure is a passing safety test, not a failed suite.

Browser QA used the built combined bundles served by a disposable same-origin
static preview, not a running Pluton database/service instance. Home,
Getting Started, Backup Plans, Remote Agent, Database, Recovery, Notifications and
Troubleshooting were loaded in both themes at requested 1440×900, 1365×768,
390×844 and 375×812: 64 page/theme/size cases, no horizontal page overflow. The
browser reported 1366 CSS pixels for the requested 1365 desktop width; other
widths were exact. Desktop/mobile screenshots were visually inspected. Mobile
sidebar/theme controls, category expansion, search hotkey/results, exact article
navigation, breadcrumb, TOC, deep-link refresh, highlighted-code copy and
contained table/code scrolling were exercised. Both Ctrl+K and Cmd+K opened the
localized search dialog. Static HMAC search worked under the unchanged
production-style CSP; Back to Application opened the synthetic preview's login
document, with only its own app stylesheet and no Fumadocs layout/CSS. The final
64-case matrix was repeated under CSP, with zero recorded browser errors.
All 17 requested technical search queries, plus a category query, returned local
results in an additional static-search check. Authenticated production dashboards
were not opened.

## G. Compatibility and known limitations

There is no schema migration, agent update, enrollment change, API protocol
change or new authenticated API. Restic parent receipt verification, real backup
statistics, phases 4–7 and Legacy read-only/staging boundaries are unchanged.
No key generation/rotation, plan recreation, repository reinitialization, snapshot
mutation or infrastructure permission change is required by this migration.

The initial docs entry is roughly 724 kB uncompressed; article modules are lazy.
The search index is about 1.14 MB uncompressed (approximately 267 kB gzip), not
fetched as a remote service. Production Vite emits the usual large-chunk warning,
two CSS optimizer warnings for supported `::highlight` rules, and an externalized
`node:fs/promises` warning from Fumadocs's unused server `getText` helper. Browser
rendering/search does not call that helper. Existing Browserslist/dependency peer
warnings are not silently fixed by unrelated upgrades. React Router logs a
non-fatal initial `HydrateFallback` warning while its async loader starts; this is
not a server-rendered hydration deployment and no browser exception was observed.
Some accessibility control labels retain official English wording; visible
search, pagination and TOC labels and all articles are Bahasa Indonesia.

The supported offline claim is operation on a LAN with the local Pluton server
reachable and no Internet dependency. This is not a guarantee of navigation with
the Pluton server itself offline: main-app PWA precaching deliberately does not
own the separate docs document. Existing controlled clients may need a normal
service-worker update/reload; the redirect guard prevents an endless reload.

The unchanged historical contributing article describes the old renderer.
Current maintainer instructions are this report and ARCHITECTURE.md: keep `.md`
and the manifest as the sole authoring inventory, add no JSX/remote assets, run
both docs validators and the combined build. Do not introduce independent
Fumadocs meta files that duplicate article ordering.

## H. Safe deployment and rollback (operator actions only)

Review the diff and dependency lockfile. Build a reviewed immutable application
image using the existing pipeline. Preserve the existing persistent volume,
SECRET, ENCRYPTION_KEY, stored credentials, repository passwords, plan/storage
records, snapshots, schedules and all agent state/identities. Do not run an
installer, re-enroll agents, rotate keys, or recreate any plan for this UI change.

Deploy only when separately authorized, using the same backend origin/port and
existing proxy rules. Confirm `/docs`, a nested article plus fragment, local
search, license text, refresh, light/dark, and Back to Application. Verify existing
authenticated app pages and API authorization independently, without triggering
production backup/restore/recovery or notification delivery merely for docs QA.
If using a CDN/proxy, publish both bundles atomically and avoid stale index HTML
pointing at removed hashed modules. No extra docs process or container is needed.

Rollback uses the previous reviewed immutable image on the same persistent
volume and unchanged secrets; no DB down-migration, agent rollback or repository
operation is needed. Refresh clients/update their application service worker if
necessary. Keep preview/generated artifacts private and out of Git.

### Final acceptance addendum

The final clean source image `pluton-fumadocs-build:local` built successfully.
Read-only inspection, without starting the application, confirmed both HTML
entries, exactly 77 article chunks, static search JSON, actual next-themes license
text, Node 24.16.0 and UID 10001. No additional docs runtime directory exists in
the production image. The image was neither published nor deployed.

Final backend results are 153 passing suites, 2,968 passing tests and 4 skips.
Frontend remains 81/81 and docs compiler/renderer tests 8/8. Protected source and
article/manifest diffs are empty and `git diff --check` passed. Working HEAD
remains `21fe706`; all migration edits are uncommitted.

Disposable browser evidence was saved locally under ignored
`tmp/fumadocs/desktop-dark.jpg` and `tmp/fumadocs/mobile-dark.jpg`. These screenshots
show synthetic public documentation only and are not part of the repository.
The preview is a static QA helper, not an added production service. Migration is
ready for code review, subject to documented baseline lint/performance warnings
and normal operator acceptance before a separately authorized deploy.
