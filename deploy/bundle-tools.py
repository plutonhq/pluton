#!/usr/bin/env python3
"""Explicit reviewed host-bundle upgrade/restore. Does NOT deploy containers."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("compose_tools", ROOT / "compose-tools.py")
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)
BUNDLE = ("install.sh", "deploy.sh", "rollback.sh", "status.sh", "lib.sh", "compose.yml", "compose-tools.py",
          "healthcheck.cjs", "upgrade-host.sh", "bundle-tools.py", ".env.example")
# Exact public, uncustomized templates from cf36856 and cd18739. Unknown local
# bases require a separately approved hash AND a mount-preserving reconciliation.
PREVIOUS_BASES = {"c15bbca998e6ecd28d720c6332a5932dd59ebcfd16d1002f158250e1f10df5a1",
                  "85cd8b7fe1e2d66a72d9d0a1c4adfc3bae5a8ed0c504f8ae309c37017b4bc34d"}


def digest(root, names):
    value = hashlib.sha256()
    for name in sorted(names):
        POLICY.trusted(root / name)
        value.update(name.encode() + b"\0" + (root / name).read_bytes() + b"\0")
    return "sha256:" + value.hexdigest()


def copy_atomic(source, target):
    temporary = target.with_name(target.name + ".bundle-tmp")
    shutil.copyfile(source, temporary)
    os.chmod(temporary, 0o600)
    temporary.replace(target)


def check_candidate(target, workspace, names):
    stage = workspace / "candidate"
    stage.mkdir(mode=0o700)
    for name in names:
        shutil.copyfile(ROOT / name if name == "compose.yml" else target / name, stage / name)
        os.chmod(stage / name, 0o600)
    shutil.copyfile(target / ".env", workspace / ".env")
    os.chmod(workspace / ".env", 0o600)
    # Keep the same central Compose invocation as application deployment.
    stage.rename(workspace / "compose")
    POLICY.save(workspace / "files.json", names)
    with (workspace / "effective.json").open("w") as output, (workspace / "errors").open("w") as errors:
        with redirect_compose(output, errors):
            result = POLICY.compose(str(target), str(workspace), ["config", "--format", "json"])
    POLICY.require(result == 0, "candidate-compose-invalid")
    config = POLICY.load(workspace / "effective.json")
    ref = config.get("services", {}).get("pluton", {}).get("image", "")
    POLICY.require(bool(ref), "existing-image-reference-required")
    value = POLICY.validate_config(workspace / "effective.json", ref, ROOT / "healthcheck.cjs", target)
    with (workspace / "ps").open("w") as output, (workspace / "errors").open("w") as errors:
        with redirect_compose(output, errors):
            result = POLICY.compose(str(target), str(workspace), ["ps", "-q", "--all", "pluton"])
    POLICY.require(result == 0, "existing-container-lookup-failed")
    cid = (workspace / "ps").read_text().strip()
    if cid:
        POLICY.require(re.fullmatch("[a-f0-9]{64}", cid) is not None, "application-container-not-unique")
        with (workspace / "container.json").open("w") as output:
            result = subprocess.run(["docker", "inspect", cid], stdout=output, stderr=subprocess.DEVNULL)
        POLICY.require(result.returncode == 0, "existing-container-inspection-failed")
        POLICY.check_container(workspace / "effective.json", workspace / "container.json")
    elif (target / ".deploy-state").exists():
        raise POLICY.Refused("recorded-installation-container-missing")
    return value


class redirect_compose:
    # subprocess inherits file descriptors, not Python's sys.stdout replacement.
    def __init__(self, output, errors):
        self.output, self.errors = output, errors

    def __enter__(self):
        self.saved = [os.dup(1), os.dup(2)]
        os.dup2(self.output.fileno(), 1)
        os.dup2(self.errors.fileno(), 2)

    def __exit__(self, *_):
        for destination, source in zip((1, 2), self.saved):
            os.dup2(source, destination)
            os.close(source)


def upgrade(target, approved, accepted_base=None):
    POLICY.require(approved == digest(ROOT, BUNDLE), "reviewed-bundle-digest-mismatch")
    POLICY.require(target.is_absolute() and target.is_dir() and not target.is_symlink(), "installation-directory-invalid")
    POLICY.trusted_directory(target)
    POLICY.trusted(target / ".env")
    names = POLICY.selection(target)
    base_hash = hashlib.sha256((target / "compose.yml").read_bytes()).hexdigest()
    POLICY.require(base_hash in PREVIOUS_BASES or base_hash == hashlib.sha256((ROOT / "compose.yml").read_bytes()).hexdigest()
                   or accepted_base == "sha256:" + base_hash, "custom-base-requires-reviewed-reconciliation-and-hash")
    for name in BUNDLE:
        if name.endswith(".sh"):
            result = subprocess.run(["sh", "-n", str(ROOT / name)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            POLICY.require(result.returncode == 0, "candidate-shell-syntax-invalid")
    lock = target / ".deployment-lock"
    lock.mkdir(mode=0o700)
    try:
        with tempfile.TemporaryDirectory(prefix=".bundle-stage.", dir=target) as temporary:
            value = check_candidate(target, Path(temporary), names)
            backup_parent = target / ".bundle-backups"
            if not backup_parent.exists() and not backup_parent.is_symlink():
                backup_parent.mkdir(mode=0o700)
            POLICY.trusted_directory(backup_parent)
            POLICY.require(not backup_parent.stat().st_mode & 0o077, "private-backup-directory-required")
            backup = Path(tempfile.mkdtemp(prefix="bundle-", dir=backup_parent))
            existing = [name for name in BUNDLE if (target / name).exists()]
            for name in existing:
                POLICY.trusted(target / name)
                shutil.copyfile(target / name, backup / name)
                os.chmod(backup / name, 0o600)
            manifest = {"present": existing, "digest": digest(backup, existing)}
            POLICY.save(backup / "manifest.json", manifest)
            try:
                for name in BUNDLE:
                    copy_atomic(ROOT / name, target / name)
            except Exception:
                restore_files(target, backup, existing)
                raise
            # Never update .env, deployment history, local overlays, or data.
            POLICY.save(target / ".deploy-compose-files.json", names)
            POLICY.save(target / ".deploy-contract.json", value)
            print("Host bundle upgraded; no containers were deployed. Backup: " + backup.name)
            print("Script rollback approval: " + manifest["digest"])
    finally:
        lock.rmdir()


def restore_files(target, backup, existing):
    for name in BUNDLE:
        if name in existing:
            copy_atomic(backup / name, target / name)
        elif (target / name).exists():
            (target / name).unlink()


def restore(target, backup_name, approved):
    POLICY.require(re.fullmatch(r"bundle-[a-z0-9_]+", backup_name) is not None, "backup-name-invalid")
    backup = target / ".bundle-backups" / backup_name
    manifest = POLICY.load(backup / "manifest.json")
    names = manifest["present"]
    POLICY.require(all(name in BUNDLE for name in names) and len(names) == len(set(names)), "backup-manifest-invalid")
    POLICY.require(approved == manifest["digest"] == digest(backup, names), "backup-approval-digest-mismatch")
    lock = target / ".deployment-lock"
    lock.mkdir(mode=0o700)
    try:
        restore_files(target, backup, names)
        print("Previous host scripts restored; no containers, .env, deployment history or data were changed.")
    finally:
        lock.rmdir()


def main(args):
    os.umask(0o077)
    if args == ["--print-digest"]:
        print(digest(ROOT, BUNDLE))
    elif len(args) in (3, 5) and args[1] == "--approve-bundle":
        POLICY.require(len(args) == 3 or args[3] == "--accept-existing-compose", "arguments-invalid")
        upgrade(Path(args[0]), args[2], args[4] if len(args) == 5 else None)
    elif len(args) == 5 and args[0] == "--restore" and args[3] == "--approve-backup":
        restore(Path(args[1]), args[2], args[4])
    else:
        raise POLICY.Refused("usage: upgrade-host.sh <absolute-directory> --approve-bundle sha256:<reviewed-hash> [--accept-existing-compose sha256:<reviewed-old-base-hash>]; --print-digest; --restore <directory> <backup-name> --approve-backup sha256:<hash>")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except POLICY.Refused as error:
        print("Host bundle refused: " + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("Host bundle refused: invalid-file-configuration-or-active-lock", file=sys.stderr)
        sys.exit(1)
