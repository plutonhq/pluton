# Memantau backup, storage, dan agent

## Indikator minimum

Catat latest successful backup age, expected schedule, completion snapshot binding, source readable, DB artifact sizes, recovery age/result, physical storage free space, and pending/failed notifications. Nilai threshold disesuaikan workload; docs tidak mengarang SLA universal.

## Health dan logs

Public `/api/health` hanya overall status; `/api/health/details` membutuhkan autentikasi. App logs dan journal agent memuat safe stage/error categories. Korelasikan plan/job/command IDs pada kanal privat; sanitize identifiers/infrastructure sebelum publikasi.

## Queued/slow

Periksa plan active job, source ONLINE, command lease, queue retry, supported capabilities, serta process/DB timeout. Progress indeterminate sebelum total valid adalah normal, bukan pasti stuck. Terminal state tidak boleh ditimpa event reconnect lama.

## Capacity

Logical Snapshot Size, repository physical usage, dan restore workspace berbeda. Ukur destination quota/filesystem serta Pluton data volume. SQL import temporary DB membutuhkan capacity sendiri. Cleanup warnings dapat mempertahankan private workspace yang perlu review, bukan broad deletion.

## Tanpa automation baru

Task ini tidak menambah polling agresif, metric SaaS, webhook-driven backup, atau automatic remediation. Alerts Phase 7 opt-in dan belum menggantikan monitoring infrastructure/receiver acceptance.
