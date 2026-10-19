# VM, Proxmox, healthcheck, dan log

## VM dan storage

Pluton tidak memprovision Proxmox atau mengatur hypervisor. Berikan VM Linux supported, Docker/Compose, reliable time synchronization, persistent disk, dan network routing yang terbatas. Snapshot VM bukan pengganti backup konsisten repository/control plane. Hindari snapshot hypervisor di tengah SQL dump/import sebagai satu-satunya recovery evidence.

## Pemeriksaan dasar

```sh
cd /opt/pluton
docker compose ps
docker compose logs --tail 100 pluton
curl --fail http://localhost:5173/api/health
```

Port contoh mengikuti default; gunakan origin/port installation yang benar. Healthcheck menilai service/control DB, bukan validasi seluruh repository, free space source, DB privileges, atau delivery receiver.

## Log dan privacy

App log berada di data/logs; agent mempunyai systemd journal. Korelasikan plan/backup/command/recovery/event IDs dan safe stage/error code. Jangan berbagi `.env`, keyfile, raw SQL, Rclone config, database dump, atau inventory internal untuk troubleshooting publik.

## Capacity

Pantau disk volume, temporary workspaces, repository destination, memory, serta longest job duration. Cleanup failure dapat meninggalkan data sensitif pada workspace privat dan perlu investigasi; jangan recursive-delete data root atau repository sebagai langkah pertama.
