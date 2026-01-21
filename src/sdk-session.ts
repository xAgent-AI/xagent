#!/usr/bin/env node

/**
 * SDK Session - xAgent CLI SDK Mode
 * 
 * This module implements the SDK communication protocol for xAgent CLI,
 * allowing external programs to interact with xAgent via JSON stdin/stdout.
 */

import { randomUUID } from 'node:crypto';
import {
  ExecutionMode,
  ChatMessage,
  AuthType,
} from './types.js';
import { AIClient, Message, ChatCompletionOptions, ToolDefinition } from './ai-client.js';
import { getConfigManager, ConfigManager } from './config.js';
import { getToolRegistry } from './tools.js';
import { getAgentManager } from './agents.js';
import { getMCPManager } from './mcp.js';
import { getConversationManager, ConversationManager } from './conversation.js';
import { getSessionManager, SessionManager } from './session-manager.js';
import { getCancellationManager, CancellationManager } from './cancellation.js';
import { getLogger } from './logger.js';

const logger = getLogger();

// SDK protocol types
interface SdkUserMessage {
  type: 'user';
  content: string | Array<{ type: string; text?: string; tool_use_id?: string; name?: string; input?: Record<string, unknown>; content?: unknown; is_error?: boolean }>;
  uuid?: string;
  parent_tool_use_id?: string | null;
}

interface SdkAssistantMessage {
  type: 'assistant';
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; thinking?: string; signature?: string }>;
  model: string;
  parent_tool_use_id?: string | null;
  error?: string;
}

interface SdkSystemMessage {
  type: 'system';
  subtype: string;
  data: Record<string, unknown>;
}

interface SdkResultMessage {
  type: 'result';
  subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd';
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
}

interface SdkControlRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'initialize' | 'can_use_tool' | 'set_permission_mode' | 'set_model' | 'hook_callback' | 'interrupt';
    [key: string]: unknown;
  };
}

interface SdkControlResponse {
  type: 'control_response';
  response: {
    subtype: 'success' | 'error';
    request_id: string;
    response?: Record<string, unknown>;
    error?: string;
  };
}

interface SdkSessionState {
  sessionId: string;
  requestIdCounter: number;
  isRunning: boolean;
  conversation: ChatMessage[];
  currentAgent: any;
  canUseTool: ((toolName: string, input: Record<string, unknown>, context: any) => Promise<{ behavior: string; message?: string }>) | null;
  hooks: Map<string, any[]>;
}

export class SdkSession {
  private configManager: ConfigManager;
  private agentManager: any;
  private memoryManager: any;
  private mcpManager: any;
  private conversationManager!: ConversationManager;
  private sessionManager!: SessionManager;
  private toolRegistry: any;
  private aiClient: AIClient | null = null;
  private cancellationManager!: CancellationManager;
  
  private state: SdkSessionState;
  private stdinBuffer = '';
  private isReady = false;
  
  constructor() {
    this.configManager = getConfigManager(process.cwd());
    this.state = {
      sessionId: randomUUID(),
      requestIdCounter: 0,
      isRunning: false,
      conversation: [],
      currentAgent: null,
      canUseTool: null,
      hooks: new Map(),
    };
  }

  /**
   * Initialize the SDK session.
   */
  async initialize(): Promise<void> {
    try {
      await this.configManager.load();
      
      const authConfig = this.configManager.getAuthConfig();
      const selectedAuthType = this.configManager.get('selectedAuthType');
      
      // Validate authentication
      if (!authConfig.apiKey) {
        throw new Error('Authentication required. Please run "xagent auth" first.');
      }
      
      // Disable AI debug output in SDK mode to avoid polluting JSON stream
      authConfig.showAIDebugInfo = false;
      
      this.aiClient = new AIClient(authConfig);
      
      // Load agents
      this.agentManager = getAgentManager(process.cwd());
      await this.agentManager.loadAgents();
      
      this.mcpManager = getMCPManager();
      
      const mcpServers = this.configManager.getMcpServers();
      for (const [name, config] of Object.entries(mcpServers)) {
        this.mcpManager.registerServer(name, config);
      }
      
      // Connect MCP servers
      if (Object.keys(mcpServers).length > 0) {
        await this.mcpManager.connectAllServers();
        const toolRegistry = getToolRegistry();
        const allMcpTools = this.mcpManager.getAllTools();
        toolRegistry.registerMCPTools(allMcpTools);
      }
      
      this.toolRegistry = getToolRegistry();
      this.conversationManager = getConversationManager();
      this.sessionManager = getSessionManager(process.cwd());
      this.cancellationManager = getCancellationManager();
      
      // Create conversation
      await this.conversationManager.initialize();
      const conversation = await this.conversationManager.createConversation();
      await this.sessionManager.createSession(
        conversation.id,
        'general-purpose',
        ExecutionMode.YOLO
      );
      
      // Set default agent
      this.state.currentAgent = this.agentManager.getAgent('general-purpose');
      
      // Add system prompt
      const systemPrompt = this.state.currentAgent?.systemPrompt || 'You are xAgent, an AI-powered CLI tool.';
      this.state.conversation.push({
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now()
      });
      
      this.isReady = true;
      
      // Send initialization success
      this.sendSystemMessage('init', {
        session_id: this.state.sessionId,
      });
      
    } catch (error: any) {
      this.sendSystemMessage('error', { error: error.message });
      throw error;
    }
  }

