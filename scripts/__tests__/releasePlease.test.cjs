const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");
const { Manifest } = require("release-please");
const releaseLogger = require("release-please/build/src/util/logger");

// Reuse the YAML parser already shipped with Release Please, without adding a
// dependency. Loading its public entry point first also initializes its factories.
const releaseRequire = createRequire(require.resolve("release-please"));
const { parse } = releaseRequire("yaml");
const root = path.resolve(__dirname, "../..");
const readJson = (file) =>
  JSON.parse(readFileSync(path.join(root, file), "utf8"));
const readWorkflow = (file) =>
  parse(readFileSync(path.join(root, file), "utf8"));
const config = readJson("release-please-config.json");
const versions = readJson(".release-please-manifest.json");
const packageJson = readJson("package.json");
const diagnostics = [];
const originalLogger = releaseLogger.logger;
const logger = Object.fromEntries(
  ["info", "warn", "error", "debug", "trace"].map((level) => [
    level,
    (...args) =>
      diagnostics.push({ level, message: args.map(String).join(" ") }),
  ]),
);
releaseLogger.setLogger(logger);
beforeEach(() => {
  diagnostics.length = 0;
});
after(() => releaseLogger.setLogger(originalLogger));

const previousSha = "a".repeat(40);
const nextSha = "b".repeat(40);
// Keep synthetic history independent of later real version bumps in the files
// under test, including release PRs that update the root version themselves.
const fixtureVersions = { ".": "0.18.0-alpha.1" };
const notes = "## 0.18.0-alpha.1\n\n### Bug Fixes\n\n* example regression fix";
const mergedPr = {
  number: 42,
  title: "chore: release main",
  headBranchName: "release-please--branches--main",
  sha: previousSha,
  labels: ["autorelease: pending"],
  files: ["package.json", "CHANGELOG.md", ".release-please-manifest.json"],
  body: [
    ":robot: I have created a release *beep* *boop*",
    "---",
    "",
    "<details><summary>0.18.0-alpha.1</summary>",
    "",
    notes,
    "</details>",
    "",
    "---",
    "This PR was generated with Release Please.",
  ].join("\n"),
};

async function fixture({
  configuration = config,
  prs = [mergedPr],
  releases = [],
  commits = [],
} = {}) {
  const state = { prs: structuredClone(prs), writes: [] };
  // Every read is an in-memory fixture; unexpected operations fail rather than
  // falling back to a real GitHub client, credentials, or network connection.
  const client = {
    repository: {
      owner: "example",
      repo: "backup-fork",
      defaultBranch: "main",
    },
    async getFileJson(file, branch) {
      assert.equal(branch, "main");
      if (file === "release-please-config.json")
        return structuredClone(configuration);
      assert.equal(file, ".release-please-manifest.json");
      return structuredClone(fixtureVersions);
    },
    async getFileContentsOnBranch(file, branch) {
      assert.equal(branch, "main");
      assert.equal(file, "package.json");
      const parsedContent = JSON.stringify({
        ...packageJson,
        version: fixtureVersions["."],
      });
      return {
        parsedContent,
        content: Buffer.from(parsedContent).toString("base64"),
        sha: previousSha,
      };
    },
    async *pullRequestIterator(branch, status) {
      assert.equal(branch, "main");
      assert.equal(status, "MERGED");
      yield* structuredClone(state.prs);
    },
    async *releaseIterator() {
      yield* structuredClone(releases);
    },
    async *mergeCommitIterator(branch) {
      assert.equal(branch, "main");
      yield* structuredClone(commits);
    },
  };
  const github = new Proxy(client, {
    get(target, property) {
      assert.ok(
        property in target,
        `Unexpected GitHub operation: ${String(property)}`,
      );
      return target[property];
    },
  });
  const manifest = await Manifest.fromManifest(
    github,
    "main",
    undefined,
    undefined,
    { logger },
  );
  return { manifest, client, state };
}

test("the root release is componentless without renaming the application", async () => {
  assert.deepEqual(Object.keys(config.packages), ["."]);
  assert.equal(config.packages["."].component, "");
  assert.equal(config.packages["."]["package-name"], "");
  assert.equal(config.packages["."]["include-component-in-tag"], false);
  assert.equal(config["separate-pull-requests"], false);
  assert.equal(packageJson.name, "pluton");
  assert.equal(packageJson.license, "Apache-2.0");
  assert.equal(packageJson.version, versions["."]);

  const { manifest } = await fixture();
  const strategy = (await manifest.getStrategiesByPath())["."];
  assert.equal(await strategy.getBranchComponent(), "");
  assert.equal(await strategy.getComponent(), "");
});

