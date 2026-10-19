# Referensi konfigurasi

## Backend environment

| Variable                                                           | Fungsi dan kehati-hatian                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| SERVER_PORT                                                        | Port listener; default 5173                                      |
| APP_URL / APP_TITLE                                                | Origin aplikasi dan title; bukan credential URL                  |
| ENCRYPTION_KEY / SECRET                                            | Key material existing; jangan rotate/regenerate saat upgrade     |
| USER_NAME / USER_PASSWORD                                          | Bootstrap administrator container; file config privat            |
| APIKEY / SESSION_DURATION                                          | Limited machine API key dan session duration days                |
| MAX_CONCURRENT_BACKUPS                                             | Batas concurrency server, default 2                              |
| PLUTON_DATA_DIR                                                    | Application persistent directory; Docker `/data`                 |
| TRUST_PROXY                                                        | Hanya trusted proxy hops/subnet yang dibatasi                    |
| ALLOW_INSECURE_AGENT_HTTP                                          | Explicit exception trusted-LAN server                            |
| AGENT_OFFLINE_TIMEOUT_SECONDS                                      | Heartbeat stale boundary, default 90                             |
| ALLOW_CUSTOM_RESTORE_PATH / ALLOW_FILE_BROWSER / FILE_BROWSER_ROOT | Local UI/file-browser capabilities; bukan bypass managed staging |
| DISABLE_EVENT_SCRIPTS                                              | Existing script lifecycle switch                                 |
| APP_VERSION / VCS_REF                                              | Metadata image/build, bukan otomatis current release feed        |

## Agent config

Agent mengenali `PLUTON_SERVER_URL`, `PLUTON_AGENT_DATA_DIR`, `PLUTON_AGENT_ALLOWED_ROOTS`, `PLUTON_AGENT_BIN_DIR`, `PLUTON_AGENT_ALLOW_INSECURE_HTTP`, CA/client certificate/key file config, hook root, dan database bin directories. Administrator-owned config, bukan fields arbitrary dari remote command.

## Compose

`PLUTON_IMAGE`, `PLUTON_IMAGE_REF`, `PLUTON_VERSION`, `PLUTON_VOLUME_NAME`, dan `PLUTON_PORT` dipakai deployment scripts, bukan semua backend config variables. Template Compose meneruskan subset explicit. Jangan mengarang env `SMTP_PASSWORD`/`WEBHOOK_SECRET`: Phase 7 channels disimpan melalui authenticated write-only API/UI.
