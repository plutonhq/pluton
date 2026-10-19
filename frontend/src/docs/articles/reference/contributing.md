# Memelihara dokumentasi

## Tambah artikel

Tulis Markdown Bahasa Indonesia pada `frontend/src/docs/articles/<slug>.md`, H1 yang cocok title. Daftarkan slug/title/support di `manifest.ts`, kategori dan evidence implementation files. Route otomatis `/docs/<slug>`. Hindari ratusan paragraf di React; article text tetap version-controlled.

## Links dan rendering

Gunakan internal `/docs/...#heading-anchor`; duplicate headings mendapat suffix numerik. Renderer React tidak menjalankan HTML atau MDX, tidak memakai dangerouslySetInnerHTML, serta menolak javascript/data/file/userinfo links. Flow diagrams memakai static text; tidak ada external Mermaid runtime.

Code fences mempunyai copy button, termasuk fallback trusted-LAN HTTP. Search mencakup title, headings, serta meaningful bundled content tanpa hosted index. Syntax highlight kompleks belum ditambahkan; readable monospace code tidak membutuhkan dependency/CDN.

## Screenshot

Simpan sanitized PNG/JPEG/WebP pada `frontend/public/docs-assets/` dan gunakan absolute `/docs-assets/...` image links. Jangan screenshot credential, real IP/hostname/inventory, dump, tokens, keys, atau production account names. Tidak ada runtime remote image fetch dari Markdown.

## Validasi dan build

```sh
pnpm test:docs
pnpm dev:frontend
pnpm --filter @plutonhq/core-frontend build
```

Validation memeriksa manifest/articles/internal links/anchors/evidence/security/search/rendering. Frontend build menjalankan docs validation dan menyertakan articles dalam asset bundle. Tidak ada translation framework; tambah language hanya lewat reviewed manifest/routing/tests, bukan klaim multilingual unsupported.
