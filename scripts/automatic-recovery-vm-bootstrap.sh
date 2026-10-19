#!/usr/bin/env bash
# Explicit disposable-VM operator only. No default Docker daemon changes.
set -euo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
fixture=${1:?Supply the reviewed fixture directory}
[[ $EUID == 0 && $fixture =~ ^/srv/pluton-fixture/lifecycle-lab-[a-f0-9]{32}$ ]] || exit 70
[[ $(realpath -e -- "$fixture") == "$fixture" && $(stat -c %u:%a -- "$fixture") == 0:755 ]] || exit 70
[[ $(systemd-detect-virt --vm) == kvm && $(ps -p 1 -o comm=) == systemd ]] || exit 70
[[ $(findmnt -n -o FSTYPE --mountpoint /srv/pluton-fixture) == ext4 ]] || exit 70
[[ $(stat -c %d /srv/pluton-fixture) != "$(stat -c %d /)" ]] || exit 70
(( $(nproc) >= 4 )) || exit 70
awk '/MemTotal:/{if($2<3900000)exit 1}' /proc/meminfo
(( $(df -B1 --output=avail /srv/pluton-fixture | tail -n 1) >= 10*1024*1024*1024 )) || exit 70
tag=${fixture##*-}
unit=pluton-lab-docker-$tag.service
containerd_unit=pluton-lab-containerd-$tag.service
[[ ! -e $fixture/manifest.json && ! -e $fixture/docker && ! -e $fixture/node ]] || exit 70
install -d -m 700 "$fixture/docker" "$fixture/docker-run" "$fixture/tmp" "$fixture/containerd-data" "$fixture/containerd-run"
install -d -m 755 "$fixture/node"
printf '{"version":1,"purpose":"disposable-lifecycle-rehearsal","scope":"%s","dockerUnit":"%s","containerdUnit":"%s"}\n' "$tag" "$unit" "$containerd_unit" > "$fixture/manifest.json"
archive=node-v24.16.0-linux-x64.tar.xz
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --output "$fixture/$archive" "https://nodejs.org/dist/v24.16.0/$archive"
# Reviewed from the official Node release checksum over HTTPS; no mutable version.
printf 'd804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9  %s\n' "$fixture/$archive" | sha256sum --check --status
tar -xJf "$fixture/$archive" --directory "$fixture/node" --strip-components=1 --no-same-owner
chmod -R go-w "$fixture/node"
[[ $("$fixture/node/bin/node" -v) == v24.16.0 ]] || exit 70
"$fixture/node/bin/node" -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p+"/daemon.json",JSON.stringify({
 "data-root":p+"/docker","exec-root":p+"/docker-run","pidfile":p+"/dockerd.pid",
 hosts:["unix://"+p+"/docker.sock"],bridge:"none",iptables:false,ip6tables:false,
 "ip-forward":false,"ip-masq":false,"userland-proxy":false,"live-restore":false,
 "containerd":p+"/containerd.sock","containerd-namespace":"plutonlab-"+p.split("-").at(-1),
 "containerd-plugins-namespace":"plutonlab-plugins-"+p.split("-").at(-1),
 "storage-driver":"overlay2",features:{"containerd-snapshotter":false},"log-driver":"local"
}),{mode:0o600,flag:"wx"});
fs.writeFileSync(p+"/containerd.toml",`version = 2\nroot = "${p}/containerd-data"\nstate = "${p}/containerd-run"\ndisabled_plugins = ["io.containerd.grpc.v1.cri", "io.containerd.cri.v1.images", "io.containerd.cri.v1.runtime"]\n[grpc]\naddress = "${p}/containerd.sock"\n`,{mode:0o600,flag:"wx"});' "$fixture"
systemd-run --quiet --no-block --collect --unit="$containerd_unit" --property=Type=notify --property=Delegate=yes \
  --property="WorkingDirectory=$fixture" --property="Environment=TMPDIR=$fixture/tmp" \
  --property="StandardOutput=append:$fixture/containerd.log" --property="StandardError=append:$fixture/containerd.log" \
  /usr/bin/containerd --config "$fixture/containerd.toml"
for attempt in {1..30}; do [[ -S $fixture/containerd.sock ]] && break; sleep 1; done
[[ -S $fixture/containerd.sock ]] || exit 70
systemd-run --quiet --no-block --collect --unit="$unit" --property=Type=notify --property=Delegate=yes \
  --property="WorkingDirectory=$fixture" --property="Environment=TMPDIR=$fixture/tmp" \
  --property="StandardOutput=append:$fixture/docker.log" --property="StandardError=append:$fixture/docker.log" \
  /usr/bin/dockerd --config-file="$fixture/daemon.json"
for attempt in {1..90}; do
  if docker --host="unix://$fixture/docker.sock" info --format '{{.DockerRootDir}}' > "$fixture/docker-root.txt" 2>/dev/null; then break; fi
  sleep 1
done
[[ $(< "$fixture/docker-root.txt") == "$fixture/docker" ]] || exit 70
[[ $(docker --host="unix://$fixture/docker.sock" info --format '{{.Driver}}') == overlay2 ]] || exit 70
[[ -d $fixture/containerd-data/io.containerd.metadata.v1.bolt ]] || exit 70
printf 'PASS disposable VM resources, pinned private Node and isolated fixture-disk Docker\n'
