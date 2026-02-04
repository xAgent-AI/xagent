// ============================================================================
// AI Module - Unified Entry Point
// ============================================================================
//
// This module provides a unified interface for different AI providers.
// Supports OpenAI, Anthropic (including MiniMax), and Remote (xAgent Web Service).
//
// Usage:
//   import { createProvider, type AIProvider } from './ai-client/index.js';
//
//   const provider = createProvider({
//     type: 'anthropic',
//     apiKey: process.env.ANTHROPIC_API_KEY,
//     baseUrl: 'https://api.minimax.chat/anthropic',  // MiniMax example
//   });
//
//   const response = await provider.complete(messages, { model: 'MiniMax-M2' });
//
// ============================================================================

// Types
export * from './types.js';

// Registry
export * from './registry.js';

// Factory
export * from './factory.js';

// Providers
export { OpenAIProvider, createOpenAIProvider } from './providers/openai.js';
export { AnthropicProvider, createAnthropicProvider } from './providers/anthropic.js';
export { RemoteProvider, createRemoteProvider } from './providers/remote.js';

// ============================================================================
// Convenience Functions
// ============================================================================

import type { AIProvider, AIConfig } from './types.js';
import { ProviderFactory } from './factory.js';

/**
 * Create an AI provider from configuration
 */
export function createProvider(config: AIConfig): AIProvider {
  return ProviderFactory.create(config);
}

/**
 * Get all available models
 */
export function getAllModels() {
  return ProviderFactory.getModels();
}

/**
 * Get available provider types
 */
export function getProviderTypes() {
  return ProviderFactory.getProviderTypes();
}
