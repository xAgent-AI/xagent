import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { AuthConfig } from './types.js';
import { withRetry, RetryConfig } from './retry.js';

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

// Markdown rendering helper function
export function renderMarkdown(text: string): string {
  // Code block rendering
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `\n┌─[${lang || 'code'}]\n${code.trim().split('\n').map((l: string) => '│ ' + l).join('\n')}\n└─\n`;
  });

  // Inline code rendering
  text = text.replace(/`([^`]+)`/g, '`$1`');

  // Bold rendering
  text = text.replace(/\*\*([^*]+)\*\*/g, '●$1○');

  // Italic rendering
  text = text.replace(/\*([^*]+)\*/g, '/$1/');

  // List rendering
  text = text.replace(/^- (.*$)/gm, '○ $1');
  text = text.replace(/^\d+\. (.*$)/gm, '• $1');

  // Heading rendering
  text = text.replace(/^### (.*$)/gm, '\n━━━ $1 ━━━\n');
  text = text.replace(/^## (.*$)/gm, '\n━━━━━ $1 ━━━━━\n');
  text = text.replace(/^# (.*$)/gm, '\n━━━━━━━ $1 ━━━━━━━\n');

  // Quote rendering
  text = text.replace(/^> (.*$)/gm, '│ │ $1');

  // Link rendering
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1]($2)');

  return text;
}

// Format message content
function formatMessageContent(content: string | Array<any> | undefined): string {
  if (content === undefined || content === null) {
    return '';
  }
  
  if (typeof content === 'string') {
    return renderMarkdown(content);
  }

  const parts: string[] = [];
  let hasToolUse = false;

  for (const block of content) {
    if (block.type === 'text') {
      parts.push(renderMarkdown(block.text || ''));
    } else if (block.type === 'tool_use') {
      hasToolUse = true;
      parts.push(`[🔧 TOOL CALL PENDING: ${block.name}]`);
    } else if (block.type === 'tool_result') {
      const result = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
      parts.push(`[✅ TOOL RESULT]\n${result}`);
    } else if (block.type === 'thinking') {
      parts.push(`[🧠 THINKING]\n${block.thinking || ''}`);
    }
  }

  if (hasToolUse) {
    parts.push('\n[⚠️  Note: Tool calls are executed by the framework, not displayed here]');
  }

  return parts.join('\n');
}

// Display messages by category
export function displayMessages(messages: any[], systemPrompt?: string): void {
  const roleColors: Record<string, string> = {
    system: '🟫 SYSTEM',
    user: '👤 USER',
    assistant: '🤖 ASSISTANT',
    tool: '🔧 TOOL'
  };

  // Display system message first (if there's a separate systemPrompt parameter)
  if (systemPrompt) {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ 🟫 SYSTEM                                                     │');
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log(renderMarkdown(systemPrompt).split('\n').map((l: string) => '│ ' + l).join('\n'));
    console.log('└─────────────────────────────────────────────────────────────┘');
  }

  // Iterate through all messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg.role as string;
    const roleLabel = roleColors[role] || `● ${role.toUpperCase()}`;

    console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
    console.log(`│ ${roleLabel} (${i + 1}/${messages.length})                                          │`);
    console.log('├─────────────────────────────────────────────────────────────┤');

    // Display reasoning_content (if present) - check both camelCase and snake_case
    const reasoningContent = (msg as any).reasoningContent || (msg as any).reasoning_content;
    if (reasoningContent) {
      console.log('│ 🧠 REASONING:');
      console.log('│ ───────────────────────────────────────────────────────────');
      const reasoningLines = renderMarkdown(reasoningContent).split('\n');
      for (const line of reasoningLines.slice(0, 20)) {
        console.log('│ ' + line.slice(0, 62));
      }
      if (reasoningContent.length > 1000) console.log('│ ... (truncated)');
      console.log('│ ───────────────────────────────────────────────────────────');
    }

    // Display main content
    const content = formatMessageContent(msg.content);
    const lines = content.split('\n');

    for (const line of lines.slice(0, 50)) {
      console.log('│ ' + line.slice(0, 62));
    }
    if (lines.length > 50) {
      console.log('│ ... (' + (lines.length - 50) + ' more lines)');
    }

    console.log('└─────────────────────────────────────────────────────────────┘');
  }
}

// Format response content
function formatResponseContent(content: string | Array<any>): string {
  if (typeof content === 'string') {
    return renderMarkdown(content);
  }

  const parts: string[] = [];
  let hasToolUse = false;

  for (const block of content) {
    if (block.type === 'text') {
      parts.push(renderMarkdown(block.text || ''));
    } else if (block.type === 'tool_use') {
      hasToolUse = true;
      // Tool calls are handled via tool_calls field, not shown here
    } else if (block.type === 'tool_result') {
      const result = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
      parts.push(`[✅ TOOL RESULT]\n${result}`);
    } else if (block.type === 'thinking') {
      parts.push(`[🧠 THINKING]\n${block.thinking || ''}`);
    } else if (block.type === 'image') {
      parts.push('[IMAGE]');
    }
  }

  if (hasToolUse) {
    parts.push('\n[⚠️  Note: Tool calls are executed via tool_calls field, not shown here]');
  }

  return parts.join('\n');
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

// Detect if it's Anthropic compatible API（Use x-api-key authentication header）
function isAnthropicCompatible(baseUrl: string): boolean {
  return baseUrl.includes('anthropic') || 
         baseUrl.includes('minimaxi.com') ||
         baseUrl.includes('minimax.chat');
}

// MiniMax API path detection
function detectMiniMaxAPI(baseUrl: string): boolean {
  return baseUrl.includes('minimax.chat') || 
         baseUrl.includes('minimaxi.com');
}

// Get correct endpoint path for MiniMax
function getMiniMaxEndpoint(baseUrl: string): { endpoint: string; format: 'anthropic' | 'openai' } {
  // MiniMax Anthropic format: https://api.minimax.chat/anthropic + /v1/messages
  if (baseUrl.includes('/anthropic')) {
    return { endpoint: '/v1/messages', format: 'anthropic' };
  }
  // MiniMax OpenAI format: https://api.minimaxi.com/v1 + /chat/completions
  if (baseUrl.includes('/v1') && !baseUrl.includes('/anthropic')) {
    return { endpoint: '/chat/completions', format: 'openai' };
  }
  // Default to Anthropic format
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
      // MiniMax: Use x-api-key authentication header
      headers['x-api-key'] = authConfig.apiKey || '';
      headers['anthropic-version'] = '2023-06-01';
    } else if (isAnthropicOfficial) {
      // Anthropic official: Use x-api-key authentication header
      headers['x-api-key'] = authConfig.apiKey || '';
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      // Other OpenAI compatible: 使用 Bearer token
      headers['Authorization'] = `Bearer ${authConfig.apiKey}`;
    }
    
    this.client = axios.create({
      baseURL: authConfig.baseUrl,
      headers,
      timeout: 300000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
  }

  // Convert OpenAI format messages to Anthropic format
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

      // For tool result messages, convert to tool_result block (Anthropic format)
      // This is critical for APIs like MiniMax that use Anthropic format
      if (msg.role === 'tool' && msg.tool_call_id) {
        blocks.push({
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content)
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

      // Handle tool_calls (OpenAI 格式)
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
    const baseUrl = this.authConfig.baseUrl || '';
    const isMiniMax = detectMiniMaxAPI(baseUrl);
    const isAnthropic = isAnthropicCompatible(baseUrl);

    if (isMiniMax) {
      return this.minimaxChatCompletion(messages, options);
    }

    if (isAnthropic) {
      return this.anthropicNativeChatCompletion(messages, options);
    }

    // OpenAI format request
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

    // Debug output（受showAIDebugInfo配置控制）
    const showDebug = this.authConfig.showAIDebugInfo ?? false;
    
    if (showDebug) {
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║                    AI REQUEST DEBUG                      ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`📦 Model: ${model}`);
      console.log(`🌐 Base URL: ${this.authConfig.baseUrl}`);
      console.log(`💬 Total Messages: ${messages.length} items`);
      if (options.temperature !== undefined) console.log(`🌡️  Temperature: ${options.temperature}`);
      if (options.maxTokens) console.log(`📏 Max Tokens: ${options.maxTokens}`);
      if (options.tools?.length) console.log(`🔧 Tools: ${options.tools.length} items`);
      if (options.thinkingTokens) console.log(`🧠 Thinking Tokens: ${options.thinkingTokens}`);
      console.log('─'.repeat(60));
      
      // Separate system messages
      const systemMsgs = messages.filter(m => m.role === 'system');
      const otherMsgs = messages.filter(m => m.role !== 'system');
      
      if (systemMsgs.length > 0) {
        const systemContent = typeof systemMsgs[0].content === 'string' 
          ? systemMsgs[0].content 
          : formatMessageContent(systemMsgs[0].content);
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🟫 SYSTEM                                                     │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log(renderMarkdown(systemContent).split('\n').map(l => '│ ' + l).join('\n'));
        console.log('└─────────────────────────────────────────────────────────────┘');
      }
      
      displayMessages(otherMsgs);
      
      console.log('\n📤 Sending request to API...\n');
    }

    try {
      const response = await this.client.post('/chat/completions', requestBody);
      
      if (showDebug) {
        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║                   AI RESPONSE DEBUG                      ║');
        console.log('╚══════════════════════════════════════════════════════════╝');
        console.log(`🆔 ID: ${response.data.id}`);
        console.log(`🤖 Model: ${response.data.model}`);
        const usage = response.data.usage;
        if (usage) {
          console.log(`📊 Tokens: ${usage.prompt_tokens} (prompt) + ${usage.completion_tokens} (completion) = ${usage.total_tokens} (total)`);
        }
        const choice = response.data.choices?.[0];
        if (choice) {
          console.log(`🏁 Finish Reason: ${choice.finish_reason}`);
          
          console.log('\n┌─────────────────────────────────────────────────────────────┐');
          console.log('│ 🤖 ASSISTANT                                                 │');
          console.log('├─────────────────────────────────────────────────────────────┤');
          
          // Display reasoning_content（如果有）
          if (choice.message.reasoning_content) {
            console.log('│ 🧠 REASONING:');
            console.log('│ ───────────────────────────────────────────────────────────');
            const reasoningLines = renderMarkdown(choice.message.reasoning_content).split('\n');
            for (const line of reasoningLines.slice(0, 15)) {
              console.log('│ ' + line.slice(0, 62));
            }
            if (choice.message.reasoning_content.length > 800) console.log('│ ... (truncated)');
            console.log('│ ───────────────────────────────────────────────────────────');
          }
          
          // Display main content
          const content = formatResponseContent(choice.message.content);
          const lines = content.split('\n');
          console.log('│ 💬 CONTENT:');
          console.log('│ ───────────────────────────────────────────────────────────');
          for (const line of lines.slice(0, 40)) {
            console.log('│ ' + line.slice(0, 62));
          }
          if (lines.length > 40) {
            console.log(`│ ... (${lines.length - 40} more lines)`);
          }
          console.log('└─────────────────────────────────────────────────────────────┘');
        }
        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║                    RESPONSE ENDED                        ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');
      }
      
      return response.data;
    } catch (error: any) {
      // Check if error is retryable (timeout, network error, or 5xx)
      const isRetryable = this.isRetryableError(error);
      if (!isRetryable) {
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

      // Retry with exponential backoff
      const retryResult = await withRetry(async () => {
        const response = await this.client.post('/chat/completions', requestBody);
        if (showDebug) {
          console.log('\n╔══════════════════════════════════════════════════════════╗');
          console.log('║                   AI RESPONSE DEBUG (RETRY)              ║');
          console.log('╚══════════════════════════════════════════════════════════╝');
          console.log(`🆔 ID: ${response.data.id}`);
          console.log(`🤖 Model: ${response.data.model}`);
          const usage = response.data.usage;
          if (usage) {
            console.log(`📊 Tokens: ${usage.prompt_tokens} (prompt) + ${usage.completion_tokens} (completion) = ${usage.total_tokens} (total)`);
          }
          console.log('╔══════════════════════════════════════════════════════════╗');
          console.log('║                    RESPONSE ENDED                        ║');
          console.log('╚══════════════════════════════════════════════════════════╝\n');
        }
        return response.data;
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

  // Anthropic official原生 API（使用 /v1/messages 端点）
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

    // Anthropic native tool format
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: 'object', properties: {} }
      }));
      
      // Convert tool_choice 从 OpenAI 格式到 Anthropic 格式
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

    // Anthropic thinking mode
    if (options.thinkingTokens && options.thinkingTokens > 0) {
      requestBody.thinking = { type: 'enabled', budget_tokens: options.thinkingTokens };
    }

    // Debug output（受showAIDebugInfo配置控制）
    const showDebug = this.authConfig.showAIDebugInfo ?? false;
    
    if (showDebug) {
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║              AI REQUEST DEBUG (ANTHROPIC)                ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`📦 Model: ${requestBody.model}`);
      console.log(`🌐 Base URL: ${this.authConfig.baseUrl}`);
      console.log(`💬 Total Messages: ${anthropicMessages.length} items`);
      if (requestBody.temperature) console.log(`🌡️  Temperature: ${requestBody.temperature}`);
      if (requestBody.max_tokens) console.log(`📏 Max Tokens: ${requestBody.max_tokens}`);
      if (requestBody.tools) console.log(`🔧 Tools: ${requestBody.tools.length} items`);
      if (requestBody.thinking) console.log(`🧠 Thinking Budget: ${requestBody.thinking.budget_tokens}`);
      console.log('─'.repeat(60));
      
      // Display system messages
      if (system) {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🟫 SYSTEM                                                     │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log(renderMarkdown(system).split('\n').map(l => '│ ' + l).join('\n'));
        console.log('└─────────────────────────────────────────────────────────────┘');
      }
      
      // Display user and assistant messages
      displayMessages(anthropicMessages);
      
      console.log('\n📤 Sending to Anthropic API (v1/messages)...\n');
    }

    try {
      // Use Anthropic native endpoint /v1/messages
      const response = await this.client.post('/v1/messages', requestBody);
      
      if (showDebug) {
        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║             AI RESPONSE DEBUG (ANTHROPIC)                ║');
        console.log('╚══════════════════════════════════════════════════════════╝');
        console.log(`🆔 ID: ${response.data.id}`);
        console.log(`🤖 Model: ${response.data.model}`);
        const usage = response.data.usage;
        if (usage) {
          console.log(`📊 Tokens: ${usage.input_tokens} (input) + ${usage.output_tokens} (output) = ${usage.input_tokens + usage.output_tokens} (total)`);
        }
        console.log(`🏁 Stop Reason: ${response.data.stop_reason}`);
        
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🤖 ASSISTANT                                                 │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        
        const content = response.data.content || [];
        const reasoning = content.filter((c: any) => c.type === 'thinking').map((c: any) => c.thinking).join('');
        const textContent = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
        
        // Display thinking
        if (reasoning) {
          console.log('│ 🧠 REASONING:');
          console.log('│ ───────────────────────────────────────────────────────────');
          const reasoningLines = renderMarkdown(reasoning).split('\n');
          for (const line of reasoningLines.slice(0, 15)) {
            console.log('│ ' + line.slice(0, 62));
          }
          if (reasoning.length > 800) console.log('│ ... (truncated)');
          console.log('│ ───────────────────────────────────────────────────────────');
        }
        
        // Display content
        console.log('│ 💬 CONTENT:');
        console.log('│ ───────────────────────────────────────────────────────────');
        const lines = renderMarkdown(textContent).split('\n');
        for (const line of lines.slice(0, 40)) {
          console.log('│ ' + line.slice(0, 62));
        }
        if (lines.length > 40) {
          console.log(`│ ... (${lines.length - 40} more lines)`);
        }
        console.log('└─────────────────────────────────────────────────────────────┘');
        
        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║                    RESPONSE ENDED                        ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');
      }
      
      return this.convertFromAnthropicNativeResponse(response.data);
    } catch (error: any) {
      const isRetryable = this.isRetryableError(error);
      if (!isRetryable) {
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

      const retryResult = await withRetry(async () => {
        const response = await this.client.post('/v1/messages', requestBody);
        if (showDebug) {
          console.log('\n╔══════════════════════════════════════════════════════════╗');
          console.log('║             AI RESPONSE DEBUG (ANTHROPIC RETRY)          ║');
          console.log('╚══════════════════════════════════════════════════════════╝\n');
        }
        return this.convertFromAnthropicNativeResponse(response.data);
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

  // MiniMax API（Automatically select based on baseUrl Anthropic 或 OpenAI 格式）
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
      // OpenAI format tools
      if (options.tools && options.tools.length > 0) {
        requestBody.tools = options.tools;
        requestBody.tool_choice = options.toolChoice || 'auto';
      }
    }

    // Debug output（受showAIDebugInfo配置控制）
    const showDebug = this.authConfig.showAIDebugInfo ?? false;
    
    if (showDebug) {
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║               AI REQUEST DEBUG (MINIMAX)                 ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`📦 Model: ${requestBody.model}`);
      console.log(`🔗 Format: ${format.toUpperCase()} | Endpoint: ${endpoint}`);
      console.log(`🌐 Base URL: ${this.authConfig.baseUrl}`);
      console.log(`💬 Total Messages: ${requestBody.messages.length} items`);
      if (requestBody.temperature) console.log(`🌡️  Temperature: ${requestBody.temperature}`);
      if (requestBody.max_tokens) console.log(`📏 Max Tokens: ${requestBody.max_tokens}`);
      if (requestBody.tools) console.log(`🔧 Tools: ${requestBody.tools.length} items`);
      console.log('─'.repeat(60));
      
      // Display system messages
      if (system && format === 'anthropic') {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🟫 SYSTEM                                                     │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log(renderMarkdown(system).split('\n').map(l => '│ ' + l).join('\n'));
        console.log('└─────────────────────────────────────────────────────────────┘');
      }
      
      // Display other messages
      displayMessages(requestBody.messages);
      
      console.log('\n📤 Sending to MiniMax API...\n');
    }

    try {
      // MiniMax uses correct endpoint
      const response = await this.client.post(endpoint, requestBody);
      
      if (showDebug) {
        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║              AI RESPONSE DEBUG (MINIMAX)                 ║');
        console.log('╚══════════════════════════════════════════════════════════╝');
        console.log(`🆔 ID: ${response.data.id}`);
        console.log(`🤖 Model: ${response.data.model}`);
        const usage = response.data.usage;
        if (usage) {
          console.log(`📊 Tokens: ${usage.prompt_tokens} (prompt) + ${usage.completion_tokens} (completion) = ${usage.total_tokens} (total)`);
        }
        console.log(`🏁 Stop Reason: ${response.data.stop_reason}`);
        
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🤖 ASSISTANT                                                 │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        
        const message = response.data.choices?.[0]?.message;
        const content = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content);
        
        console.log('│ 💬 CONTENT:');
        console.log('│ ───────────────────────────────────────────────────────────');
        const lines = renderMarkdown(content).split('\n');
        for (const line of lines.slice(0, 40)) {
          console.log('│ ' + line.slice(0, 62));
        }
        if (lines.length > 40) {
          console.log(`│ ... (${lines.length - 40} more lines)`);
        }
        console.log('└─────────────────────────────────────────────────────────────┘');
        
        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║                    RESPONSE ENDED                        ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');
      }
      
      if (format === 'anthropic') {
        return this.convertFromAnthropicNativeResponse(response.data);
      } else {
        return this.convertFromMiniMaxResponse(response.data);
      }
    } catch (error: any) {
      const isRetryable = this.isRetryableError(error);
      if (!isRetryable) {
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

      const retryResult = await withRetry(async () => {
        const response = await this.client.post(endpoint, requestBody);
        if (showDebug) {
          console.log('\n╔══════════════════════════════════════════════════════════╗');
          console.log('║              AI RESPONSE DEBUG (MINIMAX RETRY)           ║');
          console.log('╚══════════════════════════════════════════════════════════╝\n');
        }
        if (format === 'anthropic') {
          return this.convertFromAnthropicNativeResponse(response.data);
        } else {
          return this.convertFromMiniMaxResponse(response.data);
        }
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

  // Convert Anthropic native response to unified format
  private convertFromAnthropicNativeResponse(anthropicResponse: any): ChatCompletionResponse {
    const content = anthropicResponse.content || [];
    const message = anthropicResponse.choices?.[0]?.message || {};
    let textContent = '';
    let reasoningContent = '';
    const toolCalls: any[] = [];

    // 首先检查 OpenAI 格式的 tool_calls 字段（某些 API 可能同时返回）
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || '',
            arguments: tc.function?.arguments 
              ? (typeof tc.function.arguments === 'string' 
                  ? tc.function.arguments 
                  : JSON.stringify(tc.function.arguments))
              : '{}'
          }
        });
      }
    }

    // 然后处理 content 数组（Anthropic 格式）
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
                       anthropicResponse.stop_reason === 'max_tokens' ? 'length' : 'tool_calls'
      }],
      usage: anthropicResponse.usage ? {
        prompt_tokens: anthropicResponse.usage.input_tokens || 0,
        completion_tokens: anthropicResponse.usage.output_tokens || 0,
        total_tokens: (anthropicResponse.usage.input_tokens || 0) + (anthropicResponse.usage.output_tokens || 0)
      } : undefined
    };
  }

  // Convert MiniMax response to unified format
  private convertFromMiniMaxResponse(minimaxResponse: any): ChatCompletionResponse {
    const message = minimaxResponse.choices?.[0]?.message;
    const content = message?.content;
    let textContent = '';
    let reasoningContent = '';
    const toolCalls: any[] = [];

    // 首先检查 OpenAI 格式的 tool_calls 字段
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || '',
            arguments: tc.function?.arguments 
              ? (typeof tc.function.arguments === 'string' 
                  ? tc.function.arguments 
                  : JSON.stringify(tc.function.arguments))
              : '{}'
          }
        });
      }
    }

    // 然后处理 content 数组（Anthropic 格式）
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
              name: block.name || '',
              arguments: JSON.stringify(block.input || {})
            }
          });
        }
        // 忽略其他类型的块（如 tool_result、image 等）
      }
    }

    // 安全处理 usage
    const usage = minimaxResponse.usage;
    const normalizedUsage = usage ? {
      prompt_tokens: usage.prompt_tokens || usage.completion_tokens ? (usage.prompt_tokens || 0) : undefined,
      completion_tokens: usage.completion_tokens || usage.prompt_tokens ? (usage.completion_tokens || 0) : undefined,
      total_tokens: usage.total_tokens || (usage.prompt_tokens && usage.completion_tokens) 
        ? usage.prompt_tokens + usage.completion_tokens 
        : undefined
    } : undefined;

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
                       minimaxResponse.stop_reason === 'max_tokens' ? 'length' : 'tool_calls'
      }],
      usage: normalizedUsage
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

    // OpenAI streaming response
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

    // Debug output（受showAIDebugInfo配置控制）
    const showDebug = this.authConfig.showAIDebugInfo ?? false;
    
    if (showDebug) {
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║              AI REQUEST DEBUG (STREAM)                   ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`📦 Model: ${model}`);
      console.log(`🌐 Base URL: ${this.authConfig.baseUrl}`);
      console.log(`💬 Total Messages: ${messages.length} items`);
      if (options.temperature) console.log(`🌡️  Temperature: ${options.temperature}`);
      if (options.maxTokens) console.log(`📏 Max Tokens: ${options.maxTokens}`);
      if (options.tools?.length) console.log(`🔧 Tools: ${options.tools.length} items`);
      console.log('─'.repeat(60));
      
      // Separate and display messages
      const systemMsgs = messages.filter(m => m.role === 'system');
      const otherMsgs = messages.filter(m => m.role !== 'system');
      
      if (systemMsgs.length > 0) {
        const systemContent = typeof systemMsgs[0].content === 'string' 
          ? systemMsgs[0].content 
          : formatMessageContent(systemMsgs[0].content);
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🟫 SYSTEM                                                     │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log(renderMarkdown(systemContent).split('\n').map(l => '│ ' + l).join('\n'));
        console.log('└─────────────────────────────────────────────────────────────┘');
      }
      
      displayMessages(otherMsgs);
      
      console.log('\n📤 Starting stream...\n');
    }

    try {
      const response = await this.client.post('/chat/completions', requestBody, {
        responseType: 'stream'
      });

      console.log('📥 Receiving stream chunks...\n');

      let buffer = '';
      let chunkCount = 0;
      let outputBuffer = '';

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
              if (showDebug) {
                console.log('\n╔══════════════════════════════════════════════════════════╗');
                console.log('║              STREAM COMPLETED                            ║');
                console.log('╚══════════════════════════════════════════════════════════╝');
                console.log(`📦 Total chunks: ${chunkCount}`);
                console.log(`📏 Total output: ${outputBuffer.length} chars`);
                
                console.log('\n┌─────────────────────────────────────────────────────────────┐');
                console.log('│ 🤖 ASSISTANT OUTPUT                                        │');
                console.log('├─────────────────────────────────────────────────────────────┤');
                console.log('│ 💬 CONTENT:');
                console.log('│ ───────────────────────────────────────────────────────────');
                const lines = renderMarkdown(outputBuffer).split('\n');
                for (const line of lines.slice(0, 30)) {
                  console.log('│ ' + line.slice(0, 62));
                }
                if (lines.length > 30) {
                  console.log(`│ ... (${lines.length - 30} more lines)`);
                }
                console.log('└─────────────────────────────────────────────────────────────┘');
                console.log('');
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                chunkCount++;
                outputBuffer += delta.content;
                yield delta.content;
              } else if (delta?.reasoning_content) {
                chunkCount++;
                outputBuffer += delta.reasoning_content;
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
      
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║              STREAM COMPLETED                            ║');
      console.log('╚══════════════════════════════════════════════════════════╝\n');
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

  // Anthropic native streaming response（/v1/messages 端点）
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

    // Anthropic native tool format
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

    // Debug output（受showAIDebugInfo配置控制）
    const showDebug = this.authConfig.showAIDebugInfo ?? false;
    
    if (showDebug) {
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║         AI REQUEST DEBUG (ANTHROPIC STREAM)             ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`📦 Model: ${requestBody.model}`);
      console.log(`🌐 Base URL: ${this.authConfig.baseUrl}`);
      console.log(`💬 Total Messages: ${anthropicMessages.length} items`);
      if (requestBody.temperature) console.log(`🌡️  Temperature: ${requestBody.temperature}`);
      if (requestBody.max_tokens) console.log(`📏 Max Tokens: ${requestBody.max_tokens}`);
      if (requestBody.thinking) console.log(`🧠 Thinking Budget: ${requestBody.thinking.budget_tokens}`);
      console.log('─'.repeat(60));
      
      // Display system messages
      if (system) {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🟫 SYSTEM                                                     │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log(renderMarkdown(system).split('\n').map(l => '│ ' + l).join('\n'));
        console.log('└─────────────────────────────────────────────────────────────┘');
      }
      
      displayMessages(anthropicMessages);
      
      console.log('\n📤 Starting Anthropic stream...\n');
    }

    try {
      // Anthropic native streaming endpoint /v1/messages
      const response = await this.client.post('/v1/messages', requestBody, {
        responseType: 'stream'
      });

      console.log('📥 Receiving Anthropic stream chunks...\n');

      let buffer = '';
      let outputBuffer = '';

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Anthropic streaming format: data: {"type":"content_block_delta",...}
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);

            try {
              const parsed = JSON.parse(data);

              // Anthropic event types
              if (parsed.type === 'content_block_delta') {
                if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
                  outputBuffer += parsed.delta.text;
                  yield parsed.delta.text;
                } else if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
                  outputBuffer += parsed.delta.thinking;
                  yield parsed.delta.thinking;
                }
              } else if (parsed.type === 'message_delta') {
                if (parsed.delta?.stop_reason) {
                  // Message end
                  if (showDebug) {
                    console.log('\n╔══════════════════════════════════════════════════════════╗');
                    console.log('║              STREAM COMPLETED                            ║');
                    console.log('╚══════════════════════════════════════════════════════════╝');
                    console.log(`📏 Total output: ${outputBuffer.length} chars`);
                    
                    console.log('\n┌─────────────────────────────────────────────────────────────┐');
                    console.log('│ 🤖 ASSISTANT OUTPUT                                        │');
                    console.log('├─────────────────────────────────────────────────────────────┤');
                    console.log('│ 💬 CONTENT:');
                    console.log('│ ───────────────────────────────────────────────────────────');
                    const lines = renderMarkdown(outputBuffer).split('\n');
                    for (const line of lines.slice(0, 30)) {
                      console.log('│ ' + line.slice(0, 62));
                    }
                    if (lines.length > 30) {
                      console.log(`│ ... (${lines.length - 30} more lines)`);
                    }
                    console.log('└─────────────────────────────────────────────────────────────┘');
                    console.log('');
                  }
                  return;
                }
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
        }
      }
      
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║              STREAM COMPLETED                            ║');
      console.log('╚══════════════════════════════════════════════════════════╝\n');
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

  // MiniMax streaming response（Automatically select based on baseUrl格式）
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
      // OpenAI format tools
      if (options.tools && options.tools.length > 0) {
        requestBody.tools = options.tools;
        requestBody.tool_choice = options.toolChoice || 'auto';
      }
    }

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║            AI REQUEST DEBUG (MINIMAX STREAM)             ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`📦 Model: ${requestBody.model}`);
    console.log(`🔗 Format: ${format.toUpperCase()} | Endpoint: ${endpoint}`);
    console.log(`🌐 Base URL: ${this.authConfig.baseUrl}`);
    console.log(`💬 Total Messages: ${requestBody.messages.length} items`);
    if (requestBody.temperature) console.log(`🌡️  Temperature: ${requestBody.temperature}`);
    if (requestBody.max_tokens) console.log(`📏 Max Tokens: ${requestBody.max_tokens}`);
    console.log('─'.repeat(60));
    
    // Display system messages
    if (system && format === 'anthropic') {
      console.log('\n┌─────────────────────────────────────────────────────────────┐');
      console.log('│ 🟫 SYSTEM                                                     │');
      console.log('├─────────────────────────────────────────────────────────────┤');
      console.log(renderMarkdown(system).split('\n').map(l => '│ ' + l).join('\n'));
      console.log('└─────────────────────────────────────────────────────────────┘');
    }
    
    displayMessages(requestBody.messages);
    
    console.log('\n📤 Starting MiniMax stream...\n');

    try {
      // MiniMax uses correct endpoint
      const response = await this.client.post(endpoint, requestBody, {
        responseType: 'stream'
      });

      console.log('📥 Receiving MiniMax stream chunks...\n');

      let buffer = '';
      let outputBuffer = '';

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Parse different streaming responses based on format
          if (format === 'anthropic') {
            // Anthropic SSE format: data: {"type":"content_block_delta",...}
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
                    console.log('\n╔══════════════════════════════════════════════════════════╗');
                    console.log('║              STREAM COMPLETED                            ║');
                    console.log('╚══════════════════════════════════════════════════════════╝');
                    console.log(`📏 Total output: ${outputBuffer.length} chars`);
                    
                    console.log('\n┌─────────────────────────────────────────────────────────────┐');
                    console.log('│ 🤖 ASSISTANT OUTPUT                                        │');
                    console.log('├─────────────────────────────────────────────────────────────┤');
                    console.log('│ 💬 CONTENT:');
                    console.log('│ ───────────────────────────────────────────────────────────');
                    const lines = renderMarkdown(outputBuffer).split('\n');
                    for (const line of lines.slice(0, 30)) {
                      console.log('│ ' + line.slice(0, 62));
                    }
                    if (lines.length > 30) {
                      console.log(`│ ... (${lines.length - 30} more lines)`);
                    }
                    console.log('└─────────────────────────────────────────────────────────────┘');
                    console.log('');
                    return;
                  }
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }
          } else {
            // OpenAI SSE format: data: {...}
            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                  outputBuffer += delta.content;
                  yield delta.content;
                } else if (delta?.reasoning_content) {
                  outputBuffer += delta.reasoning_content;
                  yield delta.reasoning_content;
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }
          }
        }
      }
      
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║              STREAM COMPLETED                            ║');
      console.log('╚══════════════════════════════════════════════════════════╝\n');
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

  /**
   * Compress context - generate summary for long conversations
   * Local mode: calls LLM directly via chatCompletion
   */
  async compress(
    messages: Message[],
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<ChatCompletionResponse> {
    return this.chatCompletion(messages, {
      maxTokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.3
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