import axios, { AxiosInstance } from 'axios';
import https from 'https';
import type {
  AIProvider,
  RemoteAIProvider,
  RemoteConfig,
  Message,
  CompletionOptions,
  CompletionResponse,
  StreamEvent,
  Model,
  RemoteModelsResponse,
} from '../types';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// ============================================================================
// Remote Provider (xAgent Web Service)
// ============================================================================

/**
 * Remote Provider - communicates with xAgent Web Service
 * Used for cloud-based AI processing
 */
export class RemoteProvider implements AIProvider {
  readonly type = 'remote';

  private authToken: string;
  private webBaseUrl: string;
  private agentApi: string;
  private vlmApi: string;
  private showDebugInfo: boolean;
  private client: AxiosInstance;

  constructor(config: RemoteConfig) {
    this.authToken = config.authToken || '';
    this.webBaseUrl = (config.baseUrl || '').replace(/\/$/, '');
    this.agentApi = `${this.webBaseUrl}/api/agent`;
    this.vlmApi = `${this.webBaseUrl}/api/agent/vlm`;
    this.showDebugInfo = config.showDebugInfo ?? false;

    this.client = axios.create({
      timeout: 300000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  }

  /**
   * Get available models from remote service
   * Implements AIProvider interface - returns LLM models only
   */
  async getModels(): Promise<Model[]> {
    try {
      const response = await this.client.get(`${this.webBaseUrl}/api/models`, {
        headers: this.getHeaders(),
        timeout: 10000,
      });

      const data = response.data as RemoteModelsResponse;
      return data.llm || [];
    } catch {
      // Return default models if fetch fails
      return REMOTE_MODELS;
    }
  }

  /**
   * Get available models from remote service including both LLM and VLM
   * Extended method for RemoteAIProvider interface
   */
  async getRemoteModels(): Promise<RemoteModelsResponse> {
    try {
      const response = await this.client.get(`${this.webBaseUrl}/api/models`, {
        headers: this.getHeaders(),
        timeout: 10000,
      });

      const data = response.data as RemoteModelsResponse;
      return {
        llm: data.llm || [],
        vlm: data.vlm || [],
      };
    } catch {
      // Return default models if fetch fails
      return {
        llm: REMOTE_MODELS,
        vlm: [],
      };
    }
  }

  /**
   * Non-streaming completion
   */
  async complete(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    const showDebug = this.showDebugInfo;

    if (showDebug) {
      this.debugRequest(messages);
    }

    // Build request body matching original implementation
    const requestBody = {
      messages,
      taskId: options?.taskId,
      status: options?.status || 'begin',
      conversationId: options?.conversationId,
      context: options?.context,
      toolResults: options?.toolResults,
      tools: options?.tools,
      options: {
        llmModelName: options?.llmModelName || options?.model,
        vlmModelName: options?.vlmModelName,
      },
    };

    try {
      const response = await this.client.post(
        `${this.agentApi}/chat`,
        requestBody,
        {
          headers: this.getHeaders(),
        }
      );

      const data = response.data;

      if (showDebug) {
        this.debugResponse(data);
      }

      return {
        id: data?.id || `remote-${Date.now()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: options?.model || 'remote-llm',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: data?.message || data?.content || '',
            reasoning_content: data?.reasoning_content || data?.reasoningContent || '',
            tool_calls: data?.tool_calls || data?.toolCalls,
          },
          finish_reason: 'stop',
        }],
        usage: undefined,
      };
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Streaming completion - remote provider doesn't support streaming yet
   * Falls back to non-streaming with incremental yield
   */
  async *stream(
    messages: Message[],
    _options?: CompletionOptions
  ): AsyncIterable<StreamEvent> {
    // Remote provider doesn't support streaming, yield full response
    const response = await this.complete(messages);

    const content = response.choices[0]?.message.content;
    const textContent = typeof content === 'string' ? content : '';

    for (const char of textContent) {
      yield { type: 'text_delta', delta: char };
    }

    const reasoningContent = response.choices[0]?.message.reasoning_content;
    if (reasoningContent) {
      for (const char of reasoningContent) {
        yield { type: 'reasoning_delta', delta: char };
      }
    }

    yield { type: 'done', reason: 'stop' };
  }

  /**
   * Abort ongoing request - not implemented for remote
   */
  abort(): void {
    // Remote requests cannot be aborted from client side
  }

  /**
   * Close provider
   */
  async close(): Promise<void> {
    // No resources to close
  }

  // --------------------------------------------------------------------------
  // Remote Task Management Methods
  // --------------------------------------------------------------------------

  /**
   * Complete a remote task
   */
  async completeTask(taskId: string): Promise<void> {
    await this.makeTaskRequest('end', taskId);
  }

  /**
   * Cancel a remote task
   */
  async cancelTask(taskId: string): Promise<void> {
    await this.makeTaskRequest('cancel', taskId);
  }

  /**
   * Fail a remote task
   */
  async failTask(taskId: string, reason: 'timeout' | 'failure'): Promise<void> {
    await this.makeTaskRequest(reason, taskId);
  }

  /**
   * Helper for task management requests - uses /chat endpoint like original implementation
   * Note: Task management requests use minimal headers (no xagent-cli-version) to match original behavior
   */
  private async makeTaskRequest(status: string, taskId: string): Promise<void> {
    const url = `${this.agentApi}/chat`;
    const requestBody = {
      taskId,
      status,
      messages: [],
      options: {}
    };

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    try {
      await this.client.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        httpsAgent
      });
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  // --------------------------------------------------------------------------

  /**
   * Get request headers
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.authToken}`,
      'xagent-cli-version': '1.0',
    };
  }

  /**
   * Debug request output
   */
  private debugRequest(messages: Message[]): void {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║              AI REQUEST DEBUG (REMOTE)                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`🌐 Base URL: ${this.webBaseUrl}`);
    console.log(`💬 Messages: ${messages.length}`);
    console.log('─'.repeat(60));
    console.log('\n📤 Sending request to Remote API...\n');
  }

  /**
   * Debug response output
   */
  private debugResponse(data: any): void {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║             AI RESPONSE DEBUG (REMOTE)                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`🆔 ID: remote-${Date.now()}`);
    console.log(`📏 Content length: ${data.content?.length || 0}`);
    if (data.tool_calls?.length) {
      console.log(`🔧 Tool calls: ${data.tool_calls.length}`);
    }
    console.log('\n📥 Response received.\n');
  }

  /**
   * Generic request helper for task management
   */
  private async makeRequest(endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', data?: any): Promise<any> {
    const url = `${this.agentApi}${endpoint}`;
    try {
      const response = await this.client.request({
        method,
        url,
        data,
        headers: this.getHeaders(),
      });
      return response.data;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Handle errors
   */
  private handleError(error: any): Error {
    if (error.response) {
      const status = error.response.status;
      let message = `Remote API Error: ${status}`;

      if (status === 401) {
        message = 'Remote API Error: Authentication token is invalid or expired. Please log in again.';
      } else if (status === 429) {
        message = 'Remote API Error: Rate limit exceeded. Please try again later.';
      } else if (status === 500) {
        message = 'Remote API Error: Server error. Please try again later.';
      } else if (status === 503) {
        message = 'Remote API Error: Service temporarily unavailable. Please try again.';
      }

      return new Error(message);
    }

    if (error.request) {
      return new Error('Remote API Error: Network error - No response received');
    }

    return new Error(`Remote API Error: ${error.message}`);
  }

  /**
   * Invoke VLM (Vision Language Model) for image analysis
   * @param messages - Full messages array (consistent with local mode)
   * @param _systemPrompt - System prompt (optional, for reference)
   * @param remoteChatOptions - Other options including AbortSignal, taskId
   */
  async invokeVLM(
    messages: Message[],
    _systemPrompt: string,
    remoteChatOptions: {
      taskId?: string;
      status?: 'begin' | 'continue';
      context?: { cwd?: string; workspace?: string };
      signal?: AbortSignal;
    } = {}
  ): Promise<string> {
    // Forward complete messages to backend (same format as local mode)
    const requestBody = {
      messages,
      taskId: remoteChatOptions.taskId,
      status: remoteChatOptions.status || 'begin',
      context: remoteChatOptions.context,
    };

    // Handle abort signal
    const controller = remoteChatOptions.signal ? new AbortController() : undefined;
    const abortSignal = remoteChatOptions.signal || controller?.signal;
    if (remoteChatOptions.signal) {
      remoteChatOptions.signal.addEventListener?.('abort', () => controller?.abort());
    }

    try {
      const response = await axios.post(this.vlmApi, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
        },
        signal: abortSignal,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 120000,
      });

      const data = response.data as { content?: string };
      return data.content || '';
    } catch (error: any) {
      throw this.handleError(error);
    }
  }
}

// ============================================================================
// Remote Models
// ============================================================================

const REMOTE_MODELS: Model[] = [
  { id: 'remote-llm', name: 'Remote LLM', provider: 'remote', supportsStreaming: false },
];

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create Remote provider instance
 */
export function createRemoteProvider(config: RemoteConfig): RemoteAIProvider {
  return new RemoteProvider(config);
}

// ============================================================================
// Static Methods
// ============================================================================

export interface RemoteModelInfo {
  name: string;
  displayName: string;
}

export interface RemoteDefaultModels {
  llm: RemoteModelInfo;
  vlm: RemoteModelInfo;
}

/**
 * Fetch default models from remote service (static method for initialization)
 */
export async function fetchDefaultModels(authToken: string, baseUrl: string): Promise<RemoteDefaultModels> {
  const url = `${baseUrl}/api/models/default`;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  const response = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${authToken}` },
    httpsAgent,
    timeout: 10000
  });

  return response.data;
}
