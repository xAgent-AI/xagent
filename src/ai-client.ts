import axios, { AxiosInstance } from 'axios';
import { AuthConfig } from './types.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
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

  async chatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const model = options.model || this.authConfig.modelName || 'gpt-4';

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

  async *streamChatCompletion(
    messages: Message[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
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

        // Keep the last line in buffer if it's incomplete
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
              // Support both content and reasoning_content fields (for GLM-4.7 compatibility)
              if (delta?.content) {
                chunkCount++;
                yield delta.content;
              } else if (delta?.reasoning_content) {
                chunkCount++;
                yield delta.reasoning_content;
              }
            } catch (e) {
              // Silently ignore parsing errors for incomplete chunks
              // They will be accumulated in the buffer and parsed later
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        const trimmedLine = buffer.trim();
        if (trimmedLine.startsWith('data: ')) {
          const data = trimmedLine.slice(6);
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              // Support both content and reasoning_content fields (for GLM-4.7 compatibility)
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
        throw new Error(`Request request: ${error.message}`);
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
