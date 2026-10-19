import path from "node:path";
import type { AgentConfig } from "./types.js";

const TRUE_VALUES = new Set(["1", "true", "yes"]);

export function parseBoolean(value: string | undefined): boolean {
  return value ? TRUE_VALUES.has(value.trim().toLowerCase()) : false;
}

export function parseAllowedRoots(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function createAgentConfig(input: {
  serverUrl?: string;
  dataDir?: string;
  allowedRoots?: string;
  binDir?: string;
  allowInsecureHttp?: boolean;
  caFile?: string;
  clientCertFile?: string;
  clientKeyFile?: string;
  hookRoot?: string;
  databaseBinDirs?: string;
}): AgentConfig {
  if (!input.serverUrl)
    throw new Error("PLUTON_SERVER_URL or --server is required.");
  let serverUrl: URL;
  try {
    serverUrl = new URL(input.serverUrl);
  } catch {
    throw new Error("PLUTON_SERVER_URL must be an absolute HTTP or HTTPS URL.");
  }
  if (serverUrl.protocol !== "https:" && serverUrl.protocol !== "http:") {
    throw new Error(
      "PLUTON_SERVER_URL must use HTTPS or explicitly allowed HTTP.",
    );
  }
  if (serverUrl.protocol === "http:" && !input.allowInsecureHttp) {
    throw new Error(
      "HTTP is disabled. Set ALLOW_INSECURE_HTTP=true only for a trusted LAN.",
    );
  }
  if (
    serverUrl.username ||
    serverUrl.password ||
    serverUrl.hash ||
    serverUrl.search ||
    serverUrl.pathname !== "/"
  ) {
    throw new Error(
      "PLUTON_SERVER_URL must be an origin without credentials, a path, query, or fragment.",
    );
  }

  return {
    serverUrl,
    dataDir: path.resolve(input.dataDir || "/var/lib/pluton-agent"),
    allowedRoots: parseAllowedRoots(input.allowedRoots),
    binDir: path.resolve(input.binDir || "/opt/pluton-agent/bin"),
    allowInsecureHttp: input.allowInsecureHttp === true,
    caFile: input.caFile,
    clientCertFile: input.clientCertFile,
    clientKeyFile: input.clientKeyFile,
    hookRoot: path.resolve(input.hookRoot || "/etc/pluton-agent/hooks"),
    databaseBinDirs: input.databaseBinDirs
      ? parseAllowedRoots(input.databaseBinDirs).map((value) =>
          path.resolve(value),
        )
      : undefined,
  };
}

export function configFromEnvironment(
  overrides: Partial<Record<string, string>> = process.env,
): AgentConfig {
  return createAgentConfig({
    serverUrl: overrides.PLUTON_SERVER_URL,
    dataDir: overrides.PLUTON_AGENT_DATA_DIR,
    allowedRoots: overrides.PLUTON_AGENT_ALLOWED_ROOTS,
    binDir: overrides.PLUTON_AGENT_BIN_DIR,
    allowInsecureHttp:
      parseBoolean(overrides.PLUTON_AGENT_ALLOW_INSECURE_HTTP) ||
      parseBoolean(overrides.ALLOW_INSECURE_HTTP),
    caFile: overrides.PLUTON_AGENT_CA_FILE,
    clientCertFile: overrides.PLUTON_AGENT_CLIENT_CERT_FILE,
    clientKeyFile: overrides.PLUTON_AGENT_CLIENT_KEY_FILE,
    hookRoot: overrides.PLUTON_AGENT_HOOK_ROOT,
    databaseBinDirs: overrides.PLUTON_AGENT_DATABASE_BIN_DIRS,
  });
}
