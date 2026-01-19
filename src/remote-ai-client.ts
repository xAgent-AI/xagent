import { EventEmitter } from 'events';
import { ChatMessage, SessionOutput, ToolCall } from './types.js';
import { ChatCompletionResponse, ChatCompletionOptions, Message } from './ai-client.js';
import { getLogger } from './logger.js';

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
  signal?: AbortSignal;
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
    messages: ChatMessage[],
    options: RemoteChatOptions = {}
  ): Promise<SessionOutput> {
    // Pass complete messages array to backend, backend forwards directly to LLM
    const requestBody = {
      messages: messages,  // Pass complete message history
      conversationId: options.conversationId,
      context: options.context,
      options: {
        model: options.model
      },
      toolResults: options.toolResults,
      tools: options.tools
    };

    const url = `${this.agentApi}/chat`;
    if (this.showAIDebugInfo) {
      logger.debug(`[RemoteAIClient] Sending request to: ${url}`);
      logger.debug(`[RemoteAIClient] Token prefix: ${this.authToken.substring(0, 20)}...`);
      logger.debug(`[RemoteAIClient] Message count: ${messages.length}`);
      if (options.tools) {
        logger.debug(`[RemoteAIClient] Tool count: ${options.tools.length}`);
      }
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

      // Check for 401 and throw TokenInvalidError
      if (response.status === 401) {
        throw new TokenInvalidError('Authentication token is invalid or expired. Please log in again.');
      }

      if (!response.ok) {
        const errorText = await response.text();
        if (this.showAIDebugInfo) {
          console.log('[RemoteAIClient] Error response:', errorText);
        }
        const errorData = JSON.parse(errorText) as { error?: string };
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json() as RemoteChatResponse;
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] Received response, content length:', data.content?.length || 0);
        console.log('[RemoteAIClient] toolCalls count:', data.toolCalls?.length || 0);
      }

      return {
        role: 'assistant',
        content: data.content || '',
        toolCalls: data.toolCalls,
        timestamp: Date.now()
      };

    } catch (error) {
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] Request exception:', error);
      }
      throw error;
    }
  }

  /**
   * Unified LLM call interface - same return type as aiClient.chatCompletion
   * Implements transparency: caller doesn't need to know remote vs local mode
   */
  async chatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    // Call existing chat method
    const response = await this.chat(messages, {
      conversationId: undefined,
      tools: options.tools as any,
      toolResults: undefined,
      context: undefined,
      model: options.model
    });

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
   * Invoke VLM for image understanding
   * @param image - base64 image or URL
   * @param prompt - user prompt
   * @param systemPrompt - system prompt (optional, generated and passed by CLI)
   * @param options - other options including AbortSignal
   */
  async invokeVLM(
    image: string,
    prompt: string,
    systemPrompt?: string,
    options: RemoteChatOptions = {}
  ): Promise<string> {
    // Ensure correct image format: requires data:image/xxx;base64, prefix
    // Consistent with local mode
    let imageUrl = image;
    if (typeof image === 'string' && image.length > 0) {
      if (!image.startsWith('data:') && !image.startsWith('http://') && !image.startsWith('https://')) {
        imageUrl = `data:image/png;base64,${image}`;
      }
    }

    // Build VLM messages (CLI generates complete messages, backend forwards)
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
      messages,  // Pass complete messages (including system prompt)
      context: options.context,
      options: {
        model: options.model
      }
    };

    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] VLM sending request to:', this.vlmApi);
    }

    // Handle abort signal
    const controller = options.signal ? new AbortController() : undefined;
    const abortSignal = options.signal || controller?.signal;

    // If external signal is provided, listen to it
    if (options.signal) {
      options.signal.addEventListener?.('abort', () => controller?.abort());
    }

    try {
      const response = await fetch(this.vlmApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal
      });

      // Check for 401 and throw TokenInvalidError
      if (response.status === 401) {
        throw new TokenInvalidError('Authentication token is invalid or expired. Please log in again.');
      }

      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] VLM response status:', response.status);
      }

      if (!response.ok) {
        const errorText = await response.text();
        const errorData = JSON.parse(errorText) as { error?: string };
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json() as RemoteVLMResponse;
      return data.content || '';

    } catch (error) {
      if (this.showAIDebugInfo) {
        console.log('[RemoteAIClient] VLM request exception:', error);
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
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if response indicates token is invalid (401)
   * If so, throw TokenInvalidError for the session to handle re-authentication
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      return response.json() as Promise<T>;
    }

    if (response.status === 401) {
      throw new TokenInvalidError('Authentication token is invalid or expired. Please log in again.');
    }

    const errorText = await response.text();
    const errorData = JSON.parse(errorText) as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  async getConversations(): Promise<any[]> {
    const url = `${this.agentApi}/conversations`;
    if (this.showAIDebugInfo) {
      console.log('[RemoteAIClient] Getting conversation list:', url);
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to get conversation list');
    }

    const data = await response.json() as { conversations?: any[] };
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

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to get conversation details');
    }

    const data = await response.json() as { conversation?: any };
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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      },
      body: JSON.stringify({ title })
    });

    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }

    const data = await response.json() as { conversation?: any };
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

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
  }
}
