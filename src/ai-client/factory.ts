import type { AIProvider, AIConfig, RemoteAIProvider, Model } from './types.js';
import { isOpenAIConfig, isAnthropicConfig, isRemoteConfig } from './types.js';
import { createOpenAIProvider } from './providers/openai.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createRemoteProvider } from './providers/remote.js';
import { getAllModels, listProviderTypes } from './registry.js';

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * AI Provider Factory
 * Creates provider instances based on configuration
 */
export class ProviderFactory {
  /**
   * Create a provider instance from configuration
   */
  static create(config: AIConfig): AIProvider {
    if (isOpenAIConfig(config)) {
      return createOpenAIProvider(config);
    }

    if (isAnthropicConfig(config)) {
      return createAnthropicProvider(config);
    }

    if (isRemoteConfig(config)) {
      return createRemoteProvider(config);
    }

    throw new Error(`Unknown provider type: ${(config as any).type}`);
  }

  /**
   * Create a remote provider instance (with task management)
   */
  static createRemote(config: AIConfig): RemoteAIProvider {
    if (!isRemoteConfig(config)) {
      throw new Error('createRemote requires a remote configuration');
    }
    return createRemoteProvider(config);
  }

  /**
   * Get all available models
   */
  static getModels(): Model[] {
    return getAllModels();
  }

  /**
   * Get available provider types
   */
  static getProviderTypes(): string[] {
    return listProviderTypes();
  }

  /**
   * Check if provider type is supported
   */
  static isSupported(type: string): boolean {
    const types = listProviderTypes();
    return types.includes(type);
  }

  /**
   * Get default configuration for a provider type
   */
  static getDefaultConfig(type: string, apiKey?: string, baseUrl?: string): AIConfig {
    switch (type) {
      case 'openai':
        return {
          type: 'openai',
          apiKey,
          baseUrl: baseUrl || 'https://api.openai.com/v1',
        };

      case 'anthropic':
        return {
          type: 'anthropic',
          apiKey,
          baseUrl: baseUrl || 'https://api.anthropic.com',
        };

      case 'remote':
        return {
          type: 'remote',
          authToken: apiKey,
          baseUrl: baseUrl || 'https://app.xagent.cn',
        };

      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
}

// ============================================================================
// Factory Helpers
// ============================================================================

/**
 * Get all available models
 */
export function getModels(): Model[] {
  return ProviderFactory.getModels();
}

/**
 * Get available provider types
 */
export function getProviderTypes(): string[] {
  return ProviderFactory.getProviderTypes();
}
