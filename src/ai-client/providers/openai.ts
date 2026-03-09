import axios, { AxiosInstance } from 'axios';
import https from 'https';
import type {
  AIProvider,
  OpenAIConfig,
  Message,
  CompletionOptions,
  CompletionResponse,
  StreamEvent,
  Model,
} from '../types';
import { DEFAULT_RETRY_CONFIG } from '../types.js';
import { getLogger } from '../../logger.js';
import { withRetry, RetryConfig } from '../../retry.js';

const logger = getLogger();

// ============================================================================
// OpenAI Provider
// ============================================================================

/**
 * OpenAI Compatible Provider
 * Supports OpenAI, and any OpenAI-compatible APIs (Qwen, DeepSeek, etc.)
 */
export class OpenAIProvider implements AIProvider {
  readonly type = 'openai';

  private client: AxiosInstance;
  private config: OpenAIConfig;
  private abortController: AbortController | null = null;

  constructor(config: OpenAIConfig) {
    this.config = config;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    if (config.organization) {
      headers['OpenAI-Organization'] = config.organization;
    }

    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.openai.com/v1',
      headers,
      timeout: 300000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  }

  /**
   * Get available models for OpenAI provider
   */
  async getModels(): Promise<Model[]> {
    return OPENAI_MODELS;
  }

  /**
   * Non-streaming completion
   */
  async complete(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    const model = options?.model || this.config.model || 'gpt-4';
    const showDebug = this.config.showDebugInfo ?? false;

    const requestBody: Record<string, unknown> = {
      model,
      messages: this.convertMessages(messages),
      temperature: options?.temperature ?? 0.7,
      stream: false,
    };

    if (options?.maxTokens && options.maxTokens > 0) {
      requestBody.max_tokens = options.maxTokens;
    }

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options.toolChoice || 'auto';
    }

    if (options?.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.max_completion_tokens = options.thinkingTokens;
    }

    if (showDebug) {
      this.debugRequest('OpenAI', model, messages);
    }

