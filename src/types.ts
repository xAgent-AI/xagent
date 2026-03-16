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

// ============================================================================
// Hooks Types (lifecycle hooks for extensibility)
// ============================================================================

/**
 * All supported hook events
 */
export type HookEventName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'Notification'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Stop'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'InstructionsLoaded'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'PreCompact'
  | 'PostCompact'
  | 'Elicitation'
  | 'ElicitationResult';

/**
 * Hook handler type
 */
export type HookHandlerType = 'command' | 'http' | 'prompt' | 'agent';

/**
 * Base fields for all hook handlers
 */
export interface HookHandlerBase {
  type: HookHandlerType;
  timeout?: number;  // Seconds before canceling
  statusMessage?: string;  // Custom spinner message
  once?: boolean;  // Run only once per session
}

/**
 * Command hook handler - executes a shell command
 */
export interface CommandHookHandler extends HookHandlerBase {
  type: 'command';
  command: string;
  async?: boolean;  // Run in background without blocking
}

/**
 * HTTP hook handler - sends HTTP POST request
 */
export interface HttpHookHandler extends HookHandlerBase {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];  // Env vars that can be interpolated into headers
}

/**
 * Prompt hook handler - sends prompt to LLM for evaluation
 */
export interface PromptHookHandler extends HookHandlerBase {
  type: 'prompt';
  prompt: string;  // Prompt text, use $ARGUMENTS as placeholder for hook input JSON
  model?: string;  // Model to use for evaluation
}

/**
 * Agent hook handler - spawns a subagent
 */
export interface AgentHookHandler extends HookHandlerBase {
  type: 'agent';
  prompt: string;
  model?: string;
}

/**
 * Union type for all hook handlers
 */
export type HookHandler = CommandHookHandler | HttpHookHandler | PromptHookHandler | AgentHookHandler;

/**
 * Matcher group - filters when hooks fire
 */
export interface MatcherGroup {
  matcher?: string;  // Regex string to filter when hooks fire
  hooks: HookHandler[];
}

/**
 * Hooks configuration - maps event names to matcher groups
 */
export interface HooksConfig {
  [eventName: string]: MatcherGroup[];
}

/**
 * Permission decision for PreToolUse and PermissionRequest hooks
 */
export type PermissionDecision = 'allow' | 'deny' | 'ask';

/**
 * Hook-specific output for different event types
 */
export interface HookSpecificOutput {
  hookEventName: HookEventName;
  permissionDecision?: PermissionDecision;
  permissionDecisionReason?: string;
  modifiedToolInput?: Record<string, unknown>;  // For PreToolUse to modify tool input
  modifiedUserPrompt?: string;  // For UserPromptSubmit to modify prompt
  additionalContext?: string;  // Additional context to inject
}

/**
 * Hook output - returned by hook handlers
 */
export interface HookOutput {
  decision?: 'allow' | 'block';  // For blocking operations
  reason?: string;  // Reason for the decision
  hookSpecificOutput?: HookSpecificOutput;
  error?: string;  // Error message if hook failed
}

/**
 * Base input for all hook events
 */
export interface HookInputBase {
  hookEventName: HookEventName;
  session_id: string;
  timestamp: number;
}

/**
 * SessionStart hook input
 */
export interface SessionStartHookInput extends HookInputBase {
  hookEventName: 'SessionStart';
  startReason: 'startup' | 'resume' | 'clear' | 'compact';
}

/**
 * SessionEnd hook input
 */
export interface SessionEndHookInput extends HookInputBase {
  hookEventName: 'SessionEnd';
  endReason: 'clear' | 'logout' | 'prompt_input_exit' | 'bypass_permissions_disabled' | 'other';
}

/**
 * UserPromptSubmit hook input
 */
export interface UserPromptSubmitHookInput extends HookInputBase {
  hookEventName: 'UserPromptSubmit';
  user_prompt: string;
}

/**
 * PreToolUse hook input
 */
export interface PreToolUseHookInput extends HookInputBase {
  hookEventName: 'PreToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_call_id?: string;
}

