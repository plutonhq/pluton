# Fork release automation

Release Please manages one application release at the repository root, despite
the backend, frontend, and agent workspace packages. It does not publish those
packages to npm or change their package identities.

## Componentless metadata

The root entry in `release-please-config.json` intentionally sets both
`component` and `package-name` to empty strings. These are Release Please's
metadata overrides, not the application's name: `package.json` remains `pluton`.

With `separate-pull-requests: false` and `include-component-in-tag: false`, the
bot generates the branch `release-please--branches--main` and a componentless PR
summary. Release Please's Node strategy otherwise infers `pluton` from the
package name and rejects that merged PR because its branch has no component.
Omitting only `component` is insufficient; the package-name fallback must also
be explicitly disabled. The empty overrides keep existing merged pending PRs
and future generated PRs consistent with unprefixed `v...` tags.

The one-time `release-as` override has been removed after the bootstrap version
was merged. Future versions follow conventional commits instead of repeatedly
proposing the bootstrap version. Use `fix: ...` or `feat: ...` commit messages
(or squash-merge titles) for releasable changes.

## Validation and pending-PR recovery

Run from the root with the pinned pnpm version:

```sh
pnpm run test:release
git diff --check
```

Tests use the installed Release Please implementation, synthetic PRs, and an
in-memory GitHub client. They verify the previous mismatch, recovery of an
already merged pending PR, future PR/release round trips, draft/prerelease policy,
and fork publication boundaries. They do not access GitHub or publish anything.

The workflow runs these checks with read-only permissions on relevant PRs and
before Release Please on `main`. Only the fork's push/manual runs may execute the
write-capable job. Its explicit `repo-url` is the invoking `github.repository`,
never an upstream remote or a hard-coded owner.

After this configuration fix is reviewed and merged into the fork's `main`,
the normal push workflow can process the previously merged PR still labeled
`autorelease: pending`. No replacement release PR, relabeling, tag deletion, or
manual recreation is required. A successful creation changes its label to
`autorelease: tagged`. Check the workflow's reported repository and release tag.

## Drafts are not public releases

`draft: true` is intentionally retained. Creating a draft and publishing it are
different operations: the release is not public until its owner explicitly
publishes the correct new draft. Do not publish an older draft to recover a newer
merged release PR. GitHub also normally creates a draft's tag only at publication,
so validate the release's commit and notes before publishing it.

`release-assets.yml` retains inherited upstream Docker Hub, Homebrew, and R2
integrations. Its jobs are guarded: fork release events and publishing dispatches
cannot run them. Explicit manual `dry_run: true` builds remain available, with no
release upload, Docker login/push, Homebrew update, or R2 upload. Existing signing
requirements may still limit those builds. Fork artifact publication requires a
separately configured and reviewed pipeline; do not supply upstream credentials.

The independent `container.yml` continues publishing the fork's GHCR images on
its existing authorized events. This fix does not run that workflow, publish a
release, dispatch jobs, commit, or push. Creating a release with `GITHUB_TOKEN`
does not by itself trigger dependent release/tag workflows; do not assume a new
release has installer assets or a version-tagged GHCR image just because Release
Please succeeded.
