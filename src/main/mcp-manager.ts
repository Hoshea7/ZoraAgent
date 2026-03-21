import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { McpServerConfigForProcessTransport } from "@anthropic-ai/claude-agent-sdk";
import type {
  McpConfig,
  McpRawJsonSaveResult,
  McpRawJsonServerResult,
  McpServerEntry,
  McpServerTestResult,
  McpTransportType,
} from "../shared/types/mcp";
import { isRecord } from "./utils/guards";
import { isEnoentError, replaceFileAtomically } from "./utils/fs";

const MASKED_SECRET = "••••••";
const ENCRYPTED_PREFIX = "__ENCRYPTED:";
const DEFAULT_TIMEOUT_SECONDS = 30;
const REMOTE_TEST_TIMEOUT_MS = 10_000;
const MCP_TRANSPORT_TYPES = new Set<McpTransportType>(["stdio", "http", "sse"]);
const SENSITIVE_KEYWORDS = ["key", "token", "secret", "password", "authorization"];
const INITIALIZE_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: {
      name: "ZoraAgent",
      version: "1.0.0",
    },
  },
} as const;

type StringRecord = Record<string, string>;
export type SdkMcpServers = Record<string, McpServerConfigForProcessTransport>;

let sharedMcpManager: McpManager | null = null;

function isMcpTransportType(value: unknown): value is McpTransportType {
  return typeof value === "string" && MCP_TRANSPORT_TYPES.has(value as McpTransportType);
}

function normalizeRequiredName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error("MCP server name is required.");
  }

  return normalized;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }

  return value
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeOptionalStringRecord(
  value: unknown,
  fieldName: string
): StringRecord | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const normalized: StringRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`${fieldName}.${key} must be a string.`);
    }

    normalized[key] = item;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function normalizeRequiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function normalizeOptionalTimeout(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }

  return value;
}

function normalizeOptionalLastTestResult(
  value: unknown,
  fieldName: string
): McpServerEntry["lastTestResult"] {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  if (typeof value.success !== "boolean") {
    throw new Error(`${fieldName}.success must be a boolean.`);
  }

  if (typeof value.message !== "string") {
    throw new Error(`${fieldName}.message must be a string.`);
  }

  if (typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp)) {
    throw new Error(`${fieldName}.timestamp must be a number.`);
  }

  return {
    success: value.success,
    message: value.message,
    timestamp: value.timestamp,
  };
}

function normalizeServerEntry(input: unknown, fieldName: string): McpServerEntry {
  if (!isRecord(input)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  if (!isMcpTransportType(input.type)) {
    throw new Error(`${fieldName}.type must be one of: stdio, http, sse.`);
  }

  return {
    type: input.type,
    command: normalizeOptionalString(input.command),
    args: normalizeOptionalStringArray(input.args, `${fieldName}.args`),
    url: normalizeOptionalString(input.url),
    headers: normalizeOptionalStringRecord(input.headers, `${fieldName}.headers`),
    env: normalizeOptionalStringRecord(input.env, `${fieldName}.env`),
    timeout:
      normalizeOptionalTimeout(input.timeout, `${fieldName}.timeout`) ??
      DEFAULT_TIMEOUT_SECONDS,
    enabled: normalizeRequiredBoolean(input.enabled, `${fieldName}.enabled`),
    isBuiltin: normalizeOptionalBoolean(input.isBuiltin, `${fieldName}.isBuiltin`),
    lastTestResult: normalizeOptionalLastTestResult(
      input.lastTestResult,
      `${fieldName}.lastTestResult`
    ),
  };
}

function normalizeConfig(input: unknown): McpConfig {
  if (!isRecord(input) || !isRecord(input.servers)) {
    throw new Error("MCP config file is malformed.");
  }

  const servers: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(input.servers)) {
    servers[name] = normalizeServerEntry(entry, `mcp.servers.${name}`);
  }

  return { servers };
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => normalizedKey.includes(keyword));
}

function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

function ensureEncryptionAvailable(mode: "encrypt" | "decrypt"): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(`safeStorage ${mode}ion is unavailable on this device.`);
  }
}

