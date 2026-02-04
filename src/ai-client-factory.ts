/**
 * AI Client Factory
 * Creates mode-aware AI client (local or remote) based on authentication configuration.
 *
 * This module provides a unified interface for different AI providers.
 * Supports OpenAI, Anthropic (including MiniMax), and Remote (xAgent Web Service).
 *
 * Usage:
 *   import { createAIClient, type AIClientInterface } from './ai-client-factory.js';
 *   const aiClient = createAIClient(authConfig);
 *   const response = await aiClient.chatCompletion(messages, { model: 'gpt-4' });
 */

import type { Message, CompletionOptions, CompletionResponse, AIConfig, RemoteTaskManager } from './ai-client/types.js';
import { AuthConfig, AuthType } from './types.js';
import { ProviderFactory, createOpenAI, createAnthropic, createRemote, type AIProvider } from './ai-client/index.js';
import type { RemoteAIProvider } from './ai-client/types.js';

/**
 * Unified AI client interface for both local and remote modes.
 * Provides consistent API regardless of the underlying implementation.
 * Includes optional methods for remote task management.
 */
export interface AIClientInterface {
  chatCompletion(messages: Message[], options?: CompletionOptions): Promise<CompletionResponse>;
  compress(messages: Message[], options?: { maxTokens?: number; temperature?: number }): Promise<CompletionResponse>;
  // Optional remote task management methods (only available in remote mode)
  completeTask?(taskId: string): Promise<void>;
  cancelTask?(taskId: string): Promise<void>;
  failTask?(taskId: string, reason: 'timeout' | 'failure'): Promise<void>;
}

/**
 * Adapter to make AIProvider compatible with AIClientInterface
 */
class ProviderAdapter implements AIClientInterface {
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  async chatCompletion(messages: Message[], options?: CompletionOptions): Promise<CompletionResponse> {
    return this.provider.complete(messages, options);
  }

  async compress(messages: Message[], options?: { model?: string; maxTokens?: number; temperature?: number }): Promise<CompletionResponse> {
    return this.provider.complete(messages, {
      model: options?.model,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });
  }

  // Optional methods - not available in local mode
  completeTask?(taskId: string): Promise<void> {
    throw new Error('completeTask is only available in remote mode');
  }

  cancelTask?(taskId: string): Promise<void> {
    throw new Error('cancelTask is only available in remote mode');
  }

  failTask?(taskId: string, reason: 'timeout' | 'failure'): Promise<void> {
    throw new Error('failTask is only available in remote mode');
  }
}

/**
 * Adapter for remote provider with task management
 */
class RemoteProviderAdapter implements AIClientInterface, RemoteTaskManager {
  private provider: RemoteAIProvider;

  constructor(provider: RemoteAIProvider) {
    this.provider = provider;
  }

  async chatCompletion(messages: Message[], options?: CompletionOptions): Promise<CompletionResponse> {
    return this.provider.complete(messages, options);
  }

  async compress(messages: Message[], options?: { model?: string; maxTokens?: number; temperature?: number }): Promise<CompletionResponse> {
    return this.provider.complete(messages, {
      model: options?.model,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });
  }

  async completeTask(taskId: string): Promise<void> {
    return this.provider.completeTask(taskId);
  }

  async cancelTask(taskId: string): Promise<void> {
    return this.provider.cancelTask(taskId);
  }

  async failTask(taskId: string, reason: 'timeout' | 'failure'): Promise<void> {
    return this.provider.failTask(taskId, reason);
  }
}

/**
 * Create AI client based on authentication configuration.
 *
 * @param authConfig - Authentication configuration from config manager
 * @returns AIClientInterface - Unified AI client interface
 *
 * Behavior:
 *   - OAUTH_XAGENT (remote mode): Creates Remote provider that forwards requests to web backend
 *   - OPENAI_COMPATIBLE (local mode): Creates OpenAI or Anthropic provider for direct API calls
 *   - API_KEY: Creates OpenAI provider with custom baseUrl
 */
export function createAIClient(authConfig: AuthConfig): AIClientInterface {
  let config: AIConfig;

  if (authConfig.type === AuthType.OAUTH_XAGENT) {
    // Remote mode: use xAgent web service
    config = {
      type: 'remote',
      authToken: authConfig.apiKey || '',
      baseUrl: authConfig.xagentApiBaseUrl || 'https://app.xagent.cn',
    };
  } else if (authConfig.baseUrl?.includes('anthropic') || 
             authConfig.baseUrl?.includes('minimax') ||
             authConfig.baseUrl?.includes('minimaxi')) {
    // Anthropic compatible mode (includes MiniMax)
    config = {
      type: 'anthropic',
      apiKey: authConfig.apiKey || '',
      baseUrl: authConfig.baseUrl || 'https://api.anthropic.com',
      model: authConfig.modelName || 'claude-sonnet-4-20250514',
    };
  } else {
    // Default to OpenAI compatible mode
    config = {
      type: 'openai',
      apiKey: authConfig.apiKey || '',
      baseUrl: authConfig.baseUrl || 'https://api.openai.com/v1',
      model: authConfig.modelName || 'gpt-4o',
    };
  }

  const provider = ProviderFactory.create(config);

  // Use RemoteProviderAdapter for remote mode to support task management
  if (config.type === 'remote') {
    const remoteProvider = ProviderFactory.createRemote(config);
    return new RemoteProviderAdapter(remoteProvider);
  }

  return new ProviderAdapter(provider);
}

/**
 * Create AI provider directly from config (new API)
 */
export function createAIProvider(config: AIConfig): AIProvider {
  return ProviderFactory.create(config);
}

/**
 * Get all available models from all providers
 */
export function getAllModels() {
  return ProviderFactory.getModels();
}

/**
 * Get available provider types
 */
export function getProviderTypes(): string[] {
  return ProviderFactory.getProviderTypes();
}