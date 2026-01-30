import { EventEmitter } from 'events';
import https from 'https';
import axios from 'axios';
import { ChatMessage, SessionOutput, ToolCall } from './types.js';
import { ChatCompletionResponse, ChatCompletionOptions, Message, renderMarkdown, displayMessages } from './ai-client.js';
import { getLogger } from './logger.js';
import { withRetry, RetryConfig } from './retry.js';

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
  taskId?: string;
  status?: 'begin' | 'continue' | 'end' | 'cancel';
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
  reasoningContent?: string;
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
    remoteChatOptions: RemoteChatOptions = {}
  ): Promise<SessionOutput> {
    // Pass complete messages array to backend, backend forwards directly to LLM
    const requestBody = {
      messages: messages,  // Pass complete message history
      taskId: remoteChatOptions.taskId,
      status: remoteChatOptions.status || 'begin',
      conversationId: remoteChatOptions.conversationId,
      context: remoteChatOptions.context,
      options: {
        model: remoteChatOptions.model
      },
      toolResults: remoteChatOptions.toolResults,
      tools: remoteChatOptions.tools
    };

    const url = `${this.agentApi}/chat`;
    if (this.showAIDebugInfo) {
      logger.debug(`[RemoteAIClient] Sending request to: ${url}`);
      logger.debug(`[RemoteAIClient] Token prefix: ${this.authToken.substring(0, 20)}...`);
      logger.debug(`[RemoteAIClient] Message count: ${messages.length}`);
      if (remoteChatOptions.tools) {
        logger.debug(`[RemoteAIClient] Tool count: ${remoteChatOptions.tools.length}`);
      }
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        httpsAgent,
        timeout: 300000
      });

      // Check for 401 and throw TokenInvalidError
      if (response.status === 401) {
        throw new TokenInvalidError('Authentication token is invalid or expired. Please log in again.');
      }

      const data = response.data;
      logger.debug('[RemoteAIClient] response received, status:', String(response.status));
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] Received response, content length:', data.content?.length || 0);
        console.log('[RemoteAIClient] toolCalls count:', data.toolCalls?.length || 0);
      }

      return {
        role: 'assistant',
        content: data.content || '',
        reasoningContent: data.reasoningContent || '',
        toolCalls: data.toolCalls,
        timestamp: Date.now()
      };

    } catch (error: any) {
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] Request exception:', error.message);
      }

      // Provide user-friendly error messages based on status code
      let shouldRetry = false;
      let retryMessage = '';

      if (error.response) {
        const status = error.response.status;

        // Determine if error is retryable (5xx and 429 are retryable)
        const isRetryableStatus = (status >= 500 && status < 600) || status === 429;
        
        // Build error message
        let errorMessage: string;
        let userFriendlyMessage: string;

        switch (status) {
          case 400:
            errorMessage = 'Bad Request';
            userFriendlyMessage = 'Invalid request parameters. Please check your input and try again.';
            break;
          case 401:
            throw new TokenInvalidError('Authentication token is invalid or expired. Please log in again.');
          case 413:
            errorMessage = 'Payload Too Large';
            userFriendlyMessage = 'Request data is too large. Please reduce input content or screenshot size and try again.';
            break;
          case 500:
            // Try to parse server's detailed error message
            try {
              const errorData = error.response.data || null;
              errorMessage = errorData?.error || 'Internal Server Error';
              if (errorData?.error && errorData?.errorType === 'AI_SERVICE_ERROR') {
                userFriendlyMessage = `${errorData.error}\n\nSuggestion: ${errorData.suggestion}`;
              } else {
                userFriendlyMessage = errorData?.error || 'Server error. Please try again later.';
              }
            } catch {
              errorMessage = 'Internal Server Error';
              userFriendlyMessage = 'Server error. Please try again later.';
            }
            break;
          case 502:
            errorMessage = 'Bad Gateway';
            userFriendlyMessage = 'Service temporarily unavailable. Retrying...';
            break;
          case 503:
            errorMessage = 'Service Unavailable';
            userFriendlyMessage = 'AI service busy. Retrying...';
            break;
          case 504:
            errorMessage = 'Gateway Timeout';
            userFriendlyMessage = 'Gateway timeout. Retrying...';
            break;
          default:
            try {
              errorMessage = error.response.data?.error || `HTTP ${status}`;
            } catch {
              errorMessage = `HTTP ${status}`;
            }
            userFriendlyMessage = `Request failed with status code: ${status}`;
        }

        // For retryable errors (5xx, 429), set flag and continue to retry logic
        // For non-retryable errors (4xx except 429), throw immediately
        if (isRetryableStatus) {
          shouldRetry = true;
          retryMessage = userFriendlyMessage;
          console.log(`\n⚠️  ${status}: ${userFriendlyMessage}`);
          if (this.showAIDebugInfo) {
            console.log(`   Original error: ${errorMessage}`);
          }
        } else {
          console.error(`\n❌ Request failed (${status}): ${userFriendlyMessage}`);
          throw new Error(userFriendlyMessage);
        }
      } else {
        // Network error or other error (no response)
        const isRetryable = this.isRetryableError(error);
        if (isRetryable) {
          shouldRetry = true;
          retryMessage = 'Network error. Retrying...';
          console.log(`\n⚠️  ${retryMessage}`);
        } else {
          throw error;
        }
      }

      // Retry with exponential backoff (infinite retries until success)
      if (shouldRetry) {
        const retryResult = await withRetry(async () => {
          const response = await axios.post(url, requestBody, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.authToken}`
            },
            httpsAgent,
            timeout: 300000
          });

          if (response.status === 401) {
            throw new TokenInvalidError('Authentication token is invalid or expired. Please log in again.');
          }

          return {
            role: 'assistant' as const,
            content: response.data.content || '',
            reasoningContent: response.data.reasoningContent || '',
            toolCalls: response.data.toolCalls,
            timestamp: Date.now()
          };
        }, { 
          maxRetries: Infinity,    // 无限重试，直到成功
          maxTotalTime: 0,         // 不限制总时间
          baseDelay: 2000,         // 基础延迟 2 秒
          maxDelay: 30000,         // 最大延迟 30 秒
          jitter: true,
          retryOnTimeout: true,
          retryOn5xx: true,
          retryOn429: true,
          backoffMultiplier: 2
        });

        if (!retryResult.success) {
          throw retryResult.error || new Error('Retry failed');
        }

        if (!retryResult.data) {
          throw new Error('Retry returned empty response');
        }

        return retryResult.data;
      }

      // This should never be reached, but TypeScript requires a return
      throw new Error('Unexpected error state: retry was not triggered and no error was thrown');
    }
  }

  private isRetryableError(error: any): boolean {
    // Timeout or network error (no response received)
    if (error.code === 'ECONNABORTED' || !error.response) {
      return true;
    }
    // 5xx server errors
    if (error.response?.status && error.response.status >= 500) {
      return true;
    }
    // 429 rate limit
    if (error.response?.status === 429) {
      return true;
    }
    return false;
  }

  /**
   * Mark task as completed
   * Call backend to update task status to 'end'
   */
  async completeTask(taskId: string): Promise<void> {
    if (!taskId) {
      logger.debug('[RemoteAIClient] completeTask called with empty taskId, skipping');
      return;
    }

    logger.debug(`[RemoteAIClient] completeTask called: taskId=${taskId}`);

    const url = `${this.agentApi}/chat`;
    const requestBody = {
      taskId,
      status: 'end',
      messages: [],
      options: {}
    };

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        httpsAgent
      });
      logger.debug(`[RemoteAIClient] completeTask response status: ${response.status}`);
    } catch (error) {
      console.error('[RemoteAIClient] Failed to mark task as completed:', error);
    }
  }

  /**
   * Mark task as cancelled
   * Call backend to update task status to 'cancel'
   */
  async cancelTask(taskId: string): Promise<void> {
    if (!taskId) return;

    const url = `${this.agentApi}/chat`;
    const requestBody = {
      taskId,
      status: 'cancel',
      messages: [],
      options: {}
    };

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    try {
      await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        httpsAgent
      });
    } catch (error) {
      console.error('[RemoteAIClient] Failed to mark task as cancelled:', error);
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
        console.log(renderMarkdown(systemContent).split('\n').map(l => '│ ' + l).join('\n'));
        console.log('└─────────────────────────────────────────────────────────────┘');
      }

      // Display other messages
      displayMessages(otherMsgs);

      console.log('\n📤 Sending request to Remote API...\n');
    }

    // Call existing chat method
    const response = await this.chat(messages, {
      conversationId: undefined,
      tools: options.tools as any,
      toolResults: undefined,
      context: undefined,
      model: options.model,
      taskId: (options as any).taskId,
      status: (options as any).status || 'begin'  // Use status from options, default to 'begin'
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
        const reasoningLines = renderMarkdown(response.reasoningContent).split('\n');
        for (const line of reasoningLines.slice(0, 15)) {
          console.log('│ ' + line.slice(0, 62));
        }
        if (response.reasoningContent.length > 800) console.log('│ ... (truncated)');
        console.log('│ ───────────────────────────────────────────────────────────');
      }

      // Display content
      console.log('│ 💬 CONTENT:');
      console.log('│ ───────────────────────────────────────────────────────────');
      const lines = renderMarkdown(response.content).split('\n');
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
            reasoning_content: response.reasoningContent || '',
            tool_calls: response.toolCalls
          },
          finish_reason: 'stop'
        }
      ],
      usage: undefined
    };
  }

  /**
   * Invoke VLM for image understanding
   * @param messages - full messages array (consistent with local mode)
   * @param systemPrompt - system prompt (optional, for reference)
   * @param remoteChatOptions - other options including AbortSignal, taskId
   */
  async invokeVLM(
    messages: any[],
    _systemPrompt?: string,
    remoteChatOptions: RemoteChatOptions = {}
  ): Promise<string> {
    // Forward complete messages to backend (same format as local mode)
    const requestBody = {
      messages,  // Pass complete messages array
      taskId: remoteChatOptions.taskId,
      status: remoteChatOptions.status || 'begin',
      context: remoteChatOptions.context,
      options: {
        model: remoteChatOptions.model
      }
    };

    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] VLM sending request to:', this.vlmApi);
    }

    // Handle abort signal
    const controller = remoteChatOptions.signal ? new AbortController() : undefined;
    const abortSignal = remoteChatOptions.signal || controller?.signal;

    // If external signal is provided, listen to it
    if (remoteChatOptions.signal) {
      remoteChatOptions.signal.addEventListener?.('abort', () => controller?.abort());
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    // Retry on network errors, timeouts, 5xx, and 429
    const isRetryable = (error: any): boolean => {
      if (error.code === 'ECONNABORTED' || !error.response) {
        return true;
      }
      if (error.response?.status && error.response.status >= 500) {
        return true;
      }
      if (error.response?.status === 429) {
        return true;
      }
      return false;
    };

    try {
      const response = await axios.post(this.vlmApi, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        signal: abortSignal,
        httpsAgent,
        timeout: 120000
      });

      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] VLM response status:', response.status);
      }

      const data = response.data as RemoteVLMResponse;
      return data.content || '';

    } catch (error: any) {
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] VLM request exception:', error.message);
      }

      // Check if error is retryable
      if (!isRetryable(error)) {
        throw error;
      }

      // Retry with exponential backoff (infinite retries until success)
      console.log('[RemoteAIClient] VLM network error, retrying with exponential backoff...');
      const retryResult = await withRetry(async () => {
        const response = await axios.post(this.vlmApi, requestBody, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.authToken}`
          },
          signal: abortSignal,
          httpsAgent,
          timeout: 120000
        });
        const data = response.data as RemoteVLMResponse;
        return data.content || '';
      }, { 
        maxRetries: Infinity,    // 无限重试，直到成功
        maxTotalTime: 0,         // 不限制总时间
        baseDelay: 2000,         // 基础延迟 2 秒
        maxDelay: 30000,         // 最大延迟 30 秒
        jitter: true,
        retryOnTimeout: true,
        retryOn5xx: true,
        retryOn429: true,
        backoffMultiplier: 2
      });

      if (!retryResult.success) {
        throw retryResult.error || new Error('VLM retry failed');
      }

      if (retryResult.data === undefined) {
        throw new Error('VLM retry returned empty response');
      }

      return retryResult.data;
    }
  }

  /**
   * Validate if the current token is still valid
   * Returns true if valid, false otherwise
   */
  async validateToken(): Promise<boolean> {
    try {
      const url = `${this.webBaseUrl}/api/auth/me`;
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      const response = await axios.get(url, {
        httpsAgent,
        timeout: 10000
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async getConversations(): Promise<any[]> {
    const url = `${this.agentApi}/conversations`;
    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Getting conversation list:', url);
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      },
      httpsAgent
    });

    if (response.status !== 200) {
      throw new Error('Failed to get conversation list');
    }

    const data = response.data as { conversations?: any[] };
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

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      },
      httpsAgent
    });

    if (response.status !== 200) {
      throw new Error('Failed to get conversation details');
    }

    const data = response.data as { conversation?: any };
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

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.post(url, { title }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      },
      httpsAgent
    });

    if (response.status !== 200) {
      throw new Error('Failed to create conversation');
    }

    const data = response.data as { conversation?: any };
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

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.delete(url, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      },
      httpsAgent
    });

    if (!response.status.toString().startsWith('2')) {
      throw new Error('Failed to delete conversation');
    }
  }
}