# Workflow backup hingga recovery

## Alur operasional

```text
Application filesystem + optional database
  -> Remote Agent outbound poll / command ACK
  -> validate canonical source / allowed roots
  -> optional pre-hook
  -> sequential DB dump(s), private 0600 artifacts
  -> managed SFTP repository preparation
  -> Restic backup filesystem + SQL, one snapshot
  -> exact snapshot/artifact confirmation
  -> post-hook and cleanup
  -> durable Backup History
       -> independent notification outbox
       -> Browse / TAR Download / staged Restore
       -> optional Automated Recovery Test
```

## Sebelum snapshot

Source, tool, lifecycle, dan storage validation harus lolos. Salah satu dump gagal berarti backup tidak lanjut, walaupun temporary SQL file sudah terbentuk. Pre-hook bukan transaksi lintas database dan filesystem; operator menentukan consistency strategy aplikasi.

## Sesudah snapshot

Snapshot confirmation memastikan source dan seluruh recorded artifacts berada pada snapshot yang tepat. Post-hook/cleanup failure setelah snapshot sukses menjadi warning; jangan menganggap data snapshot hilang. Completion receipt persistent mencegah eksekusi ulang ketika ACK hilang.

## Recovery

Recovery Test restore exact snapshot ke workspace baru pada server, structural validation, hash SQL, lalu optional import ke target dedicated. Import Disabled berarti SQL NOT TESTED, bukan semantic database recovery passed. Manual cutover/application restart tetap kegiatan operator terpisah.
