import { EventEmitter } from 'events';
import { ChatMessage, SessionOutput, ToolCall } from './types.js';
import { ChatCompletionResponse, ChatCompletionOptions, Message } from './ai-client.js';

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
 * 远程 AI 客户端 - 用于与 xagent-web 服务通信
 */
export class RemoteAIClient extends EventEmitter {
  private authToken: string;
  private webBaseUrl: string;
  private agentApi: string;
  private vlmApi: string;

  constructor(authToken: string, webBaseUrl: string) {
    super();
    this.authToken = authToken;
    this.webBaseUrl = webBaseUrl.replace(/\/$/, ''); // 移除末尾斜杠
    this.agentApi = `${this.webBaseUrl}/api/agent`;
    this.vlmApi = `${this.webBaseUrl}/api/agent/vlm`;

    console.log('[RemoteAIClient] 初始化完成');
    console.log('[RemoteAIClient] Web Base URL:', this.webBaseUrl);
    console.log('[RemoteAIClient] Agent API:', this.agentApi);
    console.log('[RemoteAIClient] VLM API:', this.vlmApi);
  }

  /**
   * 非流式聊天 - 发送消息并接收完整响应
   */
  async chat(
    messages: ChatMessage[],
    options: RemoteChatOptions = {}
  ): Promise<SessionOutput> {
    // 传递完整的 messages 数组给后端，后端直接转发给 LLM
    const requestBody = {
      messages: messages,  // 传递完整消息历史
      conversationId: options.conversationId,
      context: options.context,
      options: {
        model: options.model
      },
      toolResults: options.toolResults,
      tools: options.tools
    };

    const url = `${this.agentApi}/chat`;
    console.log('[RemoteAIClient] 发送请求到:', url);
    console.log('[RemoteAIClient] Token 前缀:', this.authToken.substring(0, 20) + '...');
    console.log('[RemoteAIClient] 消息数量:', messages.length);
    if (options.tools) {
      console.log('[RemoteAIClient] 发送工具数量:', options.tools.length);
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

      console.log('[RemoteAIClient] 响应状态:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.log('[RemoteAIClient] 错误响应:', errorText);
        const errorData = JSON.parse(errorText) as { error?: string };
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json() as RemoteChatResponse;
      console.log('[RemoteAIClient] 收到响应, content 长度:', data.content?.length || 0);
      console.log('[RemoteAIClient] toolCalls 数量:', data.toolCalls?.length || 0);

      return {
        role: 'assistant',
        content: data.content || '',
        toolCalls: data.toolCalls,
        timestamp: Date.now()
      };

    } catch (error) {
      console.log('[RemoteAIClient] 请求异常:', error);
      throw error;
    }
  }

  /**
   * 统一 LLM 调用接口 - 与 aiClient.chatCompletion 返回类型相同
   * 实现透明性：调用方不需要关心是远程还是本地模式
   */
  async chatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    // 调用现有的 chat 方法
    const response = await this.chat(messages, {
      conversationId: undefined,
      tools: options.tools as any,
      toolResults: undefined,
      context: undefined,
      model: options.model
    });

    // 转换为 ChatCompletionResponse 格式（与本地模式一致）
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
   * 调用 VLM 进行图像理解
   * @param image - base64 图片或 URL
   * @param prompt - 用户提示词
   * @param systemPrompt - 系统提示词（可选，CLI 生成并传递）
   * @param options - 其他选项
   */
  async invokeVLM(
    image: string,
    prompt: string,
    systemPrompt?: string,
    options: RemoteChatOptions = {}
  ): Promise<string> {
    // 确保图片格式正确：需要 data:image/xxx;base64, 前缀
    // 与本地模式保持一致
    let imageUrl = image;
    if (typeof image === 'string' && image.length > 0) {
      if (!image.startsWith('data:') && !image.startsWith('http://') && !image.startsWith('https://')) {
        imageUrl = `data:image/png;base64,${image}`;
      }
    }

    // 构建 VLM 消息（CLI 生成完整消息，后端透传）
    const messages = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ];

    const requestBody = {
      messages,  // 传递完整消息（包含 system prompt）
      context: options.context,
      options: {
        model: options.model
      }
    };

    console.log('[RemoteAIClient] VLM 发送请求到:', this.vlmApi);

    try {
      const response = await fetch(this.vlmApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify(requestBody)
      });

      console.log('[RemoteAIClient] VLM 响应状态:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        const errorData = JSON.parse(errorText) as { error?: string };
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json() as RemoteVLMResponse;
      return data.content || '';

    } catch (error) {
      console.log('[RemoteAIClient] VLM 请求异常:', error);
      throw error;
    }
  }

  /**
   * 获取对话列表
   */
  async getConversations(): Promise<any[]> {
    const url = `${this.agentApi}/conversations`;
    console.log('[RemoteAIClient] 获取对话列表:', url);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('获取对话列表失败');
    }

    const data = await response.json() as { conversations?: any[] };
    return data.conversations || [];
  }

  /**
   * 获取对话详情
   */
  async getConversation(conversationId: string): Promise<any> {
    const url = `${this.agentApi}/conversations/${conversationId}`;
    console.log('[RemoteAIClient] 获取对话详情:', url);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('获取对话详情失败');
    }

    const data = await response.json() as { conversation?: any };
    return data.conversation;
  }

  /**
   * 创建新对话
   */
  async createConversation(title?: string): Promise<any> {
    const url = `${this.agentApi}/conversations`;
    console.log('[RemoteAIClient] 创建对话:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      },
      body: JSON.stringify({ title })
    });

    if (!response.ok) {
      throw new Error('创建对话失败');
    }

    const data = await response.json() as { conversation?: any };
    return data.conversation;
  }

  /**
   * 删除对话
   */
  async deleteConversation(conversationId: string): Promise<void> {
    const url = `${this.agentApi}/conversations/${conversationId}`;
    console.log('[RemoteAIClient] 删除对话:', url);

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('删除对话失败');
    }
  }
}