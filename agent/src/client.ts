import crypto from "node:crypto";
import { AgentOperationError } from "./errors.js";
import { AgentTransport } from "./transport.js";
import { signRequest, verifyCommandDetailed } from "./protocol.js";
import type {
  AgentCommandEnvelope,
  AgentConfig,
  AgentInventory,
  StoredAgentIdentity,
} from "./types.js";

type ApiResponse<T> = { success: boolean; result: T; error?: string };

export class AgentClient {
  private readonly transport: AgentTransport;

  constructor(
    private readonly config: AgentConfig,
    private readonly identity?: StoredAgentIdentity,
  ) {
    this.transport = new AgentTransport(config);
  }

  async enroll(
    token: string,
    inventory: AgentInventory,
  ): Promise<{
    deviceId: string;
    agentId: string;
    secret: string;
    pollIntervalSeconds: number;
  }> {
    return this.postUnsigned("/api/agent/enroll", { token, inventory });
  }

  async heartbeat(inventory: AgentInventory): Promise<void> {
    await this.postSigned("/api/agent/heartbeat", inventory);
  }

  async poll(): Promise<AgentCommandEnvelope | null> {
    const result = await this.postSigned<{
      command: AgentCommandEnvelope | null;
    }>("/api/agent/poll", {});
    if (!result.command) return null;
    if (!this.identity) {
      throw new AgentOperationError(
        "verify-command",
        "agent identity is unavailable",
      );
    }
    const verification = verifyCommandDetailed(
      this.identity.secret,
      result.command,
    );
    if (!verification.valid) {
      throw new AgentOperationError("verify-command", verification.reason);
    }
    return result.command;
  }

  async acknowledge(commandId: string, leaseToken: string): Promise<void> {
    await this.postSigned(
      `/api/agent/commands/${encodeURIComponent(commandId)}/ack`,
      { leaseToken },
    );
  }

  async event(
    commandId: string,
    leaseToken: string,
    sequence: number,
    event?: Record<string, unknown>,
  ): Promise<void> {
    await this.postSigned(
      `/api/agent/commands/${encodeURIComponent(commandId)}/events`,
      {
        leaseToken,
        sequence,
        ...(event ? { event } : {}),
      },
    );
  }

  async complete(
    commandId: string,
    leaseToken: string,
    completion: {
      sequence: number;
      success: boolean;
      error?: string;
      failureStage?: string;
      failureCode?: string;
      databaseId?: string;
      engine?: "mysql" | "mariadb" | "postgresql";
      result?: Record<string, unknown>;
      cancelled?: boolean;
    },
  ): Promise<void> {
    const {
      sequence,
      success,
      error,
      failureStage,
      failureCode,
      databaseId,
      engine,
      result,
      cancelled,
    } = completion;
    await this.postSigned(
      `/api/agent/commands/${encodeURIComponent(commandId)}/complete`,
      {
        leaseToken,
        sequence,
        success,
        ...(error ? { error } : {}),
        ...(failureStage ? { failureStage } : {}),
        ...(failureCode ? { failureCode } : {}),
        ...(databaseId ? { databaseId, engine } : {}),
        ...(result ? { result } : {}),
        ...(cancelled ? { cancelled: true } : {}),
      },
    );
  }

  async commandStatus(
    commandId: string,
    leaseToken: string,
  ): Promise<{ cancelled: boolean }> {
    return this.postSigned(
      `/api/agent/commands/${encodeURIComponent(commandId)}/status`,
      {
        leaseToken,
      },
    );
  }

  private async postUnsigned<T>(
    pathname: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const raw = JSON.stringify(body);
    const response = await this.transport.post<ApiResponse<T>>(pathname, raw);
    if (!response.success)
      throw new Error(response.error || "Server rejected the agent request.");
    return response.result;
  }

  private async postSigned<T>(
    pathname: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (!this.identity)
      throw new Error("Agent identity is required. Enroll this agent first.");
    const raw = JSON.stringify(body);
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(24).toString("base64url");
    const signature = signRequest(
      this.identity.secret,
      timestamp,
      nonce,
      "POST",
      pathname,
      raw,
    );
    const response = await this.transport.post<ApiResponse<T>>(pathname, raw, {
      "x-pluton-agent-id": this.identity.agentId,
      "x-pluton-agent-timestamp": timestamp,
      "x-pluton-agent-nonce": nonce,
      "x-pluton-agent-signature": signature,
    });
    if (!response.success)
      throw new Error(response.error || "Server rejected the agent request.");
    return response.result;
  }
}
