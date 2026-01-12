import axios, { AxiosInstance } from 'axios';
import { AuthConfig } from './types.js';

// Message content block type for Anthropic format
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

// 检测是否为 Anthropic 兼容 API（使用 x-api-key 认证头）
function isAnthropicCompatible(baseUrl: string): boolean {
  return baseUrl.includes('anthropic') || 
         baseUrl.includes('minimaxi.com') ||
         baseUrl.includes('minimax.chat');
}

// MiniMax API 路径检测
function detectMiniMaxAPI(baseUrl: string): boolean {
  return baseUrl.includes('minimax.chat') || 
         baseUrl.includes('minimaxi.com');
}

// 获取 MiniMax 的正确端点路径
function getMiniMaxEndpoint(baseUrl: string): { endpoint: string; format: 'anthropic' | 'openai' } {
  // MiniMax Anthropic 格式: https://api.minimax.chat/anthropic + /v1/messages
  if (baseUrl.includes('/anthropic')) {
    return { endpoint: '/v1/messages', format: 'anthropic' };
  }
  // MiniMax OpenAI 格式: https://api.minimaxi.com/v1 + /chat/completions
  if (baseUrl.includes('/v1') && !baseUrl.includes('/anthropic')) {
    return { endpoint: '/chat/completions', format: 'openai' };
  }
  // 默认使用 Anthropic 格式
  return { endpoint: '/v1/messages', format: 'anthropic' };
}

export class AIClient {
  private client: AxiosInstance;
  private authConfig: AuthConfig;

  constructor(authConfig: AuthConfig) {
    this.authConfig = authConfig;
    const isMiniMax = detectMiniMaxAPI(authConfig.baseUrl || '');
    const isAnthropicOfficial = !isMiniMax && isAnthropicCompatible(authConfig.baseUrl || '');
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (isMiniMax) {
      // MiniMax: 使用 x-api-key 认证头
      headers['x-api-key'] = authConfig.apiKey || '';
      headers['anthropic-version'] = '2023-06-01';
    } else if (isAnthropicOfficial) {
      // Anthropic 官方: 使用 x-api-key 认证头
      headers['x-api-key'] = authConfig.apiKey || '';
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      // 其他 OpenAI 兼容: 使用 Bearer token
      headers['Authorization'] = `Bearer ${authConfig.apiKey}`;
    }
    
    this.client = axios.create({
      baseURL: authConfig.baseUrl,
      headers,
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

  async chatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const model = options.model || this.authConfig.modelName || 'gpt-4';
    const isMiniMax = detectMiniMaxAPI(this.authConfig.baseUrl || '');

    if (isMiniMax) {
      return this.minimaxChatCompletion(messages, options);
    }

    const isAnthropic = isAnthropicCompatible(this.authConfig.baseUrl || '');
    if (isAnthropic) {
      return this.anthropicNativeChatCompletion(messages, options);
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

  // Anthropic 官方原生 API（使用 /v1/messages 端点）
  private async anthropicNativeChatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const { system, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);

    const requestBody: any = {
      model: options.model || this.authConfig.modelName || 'claude-sonnet-4-20250514',
      messages: anthropicMessages,
      temperature: options.temperature ?? 1.0,
      stream: false,
      max_tokens: options.maxTokens || 4096
    };

    if (system) {
      requestBody.system = system;
    }

    // Anthropic 原生工具格式
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: 'object', properties: {} }
      }));
      
