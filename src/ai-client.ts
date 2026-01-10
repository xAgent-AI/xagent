import axios, { AxiosInstance } from 'axios';
import { AuthConfig } from './types.js';

// Anthropic 格式的消息内容块类型
export interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string;
  thinking?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<AnthropicContentBlock | { type: string; text?: string; image_url?: { url: string } }>;
  reasoning_content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: any;
  };
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: string; function: { name: string } };
  stream?: boolean;
  thinkingTokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: Message;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// 检测是否为 Anthropic 兼容 API (MiniMax)
function isAnthropicCompatible(baseUrl: string): boolean {
  return baseUrl.includes('/anthropic');
}

export class AIClient {
  private client: AxiosInstance;
  private authConfig: AuthConfig;

  constructor(authConfig: AuthConfig) {
    this.authConfig = authConfig;
    this.client = axios.create({
      baseURL: authConfig.baseUrl,
      headers: {
        'Authorization': `Bearer ${authConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });
  }

  // 将 OpenAI 格式消息转换为 Anthropic 格式
  private convertToAnthropicFormat(
    messages: Message[],
    systemPrompt?: string
  ): { system: string; messages: Array<{ role: string; content: AnthropicContentBlock[] }> } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');
    
    const systemContent = systemMessages[0]?.content;
    const system = systemPrompt || (typeof systemContent === 'string' ? systemContent : '');

    const anthropicMessages: Array<{ role: string; content: AnthropicContentBlock[] }> = [];

    for (const msg of otherMessages) {
      const blocks: AnthropicContentBlock[] = [];

      if (typeof msg.content === 'string') {
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
              input: (block as any).function?.arguments || (block as any).input
            });
          } else if (block.type === 'tool_result') {
            blocks.push({
              type: 'tool_result',
              tool_use_id: (block as any).tool_call_id || (block as any).tool_use_id,
              content: typeof (block as any).content === 'string' 
                ? (block as any).content 
                : JSON.stringify((block as any).content)
            });
          } else if (block.type === 'thinking') {
            blocks.push({ type: 'thinking', thinking: (block as any).thinking });
          }
        }
      }

      // 处理 tool_calls (OpenAI 格式)
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name,
            input: tc.function?.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {}
          });
        }
      }

      if (blocks.length > 0) {
        anthropicMessages.push({
          role: msg.role === 'tool' ? 'user' : msg.role,
          content: blocks as AnthropicContentBlock[]
        });
      }
    }

    return { system, messages: anthropicMessages };
  }

  // 将 Anthropic 响应转换为 OpenAI 格式
  private convertFromAnthropicResponse(anthropicResponse: any): ChatCompletionResponse {
    const content = anthropicResponse.content || [];
    let textContent = '';
    let reasoningContent = '';
    const toolCalls: any[] = [];

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
            arguments: JSON.stringify(block.input || {})
          }
        });
      }
    }

    return {
      id: anthropicResponse.id || `anthropic-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: anthropicResponse.model || this.authConfig.modelName || 'minimax-m2.1',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textContent,
          reasoning_content: reasoningContent || undefined,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: anthropicResponse.stop_reason === 'end_turn' ? 'stop' : 
                       anthropicResponse.stop_reason === 'max_tokens' ? 'length' : 'stop'
      }],
      usage: anthropicResponse.usage
    };
  }

  async chatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const model = options.model || this.authConfig.modelName || 'gpt-4';
    const isAnthropic = isAnthropicCompatible(this.authConfig.baseUrl || '');

    if (isAnthropic) {
      return this.anthropicChatCompletion(messages, options);
    }