function encryptValue(value: string): string {
  ensureEncryptionAvailable("encrypt");
  return `${ENCRYPTED_PREFIX}${safeStorage.encryptString(value).toString("base64")}`;
}

function decryptValue(value: string): string {
  if (!isEncryptedValue(value)) {
    return value;
  }

  ensureEncryptionAvailable("decrypt");
  return safeStorage.decryptString(
    Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64")
  );
}

function maskSensitiveRecord(record?: StringRecord): StringRecord | undefined {
  if (!record) {
    return undefined;
  }

  const masked: StringRecord = {};
  for (const [key, value] of Object.entries(record)) {
    masked[key] = isSensitiveKey(key) ? MASKED_SECRET : value;
  }

  return masked;
}

function encryptSensitiveRecord(
  nextRecord?: StringRecord,
  previousRecord?: StringRecord
): StringRecord | undefined {
  if (!nextRecord) {
    return undefined;
  }

  const encrypted: StringRecord = {};
  for (const [key, value] of Object.entries(nextRecord)) {
    if (!isSensitiveKey(key)) {
      encrypted[key] = value;
      continue;
    }

    if (value === MASKED_SECRET && previousRecord?.[key]) {
      encrypted[key] = previousRecord[key];
      continue;
    }

    encrypted[key] = isEncryptedValue(value) ? value : encryptValue(value);
  }

  return encrypted;
}

function resolveRuntimeRecord(
  nextRecord?: StringRecord,
  previousStoredRecord?: StringRecord
): StringRecord | undefined {
  if (!nextRecord) {
    return undefined;
  }

  const resolved: StringRecord = {};
  for (const [key, value] of Object.entries(nextRecord)) {
    if (!isSensitiveKey(key)) {
      resolved[key] = value;
      continue;
    }

    if (value === MASKED_SECRET && previousStoredRecord?.[key]) {
      resolved[key] = decryptValue(previousStoredRecord[key]);
      continue;
    }

    resolved[key] = decryptValue(value);
  }

  return resolved;
}

function maskEntry(entry: McpServerEntry): McpServerEntry {
  return {
    ...entry,
    args: entry.args ? [...entry.args] : undefined,
    headers: maskSensitiveRecord(entry.headers),
    env: maskSensitiveRecord(entry.env),
    lastTestResult: entry.lastTestResult ? { ...entry.lastTestResult } : undefined,
  };
}

function prepareEntryForStorage(
  nextEntry: McpServerEntry,
  previousEntry?: McpServerEntry
): McpServerEntry {
  return {
    ...nextEntry,
    args: nextEntry.args ? [...nextEntry.args] : undefined,
    headers: encryptSensitiveRecord(nextEntry.headers, previousEntry?.headers),
    env: encryptSensitiveRecord(nextEntry.env, previousEntry?.env),
    lastTestResult: nextEntry.lastTestResult ? { ...nextEntry.lastTestResult } : undefined,
  };
}

function resolveEntryForRuntime(
  nextEntry: McpServerEntry,
  previousStoredEntry?: McpServerEntry
): McpServerEntry {
  return {
    ...nextEntry,
    args: nextEntry.args ? [...nextEntry.args] : undefined,
    headers: resolveRuntimeRecord(nextEntry.headers, previousStoredEntry?.headers),
    env: resolveRuntimeRecord(nextEntry.env, previousStoredEntry?.env),
    lastTestResult: nextEntry.lastTestResult ? { ...nextEntry.lastTestResult } : undefined,
  };
}

