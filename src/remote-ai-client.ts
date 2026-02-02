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
  taskId?: string;
  status?: 'begin' | 'continue' | 'end' | 'cancel' | 'timeout' | 'failure';
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
  llmProvider?: string;
  vlmProvider?: string;
}

export interface RemoteChatResponse {
  content: string;
  reasoningContent?: string;
  tool_calls?: ToolCall[];
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
    messages: Message[],
    remoteChatOptions: RemoteChatOptions = {}
  ): Promise<SessionOutput> {
    // Pass complete messages array to backend, backend forwards directly to LLM
    const requestBody = {
      messages: messages,  // Pass complete message history
      taskId: remoteChatOptions.taskId,
      status: remoteChatOptions.status || 'begin',
      conversationId: remoteChatOptions.conversationId,
      context: remoteChatOptions.context,
      toolResults: remoteChatOptions.toolResults,
      tools: remoteChatOptions.tools,
      // Pass provider info to backend
      options: {
        llmProvider: (remoteChatOptions as any).llmProvider,
        vlmProvider: (remoteChatOptions as any).vlmProvider
      }
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
          'Authorization': `Bearer ${this.authToken}`,
          'xagent-cli-version': '1.0'
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
        console.log('[RemoteAIClient] tool_calls count:', data.tool_calls?.length || 0);
      }

      return {
        role: 'assistant',
        content: data.content || '',
        reasoningContent: data.reasoningContent || '',
        tool_calls: data.tool_calls,
        timestamp: Date.now()
      };

    } catch (error: any) {
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] Request exception:', error.message);
      }

      // Provide user-friendly error messages based on status code
      if (error.response) {
        const status = error.response.status;
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
          case 429:
            errorMessage = 'Too Many Requests';
            userFriendlyMessage = 'XAgent service rate limit exceeded. Please wait a moment and try again.';
            break;
          case 500:
            // Try to parse server's detailed error message
            try {
              const errorData = error.response.data || null;
              errorMessage = errorData?.error || 'Internal Server Error';
              if (errorData?.error && errorData?.errorType === 'AI_SERVICE_ERROR') {
                userFriendlyMessage = `${errorData.error}\n\nSuggestion: ${errorData.suggestion}`;
              } else {
                userFriendlyMessage = errorData?.error || 'Server error. Please try again later. If the problem persists, contact the administrator.';
              }
            } catch {
              errorMessage = 'Internal Server Error';
              userFriendlyMessage = 'Server error. Please try again later. If the problem persists, contact the administrator.';
            }
            break;
          case 502:
            errorMessage = 'Bad Gateway';
            userFriendlyMessage = 'Gateway error. Service temporarily unavailable. Please try again later.';
            break;
          case 503:
            errorMessage = 'Service Unavailable';
            userFriendlyMessage = 'AI service request timed out. Please try again.';
            break;
          case 504:
            errorMessage = 'Gateway Timeout';
            userFriendlyMessage = 'Gateway timeout. Please try again later.';
            break;
          default:
            try {
              errorMessage = error.response.data?.error || `HTTP ${status}`;
            } catch {
              errorMessage = `HTTP ${status}`;
            }
            userFriendlyMessage = `Request failed with status code: ${status}`;
        }

        // Print user-friendly error message
        console.error(`\n❌ Request failed (${status})`);
        console.error(`   ${userFriendlyMessage}`);
        if (this.showAIDebugInfo) {
          console.error(`   Original error: ${errorMessage}`);
        }
        throw new Error(userFriendlyMessage);
      }

      // Network error or other error
      // Check if error is retryable
      const isRetryable = this.isRetryableError(error);
      if (!isRetryable) {
        throw error;
      }

      // Retry with exponential backoff
      const retryResult = await withRetry(async () => {
        const response = await axios.post(url, requestBody, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.authToken}`,
            'xagent-cli-version': '1.0'
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
          tool_calls: response.data.tool_calls,
          timestamp: Date.now()
        };
      }, { maxRetries: 3, baseDelay: 1000, maxDelay: 10000, jitter: true });

      if (!retryResult.success) {
        throw retryResult.error || new Error('Retry failed');
      }

      if (!retryResult.data) {
        throw new Error('Retry returned empty response');
      }

      return retryResult.data;
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
   * Mark task as failed with specific reason
   * @param taskId - Task ID
   * @param reason - Failure reason: 'timeout' (LLM timeout) or 'failure' (LLM/tool error)
   */
  async failTask(taskId: string, reason: 'timeout' | 'failure'): Promise<void> {
    if (!taskId) return;

    logger.debug(`[RemoteAIClient] failTask called: taskId=${taskId}, reason=${reason}`);

    const url = `${this.agentApi}/chat`;
    const requestBody = {
      taskId,
      status: reason,
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
      logger.debug(`[RemoteAIClient] failTask successfully: taskId=${taskId}, reason=${reason}`);
    } catch (error) {
      console.error(`[RemoteAIClient] Failed to mark task as ${reason}:`, error);
    }
  }

  /**
   * Unified LLM call interface - same return type as aiClient.chatCompletion
   * Implements transparency: caller doesn't need to know remote vs local mode
   */
  async chatCompletion(
    messages: Message[],
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
      taskId: (options as any).taskId,
      status: (options as any).status || 'begin',  // Use status from options, default to 'begin'
      llmProvider: (options as any).llmProvider,
      vlmProvider: (options as any).vlmProvider
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
      if (response.tool_calls && response.tool_calls.length > 0) {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🔧 TOOL CALLS                                                │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        for (let i = 0; i < response.tool_calls.length; i++) {
          const tc = response.tool_calls[i];
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
            tool_calls: response.tool_calls
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
      context: remoteChatOptions.context
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

    try {
      const response = await axios.post(this.vlmApi, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
          },
          signal: abortSignal,
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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

  /**
   * Get available models from marketplace
   */
  async getModels(): Promise<{ llm: ModelInfo[]; vlm: ModelInfo[] }> {
    const url = `${this.webBaseUrl}/api/models`;
    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Getting models:', url);
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${this.authToken}` },
      httpsAgent,
      timeout: 10000
    });

    return response.data;
  }

  /**
   * Get default models configuration
   */
  async getDefaultModels(): Promise<{ llm: ModelInfo; vlm: ModelInfo }> {
    const url = `${this.webBaseUrl}/api/models/default`;
    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Getting default models:', url);
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${this.authToken}` },
      httpsAgent,
      timeout: 10000
    });

    return response.data;
  }

  /**
   * Compress context - generate summary for long conversations
   * Uses separate /api/agent/compress endpoint that doesn't require taskId
   */
  async compress(
    messages: Message[],
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<ChatCompletionResponse> {
    const url = `${this.agentApi}/compress`;
    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Compressing context:', url);
      console.log('[RemoteAIClient] Message count:', messages.length);
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const response = await axios.post(url, {
      messages,
      maxTokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.3
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
        'xagent-cli-version': '1.0'
      },
      httpsAgent,
      timeout: 60000
    });

    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Compression complete');
    }

    return response.data;
  }
}

export interface ModelInfo {
  provider: string;
  providerDisplay: string;
}