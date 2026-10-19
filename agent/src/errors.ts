import { AgentHttpError } from "./transport.js";

export type AgentOperationStage =
  | "load-configuration"
  | "read-enrollment-token"
  | "load-identity"
  | "resolve-allowed-roots"
  | "enroll"
  | "heartbeat"
  | "poll"
  | "verify-command"
  | "validate-command"
  | "backup-filesystem"
  | "acknowledge"
  | "record-event"
  | "save-identity"
  | "complete";

/**
 * A deliberately safe diagnostic for operator-visible agent failures. It
 * carries a lifecycle stage, but never preserves an arbitrary upstream error
 * message that could contain a token, HMAC, lease token, or credential.
 */
export class AgentOperationError extends Error {
  constructor(
    public readonly stage: AgentOperationStage,
    message: string,
  ) {
    super(message);
    this.name = "AgentOperationError";
  }
}

function isSafeHttpStatus(value: number): boolean {
  return Number.isInteger(value) && value >= 100 && value <= 599;
}

export function sanitizeAgentError(error: unknown): string {
  if (error instanceof AgentHttpError && isSafeHttpStatus(error.statusCode)) {
    return `server returned HTTP ${error.statusCode}`;
  }
  if (error instanceof Error) {
    switch (error.message) {
      case "Agent identity is required. Enroll this agent first.":
        return "agent identity is unavailable";
      case "Agent identity file is invalid. Re-enroll this agent.":
        return "agent identity is invalid";
      case "Server returned an unsupported command type.":
        return "server returned an unsupported command type";
    }
  }
  return "operation failed";
}

export async function atAgentStage<T>(
  stage: AgentOperationStage,
  operation: () => Promise<T> | T,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AgentOperationError) throw error;
    throw new AgentOperationError(stage, sanitizeAgentError(error));
  }
}

export function formatAgentFailure(error: unknown): string {
  if (error instanceof AgentOperationError) {
    return `${error.stage} failed: ${error.message}.`;
  }
  return `startup failed: ${sanitizeAgentError(error)}.`;
}
