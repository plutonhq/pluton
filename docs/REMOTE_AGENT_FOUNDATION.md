# Remote Agent foundation

This document describes the independently implemented, Apache-2.0 Phase 4
control-plane foundation for the community fork. It does not use or depend on
any proprietary Pluton implementation.

The agent is an outbound-only Node.js process intended to run as a dedicated,
non-root Linux user. It has no listener, does not need Docker, and does not
need inbound SSH. This foundation does **not** back up files, restore files,
run scripts, invoke an arbitrary shell, or perform repository maintenance.

## What it provides

```text
Administrator browser                 Pluton server                 Remote agent
---------------------                 -------------                 ------------
Create one-time token  ───────────►   stores token hash
                                                                  enrolls outbound ─►
                                    ◄─────────────────────────────────────────────
                                    device + agent identity + encrypted per-agent secret

                                                                  heartbeat / poll ─►
                                    ◄─────────────────────────────────────────────
                                    one leased PING or INVENTORY_REFRESH command
                                                                  ACK / event / completion ─►
```

Every agent request after enrollment includes its agent ID, a timestamp, a
cryptographically random nonce, and an HMAC-SHA256 signature over the HTTP
method, path, nonce, timestamp, and SHA-256 body hash. The server applies a
five-minute clock-skew limit and persists nonce hashes through that window.
Replaying a valid request is rejected. The server stores a different random
secret for every agent, encrypted with its local server secret; no API or UI
response exposes it after enrollment.

The server signs a leased command response with the same per-agent secret. The
agent verifies that signature before acknowledging it. Each delivery has a
random lease token, included in that signature, which must accompany its ACK,
event, and completion requests; a stale delivery cannot update a newer lease.
Commands have durable SQLite state, acknowledgement/completion timestamps,
attempt count, idempotency key, and monotonically increasing event sequence. An
expired lease returns to `queued`, so a server restart does not silently lose it.

Only `PING` and `INVENTORY_REFRESH` can be stored or executed in this phase.
Neither command runs a process or reads a workload path.

## Transport and TLS

Set the server address on the agent; it is not embedded in an enrollment token
or persisted identity:

```sh
PLUTON_SERVER_URL=https://pluton.example.internal
PLUTON_AGENT_DATA_DIR=/var/lib/pluton-agent
PLUTON_AGENT_ALLOWED_ROOTS=/srv/example-app
```

The normal mode is HTTPS with the system trust store. A private CA can be
provided through `PLUTON_AGENT_CA_FILE`. `PLUTON_AGENT_CLIENT_CERT_FILE` and
`PLUTON_AGENT_CLIENT_KEY_FILE` are transport hooks for a future mTLS rollout;
they are optional and do not enable a server-side mTLS requirement yet.

For a temporary trusted LAN pilot only, HTTP requires **both** settings:

```sh
# On the Pluton server
ALLOW_INSECURE_AGENT_HTTP=true

# On the agent
ALLOW_INSECURE_HTTP=true
PLUTON_SERVER_URL=http://192.0.2.10:5173
```

Never use HTTP agent mode across an untrusted or public network. Changing the
agent URL later to an HTTPS domain does not change enrollment, request signing,
polling, or future backup business logic.

The installer rejects an HTTP server URL unless `--allow-insecure-http` is
present. For a trusted-LAN exception, use both server and installer opt-ins:

```sh
sudo ./installers/install-agent.sh \
  --server http://192.0.2.10:5173 \
  --allowed-root /srv/example-app \
  --allow-insecure-http
```

For HTTPS, the system CA store is used by default and certificate verification
remains enabled. A private CA is supported with a readable PEM path:

```sh
sudo ./installers/install-agent.sh \
  --server https://pluton.example.internal \
  --allowed-root /srv/example-app \
  --ca-file /etc/ssl/local-ca/pluton-ca.pem
```

The installer validates that the `pluton-agent` account can read the custom CA
file, then writes it as `PLUTON_AGENT_CA_FILE` in the agent environment.

## Install, enrollment, and updates

The repository installer supports Ubuntu/Debian-family hosts using systemd on
x86_64. It installs a private Node.js 22 runtime under
`/opt/pluton-agent/runtime`; it never upgrades or replaces `/usr/bin/node`,
the host npm installation, or another production runtime.

1. In **Sources**, select **Add Remote Machine**, give it a descriptive name,
   and create the one-time token.
2. On the remote host, clone the community fork you administer and run:

   ```sh
   git clone https://github.com/<your-community-fork>/pluton.git pluton
   cd pluton
   sudo ./installers/install-agent.sh \
     --server https://pluton.example.internal \
     --allowed-root /srv/example-app
   ```

3. Choose an enrollment method in the dialog:

   - **Secure install** is the default and preferred option for public, VPS,
     or less-trusted environments. Its generated command has no token; the
     installer requests the one-time token from a hidden terminal prompt.
   - **Quick install** is intended only for a trusted internal/admin
     environment. Its Copy button includes the actual one-time, short-lived
     enrollment token as `--token` so the command can be pasted directly.
     That token can be recorded in shell history and briefly appear in process
     listings. It is never written to the systemd environment, state directory,
     identity file, or agent command line.

