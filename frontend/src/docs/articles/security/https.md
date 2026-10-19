# HTTP LAN menuju HTTPS

## Keterbatasan pilot

HTTP LAN tidak melindungi cookie, enrollment, command credentials, atau dashboard dari network observer. HMAC command integrity tidak mengenkripsi HTTP transport. Pertahankan pilot hanya pada segmented trusted network; jangan expose port langsung ke Internet.

## Reverse proxy

Operator menyiapkan domain seperti `pluton.example.internal`, certificate CA trusted, HTTPS termination, dan upstream internal ke port aplikasi. `APP_URL` harus public origin yang benar; `TRUST_PROXY` hanya sesuai proxy hop/subnet yang dibatasi firewall. Jangan membiarkan arbitrary client memalsukan forwarded headers.

Proxy harus meneruskan SPA paths `/docs/*`, API routes, cookies, serta response headers tanpa mengalihkan nested docs ke website lain. Docs tidak membutuhkan server/domain kedua.

## Migrasi bertahap

Validasi login, origin-sensitive notification mutations, download/restore, dan docs refresh melalui domain HTTPS. Dari host agent, uji DNS/certificate dengan trust yang sama seperti service. Split DNS dapat mengarahkan domain ke internal address; certificate hostname tetap domain tersebut.

Update server origin config agent via installer dengan existing identity dan seluruh roots. Private CA memakai `--ca-file`; jangan `--re-enroll` atau disable TLS. Setelah semua agent tervalidasi HTTPS, operator dapat menonaktifkan HTTP allowance secara terencana, bukan selama pilot belum siap.

Live infrastructure changes bukan bagian task coding ini.
