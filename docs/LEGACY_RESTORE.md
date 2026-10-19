# Staged recovery from a legacy Restic repository

This guide covers the Phase 2 recovery path for an existing local Restic
repository registered in **Legacy Repositories**. It is designed to inspect a
snapshot and recover a limited set of files or directories without transferring
ownership of the repository to Pluton.

## What this recovery does

The repository stays **READ ONLY REPOSITORY**. Pluton can list structured snapshot
entries and invoke a constrained Restic restore that reads the repository. The
only write destination is a private, application-controlled staging workspace
under the Pluton data directory. There is no destination field in the UI or API.
The registered repository path must also be physically separate from the staging
root; equal, nested, ancestor, and symlink-alias overlaps are rejected.

The recovery path never runs `backup`, `forget`, `prune`, `unlock`, `migrate`,
`repair`, or `init`. It uses `--no-lock`, `--overwrite never`, validated
`--include` paths, and never uses `--delete`.

## Recover selected content

1. Open **Legacy Repositories** and select the registered repository.
2. Use filters if needed, then select a snapshot to open the browser.
3. Follow the breadcrumbs to inspect direct children. The browser shows each
   entry's type, logical path, size, modification time, and permissions.
4. Select one file, one directory, or multiple non-overlapping files/directories.
   A selected directory includes its descendants. Symlinks and unsupported entry
   types cannot be selected directly.
5. Choose **Restore selected to staging**. Review the full snapshot and selected
   logical paths in the confirmation before starting the job.
6. Watch the job status. It progresses through `queued`, `running`, then
   `completed`, `failed`, or `cancelled`.
7. After completion, navigate to a restored regular file in the browser and choose
   **Download**. Each download is authenticated and scoped to that completed job.

Pluton does not package directories into archives. A directory can be selected for
recovery but must be reviewed through the approved staging process; its individual
regular files can be downloaded from the browser after completion.

## Staging data

Each job has a generated workspace inside `legacy-restores` below the application's
data base. In Docker this is `/data/legacy-restores`; in development it is
`data/legacy-restores`. The internal workspace name and full path are not exposed
to the browser or API.

Staging output may contain sensitive application data. Protect the Pluton data
volume, keep it outside source control, and remove it only through an approved
operational process. Phase 2 does not automatically purge it, calculate required
free disk space, resume an interrupted job, or retry partial output.

## Safety limits

- The browser accepts only relative logical snapshot paths. Traversal, absolute
  paths, malformed separators, Windows-style paths, encoded ambiguity, and control
  characters are rejected.
- A browser directory response is limited to 10,000 direct entries and 8 MiB of
  structured output. A restore accepts at most 20 selected paths and limits stdout
  to 4 MiB.
- A running restore has a 30-minute timeout. Cancelling it does not unlock the
  repository or delete staging output.
- Downloads reject directories, symlinks, paths outside the job workspace, and
  jobs belonging to another repository.

For the complete implementation contract, endpoint list, and operation matrix, see
[LEGACY_REPOSITORY_DESIGN.md](LEGACY_REPOSITORY_DESIGN.md).
