# Container deployment

This deployment path builds one production Node container that serves the
frontend and backend together. GitHub Actions builds it from public source,
tests it, and publishes it to GitHub Container Registry (GHCR). A Linux VM
only needs Docker Engine, Docker Compose v2, Python 3.8+ (stdlib), the files in
deploy/, a persistent Docker volume, and a VM-local .env file. It does not
need Git, Node.js, pnpm, TypeScript, or build tools.

The GHCR production image is published for linux/amd64 only, matching the
current x86_64/AMD64 VM deployment target. ARM64 images are not published by
this deployment workflow.

This document applies to the public community fork. It does not change the
read-only guarantees for imported Restic repositories or enable any new backup
operation.

Existing installations must first follow the separate, operator-approved
[one-time host-bundle upgrade](DEPLOYMENT_OVERLAY_AND_HEALTHCHECK_FIX.md#8-a--one-time-host-script-upgrade).
Pulling a new image does not update already installed scripts. That runbook also
covers customized base Compose reconciliation and script-only rollback.

## Image build and release flow

Dockerfile.source is the reproducible source build used by
.github/workflows/container.yml. It installs the pnpm version pinned in
package.json, builds the frontend before the backend, keeps only production
dependencies in the runtime image, and copies pinned Restic and Rclone binaries
from their official versioned container images. The runtime runs as an
unprivileged user, stores all mutable application files under /data, and checks
/api/health.

The existing top-level Dockerfile is retained for the separate release-asset
pipeline that consumes pre-built executable bundles. New VM deployments should
use the GHCR image produced from Dockerfile.source and deploy/compose.yml.
The existing root docker-compose.yml remains for that release-asset path and
now requires an explicit PLUTON_VERSION; it is not the hardened GHCR deployment
configuration described here.

The container workflow has these behaviors:

| Event | Validation | Container result |
| --- | --- | --- |
| Pull request | install, backend lint/tests, both type checks, production builds, whitespace check, and a Docker build | no registry login and no image push |
| Push to main | the same validation | publishes the moving main tag and a commit SHA tag to GHCR |
| Push of vX.Y.Z or a prerelease vX.Y.Z-name | the same validation | publishes both the original v-prefixed tag and the unprefixed version alias |

The workflow uses ghcr.io followed by the GitHub repository context, so no
personal GitHub owner is embedded in source. Published images receive OCI
source, revision, version, and creation labels. Package write permission exists
only on the publishing job.

The frontend ESLint configuration currently has an upstream flat-config
compatibility error. The workflow records that command as a clearly named
non-blocking baseline step; it does not hide or globally disable linting.

Before merging this work, a repository owner must confirm that GitHub Actions
has permission to write packages, choose the GHCR package visibility and pull
access policy, and protect the main branch and release tags. A private package
requires a VM operator to run docker login ghcr.io before the first pull. No
long-lived registry credential is required for the Actions publish job because
it uses the workflow GITHUB_TOKEN.

## Fresh Linux VM install

Install Docker Engine and the Docker Compose plugin using the VM distribution's
normal administration process. The scripts deliberately do not install operating
system packages. The VM needs outbound access to GHCR. Configure credentials
offline; scripts never generate or rotate application encryption keys.

Copy the tracked deploy/ directory to the VM by a release artifact, SCP, or
another approved transfer method. The deployment itself does not require a Git
checkout. For a genuinely absent installation directory, prepare the reviewed
bundle (the first command deliberately stops for configuration without starting
services):

~~~sh
sudo sh deploy/install.sh 'sha256:<verified-image-digest>' /opt/pluton
sudoedit /opt/pluton/.env
~~~

Set PLUTON_IMAGE to the lower-case GHCR repository for this fork, set a strong
USER_PASSWORD, a securely generated ENCRYPTION_KEY for the NEW empty volume only,
and APP_URL to the external URL when applicable. Existing data always needs its
original keys. Do not put an actual
password, encryption key, registry token, or production host name in a tracked
file.

Run the installed script with an approved immutable digest:

~~~sh
sudo sh /opt/pluton/install.sh 'sha256:<verified-image-digest>'
~~~

The installer preserves credentials and application data, applies the approved
Compose stack, and requires Docker health plus bounded GET /api/health readiness.
It does not overwrite an existing directory from a checkout: use the one-time
reviewed bundle upgrade rather than copying over local configuration.

The application persists SQLite, its WAL sidecars, configuration, logs,
rclone.conf, schedules, and keys.json in the named /data volume. The external
ENCRYPTION_KEY stays in /opt/pluton/.env. Recreating the container therefore
does not discard the database or generated session/API secrets.

## Update, pinning, and rollback

After the one-time host-bundle upgrade, use the normal workflow:

~~~sh
cd /opt/pluton
docker pull ghcr.io/<fork-owner>/pluton:main
# Review and approve the immutable sha256 digest from the pull result.
sudo sh ./install.sh 'sha256:<approved-image-digest>'
sudo sh ./status.sh
~~~

deploy.sh validates the digest, effective Compose, current image and complete
mount contract before stopping only pluton. It retains a consistent stopped
SQLite directory copy under /opt/pluton/backups/, recreates only that service
with --no-deps, then verifies readiness, image, UID/GID and mounts. Failure
restores the previous actual immutable image with the SAME overlays and verifies
it before reporting the rollback outcome. A recovered failed deployment still
exits nonzero. An already healthy identical digest is not recreated.

This records an image reference in the form
ghcr.io/owner/repository@sha256:..., which Compose pulls exactly. Production
deployments must use a digest. All tags, including version tags, latest and main,
are refused as deployment arguments because tags can move.

The ordered stack is compose.yml, optional approved compose.lab.yml, then local
basenames listed explicitly in compose.overlays. It is shared by deploy, SQLite
backup, status and rollback. A missing previously approved overlay or changed
mount/volume is refused, not silently discarded. No extra manual Compose up is
needed, and optional DB/worker services are not auto-started.

To roll back the image selected by the last successful update:

~~~sh
sudo sh /opt/pluton/rollback.sh
~~~

Rollback preserves the Docker volume and .env. It does not reverse SQLite
migrations, so an older image may be incompatible with a newer database. The
same health check protects the operation: an unhealthy rollback is returned to
the currently recorded image. Restore a database copy only through a separately
reviewed recovery procedure; the deployment scripts never overwrite application
data automatically.

## Verify and troubleshoot

The tools validate the effective merged configuration privately before starting.
Use the sanitized shared status helper and public GET readiness:

~~~sh
sudo sh /opt/pluton/status.sh
curl -i http://127.0.0.1:5173/api/health
~~~

Do not print expanded Compose config or full Docker inspect output: both can
contain credentials. Loopback HEAD/spider is intentionally NOT a web Host-policy
exemption. The fixed GET probe needs no extra browser origin or trust proxy.

Inspect non-secret image metadata when diagnosing a release:

~~~sh
docker image inspect ghcr.io/owner/repository:v0.1.0-alpha.1 --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
~~~

Do not paste .env contents into issue reports or CI logs. The deployment compose
file has no privileged mode, Docker socket mount, host source mount, or
capability grant; it exposes only the application port and mounts only the
named data volume. Add host paths for backup sources only after reviewing their
read/write requirements and use read-only mounts where possible.

Use the usual repository security checks before a release, including a secret
scanner such as Gitleaks on source changes and an image vulnerability scanner
such as Trivy or Docker Scout on the exact image digest. Verify that the
published GHCR package access policy matches the intended audience.
