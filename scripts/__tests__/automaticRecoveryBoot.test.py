"""Root boot policy unit tests; synthetic metadata, no daemon/data changes."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("policy", Path(__file__).parents[2] / "deploy/compose-tools.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class BootPolicy(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.ref = "sha256:" + "a" * 64
        self.container_id = "b" * 64
        self.files = ["compose.yml", "compose.automatic-recovery.yml"]
        self.config = {"name": "example", "volumes": {"data": {"name": "example-data"}}, "services": {
            "pluton": {"image": self.ref, "restart": "on-failure", "user": "10001:10001", "read_only": True,
                       "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"],
                       "environment": dict.fromkeys(["APP_URL", "APP_ALLOWED_ORIGINS", "AGENT_SERVER_URL",
                                                     "ALLOW_INSECURE_AGENT_HTTP", "TRUST_PROXY"], ""),
                       "healthcheck": {"test": ["CMD", "node", "-e", policy.probe_source(
                           Path(policy.__file__).with_name("healthcheck.cjs"))]},
                       "volumes": [{"type": "volume", "source": "data", "target": "/data"}]}}}
        self.container = {"Image": self.ref, "Config": {"Image": self.ref, "User": "10001:10001", "Labels": {
            "com.docker.compose.service": "pluton", "com.docker.compose.project": "example"}},
            "HostConfig": {"RestartPolicy": {"Name": "on-failure"}}, "Mounts": [
                {"Type": "volume", "Name": "example-data", "Destination": "/data", "RW": True}]}
        for name, value in {".deploy-compose-files.json": self.files,
                            ".deploy-contract.json": policy.contract(self.config)}.items():
            (self.root / name).write_text(json.dumps(value))
        self.calls = []

    def run_boot(self, action="start", selection=None):
        def snapshot(_directory, workspace):
            policy.save(Path(workspace) / "files.json", self.files)
        def compose(_directory, _workspace, args):
            import os
            self.calls.append(args)
            if args[0] == "config":
                os.write(1, json.dumps(self.config).encode())
            elif args[0] == "ps":
                os.write(1, (self.container_id + "\n").encode())
            return 0
        result = type("Result", (), {"stdout": json.dumps([self.container]).encode()})()
        def owned_fixture_file(file):
            info = Path(file).lstat()
            policy.require(stat.S_ISREG(info.st_mode) and info.st_uid == self.root.stat().st_uid and
                           not info.st_mode & 0o022, "operator-file-ownership-or-mode")
        with patch.object(policy.os, "geteuid", return_value=0, create=True), \
             patch.object(policy, "trusted", side_effect=owned_fixture_file), \
             patch.object(policy, "selection", return_value=self.files if selection is None else selection), \
             patch.object(policy, "snapshot", side_effect=snapshot), \
             patch.object(policy, "compose", side_effect=compose), \
             patch.object(policy.subprocess, "run", return_value=result):
            policy.boot(str(self.root), action)

    def refused(self):
        with self.assertRaises(policy.Refused):
            self.run_boot()
        self.assertFalse(any(call[0] in ("start", "stop") for call in self.calls))

    def test_existing_application_only_start_and_stop(self):
        for action in ("start", "stop"):
            self.run_boot(action)
        self.assertIn(["start", "pluton"], self.calls)
        self.assertIn(["stop", "--timeout", "45", "pluton"], self.calls)
        self.assertFalse(any(call[0] in ("up", "pull", "down", "rm") for call in self.calls))

    def test_missing_seal_is_refused(self):
        (self.root / ".deploy-contract.json").unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_boot()

    def test_removed_or_reordered_overlay_is_refused(self):
        with self.assertRaises(policy.Refused):
            self.run_boot(selection=list(reversed(self.files)))

    def test_mutable_image_refused(self):
        self.config["services"]["pluton"]["image"] = "example:latest"
        self.refused()

    def test_root_or_privileged_application_refused(self):
        self.container["Config"]["User"] = "0:0"
        self.refused()
        self.container["Config"]["User"] = "10001:10001"
        self.container["HostConfig"]["Privileged"] = True
        self.refused()

    def test_renamed_volume_or_project_refused(self):
        self.container["Mounts"][0]["Name"] = "foreign-data"
        self.refused()

    def test_unsafe_restart_policy_refused(self):
        self.container["HostConfig"]["RestartPolicy"]["Name"] = "unless-stopped"
        self.refused()

    def test_missing_container_is_not_created(self):
        self.container_id = ""
        self.refused()

    def test_writable_operator_seal_is_refused(self):
        os.chmod(self.root / ".deploy-contract.json", 0o666)
        self.refused()


if __name__ == "__main__":
    unittest.main()
