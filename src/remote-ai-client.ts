import { EventEmitter } from 'events';
import { ChatMessage, SessionOutput, ToolCall } from './types.js';
import { ChatCompletionResponse, ChatCompletionOptions, Message } from './ai-client.js';
import { getLogger } from './logger.js';

const logger = getLogger();

/**
 * Token invalid error - thrown when the authentication token is no longer valid
 */
export class TokenInvalidError extends Error {
  constructor(message: string = 'Authentication token is invalid or expired') {
    super(message);
    this.name = 'TokenInvalidError';
  }
}

export interface RemoteChatOptions {
  model?: string;
  conversationId?: string;
  context?: {
    cwd?: string;
    workspace?: string;
    recentFiles?: string[];
  };
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    result: any;
  }>;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
      };
    };
  }>;
  signal?: AbortSignal;
}

export interface RemoteChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  conversationId: string;
}

export interface RemoteVLMResponse {
  content: string;
}

/**
 * Remote AI Client - communicates with xagent-web service
 */
export class RemoteAIClient extends EventEmitter {
  private authToken: string;
  private webBaseUrl: string;
  private agentApi: string;
  private vlmApi: string;
  private showAIDebugInfo: boolean;

  constructor(authToken: string, webBaseUrl: string, showAIDebugInfo: boolean = false) {
    super();
    logger.debug(`[RemoteAIClient] Constructor called, authToken: ${authToken ? authToken.substring(0, 30) + '...' : 'empty'}`);
    this.authToken = authToken;
    this.webBaseUrl = webBaseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.agentApi = `${this.webBaseUrl}/api/agent`;
    this.vlmApi = `${this.webBaseUrl}/api/agent/vlm`;
    this.showAIDebugInfo = showAIDebugInfo;

    if (this.showAIDebugInfo) {
      logger.debug('[RemoteAIClient] Initialization complete');
      logger.debug(`[RemoteAIClient] Web Base URL: ${this.webBaseUrl}`);
      logger.debug(`[RemoteAIClient] Agent API: ${this.agentApi}`);
      logger.debug(`[RemoteAIClient] VLM API: ${this.vlmApi}`);
    }
  }

  /**
   * Non-streaming chat - send messages and receive full response
   */
  async chat(
    messages: ChatMessage[],
    options: RemoteChatOptions = {}
  ): Promise<SessionOutput> {
    // Pass complete messages array to backend, backend forwards directly to LLM
    const requestBody = {
      messages: messages,  // Pass complete message history
      conversationId: options.conversationId,
      context: options.context,
      options: {
        model: options.model
      },
      toolResults: options.toolResults,
      tools: options.tools
    };

    const url = `${this.agentApi}/chat`;
    if (this.showAIDebugInfo) {
      logger.debug(`[RemoteAIClient] Sending request to: ${url}`);
      logger.debug(`[RemoteAIClient] Token prefix: ${this.authToken.substring(0, 20)}...`);
      logger.debug(`[RemoteAIClient] Message count: ${messages.length}`);
      if (options.tools) {
        logger.debug(`[RemoteAIClient] Tool count: ${options.tools.length}`);
      }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify(requestBody)
      });

      // Check for 401 and throw TokenInvalidError
      if (response.status === 401) {
        throw new TokenInvalidError('Authentication token is invalid or expired. Please log in again.');
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        let userFriendlyMessage: string;

        // Provide user-friendly error messages based on status code
        switch (response.status) {
          case 400:
            errorMessage = errorText ? JSON.parse(errorText).error || 'Bad Request' : 'Bad Request';
            userFriendlyMessage = 'Invalid request parameters. Please check your input and try again.';
            break;
          case 401:
            errorMessage = 'Unauthorized';
            userFriendlyMessage = 'Your session has expired. Please log in again to continue.';
            break;
          case 413:
            errorMessage = 'Payload Too Large';
            userFriendlyMessage = 'Request data is too large. Please reduce input content or screenshot size and try again.';
            break;
          case 429:
            errorMessage = 'Too Many Requests';
            userFriendlyMessage = 'Too many requests. Please wait a moment and try again.';
            break;
          case 500:
            errorMessage = 'Internal Server Error';
            userFriendlyMessage = 'Server error. Please try again later. If the problem persists, contact the administrator.';
            break;
          case 502:
            errorMessage = 'Bad Gateway';
            userFriendlyMessage = 'Gateway error. Service temporarily unavailable. Please try again later.';
            break;
          case 503:
            errorMessage = 'Service Unavailable';
            userFriendlyMessage = 'Service temporarily unavailable. Please try again later.';
            break;
          case 504:
            errorMessage = 'Gateway Timeout';
            userFriendlyMessage = 'Gateway timeout. Please try again later.';
            break;
          default:
            try {
              errorMessage = errorText ? JSON.parse(errorText).error || `HTTP ${response.status}` : `HTTP ${response.status}`;
            } catch {
              errorMessage = `HTTP ${response.status}`;
            }
            userFriendlyMessage = `Request failed with status code: ${response.status}`;
        }

        // Print user-friendly error message
        console.error(`\n❌ Request failed (${response.status})`);
        console.error(`   ${userFriendlyMessage}`);
        if (this.showAIDebugInfo) {
          console.error(`   Original error: ${errorMessage}`);
        }
        throw new Error(userFriendlyMessage);
      }

