# Allowed roots, symlink, dan preflight

## Canonical containment

Path source dan allowed roots di-resolve ke realpath. Symlink source `/var/www/example-app` dapat menunjuk `/srv/example-app`; containment diperiksa terhadap resolved path. Parent directory memerlukan execute/traverse, root directory read+execute, file regular read. Writable source tidak diperlukan.

## Diagnostik lokal read-only

```sh
sudo -u pluton-agent /opt/pluton-agent/runtime/bin/node \
  /opt/pluton-agent/app/dist/index.js preflight \
  --source /srv/example-app --allowed-roots /srv/example-app --scan
```

Tanpa `--scan`, pemeriksaan murah root/parent tetap ada; recursive scan eksplisit dibatasi, tidak berjalan pada setiap heartbeat. Output membedakan source missing, parent-not-traversable, root-not-readable, entry-inaccessible, symlink escape, unsupported type, dan policy violation. Path diagnostic lokal masih internal: sanitize sebelum dibagikan.

## ACL minimum

Administrator dapat meninjau ACL read-only khusus service account: parent traverse saja bila diperlukan, source directories read/traverse, dan files read. Pertimbangkan default ACL untuk file baru dan periksa ACL mask efektif. Review scope serta reversibility sebelum penerapan; portal ini tidak otomatis mengubah ACL.

Jangan `chmod 777`, chown source ke agent, memberikan kelompok broad-write, atau mengizinkan seluruh `/home` karena satu source ditolak. Perubahan symlink antara validation dan backup tetap diperiksa fail-closed.
