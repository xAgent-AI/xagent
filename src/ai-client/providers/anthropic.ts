import axios, { AxiosInstance } from 'axios';
import https from 'https';
import type {
  AIProvider,
  AnthropicConfig,
  Message,
  ContentBlock,
  CompletionOptions,
  CompletionResponse,
  StreamEvent,
  Model,
} from '../types';
import { getLogger } from '../../logger';

const logger = getLogger();

// ============================================================================
// Anthropic Provider
// ============================================================================

/**
 * Anthropic Compatible Provider
 * Supports Anthropic official API and MiniMax (which uses Anthropic format)
 */
export class AnthropicProvider implements AIProvider {
  readonly type = 'anthropic';

  private client: AxiosInstance;
  private config: AnthropicConfig;
  private abortController: AbortController | null = null;

  constructor(config: AnthropicConfig) {
    this.config = config;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (config.apiKey) {
      headers['x-api-key'] = config.apiKey;
    }

    // Add extra headers if provided (for MiniMax and other compatible APIs)
    if (config.extraHeaders) {
      Object.assign(headers, config.extraHeaders);
    }

    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.anthropic.com',
      headers,
      timeout: 300000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  }

  /**
   * Get available models
   */
  async getModels(): Promise<Model[]> {
    return ANTHROPIC_MODELS;
  }

  /**
   * Non-streaming completion
   */
  async complete(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    const model = options?.model || this.config.model || 'claude-sonnet-4-20250514';
    const showDebug = this.config.showDebugInfo ?? false;

    const { system, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);

    const requestBody: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      temperature: options?.temperature ?? 1.0,
      stream: false,
      max_tokens: options?.maxTokens,
    };

