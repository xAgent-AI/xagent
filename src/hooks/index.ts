/**
 * Hooks Module - Lifecycle hooks for xAgent CLI extensibility
 *
 * This module implements a hooks system similar to Claude Code's hooks feature,
 * allowing users to define shell commands, HTTP endpoints, or LLM prompts that
 * execute automatically at specific points in the agent lifecycle.
 *
 * Supported hook events:
 * - SessionStart: When a session begins or resumes
 * - SessionEnd: When a session terminates
 * - UserPromptSubmit: When user submits a prompt, before processing
 * - PreToolUse: Before a tool call executes (can block it)
 * - PostToolUse: After a tool call succeeds
 * - PostToolUseFailure: After a tool call fails
 * - PermissionRequest: When a permission dialog appears
 * - Notification: When xAgent sends a notification
 * - SubagentStart: When a subagent is spawned
 * - SubagentStop: When a subagent finishes
 * - Stop: When xAgent finishes responding
 * - PreCompact: Before context compaction
 * - PostCompact: After context compaction completes
 */

import { spawn } from 'child_process';
import axios from 'axios';
import fs from 'fs';
import {
  HookEventName,
  HooksConfig,
  HookHandler,
  HookInput,
  HookOutput,
  HookExecutionResult,
  CommandHookHandler,
  HttpHookHandler,
  PromptHookHandler,
  AgentHookHandler,
  PreToolUseHookInput,
  PermissionRequestHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  NotificationHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  PreCompactHookInput,
} from '../types.js';
import { getLogger } from '../logger.js';
import { getShellConfig } from '../shell.js';

const logger = getLogger();

/**
 * Default timeouts for different hook types (in seconds)
 */
const DEFAULT_TIMEOUTS = {
  command: 600,
  http: 30,
  prompt: 30,
  agent: 60,
};

/**
 * HookManager - Manages the lifecycle hooks system
 *
 * Responsibilities:
 * 1. Load hooks from configuration files (global, project, local)
 * 2. Match hooks against events based on matchers
 * 3. Execute hooks (command, http, prompt, agent)
 * 4. Handle hook outputs and decisions
 * 5. Support async hooks that run in background
 * 6. Prevent infinite loops in Stop hooks
 */
export class HookManager {
  private hooks: HooksConfig = {};
  private projectRoot: string;
  private sessionId: string;
  private onceHooks: Set<string> = new Set();  // Track hooks that should run only once
  private envVars: Record<string, string>;
  private stopHookActive: boolean = false;  // Prevent infinite loops in Stop hooks
  private disabled: boolean = false;  // Global disable flag

  constructor(projectRoot: string, sessionId: string) {
    this.projectRoot = projectRoot;
    this.sessionId = sessionId;
    this.envVars = {
      // Claude Code compatible env vars
      CLAUDE_PROJECT_DIR: projectRoot,
      CLAUDE_SESSION_ID: sessionId,
      CLAUDE_CWD: projectRoot,
      // XAgent specific env vars
      XAGENT_PROJECT_DIR: projectRoot,
      XAGENT_SESSION_ID: sessionId,
      XAGENT_CWD: projectRoot,
    };
  }

