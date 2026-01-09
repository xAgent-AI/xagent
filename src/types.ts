export enum ExecutionMode {
  YOLO = 'yolo',
  ACCEPT_EDITS = 'accept_edits',
  PLAN = 'plan',
  DEFAULT = 'default',
  SMART = 'smart'
}

export enum AuthType {
  OAUTH_XAGENT = 'oauth-xagent',
  API_KEY = 'api_key',
  OPENAI_COMPATIBLE = 'openai_compatible'
}

export interface AuthConfig {
  type: AuthType;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  searchApiKey?: string;
}

export interface Tool {
  name: string;
  description: string;
  execute: (params: any, executionMode?: ExecutionMode) => Promise<any>;
  allowedModes: ExecutionMode[];
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
  baseUrl?: string;
  modelName?: string;
  guiSubagentModel?: string;
  guiSubagentBaseUrl?: string;
  guiSubagentApiKey?: string;
  searchApiKey?: string;
  executionMode: ExecutionMode;
  approvalMode?: ExecutionMode;
  checkpointing: CheckpointConfig;
  thinking: ThinkingConfig;
  contextCompression: CompressionConfig;
  contextFileName: string | string[];
  mcpServers: Record<string, MCPServerConfig>;
  language: 'zh' | 'en';
  autoUpdate: boolean;
  telemetryEnabled: boolean;
  showToolDetails: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];
  timestamp: number;
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
  toolCalls: ToolCall[];
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
  maxMessages: number;
  maxContextSize: number;
  preserveRecentMessages: number;
  enableSummary: boolean;
}

export interface CompressionStats {
  lastCompressionTime?: number;
  totalCompressions: number;
  originalMessagesTotal: number;
  compressedMessagesTotal: number;
}
