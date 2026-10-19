#!/usr/bin/env python3
"""Real local Docker acceptance for the actual POSIX host helpers.

Run on a Linux Docker host (Python 3.8+, Docker/Compose v2), or inside the explicitly
authorized disposable Linux driver on Docker Desktop. No production arguments.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "pluton-deploy-test-" + secrets.token_hex(6)
IMAGE = sys.argv[1] if len(sys.argv) > 1 else "pluton-deploy-hardening:local"
BASE = Path(os.environ.get("PLUTON_DEPLOY_FIXTURE_ROOT", tempfile.gettempdir()))
PROJECTS, VOLUMES, CONTAINERS, TAGS = [], [], [], []
SECRETS, PASSED = [], 0


def run(arguments, ok=True, cwd=None, environment=None, stdin=None):
    result = subprocess.run(arguments, cwd=cwd, input=stdin, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, env=environment, timeout=600)
    if any(value in result.stdout for value in SECRETS):
        raise AssertionError("credential-output-detected")
    if ok and result.returncode:
        # CLI output can contain configuration. Never echo it on an assertion failure.
        categories = [name for name, pattern in (
            ("connection-refused", "connection refused"), ("tls-scheme", "HTTP response to HTTPS"),
            ("missing-image-content", "content digest.*not found|missing content"),
            ("registry-rejected", "manifest unknown|unknown blob|denied:"),
            ("registry-list-unavailable", "Not all multiplatform-content"),
            ("readonly-test-driver", "read-only file system"),
            ("missing-build-input", "failed to read dockerfile|failed to compute cache key"),
        ) if re.search(pattern, result.stdout, re.I)]
        raise AssertionError("local-fixture-command-failed:" + arguments[0] + ":" + arguments[1] + ":" + ",".join(categories))
    return result


def docker(*arguments, **options):
    return run(["docker", *arguments], **options)


def inspect(cid):
    # Inspect is intentionally consumed privately, not sent through run's log checks:
    # it legitimately includes the generated disposable application credentials.
    result = subprocess.run(["docker", "inspect", cid], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, "private-inspect-failed"
    return json.loads(result.stdout)[0]


def passed(name):
    global PASSED
    PASSED += 1
    print("PASS " + name, flush=True)


def write(path, body):
    path.write_text(body)
    path.chmod(0o600)


def copy_bundle(target):
    target.mkdir(mode=0o750)
    for path in (ROOT / "deploy").iterdir():
        if path.name in ("compose.yml", ".env.example", "healthcheck.cjs") or path.suffix in (".sh", ".py"):
            shutil.copyfile(path, target / path.name)
            (target / path.name).chmod(0o600)


def command(target, name, *arguments, succeeds=True, extra_environment=None):
    environment = dict(os.environ)
    if extra_environment:
        environment.update(extra_environment)
    result = run(["sh", str(target / name), *arguments], ok=False, environment=environment)
    reasons = re.findall(r'Deployment policy refused: ([a-z-]+)', result.stdout)
    assert (result.returncode == 0) == succeeds, "unexpected-host-helper-result:" + name + ":" + ",".join(reasons)
    return result.stdout


def cid(target):
    result = docker("ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=" + target.name,
                    "--filter", "label=com.docker.compose.service=pluton")
    value = result.stdout.strip()
    assert re.fullmatch("[a-f0-9]{64}", value), "unique-container-required"
    return value


def digest(image):
    value = json.loads(docker("image", "inspect", image, "--format", "{{json .RepoDigests}}").stdout)
    refs = [ref for ref in value if ref.startswith(REPOSITORY + "@")]
    assert len(refs) == 1, "fixture-registry-digest-missing"
    return refs[0].split("@", 1)[1]


def publish(image, tag):
    target = REPOSITORY + ":" + tag
    TAGS.append(target)
    docker("tag", image, target)
    docker("push", target)
    return digest(target)


def env_file(target, digest_value):
    volume = target.name + "-data"
    VOLUMES.append(volume)
    password, encryption = secrets.token_hex(24), secrets.token_hex(32)
    SECRETS.extend((password, encryption))
    write(target / ".env", "\n".join((
        "PLUTON_IMAGE=" + REPOSITORY, "PLUTON_IMAGE_REF=" + REPOSITORY + "@" + digest_value,
        "PLUTON_VERSION=" + digest_value, "PLUTON_VOLUME_NAME=" + volume,
        "COMPOSE_PROJECT_NAME=" + target.name, "PLUTON_PORT=0",
        "ENCRYPTION_KEY=" + encryption, "USER_NAME=fixture-admin", "USER_PASSWORD=" + password,
        "APP_URL=https://pluton.example.internal",
        "APP_ALLOWED_ORIGINS=https://pluton.example.internal,http://192.0.2.10:5173",
        "AGENT_SERVER_URL=http://192.0.2.10:5173", "ALLOW_INSECURE_AGENT_HTTP=true",
        "TRUST_PROXY=", "PLUTON_HEALTH_ATTEMPTS=12", "")))
    # PLUTON_PORT must be a host port, not another complete port mapping. Use a
    # loopback-only random host port via a reviewed overlay in the fixture.
    text = (target / "compose.yml").read_text().replace('"${PLUTON_PORT:-5173}:5173"', '"127.0.0.1::5173"')
    write(target / "compose.yml", text)


def verify_app(target, previous_mounts=None):
    state = inspect(cid(target))
    assert state["State"]["Running"] and state["State"]["Health"]["Status"] == "healthy", "app-not-healthy"
    assert state["Config"]["User"] in ("pluton", "10001:10001"), "application-not-nonroot"
    actual_env = dict(item.split("=", 1) for item in state["Config"]["Env"])
    assert actual_env["APP_URL"] == "https://pluton.example.internal", "canonical-env-not-propagated"
    assert actual_env["APP_ALLOWED_ORIGINS"].endswith("http://192.0.2.10:5173"), "origins-env-not-propagated"
    assert actual_env["AGENT_SERVER_URL"] == "http://192.0.2.10:5173", "agent-env-not-propagated"
    assert actual_env["ALLOW_INSECURE_AGENT_HTTP"] == "true" and actual_env["TRUST_PROXY"] == "", "transport-settings-changed"
    assert not state["HostConfig"]["Privileged"], "privileged-application"
    assert not any("docker.sock" in item["Destination"] for item in state["Mounts"]), "application-has-socket"
    mounts = sorted([(item["Type"], item.get("Name") or item["Source"], item["Destination"], item["RW"])
                     for item in state["Mounts"] if item["Type"] in ("bind", "volume")])
    if previous_mounts is not None:
        assert mounts == previous_mounts, "mount-or-volume-changed"
    return mounts


def main(workspace):
    global REPOSITORY
    assert not os.environ.get("DOCKER_HOST") or os.environ["DOCKER_HOST"].startswith(("unix://", "npipe://")), "local-docker-endpoint-required"
    endpoint = run(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).stdout.strip()
    assert endpoint.startswith(("unix://", "npipe://")), "local-docker-context-required"
    docker("image", "inspect", IMAGE)
    docker("pull", "registry:2")
    registry = PREFIX + "-registry"
    CONTAINERS.append(registry)
    # Daemon-loopback only (including the Linux VM in Docker Desktop). Published
    # Desktop host ports are not necessarily reachable on dockerd's 127.0.0.1.
    # Only this disposable registry uses host networking; never Pluton/worker.
    port = str(30000 + secrets.randbelow(25000))
    docker("run", "-d", "--name", registry, "--network", "host", "-e", "REGISTRY_HTTP_ADDR=127.0.0.1:" + port, "registry:2")
    for attempt in range(20):
        ready = docker("exec", registry, "wget", "-qO-", "http://127.0.0.1:" + port + "/v2/", ok=False)
        if ready.returncode == 0:
            break
        time.sleep(0.25)
    assert ready.returncode == 0, "disposable-registry-not-ready"
    REPOSITORY = "127.0.0.1:" + port + "/" + PREFIX
    good = publish(IMAGE, "good")
    previous_context = workspace / "previous-image"
    previous_context.mkdir()
    write(previous_context / "Dockerfile", "FROM " + IMAGE + "\nUSER root\nRUN rm -f /usr/local/libexec/pluton/healthcheck.cjs\nUSER pluton\nLABEL fixture.previous=\"true\"\n")
    previous_tag = PREFIX + ":previous"
    TAGS.append(previous_tag)
    docker("build", "-t", previous_tag, str(previous_context))
    old = publish(previous_tag, "previous")
    bad_context = workspace / "bad-image"
    bad_context.mkdir()
    # Deliberately change SQLite before becoming unhealthy, proving rollback never
    # replaces the DB with an older backup (durable restore/lease state survives).
    bad_code = "const{createRequire}=require('node:module');const D=createRequire('/app/backend/package.json')('better-sqlite3');const d=new D('/data/db/pluton.db');d.exec('CREATE TABLE IF NOT EXISTS fixture_post_migration(value TEXT); INSERT INTO fixture_post_migration VALUES (char(111,107))');d.close();require('node:http').createServer((q,s)=>{s.writeHead(503,{'Content-Type':'application/json'});s.end(JSON.stringify({status:'unhealthy'}))}).listen(5173)"
    write(bad_context / "Dockerfile", "FROM " + IMAGE + "\nCMD " + json.dumps(["node", "-e", bad_code]) + "\n")
    bad_tag = PREFIX + ":bad"
    TAGS.append(bad_tag)
    docker("build", "-t", bad_tag, str(bad_context))
    bad = publish(bad_tag, "bad")

    bootstrap = workspace / (PREFIX + "-new-bundle")
    result = run(["sh", str(ROOT / "deploy/install.sh"), old, str(bootstrap)], ok=False)
    assert result.returncode != 0 and (bootstrap / ".env").is_file(), "fresh-bundle-bootstrap-failed"
    assert "ENCRYPTION_KEY=\n" in (bootstrap / ".env").read_text(), "bootstrap-generated-key"
    passed("fresh-directory bootstrap stops for offline configuration without generating secrets or starting services")

    base = workspace / (PREFIX + "-base")
    PROJECTS.append(base.name)
    copy_bundle(base)
    env_file(base, old)
    command(base, "install.sh", old)
    verify_app(base)
    command(base, "status.sh")
    passed("base-only actual install.sh, real application/SQLite startup and GET readiness")
    original_id = cid(base)
    command(base, "install.sh", old)
    assert original_id == cid(base), "idempotent-install-recreated-container"
    passed("identical immutable digest is idempotent")
    for value in ("main", "latest", "v1.0.0", "sha256:bad", "sha256:" + "a" * 64 + ";id"):
        command(base, "install.sh", value, succeeds=False)
    assert original_id == cid(base), "invalid-input-mutated-container"
    passed("invalid/moving/tagged input refused before stopping service")

    native = PREFIX + "-native-health"
    CONTAINERS.append(native)
    docker("run", "-d", "--name", native, "--init", "--network", "none", "--read-only",
           "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
           "--tmpfs", "/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=64m",
           "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,mode=1777,size=64m",
           "--env-file", str(base / ".env"), IMAGE)
    for attempt in range(45):
        native_state = inspect(native)
        if native_state["State"].get("Health", {}).get("Status") == "healthy":
            break
        time.sleep(1)
    assert native_state["State"]["Health"]["Status"] == "healthy", "native-image-healthcheck-failed"
    head_check = "require('node:http').request({host:'127.0.0.1',port:5173,path:'/api/health',method:'HEAD'},r=>process.exit(r.statusCode===403?0:1)).end()"
    docker("exec", native, "node", "-e", head_check)
    passed("Dockerfile's own GET readiness is healthy on real startup while loopback HEAD remains 403")

    lab = workspace / (PREFIX + "-lab")
    PROJECTS.append(lab.name)
    copy_bundle(lab)
    env_file(lab, old)
    sources = workspace / "synthetic-mounts"
    sources.mkdir()
    for name in ("legacy", "staging", "managed-repo", "source"):
        (sources / name).mkdir()
    # These fixture paths live under a Docker-managed driver volume. Docker
    # enforces rslave on such submounts; declare it explicitly, never relax the
    # real deployment contract to ignore a propagation change.
    mount_lines = ["      - type: bind\n        source: " + str(sources / name) + "\n        target: /fixture/" + name + "\n        read_only: " + ("false" if name == "staging" else "true") + "\n        bind:\n          propagation: rslave"
                   for name in ("legacy", "staging", "managed-repo", "source")]
    overlay = "services:\n  pluton:\n    environment:\n      APP_TITLE: lab-precedence\n    healthcheck:\n      interval: 1s\n      start_period: 1s\n    volumes:\n" + "\n".join(mount_lines) + "\n"
    write(lab / "compose.lab.yml", overlay)
    # Explicit overlay, not auto-globbed. Neither optional nor ordinary dependency
    # services should start from application deployment.
    write(lab / "compose.worker.yml", "services:\n  untouched:\n    image: " + IMAGE + "\n    entrypoint: [node, -e, 'setInterval(()=>{},1000)']\n    user: '10001:10001'\n  optional-db:\n    image: " + IMAGE + "\n    profiles: [fixture-database]\n    entrypoint: [node, -e, 'setInterval(()=>{},1000)']\n")
    write(lab / "compose.overlays", "compose.worker.yml\n")
    write(lab / "compose.internal-recovery.yml", "invalid unselected file must not matter\n")
    command(lab, "install.sh", old, extra_environment={"COMPOSE_PROFILES": "*", "APP_URL": "https://forged.example.internal"})
    mounts_before = verify_app(lab)
    assert len(mounts_before) == 5, "all-five-mounts-required"
    assert "APP_TITLE=lab-precedence" in inspect(cid(lab))["Config"]["Env"], "overlay-precedence-lost"
    passed("lab + explicit overlays, five mounts, precedence, dual-origin and private Agent env; shell injection/profile variables ignored")
    normal = ["compose", "--project-directory", str(lab), "--env-file", str(lab / ".env")]
    for name in ("compose.yml", "compose.lab.yml", "compose.worker.yml"):
        normal += ["-f", str(lab / name)]
    docker(*normal, "up", "-d", "--no-deps", "untouched")
    untouched = docker("ps", "-q", "--filter", "label=com.docker.compose.project=" + lab.name, "--filter", "label=com.docker.compose.service=untouched").stdout.strip()
    command(lab, "install.sh", good)
    verify_app(lab, mounts_before)
    passed("successful immutable image update preserves all mounts and volume")
    backups = list((lab / "backups").glob("*/pluton.db"))
    assert backups and all(path.stat().st_size > 0 for path in backups), "sqlite-backup-missing"
    passed("existing SQLite consistently copied after stopping only Pluton")
    command(lab, "install.sh", bad, succeeds=False)
    verify_app(lab, mounts_before)
    state = (lab / ".deploy-result").read_text()
    assert "FAILURE_STAGE=health-http-status" in state and "ROLLBACK=healthy" in state, "rollback-not-verified"
    actual = inspect(cid(lab))
    assert actual["Config"]["Image"] == REPOSITORY + "@" + good, "rollback-image-wrong"
    query = "const{createRequire}=require('node:module');const D=createRequire('/app/backend/package.json')('better-sqlite3');const d=new D('/data/db/pluton.db',{readonly:true});if(d.prepare('SELECT count(*) AS n FROM fixture_post_migration').get().n<1)process.exit(1)"
    docker("exec", cid(lab), "node", "-e", query)
    passed("failed health triggers verified automatic rollback, same overlay mounts and post-migration SQLite state preserved")
    assert inspect(untouched)["State"]["Running"], "unrelated-service-stopped"
    assert not docker("ps", "-aq", "--filter", "label=com.docker.compose.project=" + lab.name, "--filter", "label=com.docker.compose.service=optional-db").stdout.strip(), "optional-profile-started"
    passed("unrelated service survives and optional database profiles never start")
    command(lab, "rollback.sh")
    verify_app(lab, mounts_before)
    assert inspect(cid(lab))["Config"]["Image"] == REPOSITORY + "@" + old, "explicit-rollback-image-wrong"
    passed("explicit rollback.sh uses the same full stack and healthy/mount gates")
    stable_id = cid(lab)
    write(lab / "compose.lab.yml", "services: [malformed\n")
    command(lab, "install.sh", good, succeeds=False)
    assert cid(lab) == stable_id, "malformed-overlay-stopped-service"
    (lab / "compose.lab.yml").unlink()
    command(lab, "install.sh", good, succeeds=False)
    assert cid(lab) == stable_id, "missing-approved-overlay-stopped-service"
    write(lab / "compose.lab.yml", overlay)
    passed("malformed or missing previously approved overlay fails before stopping service")
    write(lab / "compose.lab.yml", overlay.replace("target: /fixture/source", "target: /fixture/changed-source"))
    command(lab, "install.sh", good, succeeds=False)
    assert cid(lab) == stable_id, "changed-mount-stopped-service"
    write(lab / "compose.lab.yml", overlay)
    passed("changed mount contract refused before stopping the running application")

    # Reconstruct the exact prior public template, not production configuration.
    old_base = (ROOT / "deploy/compose.yml").read_text()
    start = old_base.index("      # GET only:")
    end = old_base.index("      interval:", start)
    old_base = old_base[:start] + '      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://127.0.0.1:5173/api/health || exit 1"]\n' + old_base[end:]
    assert hashlib.sha256(old_base.encode()).hexdigest() == "85cd8b7fe1e2d66a72d9d0a1c4adfc3bae5a8ed0c504f8ae309c37017b4bc34d", "old-template-fixture-drift"
    # Keep loopback-only ports in a fixture overlay, not in the known base.
    overlay += '    ports: !override\n      - "127.0.0.1::5173"\n'
    write(lab / "compose.lab.yml", overlay)
    write(lab / "compose.yml", old_base)
    old_script = "#!/bin/sh\n# Prior host-bundle fixture marker.\nexit 2\n"
    write(lab / "install.sh", old_script)
    for name in ("compose-tools.py", "bundle-tools.py", "healthcheck.cjs", "upgrade-host.sh", "status.sh"):
        (lab / name).unlink()
    env_before, history_before = (lab / ".env").read_bytes(), (lab / ".deploy-state").read_bytes()
    reviewed = workspace / "reviewed"
    copy_bundle(reviewed)
    approved = run(["sh", str(reviewed / "upgrade-host.sh"), "--print-digest"]).stdout.strip()
    upgrade_args = ["sh", str(reviewed / "upgrade-host.sh"), str(lab), "--approve-bundle", approved]
    assert run(upgrade_args, ok=False).returncode == 0, "known-old-bundle-upgrade-failed"
    assert (lab / ".env").read_bytes() == env_before and (lab / ".deploy-state").read_bytes() == history_before, "bundle-upgrade-modified-state-or-secrets"
    assert cid(lab) == stable_id, "bundle-upgrade-deployed-container"
    passed("one-time reviewed old-host-bundle upgrade preserves .env, image history, overlays, mounts and running container")
    backup = sorted((lab / ".bundle-backups").iterdir())[-1]
    manifest = json.loads((backup / "manifest.json").read_text())
    run(["sh", str(reviewed / "upgrade-host.sh"), "--restore", str(lab), backup.name, "--approve-backup", manifest["digest"]])
    assert (lab / "install.sh").read_text() == old_script and cid(lab) == stable_id, "host-script-rollback-failed"
    passed("script-bundle rollback restores old files without deploying or touching data")

    # Move one existing bind into the customized base. The replacement base
    # would lose it until the operator reconciles it back into compose.lab.yml.
    custom_base = old_base.replace("      - pluton-data:/data\n", "      - pluton-data:/data\n" + mount_lines[-1] + "\n")
    write(lab / "compose.yml", custom_base + "# operator-customized\n")
    write(lab / "compose.lab.yml", overlay.replace(mount_lines[-1] + "\n", ""))
    assert run(upgrade_args, ok=False).returncode != 0, "unknown-custom-base-overwritten"
    custom_hash = "sha256:" + hashlib.sha256((lab / "compose.yml").read_bytes()).hexdigest()
    assert run(upgrade_args + ["--accept-existing-compose", custom_hash], ok=False).returncode != 0, "accepted-custom-hash-allowed-lost-mount"
    write(lab / "compose.lab.yml", overlay)
    assert run(upgrade_args + ["--accept-existing-compose", custom_hash], ok=False).returncode == 0, "reviewed-custom-base-reconciliation-failed"
    command(lab, "install.sh", good)
    verify_app(lab, mounts_before)
    passed("unknown customized base refused; separately hash-approved mount-preserving reconciliation and future install succeed")
    assert not list(lab.glob(".deploy-run.*")) and not (lab / ".deployment-lock").exists(), "transaction-private-files-not-cleaned"
    passed("routine deployment output contains no generated secrets; private expanded configuration cleaned")


def cleanup():
    # Exact random fixture projects only. Never compose down -v or a global prune.
    for project in PROJECTS:
        result = docker("ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=" + project, ok=False)
        for value in result.stdout.split():
            if re.fullmatch("[a-f0-9]{64}", value):
                docker("rm", "-f", value, ok=False)
        for value in docker("network", "ls", "-q", "--filter", "label=com.docker.compose.project=" + project, ok=False).stdout.split():
            if re.fullmatch("[a-f0-9]+", value):
                docker("network", "rm", value, ok=False)
    for name in CONTAINERS:
        docker("rm", "-fv", name, ok=False)
    for name in VOLUMES:
        docker("volume", "rm", name, ok=False)
    for name in TAGS:
        docker("image", "rm", name, ok=False)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix=PREFIX + "-", dir=BASE) as directory:
            try:
                main(Path(directory))
            finally:
                cleanup()
        print("Deployment acceptance: " + str(PASSED) + " passed; disposable resources removed.", flush=True)
    except Exception as error:
        # Explicit assertions contain only hardcoded categories; never raw CLI output.
        print("FAIL deployment acceptance: " + (str(error) if isinstance(error, AssertionError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