  /**
   * Set whether hooks are globally disabled
   */
  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
  }

  /**
   * Check if hooks are globally disabled
   */
  isDisabled(): boolean {
    return this.disabled;
  }

  /**
   * Set stop_hook_active flag to prevent infinite loops
   */
  setStopHookActive(active: boolean): void {
    this.stopHookActive = active;
  }

  /**
   * Load hooks from configuration
   */
  loadHooks(config: HooksConfig): void {
    // Check for disableAllHooks flag
    if ((config as any).disableAllHooks === true) {
      this.disabled = true;
      logger.debug('[HOOKS] All hooks disabled by disableAllHooks flag');
      return;
    }
    this.hooks = { ...this.hooks, ...config };
    logger.debug('[HOOKS] Loaded hooks config:', JSON.stringify(this.hooks, null, 2));
  }

  /**
   * Load hooks from a JSON file
   */
  loadHooksFromFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);
      if (config.hooks) {
        this.loadHooks(config.hooks);
        logger.debug(`[HOOKS] Loaded hooks from file: ${filePath}`);
        return true;
      }
      // Check for disableAllHooks flag at top level
      if (config.disableAllHooks === true) {
        this.disabled = true;
        logger.debug('[HOOKS] All hooks disabled by disableAllHooks flag');
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`[HOOKS] Failed to load hooks from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get the matcher value from hook input based on event type
   */
  private getMatcherValue(input: HookInput): string {
    switch (input.hookEventName) {
      case 'PreToolUse':
      case 'PostToolUse':
      case 'PostToolUseFailure':
      case 'PermissionRequest':
        return (input as PreToolUseHookInput | PermissionRequestHookInput).tool_name;
      case 'SessionStart':
        return (input as SessionStartHookInput).startReason;
      case 'SessionEnd':
        return (input as SessionEndHookInput).endReason;
      case 'Notification':
        return (input as NotificationHookInput).notification_type;
      case 'SubagentStart':
        return (input as SubagentStartHookInput).agent_type;
      case 'SubagentStop':
        return (input as SubagentStopHookInput).agent_type;
      case 'PreCompact':
        return (input as PreCompactHookInput).trigger;
      default:
        // Events that don't support matchers
        return '*';
    }
  }

  /**
   * Check if a matcher matches the input
   */
  private matcherMatches(matcher: string | undefined, input: HookInput): boolean {
    // No matcher means match all
    if (!matcher || matcher === '*' || matcher === '') {
      return true;
    }

    const value = this.getMatcherValue(input);
    if (value === '*') {
      // Event doesn't support matchers
      return true;
    }

    try {
      const regex = new RegExp(`^(${matcher})$`);
      return regex.test(value);
    } catch (error) {
      logger.error(`[HOOKS] Invalid matcher regex: ${matcher} - ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get matching handlers for an event
   */
  private getMatchingHandlers(eventName: HookEventName, input: HookInput): HookHandler[] {
    const matcherGroups = this.hooks[eventName];
    if (!matcherGroups || matcherGroups.length === 0) {
      return [];
    }

    const handlers: HookHandler[] = [];
    for (const group of matcherGroups) {
      if (this.matcherMatches(group.matcher, input)) {
        for (const handler of group.hooks) {
          // Create unique key for once hooks
          const handlerKey = `${eventName}:${group.matcher ?? '*'}:${handler.type}:${JSON.stringify(handler)}`;

          // Skip if this hook should only run once and already has
          if (handler.once && this.onceHooks.has(handlerKey)) {
            continue;
          }

          handlers.push(handler);

          // Mark Once hooks as executed
          if (handler.once) {
            this.onceHooks.add(handlerKey);
          }
        }
      }
    }

    return handlers;
  }

  /**
   * Execute hooks for an event
   */
  async executeHooks(eventName: HookEventName, input: Omit<HookInput, 'hookEventName' | 'session_id' | 'timestamp'>): Promise<HookExecutionResult> {
    // Check if hooks are globally disabled
    if (this.disabled) {
      return { executed: false, results: [] };
    }

    // Check for stop hook infinite loop prevention
    if (eventName === 'Stop' && this.stopHookActive) {
      logger.debug('[HOOKS] Skipping Stop hook - stop_hook_active is true (preventing infinite loop)');
      return { executed: false, results: [] };
    }

    const fullInput: HookInput = {
      ...input,
      hookEventName: eventName,
      session_id: this.sessionId,
      timestamp: Date.now(),
      // Add stop_hook_active to Stop hook input so hooks can detect re-entry
      stop_hook_active: eventName === 'Stop' ? this.stopHookActive : undefined,
    } as HookInput;

    const handlers = this.getMatchingHandlers(eventName, fullInput);

    if (handlers.length === 0) {
      return { executed: false, results: [] };
    }

    logger.debug(`[HOOKS] Executing ${handlers.length} handler(s) for event: ${eventName}`);

    const results: HookExecutionResult['results'] = [];
    let finalDecision: 'allow' | 'block' | undefined;
    let blockReason: string | undefined;
    let modifiedInput: Record<string, unknown> | undefined;

    // Separate async and blocking handlers
    const asyncHandlers: HookHandler[] = [];
    const blockingHandlers: HookHandler[] = [];

    for (const handler of handlers) {
      if (handler.type === 'command' && (handler as CommandHookHandler).async) {
        asyncHandlers.push(handler);
      } else {
        blockingHandlers.push(handler);
      }
    }

    // Execute async handlers in background (fire and Forget)
    for (const handler of asyncHandlers) {
      this.executeHandlerAsync(handler, fullInput).catch((error) => {
        logger.error(`[HOOKS] Async handler failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    // Execute blocking handlers and collect their results
    for (const handler of blockingHandlers) {
      try {
        const output = await this.executeHandler(handler, fullInput);
        results.push({ handler, output });

        // Process output
        if (output) {
          // Check for block decision
          if (output.decision === 'block') {
            finalDecision = 'block';
            blockReason = output.reason;
          }

          // Check for hook-specific decisions
          if (output.hookSpecificOutput) {
            const { permissionDecision, permissionDecisionReason, modifiedToolInput, modifiedUserPrompt } = output.hookSpecificOutput;

            if (permissionDecision === 'deny') {
              finalDecision = 'block';
              blockReason = permissionDecisionReason || output.reason || 'Permission denied by hook';
            } else if (permissionDecision === 'ask') {
              // Hook wants to ask user, but we'll treat this as allow for now
              // The actual permission request will be handled by the normal flow
            }

            // Handle modified input
            if (modifiedToolInput) {
              modifiedInput = { ...modifiedInput, ...modifiedToolInput };
            }
            if (modifiedUserPrompt) {
              modifiedInput = { ...modifiedInput, user_prompt: modifiedUserPrompt };
            }
          }
        }
      } catch (error) {
        logger.error(`[HOOKS] Handler execution failed: ${error instanceof Error ? error.message : String(error)}`);
        results.push({ handler, error: error instanceof Error ? error : new Error(String(error)) });
      }
    }

    // Default to allow if no blocking decision was made
    if (!finalDecision) {
      finalDecision = 'allow';
    }

    return {
      executed: true,
      results,
      finalDecision,
      blockReason,
      modifiedInput,
    };
  }

  /**
   * Execute a single handler
   */
  private async executeHandler(handler: HookHandler, input: HookInput): Promise<HookOutput | undefined> {
    const timeout = handler.timeout ?? DEFAULT_TIMEOUTS[handler.type];

    switch (handler.type) {
      case 'command':
        return this.executeCommandHandler(handler, input, timeout);
      case 'http':
        return this.executeHttpHandler(handler, input, timeout);
      case 'prompt':
        return this.executePromptHandler(handler, input, timeout);
      case 'agent':
        return this.executeAgentHandler(handler, input, timeout);
      default:
        throw new Error(`Unknown handler type: ${(handler as any).type}`);
    }
  }

  /**
   * Execute a handler asynchronously (Fire and Forget)
   */
  private async executeHandlerAsync(handler: HookHandler, input: HookInput): Promise<void> {
    if (handler.statusMessage) {
      logger.info(`[HOOKS] ${handler.statusMessage}`);
    }

    try {
      await this.executeHandler(handler, input);
    } catch (error) {
      logger.error(`[HOOKS] Async handler failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute a command hook handler
   */
  private async executeCommandHandler(handler: CommandHookHandler, input: HookInput, timeout: number): Promise<HookOutput | undefined> {
    // Replace environment variables in command
    let command = handler.command;
    for (const [key, value] of Object.entries(this.envVars)) {
      command = command.replace(new RegExp(`\\$${key}`, 'g'), value);
      command = command.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }

    // Display status message if provided
    if (handler.statusMessage) {
      logger.info(`[HOOKS] ${handler.statusMessage}`);
    }

    logger.debug(`[HOOKS] Executing command: ${command}`);

    return new Promise((resolve, reject) => {
      const { shell, args: shellArgs } = getShellConfig();
      const inputJson = JSON.stringify(input, null, 2);

      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Hook command timed out after ${timeout} seconds`));
      }, timeout * 1000);

      const spawnOptions: any = {
        cwd: this.projectRoot,
        env: {
          ...process.env,
          ...this.envVars,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      };

      // Don't use detached on Windows
      if (process.platform !== 'win32') {
        spawnOptions.detached = true;
      }

      const child = spawn(shell, [...shellArgs, command], spawnOptions);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      // Write input to stdin
      child.stdin?.write(inputJson);
      child.stdin?.end();

      child.stdout?.on('data', (data: Buffer) => {
        stdoutChunks.push(data);
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderrChunks.push(data);
      });

      child.on('close', (code: number) => {
        clearTimeout(timeoutHandle);
        if (timedOut) return;

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

        // Exit code 2 means block - stderr becomes feedback for LLM
        if (code === 2) {
          resolve({
            decision: 'block',
            reason: stderr || 'Blocked by hook',
          });
          return;
        }

        // Non-zero exit code and no stdout = error (but don't block)
        if (code !== 0 && !stdout) {
          resolve({
            decision: 'allow',
            error: stderr || `Command exited with code ${code}`,
          });
          return;
        }

        // Try to parse JSON output
        if (stdout) {
          try {
            const output = JSON.parse(stdout) as HookOutput;
            resolve(output);
          } catch {
            // Not JSON - for UserPromptSubmit/SessionStart, stdout is context to inject
            // For other events, it's just a reason/log message
            const isContextEvent = input.hookEventName === 'UserPromptSubmit' ||
                                   input.hookEventName === 'SessionStart';
            resolve({
              decision: 'allow',
              reason: stdout,
              hookSpecificOutput: isContextEvent ? {
                hookEventName: input.hookEventName,
                additionalContext: stdout,
              } : undefined,
            });
          }
        } else {
          // No output = allow
          resolve({ decision: 'allow' });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        if (!timedOut) {
          reject(err);
        }
      });
    });
  }

  /**
   * Execute an HTTP hook handler
   */
  private async executeHttpHandler(handler: HttpHookHandler, input: HookInput, timeout: number): Promise<HookOutput | undefined> {
    // Build headers with environment variable interpolation
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...handler.headers,
    };

    // Interpolate environment variables in header values
    if (handler.allowedEnvVars) {
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
          let interpolated = value;
          for (const envVar of handler.allowedEnvVars) {
            const envValue = process.env[envVar] || this.envVars[envVar] || '';
            interpolated = interpolated.replace(new RegExp(`\\$${envVar}`, 'g'), envValue);
            interpolated = interpolated.replace(new RegExp(`\\$\\{${envVar}\\}`, 'g'), envValue);
          }
          headers[key] = interpolated;
        }
      }
    }

    // Display status message if provided
    if (handler.statusMessage) {
      logger.info(`[HOOKS] ${handler.statusMessage}`);
    }

    logger.debug(`[HOOKS] Sending HTTP POST to: ${handler.url}`);

    try {
      const response = await axios.post(handler.url, input, {
        headers,
        timeout: timeout * 1000,
      });

      // Parse response as HookOutput
      if (response.data) {
        return response.data as HookOutput;
      }

      return { decision: 'allow' };
    } catch (error: any) {
      // HTTP hooks don't block on errors - they're non-blocking
      logger.error(`[HOOKS] HTTP hook error:`, error.message);
      return {
        error: error.message,
      };
    }
  }

  /**
   * Execute a prompt hook handler
   * This sends the hook input to an LLM for evaluation
   * Note: This requires AI client integration.
   *
   * The LLM should return:
   * - { "ok": true } to allow the action
   * - { "ok": false, "reason": "..." } to block and provide feedback
   */
  private async executePromptHandler(handler: PromptHookHandler, input: HookInput, _timeout: number): Promise<HookOutput | undefined> {
    // Display status message if provided
    if (handler.statusMessage) {
      logger.info(`[HOOKS] ${handler.statusMessage}`);
    }

    // Replace $ARGUMENTS placeholder with JSON input
    // Note: prompt and model will be used when AI client is integrated
    const _prompt = handler.prompt.replace('$ARGUMENTS', JSON.stringify(input, null, 2));
    const _model = handler.model || 'haiku';  // Default to fast model

    logger.debug(`[HOOKS] Executing prompt hook with model: ${_model}`);

    // TODO: Integrate with AI client
    // For now, return a placeholder that allows the action
    // A full implementation would:
    // 1. Get the AI client from session
    // 2. Send the prompt to the LLM
    // 3. Parse the response as { ok: boolean, reason?: string }
    // 4. Return appropriate HookOutput

    return {
      decision: 'allow',
      reason: 'Prompt hooks require AI client integration',
    };
  }

  /**
   * Execute an agent hook handler
   * This spawns a subagent to evaluate the hook
   * Note: This requires Subagent integration.
   *
   * The Subagent should return:
   * - { "ok": true } to allow the action
   * - { "ok": false, "reason": "..." } to block and provide feedback
   */
  private async executeAgentHandler(handler: AgentHookHandler, input: HookInput, _timeout: number): Promise<HookOutput | undefined> {
    // Display status message if provided
    if (handler.statusMessage) {
      logger.info(`[HOOKS] ${handler.statusMessage}`);
    }

    // Replace $ARGUMENTS placeholder with JSON input
    // Note: prompt and model will be used when Subagent is integrated
    const _prompt = handler.prompt.replace('$ARGUMENTS', JSON.stringify(input, null, 2));
    const _model = handler.model;

    logger.debug(`[HOOKS] Executing agent hook${_model ? ` with model: ${_model}` : ''}`);

    // TODO: Integrate with Subagent system
    // For now, return a placeholder that allows the action
    // A full implementation would:
    // 1. Spawn a Subagent with tool access (Read, Grep, Glob, etc.)
    // 2. Send the prompt to the Subagent
    // 3. Collect the Subagent's response
    // 4. Parse as { ok: boolean, reason?: string }
    // 5. Return appropriate HookOutput

    return {
      decision: 'allow',
      reason: 'Agent hooks require Subagent integration',
    };
  }

  /**
   * Check if there are any hooks registered for an event
   */
  hasHooks(eventName: HookEventName): boolean {
    if (this.disabled) {
      return false;
    }
    const matcherGroups = this.hooks[eventName];
    return matcherGroups && matcherGroups.length > 0;
  }

  /**
   * Clear all hooks
   */
  clearHooks(): void {
    this.hooks = {};
    this.onceHooks.clear();
  }

  /**
   * Get all registered hooks (for debugging)
   */
  getHooks(): HooksConfig {
    return { ...this.hooks };
  }

  /**
   * Get environment variables (for testing/debugging)
   */
  getEnvVars(): Record<string, string> {
    return { ...this.envVars };
  }
}

// Singleton instance
let hookManagerInstance: HookManager | null = null;

/**
 * Get or create the HookManager singleton
 */
export function getHookManager(projectRoot?: string, sessionId?: string): HookManager {
  if (!hookManagerInstance && projectRoot && sessionId) {
    hookManagerInstance = new HookManager(projectRoot, sessionId);
  }
  if (!hookManagerInstance) {
    throw new Error('HookManager not initialized. Call getHookManager with projectRoot and sessionId first.');
  }
  return hookManagerInstance;
}

/**
 * Reset the HookManager singleton (for testing)
 */
export function resetHookManager(): void {
  hookManagerInstance = null;
}

export {
  HookEventName,
  HooksConfig,
  HookHandler,
  HookInput,
  HookOutput,
  HookExecutionResult,
};