function sortStringRecord(record?: StringRecord): StringRecord | undefined {
  if (!record) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

function createComparableSignature(entry: McpServerEntry): string {
  return JSON.stringify({
    type: entry.type,
    command: entry.command ?? null,
    args: entry.args ?? [],
    url: entry.url ?? null,
    headers: sortStringRecord(entry.headers) ?? null,
    env: sortStringRecord(entry.env) ?? null,
    timeout: entry.timeout ?? DEFAULT_TIMEOUT_SECONDS,
  });
}

function truncateText(value: string, maxChars = 240): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildTestResult(success: boolean, message: string): McpServerTestResult {
  return {
    success,
    message,
  };
}

function buildRawJsonServerResult(
  name: string,
  result: McpServerTestResult
): McpRawJsonServerResult {
  return {
    name,
    success: result.success,
    message: result.message,
  };
}

function buildRawJsonSaveFailure(
  error: string,
  results: McpRawJsonServerResult[] = []
): McpRawJsonSaveResult {
  return {
    success: false,
    error,
    results,
  };
}

function formatServerInfoName(serverInfo: Record<string, unknown>): string {
  const name =
    typeof serverInfo.name === "string" && serverInfo.name.trim().length > 0
      ? serverInfo.name.trim()
      : "unknown";
  const version =
    typeof serverInfo.version === "string" && serverInfo.version.trim().length > 0
      ? ` v${serverInfo.version.trim()}`
      : "";

  return `连接成功: ${name}${version}`;
}

function extractRpcTestResult(payload: unknown): McpServerTestResult | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (isRecord(payload.result) && isRecord(payload.result.serverInfo)) {
    return buildTestResult(true, formatServerInfoName(payload.result.serverInfo));
  }

  if (isRecord(payload.error)) {
    const errorMessage =
      typeof payload.error.message === "string" && payload.error.message.trim().length > 0
        ? payload.error.message.trim()
        : typeof payload.error.code === "number"
          ? `连接失败 (code ${payload.error.code})`
          : "连接失败";

    return buildTestResult(false, errorMessage);
  }

  return null;
}

function createTimestampedResult(result: McpServerTestResult): NonNullable<McpServerEntry["lastTestResult"]> {
  return {
    success: result.success,
    message: result.message,
    timestamp: Date.now(),
  };
}

export class McpManager {
  private readonly configPath: string;
  private readonly configDir: string;
  private initializePromise: Promise<McpConfig> | null = null;

  constructor() {
    this.configPath = path.join(app.getPath("home"), ".zora", "mcp.json");
    this.configDir = path.dirname(this.configPath);
  }

  private createEmptyConfig(): McpConfig {
    return { servers: {} };
  }

  private async writeConfig(config: McpConfig): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await replaceFileAtomically(this.configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  private async initializeEmptyConfig(): Promise<McpConfig> {
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        const emptyConfig = this.createEmptyConfig();
        await this.writeConfig(emptyConfig);
        return emptyConfig;
      })();

