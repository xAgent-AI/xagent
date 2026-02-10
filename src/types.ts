export enum ExecutionMode {
  YOLO = 'yolo',
  ACCEPT_EDITS = 'accept_edits',
  PLAN = 'plan',
  DEFAULT = 'default',
  SMART = 'smart'
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  SUCCESS = 'success',
  INFO = 'info',
  DEBUG = 'debug'
}

export enum AuthType {
  OAUTH_XAGENT = 'oauth-xagent',
  OPENAI_COMPATIBLE = 'openai_compatible'
}

export interface AuthConfig {
  type: AuthType;
  apiKey?: string;
  refreshToken?: string;
  baseUrl?: string;
  modelName?: string;
  searchApiKey?: string;
  showAIDebugInfo?: boolean;
  xagentApiBaseUrl?: string;     // xAgent API base URL
  remote_llmModelName?: string;  // Remote mode LLM Model Name
  remote_vlmModelName?: string;  // Remote mode VLM Model Name
}

export interface Tool {
  name: string;
  description: string;
  execute: (params: any, executionMode?: ExecutionMode) => Promise<any>;
  allowedModes: ExecutionMode[];
  inputSchema?: any; // For MCP tools to pass input schema
}

export interface AgentConfig {
  agentType: string;
  systemPrompt: string;
  whenToUse: string;
  model?: string;
  allowedTools?: string[];
  allowedMcps?: string[];
  isInheritMcps?: boolean;
  proactive?: boolean;
  color?: string;
  name?: string;
  description?: string;
}

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  trust?: boolean;
  includeTools?: string[];
  excludeTools?: string[];
  url?: string;
  transport?: 'stdio' | 'sse' | 'http';
  type?: 'stdio' | 'sse' | 'http';  // Alternative field name for transport (MCP spec compatibility)
  authToken?: string;
  headers?: Record<string, string>;
}

export interface CheckpointConfig {
  enabled: boolean;
  autoCreate: boolean;
  maxCheckpoints: number;
}

export interface ThinkingConfig {
  enabled: boolean;
  mode: 'none' | 'normal' | 'hard' | 'mega' | 'ultra';
  displayMode: 'full' | 'compact' | 'indicator';
}

export interface Settings {
  theme: string;
  selectedAuthType: AuthType;
  apiKey?: string;
  refreshToken?: string;
  baseUrl?: string;
  modelName?: string;
  xagentApiBaseUrl?: string;  // xAgent API base URL (for token validation)
  guiSubagentModel?: string;
  guiSubagentBaseUrl?: string;
  guiSubagentApiKey?: string;
  searchApiKey?: string;
  skillsPath?: string;  // Path to built-in skills directory
  userSkillsPath?: string;  // Path to user-installed skills directory (~/.xagent/skills)
  userNodeModulesPath?: string;  // Path to user-installed node_modules (~/.xagent/node_modules)
  workspacePath?: string;  // Path to workspace directory
  executionMode: ExecutionMode;
  approvalMode?: ExecutionMode;
  checkpointing: CheckpointConfig;
  thinking: ThinkingConfig;
  contextCompression: CompressionConfig;
  contextFileName: string | string[];
  mcpServers: Record<string, MCPServerConfig>;
  mcpToolPreferences: Record<string, 'mcp' | 'local'>;
  language: 'zh' | 'en';
  autoUpdate: boolean;
  telemetryEnabled: boolean;
  showToolDetails: boolean;
  showAIDebugInfo: boolean;
  loggerLevel: LogLevel;
  remote_llmModelName?: string;  // Remote 模式使用的 LLM Model Name
  remote_vlmModelName?: string;  // Remote 模式使用的 VLM Model Name
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];
  timestamp: number;
  reasoning_content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface Conversation {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolCall {
  tool: string;
  params: any;
  result?: any;
  error?: string;
  timestamp: number;
}

export interface Checkpoint {
  id: string;
  timestamp: number;
  description: string;
  gitSnapshot?: string;
  conversationSnapshot: ChatMessage[];
  tool_calls: ToolCall[];
}

export interface InputType {
  type: 'text' | 'image' | 'file' | 'command';
  content: string;
  metadata?: any;
}

export interface SessionInput {
  type: 'text' | 'command' | 'file' | 'image';
  content: string;
  rawInput?: string;
  filePath?: string;
  timestamp: number;
}

export interface SessionOutput {
  role: 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolParams?: any;
  toolResult?: any;
  timestamp: number;
  duration?: number;
  reasoning_content?: string;
  tool_calls?: any[];
}

export interface Session {
  id: string;
  conversationId: string;
  startTime: number;
  endTime?: number;
  inputs: SessionInput[];
  outputs: SessionOutput[];
  agent?: string;
  executionMode?: string;
  totalTokens?: number;
  status: 'active' | 'completed' | 'cancelled';
}

export interface CompressionConfig {
  enabled: boolean;
}

export interface CompressionStats {
  lastCompressionTime?: number;
  totalCompressions: number;
  originalMessagesTotal: number;
  compressedMessagesTotal: number;
}

export interface Agent {
  name: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
}

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCallItem {
  id?: string;
  type?: string;
  function: ToolCallFunction;
}

// ============================================================================
// SDK Message Types (for programmatic access)
// ============================================================================

/**
 * SDK input message from client
 */
export interface SdkInputMessage {
  type: 'user';
  content: string;
  request_id?: string;  // Optional request ID for tracking
  uuid?: string;
  parent_tool_use_id?: string | null;
}

/**
 * SDK control request message
 */
export interface SdkControlRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'interrupt' | 'initialize' | 'set_permission_mode' | 'set_model';
    [key: string]: unknown;
  };
}

/**
 * SDK ping message (heartbeat)
 */
export interface SdkPingMessage {
  type: 'ping';
  request_id?: string;
  timestamp: number;
}

/**
 * SDK input message union type
 */
export type SdkInputMessageType = SdkInputMessage | SdkControlRequest | SdkPingMessage;

/**
 * Check if a string is a JSON SDK message
 */
export function isSdkMessage(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith('{')) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed);
    // Check for known message types
    return (
      parsed.type === 'user' ||
      parsed.type === 'control_request' ||
      parsed.type === 'ping'
    );
  } catch {
    return false;
  }
}

/**
 * Try to parse SDK message from string
 */
export function parseSdkMessage(input: string): SdkInputMessageType | null {
  const trimmed = input.trim();

  try {
    const parsed = JSON.parse(trimmed);

    if (parsed.type === 'user') {
      return parsed as SdkInputMessage;
    }

    if (parsed.type === 'control_request') {
      return parsed as SdkControlRequest;
    }

    if (parsed.type === 'ping') {
      return parsed as SdkPingMessage;
    }

    return null;
  } catch {
    return null;
  }
}