Both commands use the server's configured URL and the allowed source root
entered in the dialog. The HTTP opt-in flag appears only when the server has
explicitly enabled trusted-LAN agent HTTP.

The installer validates the supported operating system, architecture, active
systemd manager, required utilities, server URL, and allowed roots. It
downloads the official Node.js tarball and its official `SHASUMS256.txt` file
over HTTPS, verifies SHA256 before extraction, then builds the agent in an
isolated temporary directory using the private runtime and the repository's
pinned pnpm version and lockfile. It installs no global packages and copies
only the compiled agent artifacts to `/opt/pluton-agent/app`.

The source-build step is isolated behind the installer's staging process so a
future signed release artifact can replace it without changing service or
identity handling. The agent currently has no third-party runtime dependencies;
the installer fails closed if that changes until its artifact step is updated.

The installer creates a non-login `pluton-agent` user and group. It does not
add that account to `sudo`, `docker`, or another privileged group. Its state
directory is `/var/lib/pluton-agent` with mode `0700`, and the agent writes
`identity.json` with mode `0600`.

For automation, use standard input rather than a token argument. The secret
injection mechanism must keep the value out of logs:

```sh
printf '%s\n' "$PLUTON_ENROLLMENT_TOKEN" | sudo ./installers/install-agent.sh \
  --server https://pluton.example.internal \
  --allowed-root /srv/example-app \
  --token-stdin
```

`--allowed-root` may be repeated. The installer canonicalizes each root and
checks that the dedicated agent account can read and traverse it. It stores the
resulting roots as a comma-separated value in `/etc/pluton-agent.env`.

Running the same install command again safely updates the private runtime and
application while preserving `identity.json`; it reuses the existing remote
device and never automatically enrolls a second one. Until the updated agent
passes its control-plane check, the installer retains the prior application,
configuration, and unit so a failed update can restore an active prior service.
To deliberately replace an existing local identity, add `--re-enroll`. This
requires an interactive `RE-ENROLL` confirmation unless `--force` is
explicitly supplied, then requests a new one-time token. The prior local
identity is retained until the new enrollment succeeds. Re-enrollment does not
revoke the old server-side device.

## Filesystem policy

`PLUTON_AGENT_ALLOWED_ROOTS` is a comma- or newline-separated list of absolute
paths. It is a future filesystem-command boundary; the agent resolves each root
with `realpath` at startup. Future commands must use the same policy helper,
which rejects control/NUL characters, `..`, relative paths, sibling-prefix
escapes, and symlink escapes. It never relies on `startsWith()` for path
authorization.

No filesystem command is enabled in this phase, so configuring a root only
reports the capability and does not grant a remote caller file access.

## systemd service and operations

The installer writes and enables the following service shape; administrators do
not need to create it by hand:

```ini
[Unit]
Description=Pluton remote agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pluton-agent
Group=pluton-agent
EnvironmentFile=/etc/pluton-agent.env
ExecStart=/opt/pluton-agent/runtime/bin/node /opt/pluton-agent/app/dist/index.js run
Restart=on-failure
RestartSec=10s
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ReadWritePaths=/var/lib/pluton-agent
CapabilityBoundingSet=
RestrictSUIDSGID=yes
LockPersonality=yes
UMask=0077

[Install]
WantedBy=multi-user.target
```

The service deliberately does not set `ProtectHome`, because an explicitly
configured future source root may be under a home directory. The user needs
read access only to configured roots; do not grant it repository credentials,
root access, shell sudo privileges, or Docker socket access.

Before enabling the service, the installer runs one safe `run --once` cycle
with the stored identity. That verifies the configured control plane can accept
a heartbeat and poll. It then starts the service, which should report:

```sh
systemctl status pluton-agent
journalctl -u pluton-agent -n 100 --no-pager
```

Safe agent diagnostics include only an operation stage and a sanitized message;
they never include enrollment tokens, agent secrets, HMAC values, lease tokens,
repository passwords, or storage credentials.

The generated `/etc/pluton-agent.env` has mode `0600` and contains the server
origin, state directory, one or more allowed roots, the optional private CA
path, and the explicit `ALLOW_INSECURE_HTTP` value. It never contains an
enrollment token or agent secret.

## Uninstall and purge

To remove the systemd service and installed private runtime while retaining a
local identity for a later reinstall:

```sh
sudo ./installers/install-agent.sh uninstall
```

This stops and disables the service, removes the unit and
`/opt/pluton-agent`, and preserves `/var/lib/pluton-agent/identity.json` plus
`/etc/pluton-agent.env`. It does not contact the Pluton server.

For a destructive local purge:

```sh
sudo ./installers/install-agent.sh uninstall --purge
```

Purge asks the administrator to type `PURGE` unless `--force` is supplied. It
also removes the state directory, identity, and environment file. Neither
uninstall nor purge revokes the server-side device. Revocation remains an
explicit action in **Sources** to prevent accidental loss of an agent during a
host rebuild.

## Revocation and limitations

Revoking a remote device immediately blocks heartbeat, poll, ACK, event, and
completion requests because authentication checks the durable revocation flag.
It does not merely hide the device in the UI.

The next scoped change can add a specifically designed filesystem backup
command. It must reuse the path policy, durable command lifecycle, HMAC
authentication, and explicit command allowlist. It must not turn this control
plane into generic remote shell access.