      void this.initializePromise.finally(() => {
        this.initializePromise = null;
      });
    }

    return this.initializePromise;
  }

  private async readConfig(): Promise<McpConfig> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      return normalizeConfig(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isEnoentError(error)) {
        return this.initializeEmptyConfig();
      }

      throw error;
    }
  }

  private async readRawConfigText(): Promise<string> {
    try {
      return await readFile(this.configPath, "utf8");
    } catch (error) {
      if (isEnoentError(error)) {
        const config = await this.initializeEmptyConfig();
        return `${JSON.stringify(config, null, 2)}\n`;
      }

      throw error;
    }
  }

  private createStoredConfig(
    nextConfig: McpConfig,
    previousConfig: McpConfig,
    latestTestResults: Map<string, NonNullable<McpServerEntry["lastTestResult"]>> = new Map()
  ): McpConfig {
    const servers: Record<string, McpServerEntry> = {};

    for (const [name, entry] of Object.entries(nextConfig.servers)) {
      const previousEntry = previousConfig.servers[name];
      servers[name] = prepareEntryForStorage(
        {
          ...entry,
          lastTestResult: latestTestResults.get(name) ?? previousEntry?.lastTestResult,
        },
        previousEntry
      );
    }

    return { servers };
  }

  private async persistTestResultIfCurrent(
    serverName: string,
    testedEntry: McpServerEntry,
    result: NonNullable<McpServerEntry["lastTestResult"]>
  ): Promise<void> {
    const config = await this.readConfig();
    const storedEntry = config.servers[serverName];

    if (!storedEntry) {
      return;
    }

    const runtimeStoredEntry = resolveEntryForRuntime(storedEntry, storedEntry);
    if (
      createComparableSignature(runtimeStoredEntry) !==
      createComparableSignature(testedEntry)
    ) {
      return;
    }

    config.servers[serverName] = {
      ...storedEntry,
      lastTestResult: result,
    };

    await this.writeConfig(config);
  }

  private async testStdioServer(entry: McpServerEntry): Promise<McpServerTestResult> {
    const command = entry.command;
    if (!command) {
      return buildTestResult(false, "请填写 Command");
    }

    const timeoutMs = Math.max(
      1_000,
      Math.round((entry.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1_000)
    );
    const env = {
      ...process.env,
      ...(entry.env ?? {}),
    };
    const args = entry.args ?? [];

    return new Promise<McpServerTestResult>((resolve) => {
      let settled = false;
      let stdoutBuffer = Buffer.alloc(0);
      let newlineBuffer = "";
      let stderrOutput = "";
      let sawFramedMessage = false;

      const child = spawn(command, args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      }) as ChildProcessWithoutNullStreams;

      const settle = (result: McpServerTestResult) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutHandle);

        if (!child.killed) {
          try {
            child.kill("SIGTERM");
          } catch {
            // Ignore kill failures.
          }
        }

        setTimeout(() => {
          if (!child.killed) {
            try {
              child.kill("SIGKILL");
            } catch {
              // Ignore forced kill failures.
            }
          }
        }, 250);

        resolve(result);
      };

      const timeoutHandle = setTimeout(() => {
        settle(
          buildTestResult(
            false,
            `连接超时：${timeoutMs / 1_000} 秒内未收到 initialize 响应`
          )
        );
      }, timeoutMs);

      const handlePayload = (payloadText: string) => {
        let parsed: unknown;

        try {
          parsed = JSON.parse(payloadText);
        } catch {
          return false;
        }

        const result = extractRpcTestResult(parsed);
        if (!result) {
          return false;
        }

        settle(result);
        return true;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }

        stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
        newlineBuffer += chunk.toString("utf8");

        while (stdoutBuffer.length > 0) {
          const headerStartIndex = stdoutBuffer.indexOf("Content-Length:");
          if (headerStartIndex > 0) {
            stdoutBuffer = stdoutBuffer.subarray(headerStartIndex);
          }

          const headerEndIndex = stdoutBuffer.indexOf("\r\n\r\n");
          if (headerEndIndex === -1) {
            break;
          }

          const headerText = stdoutBuffer.subarray(0, headerEndIndex).toString("utf8");
          const contentLengthMatch = /content-length:\s*(\d+)/i.exec(headerText);
          if (!contentLengthMatch) {
            stdoutBuffer = stdoutBuffer.subarray(headerEndIndex + 4);
            continue;
          }

          const contentLength = Number(contentLengthMatch[1]);
          const bodyStartIndex = headerEndIndex + 4;
          const bodyEndIndex = bodyStartIndex + contentLength;
          if (stdoutBuffer.length < bodyEndIndex) {
            break;
          }

          sawFramedMessage = true;
          const bodyText = stdoutBuffer.subarray(bodyStartIndex, bodyEndIndex).toString("utf8");
          stdoutBuffer = stdoutBuffer.subarray(bodyEndIndex);

          if (handlePayload(bodyText)) {
            return;
          }
        }

        if (sawFramedMessage) {
          return;
        }

        let lineBreakIndex = newlineBuffer.indexOf("\n");
        while (lineBreakIndex !== -1) {
          const line = newlineBuffer.slice(0, lineBreakIndex).trim();
          newlineBuffer = newlineBuffer.slice(lineBreakIndex + 1);

          if (line && handlePayload(line)) {
            return;
          }

          lineBreakIndex = newlineBuffer.indexOf("\n");
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrOutput += chunk.toString("utf8");
      });

      child.once("error", (error: Error) => {
        settle(buildTestResult(false, error.message));
      });

      child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }

        const stderrMessage = truncateText(stderrOutput.trim());
        if (stderrMessage) {
          settle(buildTestResult(false, stderrMessage));
          return;
        }

        if (signal) {
          settle(buildTestResult(false, `进程异常退出 (${signal})`));
          return;
        }

        if (typeof code === "number") {
          settle(buildTestResult(false, `进程异常退出 (code ${code})`));
          return;
        }

        settle(buildTestResult(false, "进程在返回 initialize 响应前退出"));
      });

      try {
        const body = JSON.stringify(INITIALIZE_REQUEST);
        child.stdin.write(`${body}\n`, "utf8");
      } catch (error) {
        settle(buildTestResult(false, stringifyError(error)));
      }
    });
  }

  private async testRemoteServer(entry: McpServerEntry): Promise<McpServerTestResult> {
    if (!entry.url) {
      return buildTestResult(false, "请填写 URL");
    }

    try {
      const response = await fetch(entry.url, {
        method: "POST",
        headers: {
          ...(entry.headers ?? {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(INITIALIZE_REQUEST),
        signal: AbortSignal.timeout(REMOTE_TEST_TIMEOUT_MS),
      });

      const responseText = await response.text();
      let parsed: unknown = null;

      if (responseText.trim().length > 0) {
        try {
          parsed = JSON.parse(responseText);
        } catch {
          return buildTestResult(
            false,
            `响应不是有效 JSON (HTTP ${response.status}): ${truncateText(responseText)}`
          );
        }
      }

      const rpcResult = extractRpcTestResult(parsed);
      if (!response.ok) {
        return buildTestResult(
          false,
          rpcResult?.message ??
            `HTTP ${response.status}: ${truncateText(responseText || response.statusText)}`
        );
      }

      if (rpcResult) {
        return rpcResult;
      }

      return buildTestResult(false, "响应中未包含有效的 MCP initialize 结果");
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return buildTestResult(false, "连接超时：10 秒内未收到响应");
      }

      return buildTestResult(false, stringifyError(error));
    }
  }

  async getConfig(): Promise<McpConfig> {
    const storedConfig = await this.readConfig();
    const servers: Record<string, McpServerEntry> = {};

    for (const [name, entry] of Object.entries(storedConfig.servers)) {
      servers[name] = maskEntry(entry);
    }

    return { servers };
  }

  async getRawConfigJson(): Promise<string> {
    return this.readRawConfigText();
  }

  async addServer(name: string, entry: McpServerEntry): Promise<McpConfig> {
    const normalizedName = normalizeRequiredName(name);
    const normalizedEntry = normalizeServerEntry(entry, `mcp.servers.${normalizedName}`);
    const config = await this.readConfig();

    config.servers[normalizedName] = prepareEntryForStorage(
      normalizedEntry,
      config.servers[normalizedName]
    );

    await this.writeConfig(config);
    return this.getConfig();
  }

  async updateServer(name: string, entry: McpServerEntry): Promise<McpConfig> {
    const normalizedName = normalizeRequiredName(name);
    const config = await this.readConfig();
    const previousEntry = config.servers[normalizedName];

    if (!previousEntry) {
      throw new Error(`MCP server "${normalizedName}" does not exist.`);
    }

    config.servers[normalizedName] = prepareEntryForStorage(
      normalizeServerEntry(entry, `mcp.servers.${normalizedName}`),
      previousEntry
    );

    await this.writeConfig(config);
    return this.getConfig();
  }

  async removeServer(name: string): Promise<McpConfig> {
    const normalizedName = normalizeRequiredName(name);
    const config = await this.readConfig();
    const currentEntry = config.servers[normalizedName];

    if (!currentEntry) {
      return this.getConfig();
    }

    if (currentEntry.isBuiltin) {
      throw new Error(`Built-in MCP server "${normalizedName}" cannot be removed.`);
    }

    delete config.servers[normalizedName];
    await this.writeConfig(config);
    return this.getConfig();
  }

  async toggleServer(name: string, enabled: boolean): Promise<McpConfig> {
    const normalizedName = normalizeRequiredName(name);
    const config = await this.readConfig();
    const currentEntry = config.servers[normalizedName];

    if (!currentEntry) {
      throw new Error(`MCP server "${normalizedName}" does not exist.`);
    }

    config.servers[normalizedName] = {
      ...currentEntry,
      enabled,
    };

    await this.writeConfig(config);
    return this.getConfig();
  }

  async buildSdkMcpServers(): Promise<SdkMcpServers> {
    const config = await this.readConfig();
    const sdkServers: SdkMcpServers = {};

    for (const [name, entry] of Object.entries(config.servers)) {
      if (!entry.enabled) {
        continue;
      }

      const runtimeEntry = resolveEntryForRuntime(entry, entry);

      if (runtimeEntry.type === "stdio") {
        if (!runtimeEntry.command) {
          continue;
        }

        sdkServers[name] = {
          type: "stdio",
          command: runtimeEntry.command,
          args: runtimeEntry.args ? [...runtimeEntry.args] : undefined,
          env: runtimeEntry.env,
        };
        continue;
      }

      if (!runtimeEntry.url) {
        continue;
      }

      sdkServers[name] = {
        type: runtimeEntry.type,
        url: runtimeEntry.url,
        headers: runtimeEntry.headers,
      };
    }

    return sdkServers;
  }

  async saveRawJson(rawJson: string): Promise<McpRawJsonSaveResult> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      return buildRawJsonSaveFailure(`JSON 格式错误: ${stringifyError(error)}`);
    }

    if (!isRecord(parsed) || !isRecord(parsed.servers)) {
      return buildRawJsonSaveFailure("JSON 结构错误: 必须包含 servers 对象");
    }

    let nextConfig: McpConfig;

    try {
      nextConfig = normalizeConfig(parsed);
    } catch (error) {
      return buildRawJsonSaveFailure(stringifyError(error));
    }

    const previousConfig = await this.readConfig();
    for (const [name, entry] of Object.entries(previousConfig.servers)) {
      if (entry.isBuiltin && !nextConfig.servers[name]) {
        return buildRawJsonSaveFailure(`内置 MCP Server "${name}" 不可删除`);
      }
    }

    const changedServers: Array<[string, McpServerEntry]> = [];
    for (const [name, entry] of Object.entries(nextConfig.servers)) {
      const previousEntry = previousConfig.servers[name];
      const runtimeEntry = resolveEntryForRuntime(entry, previousEntry);
      const runtimePreviousEntry = previousEntry
        ? resolveEntryForRuntime(previousEntry, previousEntry)
        : undefined;

      if (
        !runtimePreviousEntry ||
        createComparableSignature(runtimeEntry) !==
          createComparableSignature(runtimePreviousEntry)
      ) {
        changedServers.push([name, entry]);
      }
    }

    const results: McpRawJsonServerResult[] = [];
    const latestTestResults = new Map<
      string,
      NonNullable<McpServerEntry["lastTestResult"]>
    >();

    for (const [name, entry] of changedServers) {
      const testResult = await this.testServer(name, entry);
      results.push(buildRawJsonServerResult(name, testResult));
      latestTestResults.set(name, createTimestampedResult(testResult));
    }

    if (results.some((result) => !result.success)) {
      return buildRawJsonSaveFailure("以下 Server 连接测试失败", results);
    }

    const storedConfig = this.createStoredConfig(
      nextConfig,
      previousConfig,
      latestTestResults
    );
    await this.writeConfig(storedConfig);

    return {
      success: true,
      results,
    };
  }

  async testServer(name: string, entry: McpServerEntry): Promise<McpServerTestResult> {
    const normalizedName = normalizeRequiredName(name);
    const normalizedEntry = normalizeServerEntry(entry, `mcp.servers.${normalizedName}`);
    const config = await this.readConfig();
    const storedEntry = config.servers[normalizedName];
    const runtimeEntry = resolveEntryForRuntime(normalizedEntry, storedEntry);

    const result =
      runtimeEntry.type === "stdio"
        ? await this.testStdioServer(runtimeEntry)
        : await this.testRemoteServer(runtimeEntry);

    await this.persistTestResultIfCurrent(
      normalizedName,
      runtimeEntry,
      createTimestampedResult(result)
    );

    return result;
  }
}

export function setSharedMcpManager(manager: McpManager): McpManager {
  sharedMcpManager = manager;
  return manager;
}

export function getSharedMcpManager(): McpManager {
  if (!sharedMcpManager) {
    throw new Error("MCP manager has not been initialized.");
  }

  return sharedMcpManager;
}