test("the old configuration reproduces a successful no-op instead of a release", async () => {
  const configuration = structuredClone(config);
  Object.assign(configuration.packages["."], {
    component: "pluton",
    "package-name": "pluton",
    "release-as": "0.18.0-alpha.1",
  });
  const { manifest } = await fixture({ configuration });
  assert.deepEqual(await manifest.buildReleases(), []);
  assert.ok(
    diagnostics.some(
      ({ message }) =>
        message ===
        "PR component: undefined does not match configured component: pluton",
    ),
  );
});

test("clearing only component still rejects the package-name fallback", async () => {
  const configuration = structuredClone(config);
  configuration.packages["."]["package-name"] = "pluton";
  const { manifest } = await fixture({ configuration });
  assert.deepEqual(await manifest.buildReleases(), []);
  assert.ok(
    diagnostics.some(({ message }) =>
      message.includes("configured component: pluton"),
    ),
  );
});

test("an already merged pending componentless PR produces its original release", async () => {
  const { manifest, state } = await fixture();
  const candidates = await manifest.buildReleases();
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.equal(candidate.tag.toString(), "v0.18.0-alpha.1");
  assert.equal(candidate.name, "v0.18.0-alpha.1");
  assert.equal(candidate.sha, previousSha);
  assert.equal(candidate.pullRequest.number, 42);
  assert.equal(candidate.path, ".");
  assert.equal(candidate.draft, true);
  assert.equal(candidate.prerelease, true);
  assert.equal(candidate.notes, notes);
  assert.deepEqual(state.writes, []);
  assert.ok(
    !diagnostics.some(({ message }) => message.includes("PR component:")),
  );
});

test("mocked release creation labels the same PR and does not recreate it on rerun", async () => {
  const { manifest, client, state } = await fixture();
  client.createRelease = async (candidate, options) => {
    state.writes.push({ operation: "createRelease", candidate, options });
    return {
      name: candidate.name,
      tagName: candidate.tag.toString(),
      sha: candidate.sha,
      url: "https://example.invalid/releases/example",
      ...options,
    };
  };
  client.commentOnIssue = async (comment, number) => {
    assert.equal(number, 42);
    state.writes.push({ operation: "comment", comment });
  };
  client.removeIssueLabels = async (labels, number) => {
    assert.equal(number, 42);
    state.prs[0].labels = state.prs[0].labels.filter(
      (label) => !labels.includes(label),
    );
  };
  client.addIssueLabels = async (labels, number) => {
    assert.equal(number, 42);
    state.prs[0].labels.push(...labels);
  };

  const created = await manifest.createReleases();
  assert.equal(created.length, 1);
  assert.equal(created[0].prNumber, 42);
  assert.equal(created[0].version, "0.18.0-alpha.1");
  const [write] = state.writes;
  assert.equal(write.options.draft, true);
  assert.equal(write.options.prerelease, true);
  assert.notEqual(write.options.forceTag, true);
  assert.deepEqual(state.prs[0].labels, ["autorelease: tagged"]);
  assert.deepEqual(await manifest.createReleases(), []);
  assert.equal(
    state.writes.filter(({ operation }) => operation === "createRelease")
      .length,
    1,
  );
});

test("tagged historical releases and ordinary merged PRs are not released again", async () => {
  const prs = [
    { ...mergedPr, labels: ["autorelease: tagged"] },
    { ...mergedPr, number: 43, labels: [] },
  ];
  const { manifest } = await fixture({ prs });
  assert.deepEqual(await manifest.buildReleases(), []);
});

test("malformed release metadata is not turned into a candidate", async () => {
  for (const override of [
    { headBranchName: "example-feature" },
    { body: "Not a release PR" },
  ]) {
    const { manifest } = await fixture({ prs: [{ ...mergedPr, ...override }] });
    assert.deepEqual(await manifest.buildReleases(), []);
  }
});

test("the one-time release-as override no longer pins future versions", () => {
  assert.ok(!Object.hasOwn(config, "release-as"));
  assert.ok(!Object.hasOwn(config.packages["."], "release-as"));
  assert.equal(config.packages["."].draft, true);
  assert.equal(config.packages["."].prerelease, true);
  assert.notEqual(config.packages["."]["force-tag-creation"], true);
});

async function nextReleaseFixture(commits) {
  return fixture({
    prs: [],
    releases: [
      {
        tagName: "v0.18.0-alpha.1",
        name: "v0.18.0-alpha.1",
        sha: previousSha,
        notes,
      },
    ],
    commits: [
      ...commits,
      {
        sha: previousSha,
        message: "chore: release main",
        files: mergedPr.files,
        pullRequest: { ...mergedPr, labels: ["autorelease: tagged"] },
      },
    ],
  });
}