  /**
   * Start the SDK session and listen for messages.
   */
  async start(): Promise<void> {
    if (!this.isReady) {
      await this.initialize();
    }
    
    this.state.isRunning = true;
    
    // Set up stdin handler
    process.stdin.setEncoding('utf8');
    
    for await (const chunk of process.stdin) {
      this.stdinBuffer += chunk;
      
      // Process complete lines
      const lines = this.stdinBuffer.split('\n');
      this.stdinBuffer = lines.pop() || '';
      
      for (const line of lines) {
        // Remove any control characters and BOM
        const cleanLine = line.replace(/^\uFEFF/, '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
        
        if (cleanLine.trim()) {
          try {
            const data = JSON.parse(cleanLine);
            await this.handleMessage(data);
          } catch (error: any) {
            this.sendControlError(`Invalid JSON: ${error.message}`);
          }
        }
      }
    }
  }

  /**
   * Handle incoming messages.
   */
  private async handleMessage(data: any): Promise<void> {
    if (data.type === 'control_request') {
      await this.handleControlRequest(data);
    } else if (data.type === 'user') {
      await this.handleUserMessage(data);
    } else if (data.type === 'interrupt') {
      await this.handleInterrupt();
    }
  }

  /**
   * Handle control requests.
   */
  private async handleControlRequest(request: SdkControlRequest): Promise<void> {
    const requestId = request.request_id;
    const req = request.request;
    
    switch (req.subtype) {
      case 'initialize':
        if (req.hooks) {
          this.state.hooks = new Map(Object.entries(req.hooks));
        }
        this.sendControlSuccess(requestId, { ok: true });
        break;
        
      case 'can_use_tool':
        await this.handlePermissionRequest(requestId, req as unknown as { tool_name: string; input: Record<string, unknown>; tool_use_id: string });
        break;
        
      case 'set_permission_mode':
        this.sendControlSuccess(requestId, { ok: true });
        break;
        
      case 'set_model':
        this.sendControlSuccess(requestId, { ok: true });
        break;
        
      case 'hook_callback':
        await this.handleHookCallback(requestId, req as unknown as { callback_id: string; input: Record<string, unknown>; tool_use_id?: string });
        break;
        
      case 'interrupt':
        this.state.isRunning = false;
        this.sendControlSuccess(requestId, { ok: true });
        break;
        
      default:
        this.sendControlError(requestId, `Unknown request type: ${req.subtype}`);
    }
  }

  /**
   * Handle permission request.
   */
  private async handlePermissionRequest(requestId: string, request: { tool_name: string; input: Record<string, unknown>; tool_use_id: string }): Promise<void> {
    if (this.state.canUseTool) {
      try {
        const result = await this.state.canUseTool(
          request.tool_name,
          request.input,
          { toolUseID: request.tool_use_id }
        );
        
        if (result.behavior === 'allow') {
          this.sendControlSuccess(requestId, { behavior: 'allow' });
        } else {
          this.sendControlSuccess(requestId, { 
            behavior: 'deny', 
            message: result.message || 'Permission denied' 
          });
        }
      } catch (error: any) {
        this.sendControlSuccess(requestId, { 
          behavior: 'deny', 
          message: error.message 
        });
      }
    } else {
      // Default: allow all tools in SDK mode
      this.sendControlSuccess(requestId, { behavior: 'allow' });
    }
  }

  /**
   * Handle hook callback.
   */
  private async handleHookCallback(requestId: string, request: { callback_id: string; input: Record<string, unknown>; tool_use_id?: string }): Promise<void> {
    const input = request.input;
    let output: { continue?: boolean; error?: string } = { continue: true };
    
    const hookEvent = input.hook_event_name as string;
    const matchers = this.state.hooks.get(hookEvent);
    
    if (matchers && matchers.length > 0) {
      for (const matcher of matchers) {
        if (this.matchesHook(matcher, input)) {
          for (const hook of matcher.hooks || []) {
            try {
              output = await hook(input, request.tool_use_id, { signal: undefined }) as { continue?: boolean; error?: string };
            } catch (error: any) {
              output = { continue: true, error: String(error) };
            }
          }
        }
      }
    }
    
    this.sendControlSuccess(requestId, output);
  }

  /**
   * Check if hook matcher matches the input.
   */
  private matchesHook(matcher: any, input: any): boolean {
    if (!matcher.matcher) return true;
    
    const toolName = input.tool_name;
    if (toolName) {
      const patterns = matcher.matcher.split('|');
      return patterns.some((pattern: string) => pattern.trim() === toolName);
    }
    
    return false;
  }

  /**
   * Handle user messages.
   */
  private async handleUserMessage(message: SdkUserMessage): Promise<void> {
    const startTime = Date.now();
    
    // Parse message content
    let userContent: string;
    if (typeof message.content === 'string') {
      userContent = message.content;
    } else {
      userContent = message.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
    }
    
    // Add user message to conversation
    const userMsg: ChatMessage = {
      role: 'user',
      content: userContent,
      timestamp: Date.now()
    };
    this.state.conversation.push(userMsg);
    
    // Send to AI and get response
    try {
      const thinkingConfig = this.configManager.getThinkingConfig();
      let thinkingTokens = 0;
      
      if (thinkingConfig.enabled) {
        const { detectThinkingKeywords, getThinkingTokens } = await import('./ai-client.js');
        const thinkingMode = detectThinkingKeywords(userContent);
        thinkingTokens = getThinkingTokens(thinkingMode);
      }
      
      // Convert to AI client message format
      const aiMessages = this.state.conversation.map(msg => ({
        role: msg.role,
        content: msg.content
      })) as Message[];
      
      // Get tools from tool registry
      const toolDefinitions = this.getToolDefinitions();
      
      // Call AI
      const options: ChatCompletionOptions = {
        maxTokens: thinkingTokens > 0 ? undefined : 8192,
        thinkingTokens: thinkingTokens > 0 ? thinkingTokens : undefined,
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        toolChoice: toolDefinitions.length > 0 ? 'auto' : undefined,
      };
      
      const response = await this.aiClient!.chatCompletion(aiMessages, options);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Extract content from response
      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error('No response from AI');
      }
      
      const responseContent = choice.message?.content || '';
      const reasoningContent = (choice.message as any).reasoning_content;
      
      // Add assistant message to conversation
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent),
        reasoningContent,
        timestamp: Date.now()
      };
      this.state.conversation.push(assistantMsg);
      
