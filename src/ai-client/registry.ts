import type { AIProvider, AIConfig, Model, ProviderRegistryEntry } from './types.js';

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Global registry for AI providers
 */
class ProviderRegistry {
  private providers = new Map<string, ProviderRegistryEntry>();

  /**
   * Register a provider
   */
  register(type: string, entry: ProviderRegistryEntry): void {
    this.providers.set(type, entry);
  }

  /**
   * Get provider entry
   */
  get(type: string): ProviderRegistryEntry | undefined {
    return this.providers.get(type);
  }

  /**
   * Check if provider is registered
   */
  has(type: string): boolean {
    return this.providers.has(type);
  }

  /**
   * Get all registered types
   */
  keys(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all models from all registered providers
   */
  getAllModels(): Model[] {
    const allModels: Model[] = [];
    for (const entry of this.providers.values()) {
      allModels.push(...entry.models);
    }
    return allModels;
  }
}

/**
 * Global registry instance
 */
export const registry = new ProviderRegistry();

// ============================================================================
// Registration Helpers
// ============================================================================

/**
 * Decorator to register a provider
 */
export function registerProvider(
  type: string,
  models: Model[]
) {
  return function <T extends { new (...args: any[]): AIProvider }>(constructor: T) {
    registry.register(type, {
      create: (config: AIConfig) => new constructor(config),
      models,
    });
    return constructor;
  };
}

/**
 * Get provider entry
 */
export function getProviderEntry(type: string): ProviderRegistryEntry | undefined {
  return registry.get(type);
}

/**
 * List all registered provider types
 */
export function listProviderTypes(): string[] {
  return registry.keys();
}

/**
 * Get all available models
 */
export function getAllModels(): Model[] {
  return registry.getAllModels();
}
