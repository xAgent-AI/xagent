// ============================================================================
// Core Types
// ============================================================================

/**
 * AI Provider type identifier
 */
export type AIProviderType = 'openai' | 'anthropic' | 'remote';

/**
 * Tool call from OpenAI format
 */
export interface ToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/**
 * Unified message interface
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<ContentBlock>;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Content block for multi-modal messages
 */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image' | 'image_url';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  thinking?: string;
  image_url?: { url: string };
}

/**
 * Tool definition
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Tool choice options
 */
export type ToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } };

/**
 * Completion options
 */
export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  thinkingTokens?: number;
  signal?: AbortSignal;
  // Remote-specific options
  taskId?: string;
  status?: 'begin' | 'continue' | 'end' | 'cancel' | 'timeout' | 'failure';
  conversationId?: string;
  context?: {
    cwd?: string;
    workspace?: string;
    recentFiles?: string[];
  };
  toolResults?: Array<{
    toolUseId: string;
    content: string;
    isError?: boolean;
  }>;
  llmModelName?: string;
  vlmModelName?: string;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Unified completion response
 */
export interface CompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: Message;
    finish_reason: StopReason;
  }>;
  usage?: TokenUsage;
}

/**
 * Stop reason types
 */
export type StopReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

/**
 * Stream event types
 */
export interface StreamEvent {
  type: 'text_delta' | 'reasoning_delta' | 'toolcall_delta' | 'done' | 'error';
  delta?: string;
  content?: string;
  partial?: Message;
  reason?: StopReason;
  error?: Error;
}

// ============================================================================
// Provider Configuration Types
// ============================================================================

/**
 * Base provider configuration
 */
export interface BaseProviderConfig {
  type: AIProviderType;
  model?: string;
  showDebugInfo?: boolean;
}

/**
 * OpenAI compatible provider configuration
 */
export interface OpenAIConfig extends BaseProviderConfig {
  type: 'openai';
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
}

/**
 * Anthropic compatible provider configuration
 */
export interface AnthropicConfig extends BaseProviderConfig {
  type: 'anthropic';
  apiKey?: string;
  baseUrl?: string;
  /** Custom headers to add to each request */
  extraHeaders?: Record<string, string>;
}

/**
 * Remote provider configuration (xAgent Web Service)
 */
export interface RemoteConfig extends BaseProviderConfig {
  type: 'remote';
  authToken?: string;
  baseUrl?: string;  // Optional, defaults to xAgent web service
}

/**
 * Unified configuration union
 */
export type AIConfig = OpenAIConfig | AnthropicConfig | RemoteConfig;

/**
 * Check if config is OpenAI type
 */
export function isOpenAIConfig(config: AIConfig): config is OpenAIConfig {
  return config.type === 'openai';
}

/**
 * Check if config is Anthropic type
 */
export function isAnthropicConfig(config: AIConfig): config is AnthropicConfig {
  return config.type === 'anthropic';
}

/**
 * Check if config is Remote type
 */
export function isRemoteConfig(config: AIConfig): config is RemoteConfig {
  return config.type === 'remote';
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * AI Provider interface - all providers must implement this
 */
export interface AIProvider {
  /** Provider type identifier */
  readonly type: AIProviderType;

  /** Get list of available models */
  getModels(): Promise<Model[]>;

  /** Non-streaming chat completion */
  complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResponse>;

  /** Streaming chat completion */
  stream(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamEvent>;

  /** Abort ongoing request */
  abort(): void;

  /** Close provider and release resources */
  close(): Promise<void>;
}

/**
 * Model information
 */
export interface Model {
  id: string;
  name: string;
  provider: AIProviderType;
  contextWindow?: number;
  maxTokens?: number;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsThinking?: boolean;
}

/**
 * Provider registration entry
 */
export interface ProviderRegistryEntry {
  create: (config: AIConfig) => AIProvider;
  models: Model[];
}

// ============================================================================
// Utility Functions (moved from ai-client.ts)
// ============================================================================

/**
 * Thinking mode levels
 */
export type ThinkingMode = 'none' | 'normal' | 'hard' | 'mega' | 'ultra';

/**
 * Detect thinking mode from user input
 */
export function detectThinkingKeywords(text: string): ThinkingMode {
  const ultraKeywords = ['super think', 'extreme think', 'deep think', 'full think', 'ultra think', 'careful think',
    'ultrathink', 'think really super hard', 'think intensely'];
  const megaKeywords = ['strong think', 'powerful think', 'think hard', 'try hard to think', 'think well', 'think carefully',
    'megathink', 'think really hard', 'think a lot'];
  const hardKeywords = ['think again', 'think more', 'think clearly', 'think thoroughly', 'consider carefully',
    'think about it', 'think more', 'think harder'];
  const normalKeywords = ['think', 'think', 'consider', 'think'];

  const lowerText = text.toLowerCase();

  if (ultraKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()))) {
    return 'ultra';
  } else if (megaKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()))) {
    return 'mega';
  } else if (hardKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()))) {
    return 'hard';
  } else if (normalKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()))) {
    return 'normal';
  }

  return 'none';
}

/**
 * Get thinking token count for a mode
 */
export function getThinkingTokens(mode: ThinkingMode): number {
  const tokensMap: Record<ThinkingMode, number> = {
    none: 0,
    normal: 2000,
    hard: 4000,
    mega: 10000,
    ultra: 32000
  };
  return tokensMap[mode];
}

// ============================================================================
// Remote-Specific Interface Extension
// ============================================================================

/**
 * Extended interface for remote provider with task management methods
 */
export interface RemoteTaskManager {
  completeTask(taskId: string): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  failTask(taskId: string, reason: 'timeout' | 'failure'): Promise<void>;
}

/**
 * Combined interface for remote provider
 */
export interface RemoteAIProvider extends AIProvider, RemoteTaskManager {}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Token invalid error
 */
export class TokenInvalidError extends Error {
  constructor(message: string = 'Authentication token is invalid or expired') {
    super(message);
    this.name = 'TokenInvalidError';
  }
}
