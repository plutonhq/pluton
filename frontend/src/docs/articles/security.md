# Trust boundaries dan least privilege

## Control plane

Authenticated Web UI/API melindungi plans, inventory, encrypted credentials, jobs, dan configuration. Limited API key tidak otomatis memberikan hak notification/Legacy/recovery administration. Static `/docs` public hanya memuat artikel bundled sintetis, bukan environment atau data instance.

## Data plane

Remote Agent memakai enrollment identity, HMAC, signed command, lease, serta allowed roots. Credentials repository/storage/DB materialized hanya untuk authenticated agent command delivery. Source account tidak root dan tidak memerlukan write ke live source.

## Network

HTTP trusted-LAN adalah exception pilot, bukan equivalent HTTPS confidentiality. Production sebaiknya reverse proxy HTTPS dengan trusted certificate, split DNS, firewall minimum, dan agent CA trust yang benar. TLS tidak diaktifkan secara paksa oleh task coding ini.

## Repository dan recovery

Managed repository mutations terpisah dari Legacy read-only allowlist. Staging/new recovery databases harus isolated dari source. No automatic production SQL import, restore-to-original, key rotation, atau broad chmod.

## Notifikasi

DNS/address pinning, explicit private CIDRs, certificate verification, HMAC, bounded retries, dan safe payload membatasi outbound abuse. Receiver juga harus memvalidasi signature dan deduplicate stable event ID.

Gunakan [HTTPS guidance](/docs/security/https), [key preservation](/docs/security/credentials), dan [boundary checklist](/docs/security/boundaries).