    const retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG };

    const result = await withRetry(async () => {
      const response = await this.client.post('/chat/completions', requestBody, {
        signal: options?.signal,
      });
      return this.convertResponse(response.data, model);
    }, retryConfig);

    if (showDebug && result.data) {
      this.debugResponse(result.data);
    }

    if (result.success) {
      return result.data!;
    }
    throw result.error || new Error('OpenAI API request failed after retries');
  }

  /**
   * Streaming completion
   */
  async *stream(
    messages: Message[],
    options?: CompletionOptions
  ): AsyncIterable<StreamEvent> {
    const model = options?.model || this.config.model || 'gpt-4';
    const showDebug = this.config.showDebugInfo ?? false;

    const requestBody: Record<string, unknown> = {
      model,
      messages: this.convertMessages(messages),
      temperature: options?.temperature ?? 0.7,
      stream: true,
    };

    if (options?.maxTokens && options.maxTokens > 0) {
      requestBody.max_tokens = options.maxTokens;
    }

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options.toolChoice || 'auto';
    }

    if (options?.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.max_completion_tokens = options.thinkingTokens;
    }

    if (showDebug) {
      logger.debug(`[OpenAI] Starting stream with model: ${model}`);
    }

    this.abortController = new AbortController();

    try {
      const response = await this.client.post('/chat/completions', requestBody, {
        responseType: 'stream',
        signal: options?.signal || this.abortController.signal,
      });

      let buffer = '';
      let outputBuffer = '';

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;

              if (delta?.content) {
                outputBuffer += delta.content;
                yield { type: 'text_delta', delta: delta.content };
              }

              if (delta?.reasoning_content) {
                yield { type: 'reasoning_delta', delta: delta.reasoning_content };
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      yield {
        type: 'done',
        reason: 'stop',
        content: outputBuffer,
      };
    } catch (error) {
      if (axios.isCancel(error)) {
        yield { type: 'done', reason: 'stop' };
      } else {
        yield { type: 'error', error: error as Error };
      }
    }
  }

  /**
   * Abort ongoing request
   */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Close provider
   */
  async close(): Promise<void> {
    this.abort();
  }

  // --------------------------------------------------------------------------

  /**
   * Convert messages to OpenAI format
   */
  private convertMessages(messages: Message[]): Message[] {
    // OpenAI format is already our internal format, but we need to
    // convert ContentBlock arrays to the proper structure
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return msg;
      }

      // Convert ContentBlock array
      return {
        ...msg,
        content: msg.content.map(block => {
          if (block.type === 'tool_use') {
            return {
              type: 'tool_use' as const,
              id: block.id,
              function: {
                name: block.name || '',
                arguments: typeof block.input === 'string'
                  ? block.input
                  : JSON.stringify(block.input || {}),
              },
            };
          }
          return block;
        }),
      };
    });
  }

  /**
   * Convert OpenAI response to unified format
   */
  private convertResponse(data: any, model: string): CompletionResponse {
    const choice = data.choices?.[0];
    const message = choice?.message || {};

    return {
      id: data.id || `openai-${Date.now()}`,
      object: 'chat.completion',
      created: data.created || Math.floor(Date.now() / 1000),
      model: data.model || model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: message.content || '',
          reasoning_content: message.reasoning_content || undefined,
          tool_calls: this.convertToolCalls(message.tool_calls),
        },
        finish_reason: choice?.finish_reason || 'stop',
      }],
      usage: data.usage ? {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  /**
   * Convert tool calls
   */
  private convertToolCalls(toolCalls: any[] | undefined): any[] | undefined {
    if (!toolCalls || !Array.isArray(toolCalls)) return undefined;

    return toolCalls.map(tc => ({
      id: tc.id,
      type: tc.type || 'function',
      function: {
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '',
      },
    }));
  }

  /**
   * Debug request output
   */
  private debugRequest(provider: string, model: string, messages: Message[]): void {
    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║              AI REQUEST DEBUG (${provider})                  ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝`);
    console.log(`📦 Model: ${model}`);
    console.log(`💬 Messages: ${messages.length}`);
    console.log('─'.repeat(60));
    
    // Print each message content
    messages.forEach((msg, idx) => {
      const role = msg.role || 'unknown';
      const content = msg.content || '';
      const reasoning = msg.reasoning_content ? `\n  [Reasoning] ${msg.reasoning_content}` : '';
      const toolCalls = msg.tool_calls ? `\n  [Tool Calls] ${JSON.stringify(msg.tool_calls, null, 2)}` : '';
      const toolCallId = msg.tool_call_id ? `\n  [Tool Call ID] ${msg.tool_call_id}` : '';
      
      console.log(`\n[${idx + 1}] Role: ${role}${reasoning}${toolCalls}${toolCallId}`);
      if (content) {
        // No truncation for system messages or any content
        console.log(`    Content: ${content}`);
      }
    });
    
    console.log('\n📤 Sending request...\n');
  }

  /**
   * Debug response output
   */
  private debugResponse(response: CompletionResponse): void {
    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║             AI RESPONSE DEBUG (OpenAI)                    ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝`);
    console.log(`🆔 ID: ${response.id}`);
    console.log(`📦 Model: ${response.model}`);
    console.log(`⏱️  Created: ${response.created}`);
    console.log('─'.repeat(60));
    
    // Print each choice
    response.choices?.forEach((choice, idx) => {
      const msg = choice.message;
      const content = msg?.content || '';
      const reasoning = msg?.reasoning_content ? `\n  [Reasoning] ${msg.reasoning_content}` : '';
      const toolCalls = msg?.tool_calls ? `\n  [Tool Calls] ${JSON.stringify(msg.tool_calls, null, 2)}` : '';
      
      console.log(`\n[Choice ${idx}] Finish Reason: ${choice.finish_reason}${reasoning}${toolCalls}`);
      if (content) {
        // No truncation
        console.log(`    Content: ${content}`);
      }
    });
    
    if (response.usage) {
      console.log('\n📊 Usage:');
      console.log(`   Prompt tokens: ${response.usage.prompt_tokens}`);
      console.log(`   Completion tokens: ${response.usage.completion_tokens}`);
      console.log(`   Total tokens: ${response.usage.total_tokens}`);
    }
    
    console.log('\n📥 Response received.\n');
  }

  /**
   * Handle errors
   */
  private handleError(error: any): Error {
    if (error.response) {
      return new Error(`OpenAI API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    if (error.request) {
      return new Error('OpenAI API Error: Network error - No response received');
    }
    return new Error(`OpenAI API Error: ${error.message}`);
  }
}

// ============================================================================
// OpenAI Models
// ============================================================================

const OPENAI_MODELS: Model[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextWindow: 128000, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', contextWindow: 128000, supportsTools: true, supportsThinking: true, supportsStreaming: true },
  { id: 'gpt-4', name: 'GPT-4', provider: 'openai', contextWindow: 8192, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai', contextWindow: 16385, supportsTools: true, supportsStreaming: true },
  { id: 'o1', name: 'o1', provider: 'openai', contextWindow: 200000, supportsThinking: true, supportsStreaming: true },
  { id: 'o1-mini', name: 'o1-mini', provider: 'openai', contextWindow: 200000, supportsThinking: true, supportsStreaming: true },
  { id: 'o3-mini', name: 'o3-mini', provider: 'openai', contextWindow: 200000, supportsThinking: true, supportsStreaming: true },
];

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create OpenAI provider instance
 */
export function createOpenAIProvider(config: OpenAIConfig): AIProvider {
  return new OpenAIProvider(config);
}