      // 转换 tool_choice 从 OpenAI 格式到 Anthropic 格式
      const toolChoice = options.toolChoice;
      if (toolChoice === 'none') {
        requestBody.tool_choice = { type: 'auto' };
      } else if (toolChoice && typeof toolChoice === 'object') {
        if (toolChoice.type === 'function' && toolChoice.function) {
          requestBody.tool_choice = { type: 'tool', tool: { name: toolChoice.function.name } };
        } else {
          requestBody.tool_choice = { type: 'auto' };
        }
      } else {
        requestBody.tool_choice = { type: 'auto' };
      }
    }

    // Anthropic thinking 模式
    if (options.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.thinking = { type: 'enabled', budget_tokens: options.thinkingTokens };
    }

    try {
      // 使用 Anthropic 原生端点 /v1/messages
      const response = await this.client.post('/v1/messages', requestBody);
      
      return this.convertFromAnthropicNativeResponse(response.data);
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

  // MiniMax API（根据 baseUrl 自动选择 Anthropic 或 OpenAI 格式）
  private async minimaxChatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const { system, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);
    const { endpoint, format } = getMiniMaxEndpoint(this.authConfig.baseUrl || '');

    const requestBody: any = {
      model: options.model || this.authConfig.modelName || 'MiniMax-M2',
      messages: format === 'anthropic' ? anthropicMessages : messages,
      temperature: options.temperature ?? 1.0,
      stream: false,
      max_tokens: options.maxTokens || 4096
    };

    if (system && format === 'anthropic') {
      requestBody.system = system;
    }

    if (format === 'anthropic') {
      // Anthropic format tools
      if (options.tools && options.tools.length > 0) {
        requestBody.tools = options.tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters || { type: 'object', properties: {} }
        }));
        
        const toolChoice = options.toolChoice;
        if (toolChoice === 'none') {
          requestBody.tool_choice = { type: 'auto' };
        } else if (toolChoice && typeof toolChoice === 'object') {
          if (toolChoice.type === 'function' && toolChoice.function) {
            requestBody.tool_choice = { type: 'tool', tool: { name: toolChoice.function.name } };
          } else {
            requestBody.tool_choice = { type: 'auto' };
          }
        } else {
          requestBody.tool_choice = { type: 'auto' };
        }
      }
    } else {
      // OpenAI 格式的工具
      if (options.tools && options.tools.length > 0) {
        requestBody.tools = options.tools;
        requestBody.tool_choice = options.toolChoice || 'auto';
      }
    }

    try {
      // MiniMax 使用正确的端点
      const response = await this.client.post(endpoint, requestBody);
      
      if (format === 'anthropic') {
        return this.convertFromAnthropicNativeResponse(response.data);
      } else {
        return this.convertFromMiniMaxResponse(response.data);
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

  // 将 Anthropic 原生响应转换为统一格式
  private convertFromAnthropicNativeResponse(anthropicResponse: any): ChatCompletionResponse {
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
      model: anthropicResponse.model || this.authConfig.modelName || 'claude-sonnet-4-20250514',
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
      usage: anthropicResponse.usage ? {
        prompt_tokens: anthropicResponse.usage.input_tokens || 0,
        completion_tokens: anthropicResponse.usage.output_tokens || 0,
        total_tokens: (anthropicResponse.usage.input_tokens || 0) + (anthropicResponse.usage.output_tokens || 0)
      } : undefined
    };
  }

  // 将 MiniMax 响应转换为统一格式
  private convertFromMiniMaxResponse(minimaxResponse: any): ChatCompletionResponse {
    const message = minimaxResponse.choices?.[0]?.message;
    const content = message?.content;
    let textContent = '';
    let reasoningContent = '';
    const toolCalls: any[] = [];

    if (typeof content === 'string') {
      textContent = content.trim();
    } else if (Array.isArray(content)) {
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
    }

    return {
      id: minimaxResponse.id || `minimax-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: minimaxResponse.model || this.authConfig.modelName || 'MiniMax-M2',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textContent,
          reasoning_content: reasoningContent || undefined,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: minimaxResponse.stop_reason === 'end_turn' ? 'stop' : 
                       minimaxResponse.stop_reason === 'max_tokens' ? 'length' : 'stop'
      }],
      usage: minimaxResponse.usage
    };
  }

  async *streamChatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const isMiniMax = detectMiniMaxAPI(this.authConfig.baseUrl || '');

    if (isMiniMax) {
      yield* this.minimaxStreamChatCompletion(messages, options);
      return;
    }

    const isAnthropic = isAnthropicCompatible(this.authConfig.baseUrl || '');
    if (isAnthropic) {
      yield* this.anthropicNativeStreamChatCompletion(messages, options);
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

  // Anthropic 原生流式响应（/v1/messages 端点）
  private async *anthropicNativeStreamChatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const { system, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);

    const requestBody: any = {
      model: options.model || this.authConfig.modelName || 'claude-sonnet-4-20250514',
      messages: anthropicMessages,
      temperature: options.temperature ?? 1.0,
      stream: true,
      max_tokens: options.maxTokens || 4096
    };

    if (system) {
      requestBody.system = system;
    }

    // Anthropic 原生工具格式
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: 'object', properties: {} }
      }));
      
      const toolChoice = options.toolChoice;
      if (toolChoice === 'none') {
        requestBody.tool_choice = { type: 'auto' };
      } else if (toolChoice && typeof toolChoice === 'object') {
        if (toolChoice.type === 'function' && toolChoice.function) {
          requestBody.tool_choice = { type: 'tool', tool: { name: toolChoice.function.name } };
        } else {
          requestBody.tool_choice = { type: 'auto' };
        }
      } else {
        requestBody.tool_choice = { type: 'auto' };
      }
    }

    if (options.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.thinking = { type: 'enabled', budget_tokens: options.thinkingTokens };
    }

    try {
      // Anthropic 原生流式端点 /v1/messages
      const response = await this.client.post('/v1/messages', requestBody, {
        responseType: 'stream'
      });

      let buffer = '';

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Anthropic 流式格式: data: {"type":"content_block_delta",...}
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);

            try {
              const parsed = JSON.parse(data);

              // Anthropic 事件类型
              if (parsed.type === 'content_block_delta') {
                if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
                  yield parsed.delta.text;
                } else if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
                  yield parsed.delta.thinking;
                }
              } else if (parsed.type === 'message_delta') {
                if (parsed.delta?.stop_reason) {
                  // 消息结束
                  return;
                }
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

  // MiniMax 流式响应（根据 baseUrl 自动选择格式）
  private async *minimaxStreamChatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const { system, messages: anthropicMessages } = this.convertToAnthropicFormat(messages);
    const { endpoint, format } = getMiniMaxEndpoint(this.authConfig.baseUrl || '');

    const requestBody: any = {
      model: options.model || this.authConfig.modelName || 'MiniMax-M2',
      messages: format === 'anthropic' ? anthropicMessages : messages,
      temperature: options.temperature ?? 1.0,
      stream: true,
      max_tokens: options.maxTokens || 4096
    };

    if (system && format === 'anthropic') {
      requestBody.system = system;
    }

    if (format === 'anthropic') {
      // Anthropic 格式的工具
      if (options.tools && options.tools.length > 0) {
        requestBody.tools = options.tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters || { type: 'object', properties: {} }
        }));
        
        const toolChoice = options.toolChoice;
        if (toolChoice === 'none') {
          requestBody.tool_choice = { type: 'auto' };
        } else if (toolChoice && typeof toolChoice === 'object') {
          if (toolChoice.type === 'function' && toolChoice.function) {
            requestBody.tool_choice = { type: 'tool', tool: { name: toolChoice.function.name } };
          } else {
            requestBody.tool_choice = { type: 'auto' };
          }
        } else {
          requestBody.tool_choice = { type: 'auto' };
        }
      }
    } else {
      // OpenAI 格式的工具
      if (options.tools && options.tools.length > 0) {
        requestBody.tools = options.tools;
        requestBody.tool_choice = options.toolChoice || 'auto';
      }
    }

    try {
      // MiniMax uses correct endpoint
      const response = await this.client.post(endpoint, requestBody, {
        responseType: 'stream'
      });

      let buffer = '';

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // 根据格式解析不同的流式响应
          if (format === 'anthropic') {
            // Anthropic SSE 格式: data: {"type":"content_block_delta",...}
            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6);

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === 'content_block_delta') {
                  if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
                    yield parsed.delta.text;
                  } else if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
                    yield parsed.delta.thinking;
                  }
                } else if (parsed.type === 'message_delta') {
                  if (parsed.delta?.stop_reason) {
                    return;
                  }
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          } else {
            // OpenAI SSE 格式: data: {...}
            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                  yield delta.content;
                } else if (delta?.reasoning_content) {
                  yield delta.reasoning_content;
                }
              } catch (e) {
                // 忽略解析错误
              }
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
    
    const isMiniMax = detectMiniMaxAPI(authConfig.baseUrl || '');
    const isAnthropic = !isMiniMax && isAnthropicCompatible(authConfig.baseUrl || '');
    
    if (isMiniMax || isAnthropic) {
      // MiniMax/Anthropic: Use x-api-key auth header
      this.client.defaults.headers['x-api-key'] = authConfig.apiKey || '';
      this.client.defaults.headers['anthropic-version'] = '2023-06-01';
      // Clear Bearer header
      delete this.client.defaults.headers['Authorization'];
    } else {
      // OpenAI compatible: Use Bearer token
      this.client.defaults.headers['Authorization'] = `Bearer ${authConfig.apiKey}`;
      // Clear x-api-key header
      delete this.client.defaults.headers['x-api-key'];
      delete this.client.defaults.headers['anthropic-version'];
    }
  }

  getAuthConfig(): AuthConfig {
    return { ...this.authConfig };
  }

  // Check if messages contain tool calls
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