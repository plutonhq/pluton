#!/usr/bin/env node
import {
  configFromEnvironment,
  createAgentConfig,
  parseBoolean,
} from "./config.js";
import { AgentClient } from "./client.js";
import { readEnrollmentToken } from "./enrollmentToken.js";
import { atAgentStage, formatAgentFailure } from "./errors.js";
import { saveIdentity } from "./identity.js";
import { collectInventory } from "./inventory.js";
import {
  preflightSource,
  resolveAllowedRoots,
  safeSourceDiagnosticPath,
  SourceAccessError,
} from "./filesystemPolicy.js";
import { checkConnection, run, runOnce } from "./runtime.js";

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function configFromArgs(args: string[]) {
  const envConfig = process.env;
  const allowInsecureHttp =
    args.includes("--allow-insecure-http") ||
    parseBoolean(envConfig.PLUTON_AGENT_ALLOW_INSECURE_HTTP) ||
    parseBoolean(envConfig.ALLOW_INSECURE_HTTP);
  return createAgentConfig({
    serverUrl: readOption(args, "--server") || envConfig.PLUTON_SERVER_URL,
    dataDir: readOption(args, "--data-dir") || envConfig.PLUTON_AGENT_DATA_DIR,
    allowedRoots:
      readOption(args, "--allowed-roots") ||
      envConfig.PLUTON_AGENT_ALLOWED_ROOTS,
    binDir: readOption(args, "--bin-dir") || envConfig.PLUTON_AGENT_BIN_DIR,
    allowInsecureHttp,
    caFile: readOption(args, "--ca-file") || envConfig.PLUTON_AGENT_CA_FILE,
    clientCertFile: envConfig.PLUTON_AGENT_CLIENT_CERT_FILE,
    clientKeyFile: envConfig.PLUTON_AGENT_CLIENT_KEY_FILE,
    hookRoot: envConfig.PLUTON_AGENT_HOOK_ROOT,
    databaseBinDirs: envConfig.PLUTON_AGENT_DATABASE_BIN_DIRS,
  });
}

function usage(): void {
  console.log(
    "Usage: pluton-agent enroll --server <url> (--token-stdin | --token <token>) [--data-dir <dir>]",
  );
  console.log(
    "       pluton-agent run [--once] [--server <url>] [--data-dir <dir>]",
  );
  console.log(
    "       pluton-agent check [--server <url>] [--data-dir <dir>] (heartbeat only; no command execution)",
  );
  console.log(
    "       pluton-agent preflight --source <absolute-path> --allowed-roots <comma-separated-paths> [--scan] (local, read-only; run as pluton-agent)",
  );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }
  if (command === "preflight") {
    const source = readOption(args, "--source") || "";
    const roots = (
      readOption(args, "--allowed-roots") ||
      process.env.PLUTON_AGENT_ALLOWED_ROOTS ||
      ""
    )
      .split(",")
      .filter(Boolean);
    try {
      const result = await preflightSource(source, roots, {
        scan: args.includes("--scan"),
      });
      console.log(
        JSON.stringify({
          ...result,
          requestedPath: safeSourceDiagnosticPath(result.requestedPath),
          resolvedPath: safeSourceDiagnosticPath(result.resolvedPath),
        }),
      );
    } catch (error) {
      if (!(error instanceof SourceAccessError))
        throw new Error("Source preflight could not complete.");
      console.error(
        JSON.stringify({
          code: error.code,
          requestedPath: safeSourceDiagnosticPath(error.requestedPath),
          resolvedPath: safeSourceDiagnosticPath(error.resolvedPath),
          blockedPath: safeSourceDiagnosticPath(error.blockedPath),
          advice:
            "Review read-only access and canonical allowed roots. No permissions were changed.",
        }),
      );
      process.exitCode = 1;
    }
    return;
  }
  const config = await atAgentStage("load-configuration", () =>
    args.length > 0 ? configFromArgs(args) : configFromEnvironment(),
  );
  if (command === "enroll") {
    const token = await atAgentStage("read-enrollment-token", () =>
      readEnrollmentToken(args),
    );
    const roots = await atAgentStage("resolve-allowed-roots", () =>
      resolveAllowedRoots(config.allowedRoots),
    );
    const client = new AgentClient(config);
    const result = await atAgentStage("enroll", () =>
      client.enroll(
        token,
        collectInventory({
          filesystemRootsConfigured: roots.length > 0,
          binDir: config.binDir,
          hookRoot: config.hookRoot,
          databaseBinDirs: config.databaseBinDirs,
        }),
      ),
    );
    await atAgentStage("save-identity", () =>
      saveIdentity(config.dataDir, { ...result, completedCommands: [] }),
    );
    console.log(`Agent enrolled successfully: ${result.agentId}`);
    return;
  }
  if (command === "run") {
    if (args.includes("--once")) await runOnce(config);
    else await run(config);
    return;
  }
  if (command === "check") {
    await checkConnection(config);
    console.log(
      "Agent authenticated heartbeat succeeded; no command was polled or executed.",
    );
    return;
  }
  usage();
  throw new Error("Unknown command.");
}

main().catch((error) => {
  console.error(`[pluton-agent] ${formatAgentFailure(error)}`);
  process.exitCode = 1;
});
