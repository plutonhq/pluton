const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.join(__dirname, "..", "..");
const docker = fs.readFileSync(path.join(root, "Dockerfile.source"), "utf8");
const runtime =
  docker.split(" AS production\n")[1] || docker.split(" AS production\r\n")[1];
test("source runtime installs stable, security-floored native clients, never database servers or mysql-client", () => {
  assert(runtime);
  const packages = /RUN apk add --no-cache ([\s\S]*?)&&/.exec(runtime)[1];
  assert(packages.includes("mariadb-client>=11.8.8-r0"));
  assert(packages.includes("postgresql18-client>=18.6-r0"));
  assert(
    !/\bmysql-client\b|(?:^|\s)['"]?(?:mariadb|mysql|postgresql18|postgresql)['"]?(?:\s|$)/.test(
      packages,
    ),
  );
  assert(!packages.includes("edge"));
  assert(runtime.indexOf("USER pluton") < runtime.indexOf("RUN node --loader"));
  assert.match(
    runtime,
    /addgroup -S -g 10001 pluton.*adduser -S -u 10001 -G pluton pluton/,
  );
});
test("application entrypoint, persistent data and non-root client verification are preserved", () => {
  assert.match(runtime, /VOLUME \["\/data"\]/);
  assert.match(
    runtime,
    /CMD \["node", "--loader", "\.\/backend\/loader.mjs", "\.\/backend\/dist\/index.js"\]/,
  );
  assert.match(runtime, /verify-database-recovery-clients.mjs/);
  assert(!/ENTRYPOINT.*(?:mysql|mariadb|postgres)/.test(runtime));
});
test("GHCR publication is gated on the exact source-image recovery runtime/import checks", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/container.yml"),
    "utf8",
  );
  assert.match(workflow, /load: true/);
  assert.match(
    workflow,
    /validate-database-recovery-clients.ps1 -RuntimeImage pluton-recovery-ci:local/,
  );
  assert.match(workflow, /needs: \[validate, build-pr\]/);
  assert.match(workflow, /file: Dockerfile.source/);
});
test("native imports isolate database processes from the application container and never accept a production target", () => {
  const runner = fs.readFileSync(
    path.join(root, "scripts/validate-database-recovery-clients.ps1"),
    "utf8",
  );
  assert.match(runner, /'--network','none'/);
  assert.match(runner, /container:\$databaseContainer/);
  assert.match(runner, /'--user','10001:10001'/);
  assert(
    !/--privileged|--network.?host|\/var\/run\/docker.sock|\[string\]\$(?:Password|Target|Host|Secret)/.test(
      runner,
    ),
  );
  assert.match(runner, /Refusing unsafe disposable fixture cleanup/);
});