test("the next generated PR bumps normally and round-trips to a componentless release", async () => {
  const { manifest, state } = await nextReleaseFixture([
    {
      sha: nextSha,
      message: "fix: example regression",
      files: ["frontend/src/example.ts"],
    },
  ]);
  const prs = await manifest.buildPullRequests();
  assert.equal(prs.length, 1);
  const pr = prs[0];
  assert.equal(pr.body.releaseData[0].version.toString(), "0.18.0-alpha.2");
  assert.equal(pr.title.toString(), "chore: release main");
  assert.equal(pr.headRefName, "release-please--branches--main");
  assert.match(pr.body.toString(), /<summary>0\.18\.0-alpha\.2<\/summary>/);

  const packageUpdate = pr.updates.find(
    ({ path: file }) => file === "package.json",
  );
  const updatedPackage = JSON.parse(
    packageUpdate.updater.updateContent(JSON.stringify(packageJson)),
  );
  assert.equal(updatedPackage.name, packageJson.name);
  assert.equal(updatedPackage.version, "0.18.0-alpha.2");
  assert.equal(updatedPackage.license, packageJson.license);
  assert.deepEqual(updatedPackage.devDependencies, packageJson.devDependencies);

  state.prs.push({
    number: 43,
    title: pr.title.toString(),
    headBranchName: pr.headRefName,
    sha: nextSha,
    labels: pr.labels,
    files: [],
    body: pr.body.toString(),
  });
  const candidates = await manifest.buildReleases();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].tag.toString(), "v0.18.0-alpha.2");
  assert.equal(candidates[0].draft, true);
  assert.ok(
    !diagnostics.some(({ message }) => message.includes("PR component:")),
  );
});

test("a rerun with no new commits does not propose another release PR", async () => {
  const { manifest } = await nextReleaseFixture([]);
  assert.deepEqual(await manifest.buildPullRequests(), []);
});

test("workflow validates with read-only permissions and writes only to the invoking fork", () => {
  const workflow = readWorkflow(".github/workflows/release-please.yml");
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.ok(
    workflow.on.pull_request.paths.includes(
      "scripts/__tests__/releasePlease.test.cjs",
    ),
  );

  const validation = workflow.jobs["validate-config"];
  const checkout = validation.steps.find(
    (step) => step.uses === "actions/checkout@v4",
  );
  assert.equal(checkout.with["persist-credentials"], false);
  assert.ok(
    validation.steps.some((step) => step.run === "pnpm run test:release"),
  );
  assert.ok(
    validation.steps.some(
      (step) =>
        step.run ===
        "pnpm install --filter pluton --frozen-lockfile --ignore-scripts",
    ),
  );
  const pnpmSetup = validation.steps.find(
    (step) => step.uses === "pnpm/action-setup@v4",
  );
  assert.equal(packageJson.packageManager, `pnpm@${pnpmSetup.with.version}`);

  const release = workflow.jobs["release-please"];
  assert.equal(release.needs, "validate-config");
  assert.equal(
    release.if,
    "github.event.repository.fork == true && github.event_name != 'pull_request'",
  );
  assert.deepEqual(release.permissions, {
    contents: "write",
    "pull-requests": "write",
  });
  const action = release.steps.find(
    (step) => step.uses === "googleapis/release-please-action@v4",
  );
  assert.equal(action.with["repo-url"], "${{ github.repository }}");
  assert.equal(action.with["target-branch"], "main");
  assert.equal(action.with["config-file"], "release-please-config.json");
  assert.equal(action.with["manifest-file"], ".release-please-manifest.json");
  assert.ok(
    release.steps.some((step) => step.name === "Report release result"),
  );
});

test("fork publication cannot run inherited upstream asset integrations", () => {
  const workflow = readWorkflow(".github/workflows/release-assets.yml");
  const buildGuard =
    "github.repository == 'plutonhq/pluton' || (github.event_name == 'workflow_dispatch' && inputs.dry_run == true)";
  const publishGuard =
    "${{ github.repository == 'plutonhq/pluton' && github.event.inputs.dry_run != 'true' }}";
  for (const job of ["build-linux", "build-windows", "build-macos", "docker"]) {
    assert.equal(workflow.jobs[job].if, buildGuard);
  }
  for (const job of ["update-homebrew", "upload-scripts"]) {
    assert.equal(workflow.jobs[job].if, publishGuard);
  }
  for (const job of ["build-linux", "build-windows", "build-macos"]) {
    const uploads = workflow.jobs[job].steps.filter(
      (step) => step.uses === "softprops/action-gh-release@v2",
    );
    assert.ok(uploads.length > 0);
    for (const upload of uploads)
      assert.match(upload.if, /github\.event\.inputs\.dry_run != 'true'/);
  }
  const docker = workflow.jobs.docker;
  const login = docker.steps.find(
    (step) => step.uses === "docker/login-action@v3",
  );
  assert.equal(login.if, "${{ github.event.inputs.dry_run != 'true' }}");
  const build = docker.steps.find(
    (step) => step.uses === "docker/build-push-action@v5",
  );
  assert.match(build.with.push, /github\.event\.inputs\.dry_run != 'true'/);
});