    // OpenAI 格式请求
    const requestBody: any = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      stream: options.stream ?? false
    };

    if (options.maxTokens && options.maxTokens > 0) {
      requestBody.max_tokens = options.maxTokens;
    }

    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options.toolChoice || 'auto';
    }

    if (options.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.max_completion_tokens = options.thinkingTokens;
    }

    try {
      const response = await this.client.post('/chat/completions', requestBody);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        throw new Error('Network error: No response received from server');
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }

  // Anthropic 兼容 API 请求
  private async anthropicChatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const { system, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);

    const requestBody: any = {
      model: options.model || this.authConfig.modelName || 'MiniMax-M2',
      messages: anthropicMessages,
      temperature: options.temperature ?? 1.0,
      stream: options.stream ?? false,
      max_tokens: options.maxTokens || 4096
    };

    if (system) {
      requestBody.system = system;
    }

    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: 'object', properties: {} }
      }));
      requestBody.tool_choice = options.toolChoice === 'none' ? { type: 'auto' } : 
        (options.toolChoice || { type: 'auto' });
    }

    if (options.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.thinking = { type: 'enabled', budget_tokens: options.thinkingTokens };
    }

    try {
      const response = await this.client.post('/messages', requestBody);
      return this.convertFromAnthropicResponse(response.data);
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        throw new Error('Network error: No response received from server');
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }

  async *streamChatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const isAnthropic = isAnthropicCompatible(this.authConfig.baseUrl || '');

    if (isAnthropic) {
      yield* this.anthropicStreamChatCompletion(messages, options);
      return;
    }

    // OpenAI 流式响应
    const model = options.model || this.authConfig.modelName || 'gpt-4';

    const requestBody: any = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      stream: true
    };

    if (options.maxTokens && options.maxTokens > 0) {
      requestBody.max_tokens = options.maxTokens;
    }

    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options.toolChoice || 'auto';
    }

    if (options.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.max_completion_tokens = options.thinkingTokens;
    }

    try {
      const response = await this.client.post('/chat/completions', requestBody, {
        responseType: 'stream'
      });

      let buffer = '';
      let chunkCount = 0;

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');

        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);
            if (data === '[DONE]') {
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                chunkCount++;
                yield delta.content;
              } else if (delta?.reasoning_content) {
                chunkCount++;
                yield delta.reasoning_content;
              }
            } catch (e) {
              // Silently ignore parsing errors
            }
          }
        }
      }

      if (buffer.trim()) {
        const trimmedLine = buffer.trim();
        if (trimmedLine.startsWith('data: ')) {
          const data = trimmedLine.slice(6);
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                yield delta.content;
              } else if (delta?.reasoning_content) {
                yield delta.reasoning_content;
              }
            } catch (e) {
              // Ignore final parsing errors
            }
          }
        }
      }
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        throw new Error('Network error: No response received from server');
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }

  // Anthropic 流式响应
  private async *anthropicStreamChatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const { system, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);

    const requestBody: any = {
      model: options.model || this.authConfig.modelName || 'MiniMax-M2',
      messages: anthropicMessages,
      temperature: options.temperature ?? 1.0,
      stream: true,
      max_tokens: options.maxTokens || 4096
    };

    if (system) {
      requestBody.system = system;
    }

    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: 'object', properties: {} }
      }));
      requestBody.tool_choice = options.toolChoice === 'none' ? { type: 'auto' } : 
        (options.toolChoice || { type: 'auto' });
    }

    if (options.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.thinking = { type: 'enabled', budget_tokens: options.thinkingTokens };
    }

    try {
      const response = await this.client.post('/messages', requestBody, {
        responseType: 'stream'
      });

      let buffer = '';
      let inThinking = false;
      let thinkingBuffer = '';

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === 'event: message_end') continue;

          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(5);

            try {
              const parsed = JSON.parse(data);

              // content_block_start - 开始新块
              if (parsed.type === 'content_block_start') {
                if (parsed.content_block?.type === 'thinking') {
                  inThinking = true;
                  thinkingBuffer = '';
                } else if (parsed.content_block?.type === 'text') {
                  inThinking = false;
                }
              }
              // content_block_delta - 块的增量更新
              else if (parsed.type === 'content_block_delta') {
                if (parsed.delta?.type === 'thinking_delta') {
                  if (parsed.delta.thinking) {
                    thinkingBuffer += parsed.delta.thinking;
                    yield parsed.delta.thinking;
                  }
                } else if (parsed.delta?.type === 'text_delta') {
                  inThinking = false;
                  if (parsed.delta.text) {
                    yield parsed.delta.text;
                  }
                } else if (parsed.delta?.type === 'tool_use_delta') {
                  // 工具调用，不输出到主内容流
                }
              }
              // message_delta - 消息完成
              else if (parsed.type === 'message_delta') {
                // 消息完成
              }
              // content_block_stop - 块完成
              else if (parsed.type === 'content_block_stop') {
                inThinking = false;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        throw new Error('Network error: No response received from server');
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }

  async listModels(): Promise<any[]> {
    try {
      const response = await this.client.get('/models');
      return response.data.data || [];
    } catch (error: any) {
      console.error('Failed to list models:', error);
      return [];
    }
  }

  updateAuthConfig(authConfig: AuthConfig): void {
    this.authConfig = authConfig;
    this.client.defaults.baseURL = authConfig.baseUrl;
    this.client.defaults.headers['Authorization'] = `Bearer ${authConfig.apiKey}`;
  }

  getAuthConfig(): AuthConfig {
    return { ...this.authConfig };
  }

  // 检测消息中是否包含工具调用
  hasToolCalls(messages: Message[]): boolean {
    return messages.some(msg => {
      if (msg.tool_calls && msg.tool_calls.length > 0) return true;
      if (Array.isArray(msg.content)) {
        return msg.content.some(block => 
          block.type === 'tool_use' || 
          (block as any).type === 'tool_result'
        );
      }
      return false;
    });
  }
}

export function detectThinkingKeywords(text: string): 'none' | 'normal' | 'hard' | 'mega' | 'ultra' {
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

export function getThinkingTokens(mode: 'none' | 'normal' | 'hard' | 'mega' | 'ultra'): number {
  const tokensMap = {
    none: 0,
    normal: 2000,
    hard: 4000,
    mega: 10000,
    ultra: 32000
  };
  return tokensMap[mode];
}