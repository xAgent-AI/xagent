/**
 * AI Client Factory
 * Creates mode-aware AI client (local or remote) based on authentication configuration.
 *
 * Usage:
 *   const { createAIClient } = await import('./ai-client-factory.js');
 *   const aiClient = createAIClient(authConfig);
 */

import { AIClient, ChatCompletionResponse, ChatCompletionOptions, Message } from './ai-client.js';
import { RemoteAIClient } from './remote-ai-client.js';
import { AuthConfig, AuthType } from './types.js';

/**
 * Unified AI client interface for both local and remote modes.
 * Provides consistent API regardless of the underlying implementation.
 */
export interface AIClientInterface {
  chatCompletion(messages: Message[], options?: ChatCompletionOptions): Promise<ChatCompletionResponse>;
  compress(messages: Message[], options?: { maxTokens?: number; temperature?: number }): Promise<ChatCompletionResponse>;
}

/**
 * Create AI client based on authentication configuration.
 *
 * @param authConfig - Authentication configuration from config manager
 * @returns AIClientInterface - Unified AI client interface
 *
 * Behavior:
 *   - OAUTH_XAGENT (remote mode): Creates RemoteAIClient that forwards requests to web backend
 *   - OPENAI_COMPATIBLE (local mode): Creates local AIClient for direct API calls
 */
export function createAIClient(authConfig: AuthConfig): AIClientInterface {
  if (authConfig.type === AuthType.OAUTH_XAGENT) {
    const webBaseUrl = authConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
    return new RemoteAIClient(
      authConfig.apiKey || '',
      webBaseUrl,
      authConfig.showAIDebugInfo ?? false
    );
  }
  return new AIClient(authConfig);
}