      const data = await response.json() as RemoteChatResponse;
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] Received response, content length:', data.content?.length || 0);
        console.log('[RemoteAIClient] toolCalls count:', data.toolCalls?.length || 0);
      }

      return {
        role: 'assistant',
        content: data.content || '',
        toolCalls: data.toolCalls,
        timestamp: Date.now()
      };

    } catch (error) {
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] Request exception:', error);
      }
      throw error;
    }
  }

  /**
   * Unified LLM call interface - same return type as aiClient.chatCompletion
   * Implements transparency: caller doesn't need to know remote vs local mode
   */
  async chatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const model = options.model || 'remote-llm';

    // Debug output for request
    if (this.showAIDebugInfo) {
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║              AI REQUEST DEBUG (REMOTE)                   ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`📦 Model: ${model}`);
      console.log(`🌐 Base URL: ${this.webBaseUrl}`);
      console.log(`💬 Total Messages: ${messages.length} items`);
      if (options.temperature !== undefined) console.log(`🌡️  Temperature: ${options.temperature}`);
      if (options.maxTokens) console.log(`📏 Max Tokens: ${options.maxTokens}`);
      if (options.tools?.length) console.log(`🔧 Tools: ${options.tools.length} items`);
      if (options.thinkingTokens) console.log(`🧠 Thinking Tokens: ${options.thinkingTokens}`);
      console.log('─'.repeat(60));

      // Display system messages separately
      const systemMsgs = messages.filter(m => m.role === 'system');
      const otherMsgs = messages.filter(m => m.role !== 'system');

      if (systemMsgs.length > 0) {
        const systemContent = typeof systemMsgs[0].content === 'string'
          ? systemMsgs[0].content
          : JSON.stringify(systemMsgs[0].content);
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🟫 SYSTEM                                                     │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log(this.renderMarkdown(systemContent).split('\n').map(l => '│ ' + l).join('\n'));
        console.log('└─────────────────────────────────────────────────────────────┘');
      }

      // Display other messages
      this.displayMessages(otherMsgs);

      console.log('\n📤 Sending request to Remote API...\n');
    }

    // Call existing chat method
    const response = await this.chat(messages, {
      conversationId: undefined,
      tools: options.tools as any,
      toolResults: undefined,
      context: undefined,
      model: options.model
    });

    // Debug output for response
    if (this.showAIDebugInfo) {
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║             AI RESPONSE DEBUG (REMOTE)                   ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`🆔 ID: remote-${Date.now()}`);
      console.log(`🤖 Model: ${model}`);
      console.log(`🏁 Finish Reason: stop`);

      console.log('\n┌─────────────────────────────────────────────────────────────┐');
      console.log('│ 🤖 ASSISTANT                                                 │');
      console.log('├─────────────────────────────────────────────────────────────┤');

      // Display reasoning_content (if present)
      if (response.reasoningContent) {
        console.log('│ 🧠 REASONING:');
        console.log('│ ───────────────────────────────────────────────────────────');
        const reasoningLines = this.renderMarkdown(response.reasoningContent).split('\n');
        for (const line of reasoningLines.slice(0, 15)) {
          console.log('│ ' + line.slice(0, 62));
        }
        if (response.reasoningContent.length > 800) console.log('│ ... (truncated)');
        console.log('│ ───────────────────────────────────────────────────────────');
      }

      // Display content
      console.log('│ 💬 CONTENT:');
      console.log('│ ───────────────────────────────────────────────────────────');
      const lines = this.renderMarkdown(response.content).split('\n');
      for (const line of lines.slice(0, 40)) {
        console.log('│ ' + line.slice(0, 62));
      }
      if (lines.length > 40) {
        console.log(`│ ... (${lines.length - 40} more lines)`);
      }
      console.log('└─────────────────────────────────────────────────────────────┘');

      // Display tool calls if present
      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🔧 TOOL CALLS                                                │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        for (let i = 0; i < response.toolCalls.length; i++) {
          const tc = response.toolCalls[i];
          console.log(`│ ${i + 1}. ${tc.function?.name || 'unknown'}`);
          if (tc.function?.arguments) {
            const args = typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
            const argsStr = JSON.stringify(args, null, 2).split('\n').slice(0, 5).join('\n');
            console.log('│    Args:', argsStr.slice(0, 50) + (argsStr.length > 50 ? '...' : ''));
          }
        }
        console.log('└─────────────────────────────────────────────────────────────┘');
      }

      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║                    RESPONSE ENDED                        ║');
      console.log('╚══════════════════════════════════════════════════════════╝\n');
    }

    // Convert to ChatCompletionResponse format (consistent with local mode)
    return {
      id: `remote-${Date.now()}`,
      object: 'chat.completion',
      created: Date.now(),
      model: options.model || 'remote-llm',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.content,
            reasoning_content: '',
            tool_calls: response.toolCalls
          },
          finish_reason: 'stop'
        }
      ],
      usage: undefined
    };
  }

  /**
   * Render markdown text (helper method for debug output)
   */
  private renderMarkdown(text: string): string {
    let result = text;
    // Code block rendering
    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `\n┌─[${lang || 'code'}]\n${code.trim().split('\n').map((l: string) => '│ ' + l).join('\n')}\n└─\n`;
    });
    // Inline code rendering
    result = result.replace(/`([^`]+)`/g, '`$1`');
    // Bold rendering
    result = result.replace(/\*\*([^*]+)\*\*/g, '●$1○');
    // Italic rendering
    result = result.replace(/\*([^*]+)\*/g, '/$1/');
    // List rendering
    result = result.replace(/^- (.*$)/gm, '○ $1');
    result = result.replace(/^\d+\. (.*$)/gm, '• $1');
    // Heading rendering
    result = result.replace(/^### (.*$)/gm, '\n━━━ $1 ━━━\n');
    result = result.replace(/^## (.*$)/gm, '\n━━━━━ $1 ━━━━━\n');
    result = result.replace(/^# (.*$)/gm, '\n━━━━━━━ $1 ━━━━━━━\n');
    // Quote rendering
    result = result.replace(/^> (.*$)/gm, '│ │ $1');
    return result;
  }

  /**
   * Display messages by category (helper method for debug output)
   */
  private displayMessages(messages: ChatMessage[]): void {
    const roleColors: Record<string, string> = {
      system: '🟫 SYSTEM',
      user: '👤 USER',
      assistant: '🤖 ASSISTANT',
      tool: '🔧 TOOL'
    };

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role as string;
      const roleLabel = roleColors[role] || `● ${role.toUpperCase()}`;

      console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
      console.log(`│ ${roleLabel} (${i + 1}/${messages.length})                                          │`);
      console.log('├─────────────────────────────────────────────────────────────┤');

      // Display main content
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      const lines = this.renderMarkdown(content).split('\n');
      for (const line of lines.slice(0, 50)) {
        console.log('│ ' + line.slice(0, 62));
      }
      if (lines.length > 50) {
        console.log('│ ... (' + (lines.length - 50) + ' more lines)');
      }

      console.log('└─────────────────────────────────────────────────────────────┘');
    }
  }

  /**
   * Invoke VLM for image understanding
   * @param messages - full messages array (consistent with local mode)
   * @param systemPrompt - system prompt (optional, for reference)
   * @param options - other options including AbortSignal
   */
  async invokeVLM(
    messages: any[],
    _systemPrompt?: string,
    options: RemoteChatOptions = {}
  ): Promise<string> {
    // Forward complete messages to backend (same format as local mode)
    const requestBody = {
      messages,  // Pass complete messages array
      context: options.context,
      options: {
        model: options.model
      }
    };

    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] VLM sending request to:', this.vlmApi);
    }

    // Handle abort signal
    const controller = options.signal ? new AbortController() : undefined;
    const abortSignal = options.signal || controller?.signal;

    // If external signal is provided, listen to it
    if (options.signal) {
      options.signal.addEventListener?.('abort', () => controller?.abort());
    }

    try {
      const response = await fetch(this.vlmApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal
      });

      // Check for 401 and throw TokenInvalidError
      if (response.status === 401) {
        throw new TokenInvalidError('Authentication token is invalid or expired. Please log in again.');
      }

      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] VLM response status:', response.status);
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        let userFriendlyMessage: string;

        // Provide user-friendly error messages based on status code
        switch (response.status) {
          case 400:
            errorMessage = errorText ? JSON.parse(errorText).error || 'Bad Request' : 'Bad Request';
            userFriendlyMessage = 'Invalid request parameters. Please check your input and try again.';
            break;
          case 401:
            errorMessage = 'Unauthorized';
            userFriendlyMessage = 'Your session has expired. Please log in again to continue.';
            break;
          case 413:
            errorMessage = 'Payload Too Large';
            userFriendlyMessage = 'Request data is too large. Possible solutions: 1) Reduce screenshot size; 2) Capture smaller area; 3) Use a smaller image.';
            break;
          case 429:
            errorMessage = 'Too Many Requests';
            userFriendlyMessage = 'Too many requests. Please wait a moment and try again.';
            break;
          case 500:
            errorMessage = 'Internal Server Error';
            userFriendlyMessage = 'Server error. Please try again later. If the problem persists, contact the administrator.';
            break;
          case 502:
            errorMessage = 'Bad Gateway';
            userFriendlyMessage = 'Gateway error. Service temporarily unavailable. Please try again later.';
            break;
          case 503:
            errorMessage = 'Service Unavailable';
            userFriendlyMessage = 'Service temporarily unavailable. Please try again later.';
            break;
          case 504:
            errorMessage = 'Gateway Timeout';
            userFriendlyMessage = 'Gateway timeout. Please try again later.';
            break;
          default:
            try {
              errorMessage = errorText ? JSON.parse(errorText).error || `HTTP ${response.status}` : `HTTP ${response.status}`;
            } catch {
              errorMessage = `HTTP ${response.status}`;
            }
            userFriendlyMessage = `Request failed with status code: ${response.status}`;
        }

        // Print user-friendly error message
        console.error(`\n❌ VLM request failed (${response.status})`);
        console.error(`   ${userFriendlyMessage}`);
        if (this.showAIDebugInfo) {
          console.error(`   Original error: ${errorMessage}`);
        }
        throw new Error(userFriendlyMessage);
      }

      const data = await response.json() as RemoteVLMResponse;
      return data.content || '';

    } catch (error) {
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] VLM request exception:', error);
      }
      throw error;
    }
  }

  /**
   * Validate if the current token is still valid
   * Returns true if valid, false otherwise
   */
  async validateToken(): Promise<boolean> {
    try {
      const url = `${this.webBaseUrl}/api/auth/me`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if response indicates token is invalid (401)
   * If so, throw TokenInvalidError for the session to handle re-authentication
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      return response.json() as Promise<T>;
    }

    if (response.status === 401) {
      throw new TokenInvalidError('Authentication token is invalid or expired. Please log in again.');
    }

    const errorText = await response.text();
    const errorData = JSON.parse(errorText) as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  async getConversations(): Promise<any[]> {
    const url = `${this.agentApi}/conversations`;
    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Getting conversation list:', url);
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to get conversation list');
    }

    const data = await response.json() as { conversations?: any[] };
    return data.conversations || [];
  }

  /**
   * Get conversation details
   */
  async getConversation(conversationId: string): Promise<any> {
    const url = `${this.agentApi}/conversations/${conversationId}`;
    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Getting conversation details:', url);
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to get conversation details');
    }

    const data = await response.json() as { conversation?: any };
    return data.conversation;
  }

  /**
   * Create new conversation
   */
  async createConversation(title?: string): Promise<any> {
    const url = `${this.agentApi}/conversations`;
    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Creating conversation:', url);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      },
      body: JSON.stringify({ title })
    });

    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }

    const data = await response.json() as { conversation?: any };
    return data.conversation;
  }

  /**
   * Delete conversation
   */
  async deleteConversation(conversationId: string): Promise<void> {
    const url = `${this.agentApi}/conversations/${conversationId}`;
    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Deleting conversation:', url);
    }

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    });

        if (!response.ok) {

          throw new Error('Failed to delete conversation');

        }

      }

    }