      // Send assistant message
      this.sendAssistantMessage(responseContent, reasoningContent);
      
      // Process tool calls if any
      const toolCalls = choice.message?.tool_calls || (choice as any).tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          await this.processToolCall(toolCall);
        }
      }
      
      // Send result message
      this.sendResultMessage({
        duration_ms: duration,
        is_error: false,
        num_turns: Math.ceil(this.state.conversation.length / 2),
      });
      
    } catch (error: any) {
      this.sendSystemMessage('error', { error: error.message });
    }
  }

  /**
   * Get tool definitions from registry.
   */
  private getToolDefinitions(): ToolDefinition[] {
    if (!this.toolRegistry) return [];
    
    const definitions: ToolDefinition[] = [];
    
    // Get local tools
    const tools = this.toolRegistry.getAll();
    for (const tool of tools) {
      definitions.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || { type: 'object', properties: {} }
        }
      });
    }
    
    return definitions;
  }

  /**
   * Process a tool call.
   */
  private async processToolCall(toolCall: any): Promise<void> {
    const toolUseId = toolCall.id || randomUUID();
    const toolName = toolCall.function?.name || toolCall.name;
    const toolInput = toolCall.function?.arguments || toolCall.input || {};
    
    // Send tool use message
    const textContent = `Using tool: ${toolName}`;
    const assistantContent = [
      { type: 'text', text: textContent },
      { type: 'tool_use', id: toolUseId, name: toolName, input: toolInput }
    ];
    
    this.sendAssistantMessage(textContent, undefined, assistantContent);
    
    // Execute tool
    let result: any;
    let isError = false;
    
    try {
      result = await this.toolRegistry.execute(toolName, toolInput, ExecutionMode.YOLO);
    } catch (error: any) {
      result = error.message;
      isError = true;
    }
    
    // Add tool result to conversation
    this.state.conversation.push({
      role: 'tool',
      content: typeof result === 'string' ? result : JSON.stringify(result),
      timestamp: Date.now()
    });
    
    // Send tool result as a user message (following SDK protocol)
    const resultMessage: SdkUserMessage = {
      type: 'user',
      content: [
        { 
          type: 'tool_result', 
          tool_use_id: toolUseId, 
          content: typeof result === 'string' ? result : JSON.stringify(result),
          is_error: isError
        }
      ]
    };
    this.writeMessage(resultMessage);
    
    // Get next AI response
    await this.getNextAiResponse();
  }

  /**
   * Get next AI response after tool result.
   */
  private async getNextAiResponse(): Promise<void> {
    const startTime = Date.now();
    
    try {
      const aiMessages = this.state.conversation.map(msg => ({
        role: msg.role,
        content: msg.content
      })) as Message[];
      
      const toolDefinitions = this.getToolDefinitions();
      
      const options: ChatCompletionOptions = {
        maxTokens: 8192,
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        toolChoice: toolDefinitions.length > 0 ? 'auto' : undefined,
      };
      
      const response = await this.aiClient!.chatCompletion(aiMessages, options);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error('No response from AI');
      }
      
      const responseContent = choice.message?.content || '';
      const reasoningContent = (choice.message as any).reasoning_content;
      
      // Add assistant message
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent),
        reasoningContent,
        timestamp: Date.now()
      };
      this.state.conversation.push(assistantMsg);
      
      // Send assistant message
      this.sendAssistantMessage(responseContent, reasoningContent);
      
      // Process more tool calls
      const toolCalls = choice.message?.tool_calls || (choice as any).tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          await this.processToolCall(toolCall);
        }
      }
      
      // Send result
      this.sendResultMessage({
        duration_ms: duration,
        is_error: false,
        num_turns: Math.ceil(this.state.conversation.length / 2),
      });
      
    } catch (error: any) {
      this.sendSystemMessage('error', { error: error.message });
    }
  }

  /**
   * Handle interrupt request.
   */
  private async handleInterrupt(): Promise<void> {
    this.state.isRunning = false;
    this.cancellationManager.cancel();
  }

  /**
   * Send an assistant message.
   */
  private sendAssistantMessage(text: string | unknown[], reasoningContent?: string, content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; thinking?: string; signature?: string }>): void {
    const blocks = content || [];
    
    if (!content) {
      blocks.push({ type: 'text', text: typeof text === 'string' ? text : String(text) });
    }
    
    if (reasoningContent) {
      blocks.unshift({
        type: 'thinking',
        thinking: reasoningContent,
        signature: ''
      });
    }
    
    const message: SdkAssistantMessage = {
      type: 'assistant',
      content: blocks,
      model: 'sonnet'
    };
    
    this.writeMessage(message);
  }

  /**
   * Send a system message.
   */
  private sendSystemMessage(subtype: string, data: Record<string, unknown>): void {
    const message: SdkSystemMessage = {
      type: 'system',
      subtype,
      data
    };
    
    this.writeMessage(message);
  }

  /**
   * Send a result message.
   */
  private sendResultMessage(data: { duration_ms: number; is_error: boolean; num_turns: number }): void {
    const message: SdkResultMessage = {
      type: 'result',
      subtype: data.is_error ? 'error_during_execution' : 'success',
      duration_ms: data.duration_ms,
      duration_api_ms: data.duration_ms,
      is_error: data.is_error,
      num_turns: data.num_turns
    };

    this.writeMessage(message);

    // Close stdin to signal that the interaction is complete
    // This allows the client to know when to stop reading
    process.stdin.end();

    // Exit the process after a short delay to ensure the result message is flushed
    setTimeout(() => {
      process.exit(0);
    }, 100);
  }

  /**
   * Send control success response.
   */
  private sendControlSuccess(requestId: string, response?: Record<string, unknown>): void {
    const message: SdkControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response
      }
    };
    
    this.writeMessage(message);
  }

  /**
   * Send control error response.
   */
  private sendControlError(requestId: string, error: string): void;
  private sendControlError(error: string): void;
  private sendControlError(requestIdOrError: string, error?: string): void {
    let requestId: string;
    let errorMsg: string;
    
    if (error !== undefined) {
      requestId = requestIdOrError;
      errorMsg = error;
    } else {
      requestId = this.state.sessionId;
      errorMsg = requestIdOrError;
    }
    
    const message: SdkControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error: errorMsg
      }
    };
    
    this.writeMessage(message);
  }

  /**
   * Write a message to stdout.
   */
  private writeMessage(message: any): void {
    process.stdout.write(JSON.stringify(message) + '\n');
  }

  /**
   * Close the session.
   */
  async close(): Promise<void> {
    this.state.isRunning = false;
  }
}

/**
 * Start SDK mode.
 */
export async function startSdkSession(): Promise<void> {
  const session = new SdkSession();
  
  try {
    await session.initialize();
    await session.start();
  } catch (error: any) {
    console.error('SDK session error:', error.message);
    process.exit(1);
  }
}
