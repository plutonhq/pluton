"""Linux host policy regressions; all files are private, disposable fixtures."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("deployment_policy", ROOT / "deploy/compose-tools.py")
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


class DeploymentPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for name in ("compose.yml", ".env"):
            self.write(name, "# disposable\n")

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, name, value):
        path = self.root / name
        path.write_text(value)
        path.chmod(0o600)
        return path

    def test_base_only(self):
        self.assertEqual(POLICY.selection(self.root), ["compose.yml"])

    def test_lab_and_explicit_precedence(self):
        self.write("compose.lab.yml", "# local\n")
        self.write("compose.worker.yml", "# explicit\n")
        self.write("compose.overlays", "# approved\ncompose.worker.yml\n")
        self.assertEqual(POLICY.selection(self.root), ["compose.yml", "compose.lab.yml", "compose.worker.yml"])

    def test_profiles_not_discovered_by_glob(self):
        self.write("compose.internal-recovery.yml", "# not selected\n")
        self.assertEqual(POLICY.selection(self.root), ["compose.yml"])

    def test_missing_explicit_overlay_refused(self):
        self.write("compose.overlays", "compose.missing.yml\n")
        with self.assertRaisesRegex(POLICY.Refused, "missing"):
            POLICY.selection(self.root)

    def test_removed_previously_approved_lab_refused(self):
        self.write(".deploy-compose-files.json", '["compose.yml","compose.lab.yml"]')
        with self.assertRaisesRegex(POLICY.Refused, "missing-or-reordered"):
            POLICY.selection(self.root)

    def test_overlay_injection_refused(self):
        for name in ("../compose.host.yml", "/tmp/compose.host.yml", "compose.a.yml;id", "$(id)", "compose.a.yml --profile all"):
            self.write("compose.overlays", name)
            with self.assertRaisesRegex(POLICY.Refused, "name-invalid"):
                POLICY.selection(self.root)

    def test_duplicate_overlay_refused(self):
        self.write("compose.lab.yml", "# local\n")
        self.write("compose.overlays", "compose.lab.yml")
        with self.assertRaisesRegex(POLICY.Refused, "duplicate"):
            POLICY.selection(self.root)

    def test_symlink_refused(self):
        (self.root / "compose.lab.yml").symlink_to(self.root / "compose.yml")
        with self.assertRaisesRegex(POLICY.Refused, "not-regular"):
            POLICY.selection(self.root)

    def test_group_writable_file_refused(self):
        self.write("compose.lab.yml", "# local").chmod(0o660)
        with self.assertRaisesRegex(POLICY.Refused, "ownership-or-mode"):
            POLICY.selection(self.root)

    def config(self):
        return {"name": "disposable-app", "volumes": {"data": {"name": "disposable-data"}}, "services": {"pluton": {
            "image": "ghcr.io/example/pluton@sha256:" + "a" * 64,
            "read_only": True, "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"],
            "environment": dict.fromkeys(("APP_URL", "APP_ALLOWED_ORIGINS", "AGENT_SERVER_URL", "ALLOW_INSECURE_AGENT_HTTP", "TRUST_PROXY"), ""),
            "healthcheck": {"test": ["CMD", "node", "-e", POLICY.probe_source(ROOT / "deploy/healthcheck.cjs")]},
            "volumes": [{"type": "volume", "source": "data", "target": "/data"},
                        {"type": "bind", "source": str(self.root), "target": "/fixture", "read_only": True}]
        }}}

    def validate(self, config):
        path = self.write("effective.json", json.dumps(config))
        return POLICY.validate_config(path, self.config()["services"]["pluton"]["image"], ROOT / "deploy/healthcheck.cjs", self.root)

    def test_valid_sandbox_and_mount_contract(self):
        self.assertEqual(len(self.validate(self.config())["mounts"]), 2)

    def test_image_override_refused(self):
        config = self.config()
        config["services"]["pluton"]["image"] = "unreviewed:latest"
        with self.assertRaisesRegex(POLICY.Refused, "image-overridden"):
            self.validate(config)

    def test_unsafe_service_settings_refused(self):
        for key, value in (("privileged", True), ("use_api_socket", True), ("user", "root"), ("profiles", ["database"]), ("read_only", False)):
            config = self.config()
            config["services"]["pluton"][key] = value
            with self.subTest(key=key), self.assertRaises(POLICY.Refused):
                self.validate(config)

    def test_missing_supported_environment_refused(self):
        config = self.config()
        del config["services"]["pluton"]["environment"]["APP_ALLOWED_ORIGINS"]
        with self.assertRaisesRegex(POLICY.Refused, "environment-setting"):
            self.validate(config)

    def test_wrong_healthcheck_refused(self):
        config = self.config()
        config["services"]["pluton"]["healthcheck"]["test"] = ["CMD", "true"]
        with self.assertRaisesRegex(POLICY.Refused, "get-healthcheck"):
            self.validate(config)

    def test_missing_bind_source_refused(self):
        config = self.config()
        config["services"]["pluton"]["volumes"][1]["source"] += "/does-not-exist"
        with self.assertRaisesRegex(POLICY.Refused, "bind-source-missing"):
            self.validate(config)

    def test_volume_swap_or_readonly_change_refused(self):
        POLICY.save(self.root / ".deploy-contract.json", self.validate(self.config()))
        for change in ("volume", "mode", "project"):
            config = self.config()
            if change == "volume":
                config["volumes"]["data"]["name"] = "another-volume"
            elif change == "mode":
                config["services"]["pluton"]["volumes"][1]["read_only"] = False
            else:
                config["name"] = "another-project"
            with self.subTest(change=change), self.assertRaisesRegex(POLICY.Refused, "recorded-project-or-mounts"):
                self.validate(config)

    def test_runtime_mount_mismatch_and_wrong_project_refused(self):
        config = self.config()
        config_path = self.write("effective.json", json.dumps(config))
        container = {"Config": {"User": "10001:10001", "Labels": {"com.docker.compose.service": "pluton", "com.docker.compose.project": "disposable-app"}}, "Mounts": []}
        path = self.write("inspect.json", json.dumps([container]))
        with self.assertRaisesRegex(POLICY.Refused, "mounts-mismatch"):
            POLICY.check_container(config_path, path)
        container["Config"]["Labels"]["com.docker.compose.project"] = "other-app"
        path.write_text(json.dumps([container]))
        with self.assertRaisesRegex(POLICY.Refused, "identity-mismatch"):
            POLICY.check_container(config_path, path)

    def test_image_digest_and_nonroot_user_required(self):
        ref = self.config()["services"]["pluton"]["image"]
        path = self.write("image.json", json.dumps([{"Id": "fixture-image", "RepoDigests": [ref], "Config": {"User": "10001:10001"}}]))
        self.assertEqual(POLICY.image_valid(path, ref), "fixture-image")
        with self.assertRaisesRegex(POLICY.Refused, "digest-mismatch"):
            POLICY.image_valid(path, ref[:-1] + "b")
        value = json.loads(path.read_text())
        value[0]["Config"]["User"] = "root"
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(POLICY.Refused, "runtime-user"):
            POLICY.image_valid(path, ref)

    def test_propagation_is_part_of_the_exact_contract(self):
        config = self.config()
        first = POLICY.mounts(config)
        config["services"]["pluton"]["volumes"][1]["bind"] = {"propagation": "rslave"}
        self.assertNotEqual(first, POLICY.mounts(config))

    def test_snapshot_freezes_overlay_for_rollback(self):
        self.write("compose.lab.yml", "# original\n")
        with tempfile.TemporaryDirectory() as workspace:
            POLICY.snapshot(self.root, workspace)
            self.write("compose.lab.yml", "# changed after transaction\n")
            self.assertEqual((Path(workspace) / "compose/compose.lab.yml").read_text(), "# original\n")

    def test_actual_compose_preserves_probe_source(self):
        self.write("compose.yml", (ROOT / "deploy/compose.yml").read_text())
        self.write(".env", "PLUTON_IMAGE_REF=ghcr.io/example/pluton@sha256:" + "a" * 64 + "\nENCRYPTION_KEY=" + os.urandom(32).hex() + "\nUSER_NAME=fixture-admin\nUSER_PASSWORD=" + os.urandom(24).hex() + "\n")
        with tempfile.TemporaryDirectory() as workspace:
            POLICY.snapshot(self.root, workspace)
            result = subprocess.run(["python3", str(ROOT / "deploy/compose-tools.py"), "compose", str(self.root), workspace, "config", "--format", "json"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, "actual Compose validation failed")
            actual = json.loads(result.stdout)["services"]["pluton"]["healthcheck"]["test"]
            self.assertEqual(actual, ["CMD", "node", "-e", POLICY.probe_source(ROOT / "deploy/healthcheck.cjs")])

    def mysql_worker(self):
        config = self.config()
        config["services"]["pluton"]["volumes"].append({"type": "volume", "source": "mysql-ipc", "target": "/run/pluton-mysql-worker", "read_only": True})
        config["services"]["mysql-recovery-worker"] = {
            "image": "ghcr.io/example/pluton-mysql-recovery-worker@sha256:" + "b" * 64,
            "user": "10001:10001", "read_only": True, "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"],
            "mem_limit": 384 * 1024 ** 2, "memswap_limit": 384 * 1024 ** 2, "cpus": "0.5", "pids_limit": 64,
            "tmpfs": ["/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=160m"],
            "networks": {"persistent-restores": {}, "automatic-tests": {}},
            "volumes": [{"type": "volume", "source": "mysql-ipc", "target": "/run/pluton-mysql-worker"},
                        {"type": "bind", "source": "/etc/example-worker/target.json", "target": "/run/pluton-mysql-config/target.json", "read_only": True, "bind": {"create_host_path": False}},
                        {"type": "bind", "source": "/etc/pluton-automatic-recovery/mysql-public", "target": "/run/pluton-mysql-internal", "read_only": True, "bind": {"create_host_path": False}}]}
        return config

    def test_mysql_internal_worker_is_immutable_private_and_bounded(self):
        config = self.mysql_worker()
        POLICY.validate_internal_mysql_worker(config)
        config["services"]["mysql-recovery-worker"]["image"] = "sha256:" + "c" * 64
        POLICY.validate_internal_mysql_worker(config)  # Reviewed local archive, never a mutable test tag.

    def test_mysql_worker_refuses_runtime_overrides_and_unbounded_resources(self):
        for key, value in (("image", "unreviewed:latest"), ("user", "0:0"), ("privileged", True), ("cap_add", ["SYS_ADMIN"]),
                           ("command", ["arbitrary"]), ("entrypoint", ["arbitrary"]), ("network_mode", "host"),
                           ("environment", {"UNREVIEWED_OPTION": "true"}), ("mem_limit", 0), ("memswap_limit", -1),
                           ("pids_limit", 0), ("tmpfs", ["/tmp:size=2g"])):
            config = self.mysql_worker()
            config["services"]["mysql-recovery-worker"][key] = value
            with self.subTest(key=key), self.assertRaises(POLICY.Refused):
                POLICY.validate_internal_mysql_worker(config)

    def test_mysql_worker_cannot_read_other_engine_mailboxes_or_application_data(self):
        for patch in ({"source": "/etc/pluton-automatic-recovery/public"}, {"read_only": False},
                      {"bind": {"create_host_path": True}}):
            config = self.mysql_worker()
            config["services"]["mysql-recovery-worker"]["volumes"][2].update(patch)
            with self.assertRaises(POLICY.Refused):
                POLICY.validate_internal_mysql_worker(config)
        config = self.mysql_worker()
        config["services"]["mysql-recovery-worker"]["volumes"].append({"type": "bind", "source": "/data", "target": "/data", "read_only": True})
        with self.assertRaises(POLICY.Refused):
            POLICY.validate_internal_mysql_worker(config)

    def test_mysql_worker_requires_exact_private_ipc_and_networks(self):
        config = self.mysql_worker()
        config["services"]["mysql-recovery-worker"]["volumes"][0]["source"] = "foreign-ipc"
        with self.assertRaises(POLICY.Refused):
            POLICY.validate_internal_mysql_worker(config)
        config = self.mysql_worker()
        config["services"]["mysql-recovery-worker"]["networks"]["unapproved"] = {}
        with self.assertRaises(POLICY.Refused):
            POLICY.validate_internal_mysql_worker(config)

    def test_existing_custom_worker_policy_is_unchanged_and_approved_ca_can_coexist(self):
        POLICY.validate_internal_mysql_worker({"services": {"mysql-recovery-worker": {"image": "legacy-not-an-internal-profile"}}})
        config = self.mysql_worker()
        worker = config["services"]["mysql-recovery-worker"]
        worker["networks"]["mysql-recovery-egress"] = {}
        worker["volumes"].append({"type": "bind", "source": "/etc/example-worker/ca.pem", "target": "/run/pluton-mysql-config/ca.pem", "read_only": True, "bind": {"create_host_path": True}})
        POLICY.validate_internal_mysql_worker(config)

    def test_actual_mysql_overlay_is_narrow_alone_and_preserves_an_existing_custom_worker(self):
        self.write("compose.yml", (ROOT / "deploy/compose.yml").read_text())
        base = ["compose.persistent-restore.yml", "compose.automatic-recovery.yml"]
        for custom in (False, True):
            names = base + (["compose.mysql-recovery-worker.yml"] if custom else []) + ["compose.mysql-internal-recovery.yml"]
            for name in names:
                self.write(name, (ROOT / "deploy" / name).read_text())
            self.write("compose.overlays", "\n".join(names))
            self.write(".env", "PLUTON_IMAGE_REF=ghcr.io/example/pluton@sha256:" + "a" * 64 + "\nENCRYPTION_KEY=" + os.urandom(32).hex() +
                       "\nUSER_NAME=fixture-admin\nUSER_PASSWORD=" + os.urandom(24).hex() +
                       "\nPLUTON_MYSQL_WORKER_IMAGE_REF=ghcr.io/example/pluton-mysql-recovery-worker@sha256:" + "b" * 64 +
                       "\nPLUTON_MYSQL_WORKER_CONFIG=/etc/example-worker/target.json\nPLUTON_MYSQL_WORKER_CA=/etc/example-worker/ca.pem\n")
            with tempfile.TemporaryDirectory() as workspace:
                POLICY.snapshot(self.root, workspace)
                result = subprocess.run(["python3", str(ROOT / "deploy/compose-tools.py"), "compose", str(self.root), workspace, "config", "--format", "json"], capture_output=True, text=True)
                diagnostic = result.stderr
                for line in (self.root / ".env").read_text().splitlines():
                    if "=" in line:
                        value = line.split("=", 1)[1]
                        if value:
                            diagnostic = diagnostic.replace(value, "<fixture-value>")
                self.assertEqual(result.returncode, 0, "actual MySQL overlay expansion failed: " + diagnostic[:500])
                effective = json.loads(result.stdout)
                POLICY.validate_internal_mysql_worker(effective)
                ca = [item for item in effective["services"]["mysql-recovery-worker"]["volumes"] if item["target"] == "/run/pluton-mysql-config/ca.pem"]
                self.assertEqual(len(ca), int(custom), "Custom CA must be preserved, not invented or removed")


if __name__ == "__main__":
    unittest.main()
