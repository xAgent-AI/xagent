import { EventEmitter } from 'events';
import { ChatMessage, SessionOutput } from './types.js';

export interface RemoteChatOptions {
  model?: string;
  conversationId?: string;
  context?: {
    cwd?: string;
    workspace?: string;
    recentFiles?: string[];
  };
}

export interface RemoteChunk {
  type: 'message' | 'done' | 'error';
  content?: string;
  conversationId?: string;
  error?: string;
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
   * 流式聊天 - 发送消息并接收流式响应
   */
  async streamChat(
    messages: ChatMessage[],
    options: RemoteChatOptions = {}
  ): Promise<void> {
    const lastMessage = messages[messages.length - 1];
    const userContent = typeof lastMessage?.content === 'string' 
      ? lastMessage.content 
      : '';

    const requestBody = {
      message: userContent,
      conversationId: options.conversationId,
      context: options.context,
      options: {
        model: options.model
      }
    };

    const url = `${this.agentApi}/chat`;
    console.log('[RemoteAIClient] 发送请求到:', url);
    console.log('[RemoteAIClient] Token 前缀:', this.authToken.substring(0, 20) + '...');
    console.log('[RemoteAIClient] 请求体:', JSON.stringify(requestBody).substring(0, 200));

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
      console.log('[RemoteAIClient] 响应头:', JSON.stringify(Object.fromEntries(response.headers.entries())));

      if (!response.ok) {
        const errorText = await response.text();
        console.log('[RemoteAIClient] 错误响应:', errorText);
        const errorData = JSON.parse(errorText) as { error?: string };
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let messageCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[RemoteAIClient] 流结束，收到消息数:', messageCount);
          this.emit('done');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const chunk: RemoteChunk = JSON.parse(data);
              
              if (chunk.type === 'error') {
                console.log('[RemoteAIClient] 收到错误:', chunk.error);
                this.emit('error', new Error(chunk.error));
                return;
              }
              
              if (chunk.type === 'done') {
                console.log('[RemoteAIClient] 收到完成信号, conversationId:', chunk.conversationId);
                this.emit('done', chunk.conversationId);
                return;
              }
              
              if (chunk.type === 'message' && chunk.content) {
                messageCount++;
                this.emit('chunk', chunk.content);
              }
            } catch (e) {
              console.log('[RemoteAIClient] JSON 解析跳过:', line.substring(0, 50));
            }
          }
        }
      }

    } catch (error) {
      console.log('[RemoteAIClient] 请求异常:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * 非流式聊天
   */
  async chat(
    messages: ChatMessage[],
    options: RemoteChatOptions = {}
  ): Promise<SessionOutput> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];

      this.streamChat(messages, {
        ...options,
        model: options.model
      });

      this.on('chunk', (content: string) => {
        chunks.push(content);
      });

      this.on('done', () => {
        resolve({
          role: 'assistant',
          content: chunks.join(''),
          timestamp: Date.now()
        });
      });

      this.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * 调用 VLM 进行图像理解
   */
  async invokeVLM(
    image: string,
    prompt: string,
    options: RemoteChatOptions = {}
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];

      this.streamVLM(image, prompt, options);

      this.on('chunk', (content: string) => {
        chunks.push(content);
      });

      this.on('done', () => {
        resolve(chunks.join(''));
      });

      this.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * 流式 VLM 调用
   */
  async streamVLM(
    image: string,
    prompt: string,
    options: RemoteChatOptions = {}
  ): Promise<void> {
    const requestBody = {
      image,
      prompt,
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

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取 VLM 响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          this.emit('done');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const chunk: RemoteChunk = JSON.parse(data);
              
              if (chunk.type === 'error') {
                this.emit('error', new Error(chunk.error));
                return;
              }
              
              if (chunk.type === 'done') {
                this.emit('done');
                return;
              }
              
              if (chunk.type === 'message' && chunk.content) {
                this.emit('chunk', chunk.content);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error) {
      this.emit('error', error as Error);
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