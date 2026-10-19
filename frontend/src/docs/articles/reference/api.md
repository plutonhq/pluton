# Referensi API operasional

## Auth boundary

API aplikasi membutuhkan session/permission sesuai route. Limited API key tidak setara administrator. Jangan menyimpan cookie/API token dalam public curl examples atau URLs. Gunakan UI untuk mutations bila belum memahami Origin/JSON requirements.

| Endpoint                                        | Kontrak ringkas                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| GET /api/health                                 | Public overall service/control DB status                         |
| GET /api/health/details                         | Authenticated component-level checks                             |
| GET /api/backups/:id/files                      | Snapshot contents, exact backup binding                          |
| GET /api/backups/:id/progress                   | Safe job progress/stage                                          |
| POST /api/backups/:id/action/cancel             | Cancel owned job                                                 |
| /api/legacy-repositories                        | Authenticated separate read-only registration/inspection/staging |
| GET /api/recovery-testing/:planId/configuration | Recovery policy/target configured markers                        |
| POST /api/recovery-testing/:planId/tests        | Queue exact-backup recovery test                                 |
| GET /api/notifications/channels                 | Sanitized named channels, no secrets                             |
| POST /api/notifications/channels/:id/test       | Queue test; 202 bukan delivered                                  |
| PUT /api/notifications/plans/:id                | Separate per-plan subscription                                   |
| GET /api/notifications/deliveries?page=0        | Paged sanitized history                                          |
| POST /api/notifications/deliveries/:id/retry    | Eligible reviewed manual retry                                   |

## Safety

Notification/settings malformed JSON errors sanitized. Notification mutations require approved Origin and application/json, termasuk bodyless DELETE. Agents memakai signed/polled protocol, bukan administrator endpoints di tabel sebagai arbitrary execution API.

Unknown/unsupported operation tidak diaktifkan hanya karena endpoint dapat ditebak. Docs public SPA fallback tidak mem-bypass registered authenticated API handlers.