/**
 * PostToolUse hook input
 */
export interface PostToolUseHookInput extends HookInputBase {
  hookEventName: 'PostToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_result: unknown;
  tool_call_id?: string;
}

/**
 * PostToolUseFailure hook input
 */
export interface PostToolUseFailureHookInput extends HookInputBase {
  hookEventName: 'PostToolUseFailure';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_error: string;
  tool_call_id?: string;
}

/**
 * PermissionRequest hook input
 */
export interface PermissionRequestHookInput extends HookInputBase {
  hookEventName: 'PermissionRequest';
  tool_name: string;
  tool_input: Record<string, unknown>;
  permission_type: 'tool_execution' | 'file_write' | 'shell_command' | 'other';
  resource?: string;  // The resource being accessed (file path, command, etc.)
}

/**
 * Notification hook input
 */
export interface NotificationHookInput extends HookInputBase {
  hookEventName: 'Notification';
  notification_type: 'permission_prompt' | 'idle_prompt' | 'auth_success' | 'elicitation_dialog' | 'other';
  message: string;
}

/**
 * SubagentStart hook input
 */
export interface SubagentStartHookInput extends HookInputBase {
  hookEventName: 'SubagentStart';
  agent_type: string;
  agent_prompt?: string;
}

/**
 * SubagentStop hook input
 */
export interface SubagentStopHookInput extends HookInputBase {
  hookEventName: 'SubagentStop';
  agent_type: string;
  result?: unknown;
  error?: string;
}

/**
 * Stop hook input
 */
export interface StopHookInput extends HookInputBase {
  hookEventName: 'Stop';
  reason: 'completed' | 'cancelled' | 'error' | 'user_interrupt';
  stop_hook_active?: boolean;  // True if Stop hook triggered continuation, prevents infinite loop
}

/**
 * PreCompact hook input
 */
export interface PreCompactHookInput extends HookInputBase {
  hookEventName: 'PreCompact';
  trigger: 'manual' | 'auto';
  message_count: number;
  token_count?: number;
}

/**
 * PostCompact hook input
 */
export interface PostCompactHookInput extends HookInputBase {
  hookEventName: 'PostCompact';
  trigger: 'manual' | 'auto';
  original_message_count: number;
  compacted_message_count: number;
  token_saved?: number;
}

/**
 * Union type for all hook inputs
 */
export type HookInput =
  | SessionStartHookInput
  | SessionEndHookInput
  | UserPromptSubmitHookInput
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | PermissionRequestHookInput
  | NotificationHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | StopHookInput
  | PreCompactHookInput
  | PostCompactHookInput;

/**
 * Result of executing a hook
 */
export interface HookExecutionResult {
  executed: boolean;  // Whether any hooks were executed
  results: Array<{
    handler: HookHandler;
    output?: HookOutput;
    error?: Error;
  }>;
  finalDecision?: 'allow' | 'block';
  blockReason?: string;
  modifiedInput?: Record<string, unknown>;  // Modified tool input or user prompt
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
  hooks?: HooksConfig;  // Hooks configuration
  disableAllHooks?: boolean;  // Globally disable all hooks
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
 * SDK approval response message (for responding to approval requests in SDK mode)
 */
export interface SdkApprovalResponse {
  type: 'approval_response';
  request_id: string;
  approved: boolean;
}

/**
 * SDK question response message (for responding to ask_user_question in SDK mode)
 */
export interface SdkQuestionResponse {
  type: 'question_response';
  request_id: string;
  answers: string[];
}

/**
 * SDK input message union type
 */
export type SdkInputMessageType = SdkInputMessage | SdkControlRequest | SdkPingMessage | SdkApprovalResponse | SdkQuestionResponse;

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
      parsed.type === 'ping' ||
      parsed.type === 'approval_response' ||
      parsed.type === 'question_response'
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

    if (parsed.type === 'approval_response') {
      return parsed as SdkApprovalResponse;
    }

    if (parsed.type === 'question_response') {
      return parsed as SdkQuestionResponse;
    }

    return null;
  } catch {
    return null;
  }
}
