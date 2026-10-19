# Pluton — independently maintained self-hosted fork

Pluton manages Restic backups and Rclone storage through a local web application.
This public fork derives from `plutonhq/pluton`; it retains the Pluton name,
Apache-2.0 licensing and upstream attribution without claiming upstream endorsement.
No proprietary PRO/Business source or binaries are used for fork extensions.

## Documentation

The application includes an original Bahasa Indonesia documentation portal at
`/docs`, with bundled articles, navigation, local search and safe Markdown rendering.
It shares the Pluton server/build; no documentation domain, hosted search service
or external CDN is required. Source: [frontend/src/docs/articles](frontend/src/docs/articles).

- [Architecture and checks](docs/ARCHITECTURE.md)
- [Operational hardening](docs/OPERATIONAL_HARDENING_REPORT.md)
- [Phase 7 Webhook/SMTP implementation and acceptance](docs/PHASE7_WEBHOOK_NOTIFICATIONS.md)
- [Product hardening report](docs/SELFHOSTED_PRODUCT_HARDENING_REPORT.md)
- [Deployment scripts](deploy)

## Implemented capabilities and boundaries

- Managed backups, snapshot history, scheduling and local storage/provider integrations.
- Outbound-polling Linux Remote Agent with canonical allowed roots and managed SFTP backup.
- Filesystem plus 0–8 MariaDB/MySQL/PostgreSQL dumps, constrained pre/post hooks.
- Exact-snapshot Browse, TAR Download and staging-only remote Restore.
- Automated Recovery Testing with artifact integrity and optional dedicated-target import.
- Durable Webhook/SMTP outbox, subscriptions, safe payload/HMAC/TLS, retries and history.
- Separate read-only Legacy Repository Adapter; no legacy init/retention/maintenance.

Capability does not imply production certification. Genuine MySQL native recovery,
vendor-specific S3 acceptance and live notification acceptance require separate
operator validation. No restore-to-original or automatic production SQL import is added.

## Build and deployment

Use Node.js 24 and pinned pnpm 10.20.0 with the existing lockfile:

```sh
pnpm install --frozen-lockfile
pnpm test:docs
pnpm build
docker build -f Dockerfile.source -t pluton:reviewed .
```

The Docker source image is the maintained server deployment path. Review
[deploy/compose.yml](deploy/compose.yml), its placeholder-only environment example,
and [deploy/install.sh](deploy/install.sh) / [deploy/deploy.sh](deploy/deploy.sh).
Production deployment must use a reviewed immutable image digest,
preserve the existing volume, `SECRET`, `ENCRYPTION_KEY`, agent identity and
repository credentials, and take a consistent control-plane backup first.
Do not deploy a mutable `latest`/`main` tag or regenerate keys during an update.
Existing hosts need a separate [reviewed one-time script-bundle upgrade](docs/DEPLOYMENT_OVERLAY_AND_HEALTHCHECK_FIX.md)
before the normal digest-based installer can preserve local overlays and verify rollback.

Historical native installers that fetch unverified helper binaries from upstream
commercial CDN are disabled before any download/system change. Do not use old
curl-to-shell installation instructions. Agent installation remains independent
and pinned; it does not replace global Node.js or automatically broaden source ACLs.

## Acknowledgements

Pluton is built on the shoulders of giants. We would like to thank the creators and contributors of the following projects:

- [Restic](https://restic.net/) (BSD 2-Clause License): For providing the robust and secure backup foundation.
- [Rclone](https://rclone.org/) (MIT License): For enabling seamless connectivity to a vast array of cloud storage providers.

Keep [LICENSE](LICENSE), original notices, authorship and dependency licensing intact.
This fork is independent and does not represent the upstream commercial service.
