"""Fixed lock adapter for the pinned Oracle image (which has no flock binary).

Executed by its bundled mysqlsh Python, never an RPC or general-purpose runner.
Preserve the SAME kernel lock and descriptor across exec into the fixed bootstrap.
No third-party package, privileged helper, alternate controller or caller path.
"""
import fcntl
import os

if os.getuid() != 999 or os.getgid() != 999:
    raise SystemExit(70)
try:
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.set_inheritable(9, True)
except OSError:
    print("persistent-target-failed stage=engine-lock", flush=True)
    os._exit(71)
os.execv("/bin/bash", ["/bin/bash", "/opt/pluton-persistent/bootstrap.sh", "mysql-locked"])