    if (system) {
      requestBody.system = system;
    }

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: 'object', properties: {} },
      }));

      const toolChoice = options.toolChoice;
      if (toolChoice === 'none') {
        requestBody.tool_choice = { type: 'auto' };
      } else if (toolChoice && typeof toolChoice === 'object' && 'function' in toolChoice) {
        requestBody.tool_choice = { type: 'tool', tool: { name: toolChoice.function.name } };
      } else {
        requestBody.tool_choice = { type: 'auto' };
      }
    }

    if (options?.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.thinking = { type: 'enabled', budget_tokens: options.thinkingTokens };
    }

    if (showDebug) {
      this.debugRequest('Anthropic', model, anthropicMessages, system);
    }

    try {
      const response = await this.client.post('/v1/messages', requestBody, {
        signal: options?.signal,
      });
      return this.convertResponse(response.data, model);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Streaming completion
   */
  async *stream(
    messages: Message[],
    options?: CompletionOptions
  ): AsyncIterable<StreamEvent> {
    const model = options?.model || this.config.model || 'claude-sonnet-4-20250514';
    const showDebug = this.config.showDebugInfo ?? false;

    const { system, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);

    const requestBody: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      temperature: options?.temperature ?? 1.0,
      stream: true,
      max_tokens: options?.maxTokens,
    };

    if (system) {
      requestBody.system = system;
    }

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: 'object', properties: {} },
      }));
      requestBody.tool_choice = { type: 'auto' };
    }

    if (options?.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.thinking = { type: 'enabled', budget_tokens: options.thinkingTokens };
    }

    if (showDebug) {
      logger.debug(`[Anthropic] Starting stream with model: ${model}`);
    }

    this.abortController = new AbortController();

    try {
      const response = await this.client.post('/v1/messages', requestBody, {
        responseType: 'stream',
        signal: options?.signal || this.abortController.signal,
      });

      let buffer = '';

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);
            try {
              const event = JSON.parse(data);

              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                yield { type: 'text_delta', delta: event.delta.text };
              }

              if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
                yield { type: 'reasoning_delta', delta: event.delta.thinking };
              }

              if (event.type === 'content_block_delta' && event.delta?.type === 'tool_use_delta') {
                const toolDelta = event.delta;
                yield {
                  type: 'toolcall_delta',
                  delta: JSON.stringify({
                    id: toolDelta.id,
                    name: toolDelta.name,
                    input: toolDelta.input,
                  }),
                };
              }

              if (event.type === 'message_stop') {
                yield { type: 'done', reason: 'stop' };
              }

              if (event.type === 'message_delta' && event.delta?.stop_reason) {
                yield { type: 'done', reason: this.convertStopReason(event.delta.stop_reason) };
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
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
   * Convert messages to Anthropic format
   */
  private convertToAnthropicFormat(
    messages: Message[]
  ): { system: string; messages: Array<{ role: string; content: ContentBlock[] }> } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const systemContent = systemMessages[0]?.content;
    const system = typeof systemContent === 'string' ? systemContent : '';

    // 记录输入消息中的 tool_calls 情况
    const assistantWithToolCalls = otherMessages.filter(m => m.role === 'assistant' && m.tool_calls?.length);
    if (assistantWithToolCalls.length > 0) {
      console.log(`[AnthropicConvert] Found ${assistantWithToolCalls.length} assistant messages with tool_calls`);
      for (const msg of assistantWithToolCalls) {
        const toolCallIds = (msg.tool_calls as any[]).map((tc: any) => tc.id);
        console.log(`[AnthropicConvert] Tool call IDs: ${JSON.stringify(toolCallIds)}`);
      }
    }

    const toolResults = otherMessages.filter(m => m.role === 'tool' && m.tool_call_id);
    if (toolResults.length > 0) {
      const toolResultIds = toolResults.map(m => m.tool_call_id);
      console.log(`[AnthropicConvert] Tool result IDs: ${JSON.stringify(toolResultIds)}`);
    }

    const anthropicMessages: Array<{ role: string; content: ContentBlock[] }> = [];

    for (const msg of otherMessages) {
      const blocks: ContentBlock[] = [];

      // Handle tool result messages
      if (msg.role === 'tool' && msg.tool_call_id) {
        blocks.push({
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
        });
      } else if (typeof msg.content === 'string') {
        blocks.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && 'text' in block) {
            blocks.push({ type: 'text', text: (block as any).text });
          } else if (block.type === 'tool_use') {
            blocks.push({
              type: 'tool_use',
              id: (block as any).id,
              name: (block as any).function?.name || (block as any).name,
              input: (block as any).function?.arguments || (block as any).input,
            });
          } else if (block.type === 'tool_result') {
            blocks.push({
              type: 'tool_result',
              tool_use_id: (block as any).tool_call_id || (block as any).tool_use_id,
              content: typeof (block as any).content === 'string'
                ? (block as any).content
                : JSON.stringify((block as any).content),
            });
          } else if (block.type === 'thinking') {
            blocks.push({ type: 'thinking', thinking: (block as any).thinking });
          }
        }
      }

      // Handle tool_calls from OpenAI format
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls as any[]) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name || '',
            input: typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function?.arguments)
              : tc.function?.arguments || {},
          });
        }
      }

      if (blocks.length > 0) {
        anthropicMessages.push({
          role: msg.role === 'tool' ? 'user' : msg.role,
          content: blocks,
        });
      }
    }

    // 记录 Anthropic 消息中的 tool_use 和 tool_result IDs
    const allToolUseIds: string[] = [];
    const allToolResultIds: string[] = [];

    for (const msg of anthropicMessages) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          allToolUseIds.push((block as any).id);
        } else if (block.type === 'tool_result') {
          allToolResultIds.push((block as any).tool_use_id);
        }
      }
    }

    if (allToolUseIds.length > 0) {
      console.log(`[AnthropicConvert] Output - tool_use IDs: ${JSON.stringify(allToolUseIds)}`);
      console.log(`[AnthropicConvert] Output - tool_result IDs: ${JSON.stringify(allToolResultIds)}`);

      // 检查是否有 tool_use 没有对应的 tool_result
      const unmatchedToolUses = allToolUseIds.filter(id => !allToolResultIds.includes(id));
      if (unmatchedToolUses.length > 0) {
        console.log(`[AnthropicConvert] WARNING: Unmatched tool_use IDs: ${JSON.stringify(unmatchedToolUses)}`);
      }
    }

    return { system, messages: anthropicMessages };
  }

  /**
   * Convert Anthropic response to unified format
   */
  private convertResponse(data: any, model: string): CompletionResponse {
    const content = data.content || [];
    let textContent = '';
    let reasoningContent = '';
    const toolCalls: any[] = [];

    // Handle tool calls from content blocks
    for (const block of content) {
      if (block.type === 'text') {
        textContent += block.text || '';
      } else if (block.type === 'thinking') {
        reasoningContent += block.thinking || '';
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {}),
          },
        });
      }
    }

    // Handle tool calls from top-level field (some APIs return here too)
    const topLevelToolCalls = data.tool_calls;
    if (topLevelToolCalls && Array.isArray(topLevelToolCalls)) {
      for (const tc of topLevelToolCalls) {
        toolCalls.push({
          id: tc.id,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '',
          },
        });
      }
    }

    return {
      id: data.id || `anthropic-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model || model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textContent,
          reasoning_content: reasoningContent || undefined,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: this.convertStopReason(data.stop_reason),
      }],
      usage: data.usage ? {
        prompt_tokens: data.usage.input_tokens || 0,
        completion_tokens: data.usage.output_tokens || 0,
        total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      } : undefined,
    };
  }

  /**
   * Convert Anthropic stop reason to unified format
   */
  private convertStopReason(reason: string | undefined): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'end_turn':
      case 'stop':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }

  /**
   * Debug request output
   */
  private debugRequest(
    provider: string,
    model: string,
    messages: Array<{ role: string; content: ContentBlock[] }>,
    system?: string
  ): void {
    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║              AI REQUEST DEBUG (${provider})                  ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝`);
    console.log(`📦 Model: ${model}`);
    console.log(`💬 Messages: ${messages.length}`);
    if (system) console.log(`📝 System: ${system.slice(0, 100)}...`);
    console.log('─'.repeat(60));
    console.log('\n📤 Sending request...\n');
  }

  /**
   * Handle errors
   */
  private handleError(error: any): Error {
    if (error.response) {
      return new Error(`Anthropic API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    if (error.request) {
      return new Error('Anthropic API Error: Network error - No response received');
    }
    return new Error(`Anthropic API Error: ${error.message}`);
  }
}

// ============================================================================
// Anthropic Models
// ============================================================================

const ANTHROPIC_MODELS: Model[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsThinking: true, supportsStreaming: true },
  { id: 'claude-haiku-3-20250506', name: 'Claude Haiku 3', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsStreaming: true },
  { id: 'claude-opus-4-20250501', name: 'Claude Opus 4', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsThinking: true, supportsStreaming: true },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsThinking: true, supportsStreaming: true },
  { id: 'claude-haiku-3', name: 'Claude Haiku 3', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsStreaming: true },
  // MiniMax models (uses Anthropic format)
  { id: 'MiniMax-M2', name: 'MiniMax-M2', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsStreaming: true },
  { id: 'MiniMax-M2-8k', name: 'MiniMax-M2-8K', provider: 'anthropic', contextWindow: 8000, supportsTools: true, supportsStreaming: true },
  { id: 'MiniMax-M2-32k', name: 'MiniMax-M2-32K', provider: 'anthropic', contextWindow: 32000, supportsTools: true, supportsStreaming: true },
  { id: 'MiniMax-M2-128k', name: 'MiniMax-M2-128K', provider: 'anthropic', contextWindow: 128000, supportsTools: true, supportsStreaming: true },
];

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create Anthropic provider instance
 */
export function createAnthropicProvider(config: AnthropicConfig): AIProvider {
  return new AnthropicProvider(config);
}
