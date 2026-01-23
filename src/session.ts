import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { ExecutionMode, ChatMessage, ToolCall, AuthType } from './types.js';
import { AIClient, Message, detectThinkingKeywords, getThinkingTokens } from './ai-client.js';
import { RemoteAIClient, TokenInvalidError } from './remote-ai-client.js';
import { getConfigManager, ConfigManager } from './config.js';
import { AuthService, selectAuthType } from './auth.js';
import { getToolRegistry } from './tools.js';
import { getAgentManager, DEFAULT_AGENTS, AgentManager } from './agents.js';
import { getMemoryManager, MemoryManager } from './memory.js';
import { getMCPManager, MCPManager } from './mcp.js';
import { getCheckpointManager, CheckpointManager } from './checkpoint.js';
import { getConversationManager, ConversationManager } from './conversation.js';
import { getSessionManager, SessionManager } from './session-manager.js';
import { SlashCommandHandler, parseInput, detectImageInput } from './slash-commands.js';
import { SystemPromptGenerator } from './system-prompt-generator.js';
import { theme, icons, colors, styleHelpers, renderMarkdown } from './theme.js';
import { getCancellationManager, CancellationManager } from './cancellation.js';
import {
  getContextCompressor,
  ContextCompressor,
  CompressionResult,
} from './context-compressor.js';
import { Logger, LogLevel, getLogger } from './logger.js';
import { SdkOutputAdapter } from './sdk-output-adapter.js';

const logger = getLogger();

export class InteractiveSession {
  private conversationManager: ConversationManager;
  private sessionManager: SessionManager;
  private contextCompressor: ContextCompressor;
  private aiClient: AIClient | null = null;
  private remoteAIClient: RemoteAIClient | null = null;
  private conversation: ChatMessage[] = [];
  private toolCalls: ToolCall[] = [];
  private executionMode: ExecutionMode;
  private slashCommandHandler: SlashCommandHandler;
  private configManager: ConfigManager;
  private agentManager: AgentManager;
  private memoryManager: MemoryManager;
  private mcpManager: MCPManager;
  private checkpointManager: CheckpointManager;
  private currentAgent: any = null;
  private rl: readline.Interface;
  private cancellationManager: CancellationManager;
  private indentLevel: number;
  private indentString: string;
  private remoteConversationId: string | null = null;
  private sdkOutputAdapter: SdkOutputAdapter | null = null;
  private isSdkMode: boolean = false;
  private sdkInputBuffer: string[] = [];
  private resolveInput: ((value: string | null) => void) | null = null;
  private _currentRequestId: string | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimeoutMs: number = 60000; // 60 seconds default timeout
  private lastActivityTime: number = Date.now();

  constructor(indentLevel: number = 0) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.configManager = getConfigManager(process.cwd());
    this.agentManager = getAgentManager(process.cwd());
    this.memoryManager = getMemoryManager(process.cwd());
    this.mcpManager = getMCPManager();
    this.checkpointManager = getCheckpointManager(process.cwd());
    this.conversationManager = getConversationManager();
    this.sessionManager = getSessionManager(process.cwd());
    this.slashCommandHandler = new SlashCommandHandler();

    // Register /clear callback, clear local conversation when clearing dialogue
    this.slashCommandHandler.setClearCallback(() => {
      this.conversation = [];
    });

    // Register MCP update callback, update system prompt
    this.slashCommandHandler.setSystemPromptUpdateCallback(async () => {
      await this.updateSystemPrompt();
    });

    this.executionMode = ExecutionMode.DEFAULT;
    this.cancellationManager = getCancellationManager();
    this.indentLevel = indentLevel;
    this.indentString = ' '.repeat(indentLevel);
    this.contextCompressor = getContextCompressor();
  }

  /**
   * Get current indent string.
   */
  private getIndent(): string {
    return this.indentString;
  }

  /**
   * Unified output method - routes to console.log or SDK adapter
   */
  private output(
    type: 'output' | 'input' | 'system' | 'tool' | 'error' | 'thinking' | 'result',
    subtype: string,
    data: Record<string, unknown>
  ): void {
    if (this.isSdkMode && this.sdkOutputAdapter) {
      this.sdkOutputAdapter.output({
        type,
        subtype,
        timestamp: Date.now(),
        data,
      });
    } else {
      console.log(...this.formatOutput(type, subtype, data));
    }
  }

  /**
   * Format output for console.log
   */
  private formatOutput(type: string, subtype: string, data: Record<string, unknown>): any[] {
    const indent = this.getIndent();

    switch (type) {
      case 'error':
        return [colors.error(String(data.message || ''))];
      case 'warning':
        return [colors.warning(String(data.message || ''))];
      case 'success':
        return [colors.success(String(data.message || ''))];
      case 'info':
        return [colors.info(String(data.message || ''))];
      case 'tool':
        if (subtype === 'start') {
          return [`${indent}${colors.textMuted(`${icons.tool} Using tool: ${data.tool}`)}`];
        } else if (subtype === 'result') {
          return [`${indent}${colors.success(`${icons.check} ${data.tool} completed`)}`];
        } else if (subtype === 'error') {
          return [`${indent}${colors.error(`${icons.cross} ${data.tool} failed: ${data.error}`)}`];
        }
        return [];
      case 'thinking':
        return [`${indent}${colors.textDim(`${icons.brain} Thinking process`)}`];
      default:
        return [];
    }
  }

  /**
   * SDK-style output for assistant response
   */
  private outputAssistant(content: string, reasoningContent?: string): void {
    if (this.isSdkMode && this.sdkOutputAdapter) {
      this.sdkOutputAdapter.outputAssistant(content, reasoningContent);
    } else {
      const indent = this.getIndent();
      console.log('');
      console.log(`${indent}${colors.primaryBright(`${icons.robot} Assistant:`)}`);
      console.log(
        `${indent}${colors.border(icons.separator.repeat(Math.min(60, process.stdout.columns || 80) - indent.length))}`
      );
      console.log('');
      const renderedContent = renderMarkdown(
        content,
        (process.stdout.columns || 80) - indent.length * 2
      );
      console.log(`${indent}${renderedContent.replace(/^/gm, indent)}`);
      console.log('');
    }
  }

  setAIClient(aiClient: AIClient): void {
    this.aiClient = aiClient;
  }

  setExecutionMode(mode: ExecutionMode): void {
    this.executionMode = mode;
  }

  /**
   * Enable SDK mode with custom output adapter
   * When SDK mode is enabled, all output goes through the adapter
   * instead of console.log
   */
  setSdkMode(adapter: SdkOutputAdapter): void {
    this.isSdkMode = true;
    this.sdkOutputAdapter = adapter;
    adapter.setIndentLevel(this.indentLevel);
    // Also enable SDK mode for tool registry (async to avoid circular deps)
    this.initToolRegistrySdkMode(adapter);
  }

  private async initToolRegistrySdkMode(adapter: SdkOutputAdapter): Promise<void> {
    const { getToolRegistry } = await import('./tools.js');
    const toolRegistry = getToolRegistry();
    toolRegistry.setSdkMode(true, adapter);
  }

  /**
   * Check if running in SDK mode
   */
  getIsSdkMode(): boolean {
    return this.isSdkMode;
  }

  /**
   * Update system prompt to reflect MCP changes (called after add/remove MCP)
   */
  async updateSystemPrompt(): Promise<void> {
    const toolRegistry = getToolRegistry();
    const promptGenerator = new SystemPromptGenerator(
      toolRegistry,
      this.executionMode,
      undefined,
      this.mcpManager
    );

    // Use the current agent's original system prompt as base
    const baseSystemPrompt =
      this.currentAgent?.systemPrompt || 'You are xAgent, an AI-powered CLI tool.';
    const newSystemPrompt = await promptGenerator.generateEnhancedSystemPrompt(baseSystemPrompt);

    // Replace old system prompt with new one
    this.conversation = this.conversation.filter((msg) => msg.role !== 'system');
    this.conversation.unshift({
      role: 'system',
      content: newSystemPrompt,
      timestamp: Date.now(),
    });

    // Sync to slashCommandHandler
    this.slashCommandHandler.setConversationHistory(this.conversation);
  }

  setAgent(agent: any): void {
    this.currentAgent = agent;
  }

  async start(): Promise<void> {
    // Set this session as the singleton for access from other modules
    setSingletonSession(this);

    const separator = icons.separator.repeat(60);

    if (this.isSdkMode && this.sdkOutputAdapter) {
      // SDK mode: output welcome through adapter
      const language = this.configManager.getLanguage();
      this.sdkOutputAdapter.outputWelcome(language, this.executionMode);
    } else {
      // Normal mode: console output
      console.log('');
      console.log(
        colors.gradient('╔════════════════════════════════════════════════════════════╗')
      );
      console.log(colors.gradient('║') + ' '.repeat(56) + colors.gradient('║'));
      console.log(
        ' '.repeat(12) + colors.gradient('🤖 XAGENT CLI') + ' '.repeat(37) + colors.gradient('║')
      );
      console.log(
        ' '.repeat(14) + colors.textMuted('v1.0.0') + ' '.repeat(40) + colors.gradient('║')
      );
      console.log(colors.gradient('║') + ' '.repeat(56) + colors.gradient('║'));
      console.log(
        colors.gradient('╚════════════════════════════════════════════════════════════╝')
      );
      console.log(colors.textMuted('  AI-powered command-line assistant'));
      console.log('');
    }

    await this.initialize();
    this.showWelcomeMessage();

    // Track if an operation is in progress
    (this as any)._isOperationInProgress = false;

    // Listen for ESC cancellation - only cancel operations, don't exit the program
    const cancelHandler = () => {
      if ((this as any)._isOperationInProgress) {
        // An operation is running, let it be cancelled
        return;
      }
      // No operation running, ignore ESC or show a message
    };
    this.cancellationManager.on('cancelled', cancelHandler);

    this.promptLoop();

    // Start heartbeat timeout monitoring in SDK mode
    if (this.isSdkMode) {
      this.startHeartbeatMonitoring();
    }

    // Keep the promise pending until shutdown
    return new Promise((resolve) => {
      (this as any)._shutdownResolver = resolve;
    });
  }

  private async initialize(): Promise<void> {
    logger.debug('\n[SESSION] ========== initialize() 开始 ==========\n');

    try {
      // In SDK mode, output through adapter; in normal mode, use spinner
      const spinner = this.isSdkMode
        ? null
        : ora({
            text: colors.textMuted('Initializing XAGENT CLI...'),
            spinner: 'dots',
            color: 'cyan',
          }).start();

      // SDK mode: output initialization status
      if (this.isSdkMode) {
        this.sdkOutputAdapter?.outputSystem('info', { message: 'Initializing XAGENT CLI...' });
      }

      logger.debug('[SESSION] 调用 configManager.load()...');
      await this.configManager.load();

      logger.debug('[SESSION] 调用 configManager.getAuthConfig()...');
      let authConfig = this.configManager.getAuthConfig();
      const selectedAuthType = this.configManager.get('selectedAuthType');

      logger.debug('[SESSION] getAuthConfig() 返回:');
      logger.debug('  - apiKey exists:', !!authConfig.apiKey ? 'true' : 'false');
      logger.debug('  - selectedAuthType:', String(selectedAuthType));
      logger.debug('  - authConfig.type:', String(authConfig.type));
      logger.debug('  - authConfig.baseUrl:', String(authConfig.baseUrl));

      // Only validate OAuth tokens, skip validation for third-party API keys
      if (authConfig.apiKey && selectedAuthType === AuthType.OAUTH_XAGENT) {
        if (spinner) {
          spinner.text = colors.textMuted('Validating authentication...');
        } else {
          this.sdkOutputAdapter?.outputSystem('info', { message: 'Validating authentication...' });
        }
        const baseUrl = authConfig.xagentApiBaseUrl || 'http://xagent-colife.net:3000';
        let isValid = await this.validateToken(baseUrl, authConfig.apiKey);

        // Try refresh token if validation failed
        if (!isValid && authConfig.refreshToken) {
          if (spinner) {
            spinner.text = colors.textMuted('Refreshing authentication...');
          } else {
            this.sdkOutputAdapter?.outputSystem('info', { message: 'Refreshing authentication...' });
          }
          const newToken = await this.refreshToken(baseUrl, authConfig.refreshToken);

          if (newToken) {
            // Save new token and persist
            await this.configManager.set('apiKey', newToken);
            await this.configManager.save('global');
            authConfig.apiKey = newToken;
            isValid = true;
          }
        }

        if (!isValid) {
          if (spinner) {
            spinner.stop();
            console.log('');
            console.log(colors.warning('⚠️  Authentication expired or invalid'));
            console.log(colors.info('Please log in again to continue.'));
            console.log('');
          } else {
            this.sdkOutputAdapter?.outputWarning('Authentication expired or invalid');
            this.sdkOutputAdapter?.outputSystem('info', { message: 'Please log in again to continue.' });
          }

          // Clear invalid credentials and persist
          await this.configManager.set('apiKey', '');
          await this.configManager.set('refreshToken', '');
          await this.configManager.set('selectedAuthType', AuthType.OAUTH_XAGENT);
          await this.configManager.save('global');

          await this.configManager.load();
          authConfig = this.configManager.getAuthConfig();

          await this.setupAuthentication();
          authConfig = this.configManager.getAuthConfig();

          // Recreate readline interface after inquirer (only for non-SDK mode)
          if (!this.isSdkMode) {
            this.rl.close();
            this.rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            this.rl.on('close', () => {
              // readline closed
            });
          }
          if (spinner) {
            spinner.start();
          }
        }
      } else if (!authConfig.apiKey) {
        // No API key configured, need to set up authentication
        if (spinner) {
          spinner.stop();
        }
        
        // In SDK mode, we cannot interactively set up authentication
        if (this.isSdkMode) {
          this.sdkOutputAdapter?.outputError(`Authentication required for SDK mode`);
          this.sdkOutputAdapter?.outputSystem('info', { message: 'Please configure authentication before using SDK mode. Run "xagent auth" to configure.' });
          
          throw new Error('Authentication required for SDK mode');
        }
        
        await this.setupAuthentication();
        authConfig = this.configManager.getAuthConfig();

        // Recreate readline interface after inquirer (only for non-SDK mode)
        if (!this.isSdkMode) {
          this.rl.close();
          this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          this.rl.on('close', () => {
            // readline closed
          });
        }
        if (spinner) {
          spinner.start();
        }
      }
      // For OPENAI_COMPATIBLE with API key, skip validation and proceed directly

      this.aiClient = new AIClient(authConfig);
      this.contextCompressor.setAIClient(this.aiClient);

      // Initialize remote AI client for OAuth XAGENT mode
      if (selectedAuthType === AuthType.OAUTH_XAGENT) {
        const webBaseUrl = authConfig.xagentApiBaseUrl || 'http://xagent-colife.net:3000';
        // In OAuth XAGENT mode, we still pass apiKey (can be empty or used for other purposes)
        this.remoteAIClient = new RemoteAIClient(
          authConfig.apiKey || '',
          webBaseUrl,
          authConfig.showAIDebugInfo
        );
        logger.debug('[DEBUG Initialize] RemoteAIClient created successfully');
      } else {
        logger.debug('[DEBUG Initialize] RemoteAIClient NOT created (not OAuth XAGENT mode)');
      }

      this.executionMode =
        this.configManager.getApprovalMode() || this.configManager.getExecutionMode();

      await this.agentManager.loadAgents();
      await this.memoryManager.loadMemory();
      await this.conversationManager.initialize();
      await this.sessionManager.initialize();

      // Create a new conversation and session for this interactive session
      const conversation = await this.conversationManager.createConversation();
      await this.sessionManager.createSession(
        conversation.id,
        this.currentAgent?.name || 'general-purpose',
        this.executionMode
      );

      // Sync conversation history to slashCommandHandler
      this.slashCommandHandler.setConversationHistory(this.conversation);

      const mcpServers = this.configManager.getMcpServers();
      this.sdkOutputAdapter?.outputMCPLoading(Object.keys(mcpServers).length);
      Object.entries(mcpServers).forEach(([name, config]) => {
        this.sdkOutputAdapter?.outputMCPRegistering(name, config.transport || 'stdio');
        this.mcpManager.registerServer(name, config);
        // Set SDK output adapter for each server
        const server = this.mcpManager.getServer(name);
        if (server && this.sdkOutputAdapter) {
          server.setSdkOutputAdapter(this.sdkOutputAdapter);
        }
      });

      // Eagerly connect to MCP servers to get tool definitions
      if (mcpServers && Object.keys(mcpServers).length > 0) {
        try {
          this.sdkOutputAdapter?.outputMCPConnecting(Object.keys(mcpServers).length);
          await this.mcpManager.connectAllServers();
          const connectedCount = Array.from(this.mcpManager.getAllServers()).filter((s: any) =>
            s.isServerConnected()
          ).length;
          const mcpTools = this.mcpManager.getToolDefinitions();
          this.sdkOutputAdapter?.outputMCPConnected(
            Object.keys(mcpServers).length,
            connectedCount,
            mcpTools.length
          );

          // Register MCP tools with the tool registry (hide MCP origin from LLM)
          const toolRegistry = getToolRegistry();
          const allMcpTools = this.mcpManager.getAllTools();
          toolRegistry.registerMCPTools(allMcpTools);

          // Sync MCP tools to remote server (remote mode only)
          if (this.remoteAIClient) {
            await this.syncMCPToRemote(allMcpTools);
          }
        } catch (error: any) {
          this.sdkOutputAdapter?.outputMCPConnectionFailed(error.message);
        }
      }

      // Sync skills to remote server (remote mode only)
      if (this.remoteAIClient) {
        await this.syncSkillsToRemote();
      }

      const checkpointingConfig = this.configManager.getCheckpointingConfig();
      if (checkpointingConfig.enabled) {
        this.checkpointManager = getCheckpointManager(
          process.cwd(),
          checkpointingConfig.enabled,
          checkpointingConfig.maxCheckpoints
        );
        await this.checkpointManager.initialize();
      }

      this.currentAgent = this.agentManager.getAgent('general-purpose');

      if (spinner) {
        spinner.succeed(colors.success('Initialization complete'));
      } else {
        this.sdkOutputAdapter?.outputSystem('success', { message: 'Initialization complete' });
      }
    } catch (error: any) {
      if (this.isSdkMode) {
        this.sdkOutputAdapter?.outputError(`Initialization failed: ${error.message}`);
      } else {
        const failSpinner = ora({ text: '', spinner: 'dots', color: 'red' }).start();
        failSpinner.fail(colors.error(`Initialization failed: ${error.message}`));
      }
      throw error;
    }
  }

  /**
   * Validate token with the backend
   * Returns true if token is valid, false otherwise
   */
  private async validateToken(baseUrl: string, apiKey: string): Promise<boolean> {
    try {
      // For OAuth XAGENT auth, use /api/auth/me endpoint
      const url = `${baseUrl}/api/auth/me`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      return response.ok;
    } catch (error: any) {
      // Network error - log details but still consider token may be invalid
      // For network errors, we still return false to trigger re-authentication
      // This ensures security but the user can retry
      return false;
    }
  }

  private async refreshToken(baseUrl: string, refreshToken: string): Promise<string | null> {
    try {
      const url = `${baseUrl}/api/auth/refresh`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (response.ok) {
        const data = (await response.json()) as { token?: string; refreshToken?: string };
        return data.token || null;
      } else {
        return null;
      }
    } catch (error: any) {
      return null;
    }
  }

  private async setupAuthentication(): Promise<void> {
    const separator = icons.separator.repeat(40);
    console.log('');
    console.log(colors.primaryBright(`${icons.lock} Setup Authentication`));
    console.log(colors.border(separator));
    console.log('');

    const authType = await selectAuthType();
    this.configManager.set('selectedAuthType', authType);

    const authService = new AuthService({
      type: authType,
      apiKey: '',
      baseUrl: '',
      modelName: '',
    });

    const success = await authService.authenticate();

    if (!success) {
      if (!this.isSdkMode) {
        console.log('');
        console.log(colors.error('Authentication failed. Exiting...'));
        console.log('');
      }
      process.exit(1);
    }

    const authConfig = authService.getAuthConfig();

    // VLM configuration is optional - skip for now, can be configured later with /vlm command
    if (!this.isSdkMode) {
      console.log('');
      console.log(colors.info(`${icons.info} VLM configuration is optional.`));
      console.log(colors.info(`You can configure it later using the /vlm command if needed.`));
      console.log('');
    }

    // Save LLM config only, skip VLM for now
    await this.configManager.setAuthConfig(authConfig);
  }

  private showWelcomeMessage(): void {
    const language = this.configManager.getLanguage();
    const separator = icons.separator.repeat(40);

    if (!this.isSdkMode) {
      console.log('');
      console.log(colors.border(separator));

      if (language === 'zh') {
        console.log(colors.primaryBright(`${icons.sparkles} Welcome to XAGENT CLI!`));
        console.log(colors.textMuted('Type /help to see available commands'));
      } else {
        console.log(colors.primaryBright(`${icons.sparkles} Welcome to XAGENT CLI!`));
        console.log(colors.textMuted('Type /help to see available commands'));
      }

      console.log(colors.border(separator));
      console.log('');
    }

    this.showExecutionMode();

    // SDK mode: signal that CLI is ready to accept requests
    if (this.isSdkMode && this.sdkOutputAdapter) {
      this.sdkOutputAdapter.outputReady();
    }
  }

  private showExecutionMode(): void {
    const modeConfig = {
      [ExecutionMode.YOLO]: {
        color: colors.error,
        icon: icons.fire,
        description: 'Execute commands without confirmation',
      },
      [ExecutionMode.ACCEPT_EDITS]: {
        color: colors.warning,
        icon: icons.check,
        description: 'Accept all edits automatically',
      },
      [ExecutionMode.PLAN]: {
        color: colors.info,
        icon: icons.brain,
        description: 'Plan before executing',
      },
      [ExecutionMode.DEFAULT]: {
        color: colors.success,
        icon: icons.bolt,
        description: 'Safe execution with confirmations',
      },
      [ExecutionMode.SMART]: {
        color: colors.primaryBright,
        icon: icons.sparkles,
        description: 'Smart approval with intelligent security checks',
      },
    };

    const config = modeConfig[this.executionMode];
    const modeName = this.executionMode;

    if (!this.isSdkMode) {
      console.log(colors.textMuted(`${icons.info} Current Mode:`));
      console.log(
        `  ${config.color(config.icon)} ${styleHelpers.text.bold(config.color(modeName))}`
      );
      console.log(`  ${colors.textDim(`  ${config.description}`)}`);
      console.log('');
    }
  }

  private async promptLoop(): Promise<void> {
    // Check if we're shutting down
    if ((this as any)._isShuttingDown) {
      return;
    }

    if (this.isSdkMode) {
      // SDK mode: read from stdin
      await this.sdkPromptLoop();
      return;
    }

    // Normal mode: use readline for interactive input
    // Recreate readline interface for input
    if (this.rl) {
      this.rl.close();
    }

    // Enable raw mode BEFORE emitKeypressEvents for better ESC detection
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    readline.emitKeypressEvents(process.stdin);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = `${colors.primaryBright('❯')} `;
    this.rl.question(prompt, async (input: string) => {
      if ((this as any)._isShuttingDown) {
        return;
      }

      try {
        await this.handleInput(input);
      } catch (err: any) {
        console.log(colors.error(`Error: ${err.message}`));
      }

      this.promptLoop();
    });
  }

  /**
   * SDK mode prompt loop - reads from stdin
   */
  private async sdkPromptLoop(): Promise<void> {
    // Read input from stdin directly without outputting prompt
    const input = await this.readSdkInput();

    if ((this as any)._isShuttingDown || input === null) {
      return;
    }

    try {
      await this.handleInput(input);
    } catch (err: any) {
      this.output('error', 'general', { message: err.message });
    }

    // Continue the loop
    this.sdkPromptLoop();
  }

  private sdkRl: readline.Interface | null = null;

  /**
   * Read a line of input from stdin (SDK mode)
   * Uses readline 'line' event for reliable stdin reading
   */
  private readSdkInput(): Promise<string | null> {
    return new Promise((resolve) => {
      // Create readline interface if not exists
      if (!this.sdkRl) {
        this.sdkRl = readline.createInterface({
          input: process.stdin,
          crlfDelay: Infinity,
        });

        // Handle line events
        this.sdkRl.on('line', (line) => {
          const cleanLine = line
            .replace(/^\uFEFF/, '')
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

          if (this.resolveInput) {
            // Immediate handler available, resolve immediately
            this.resolveInput(cleanLine);
            this.resolveInput = null;
          } else {
            // No handler available, queue the message
            this.sdkInputBuffer.push(cleanLine);
          }
        });

        // Handle close events
        this.sdkRl.on('close', () => {
          if (this.resolveInput) {
            this.resolveInput(null);
            this.resolveInput = null;
          }
        });

        // Handle errors
        this.sdkRl.on('error', () => {
          if (this.resolveInput) {
            this.resolveInput(null);
            this.resolveInput = null;
          }
        });
      }

      // Check if there's already input in buffer
      if (this.sdkInputBuffer.length > 0) {
        const line = this.sdkInputBuffer.shift()!;
        resolve(line);
        return;
      }

      // Set up the resolve callback
      this.resolveInput = (value: string | null) => {
        resolve(value);
      };
    });
  }

  private async handleInput(input: string): Promise<void> {
    // Reset heartbeat timeout on any input activity
    this.resetHeartbeatTimeout();

    const trimmedInput = input.trim();

    if (!trimmedInput) {
      return;
    }

    // Check for SDK JSON message format
    if (this.isSdkMode) {
      const { isSdkMessage, parseSdkMessage } = await import('./types.js');

      // Debug: Log raw input
      if (trimmedInput.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmedInput);
          this.sdkOutputAdapter?.outputSystem('debug', {
            message: 'Received JSON input',
            parsedType: parsed.type,
            contentLength: String(parsed.content || '').length
          });
        } catch (e) {
          this.sdkOutputAdapter?.outputSystem('debug', {
            message: 'Invalid JSON input',
            error: String(e)
          });
        }
      }

      if (isSdkMessage(trimmedInput)) {
        const sdkMessage = parseSdkMessage(trimmedInput);

        if (sdkMessage) {
          if (sdkMessage.type === 'ping') {
            // Handle ping - respond with pong
            await this.handlePing(sdkMessage);
            return;
          } else if (sdkMessage.type === 'control_request') {
            // Handle control request
            await this.handleControlRequest(sdkMessage);
            return;
          } else if (sdkMessage.type === 'user') {
            // Store request_id for tracking
            this._currentRequestId = sdkMessage.request_id || null;
            // Handle user message from SDK
            await this.processUserMessage(sdkMessage.content);
            return;
          }
        }
      } else {
        // Not a JSON SDK message, treat as regular text
        this.sdkOutputAdapter?.outputSystem('debug', {
          message: 'Not recognized as SDK message, treating as text',
          inputPreview: trimmedInput.substring(0, 50)
        });
        await this.processUserMessage(trimmedInput);
        return;
      }
    }

    if (trimmedInput.startsWith('/')) {
      const handled = await this.slashCommandHandler.handleCommand(trimmedInput);
      if (handled) {
        this.executionMode =
          this.configManager.getApprovalMode() || this.configManager.getExecutionMode();
        // Sync conversation history to slashCommandHandler
        this.slashCommandHandler.setConversationHistory(this.conversation);
      }
      return;
    }

    if (trimmedInput.startsWith('$')) {
      await this.handleSubAgentCommand(trimmedInput);
      return;
    }

    await this.processUserMessage(trimmedInput);
  }

  /**
   * Handle SDK ping messages (heartbeat)
   */
  private async handlePing(pingMessage: any): Promise<void> {
    const requestId = pingMessage.request_id || `ping_${Date.now()}`;

    // Reset activity timestamp on ping (heartbeat activity)
    this.lastActivityTime = Date.now();

    // Send pong response through SDK adapter for consistency
    this.sdkOutputAdapter?.output({
      type: 'system',
      subtype: 'pong',
      timestamp: Date.now(),
      data: {
        type: 'pong',
        request_id: requestId,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Start heartbeat timeout monitoring in SDK mode
   */
  private startHeartbeatMonitoring(): void {
    // Clear any existing timeout
    this.stopHeartbeatMonitoring();

    // Check heartbeat timeout periodically
    this.heartbeatTimeout = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastActivityTime;

      if (elapsed > this.heartbeatTimeoutMs) {
        // Heartbeat timeout - no activity for too long
        this.sdkOutputAdapter?.output({
          type: 'system',
          subtype: 'heartbeat_timeout',
          timestamp: now,
          data: {
            message: 'No activity detected, connection may be stale',
            lastActivity: this.lastActivityTime,
            timeoutMs: this.heartbeatTimeoutMs,
            elapsedMs: elapsed
          }
        });
        // Reset for next monitoring cycle
        this.lastActivityTime = now;
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop heartbeat timeout monitoring
   */
  private stopHeartbeatMonitoring(): void {
    if (this.heartbeatTimeout) {
      clearInterval(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * Reset heartbeat timeout (called on activity)
   */
  private resetHeartbeatTimeout(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Update activity timestamp - call this at the start of any work
   * to prevent heartbeat timeout during active processing
   */
  private updateActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Stop heartbeat monitoring (public method for cleanup)
   */
  public stopHeartbeatMonitor(): void {
    this.stopHeartbeatMonitoring();
  }

  /**
   * Handle SDK control requests
   */
  private async handleControlRequest(request: any): Promise<void> {
    // Update activity to prevent heartbeat timeout during control requests
    this.updateActivity();

    const { request_id, request: req } = request;
    
    switch (req.subtype) {
      case 'interrupt':
        this.sdkOutputAdapter?.outputSystem('interrupt', { request_id });
        (this as any)._isShuttingDown = true;
        process.exit(0);
        break;
        
      case 'set_permission_mode':
        const { ExecutionMode } = await import('./types.js');
        const modeMap: Record<string, ExecutionMode> = {
          'default': ExecutionMode.DEFAULT,
          'acceptEdits': ExecutionMode.ACCEPT_EDITS,
          'plan': ExecutionMode.PLAN,
          'bypassPermissions': ExecutionMode.YOLO,
        };
        const mode = modeMap[req.mode] || ExecutionMode.SMART;
        this.executionMode = mode;
        this.sdkOutputAdapter?.outputSystem('permission_mode_changed', { 
          request_id, 
          mode: req.mode 
        });
        break;
        
      case 'set_model':
        this.sdkOutputAdapter?.outputSystem('model_changed', { 
          request_id, 
          model: req.model 
        });
        break;
        
      default:
        this.sdkOutputAdapter?.outputWarning(`Unknown control request: ${req.subtype}`);
    }
  }

  private async handleSubAgentCommand(input: string): Promise<void> {
    // Update activity to prevent heartbeat timeout during subagent execution
    this.updateActivity();

    const [agentType, ...taskParts] = input.slice(1).split(' ');
    const task = taskParts.join(' ');

    const agent = this.agentManager.getAgent(agentType);

    if (!agent) {
      console.log('');
      console.log(colors.warning(`Agent not found: ${agentType}`));
      console.log(colors.textMuted('Use /agents list to see available agents'));
      console.log('');
      return;
    }

    console.log('');
    console.log(
      colors.primaryBright(`${icons.robot} Using agent: ${agent.name || agent.agentType}`)
    );
    console.log(colors.border(icons.separator.repeat(40)));
    console.log('');

    this.currentAgent = agent;
    await this.processUserMessage(task, agent);
  }

  public async processUserMessage(message: string, agent?: any): Promise<void> {
    // Update activity to prevent heartbeat timeout during message processing
    this.updateActivity();

    const inputs = parseInput(message);
    const textInput = inputs.find((i) => i.type === 'text');
    const fileInputs = inputs.filter((i) => i.type === 'file');
    const commandInput = inputs.find((i) => i.type === 'command');

    if (commandInput) {
      await this.executeShellCommand(commandInput.content);
      return;
    }

    let userContent = textInput?.content || '';

    if (fileInputs.length > 0) {
      const toolRegistry = getToolRegistry();
      for (const fileInput of fileInputs) {
        try {
          const content = await toolRegistry.execute(
            'Read',
            { filePath: fileInput.content },
            this.executionMode
          );
          userContent += `\n\n--- File: ${fileInput.content} ---\n${content}`;
        } catch (error: any) {
          console.log(
            chalk.yellow(`Warning: Failed to read file ${fileInput.content}: ${error.message}`)
          );
        }
      }
    }

    // Record input to session manager
    const sessionInput = {
      type: 'text' as const,
      content: userContent,
      rawInput: message,
      timestamp: Date.now(),
    };
    await this.sessionManager.addInput(sessionInput);

    // Calculate thinking tokens based on config and user input
    const thinkingConfig = this.configManager.getThinkingConfig();
    let thinkingTokens = 0;

    if (thinkingConfig.enabled) {
      // If thinking mode is enabled, detect keywords and calculate tokens
      const thinkingMode = detectThinkingKeywords(userContent);
      thinkingTokens = getThinkingTokens(thinkingMode);
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
    };

    // Save last user message for recovery after compression
    const lastUserMessage = userMessage;

    this.conversation.push(userMessage);
    await this.conversationManager.addMessage(userMessage);

    // Check if context compression is needed
    await this.checkAndCompressContext(lastUserMessage);

    // Use remote AI client if available (OAuth XAGENT mode)
    logger.debug(
      '[DEBUG processUserMessage] this.remoteAIClient exists:',
      !!this.remoteAIClient ? 'true' : 'false'
    );
    if (this.remoteAIClient) {
      logger.debug('[DEBUG processUserMessage] Using generateRemoteResponse');
      await this.generateRemoteResponse(thinkingTokens);
    } else {
      logger.debug('[DEBUG processUserMessage] Using generateResponse (local mode)');
      await this.generateResponse(thinkingTokens);
    }
  }

  private displayThinkingContent(reasoningContent: string): void {
    const indent = this.getIndent();
    const thinkingConfig = this.configManager.getThinkingConfig();
    const displayMode = thinkingConfig.displayMode || 'compact';

    if (this.isSdkMode && this.sdkOutputAdapter) {
      this.sdkOutputAdapter.outputThinking(reasoningContent, displayMode);
      return;
    }

    const separator = icons.separator.repeat(
      Math.min(60, process.stdout.columns || 80) - indent.length
    );

    console.log('');
    console.log(`${indent}${colors.border(separator)}`);

    switch (displayMode) {
      case 'full':
        // Full display, using small font and gray color
        console.log(`${indent}${colors.textDim(`${icons.brain} Thinking Process:`)}`);
        console.log('');
        console.log(`${indent}${colors.textDim(reasoningContent.replace(/^/gm, indent))}`);
        break;

      case 'compact':
        // Compact display, truncate partial content
        const maxLength = 500;
        const truncatedContent =
          reasoningContent.length > maxLength
            ? reasoningContent.substring(0, maxLength) + '... (truncated)'
            : reasoningContent;

        console.log(`${indent}${colors.textDim(`${icons.brain} Thinking Process:`)}`);
        console.log('');
        console.log(`${indent}${colors.textDim(truncatedContent.replace(/^/gm, indent))}`);
        console.log(`${indent}${colors.textDim(`[${reasoningContent.length} chars total]`)}`);
        break;

      case 'indicator':
        // Show indicator only
        console.log(`${indent}${colors.textDim(`${icons.brain} Thinking process completed`)}`);
        console.log(
          `${indent}${colors.textDim(`[${reasoningContent.length} chars of reasoning]`)}`
        );
        break;

      default:
        console.log(`${indent}${colors.textDim(`${icons.brain} Thinking:`)}`);
        console.log('');
        console.log(`${indent}${colors.textDim(reasoningContent.replace(/^/gm, indent))}`);
    }

    console.log(`${indent}${colors.border(separator)}`);
    console.log('');
  }

  /**
   * Check and compress conversation context
   */
  private async checkAndCompressContext(lastUserMessage?: ChatMessage): Promise<void> {
    const compressionConfig = this.configManager.getContextCompressionConfig();

    if (!compressionConfig.enabled) {
      return;
    }

    const { needsCompression, reason } = this.contextCompressor.needsCompression(
      this.conversation,
      compressionConfig
    );

    if (needsCompression) {
      const indent = this.getIndent();
      console.log('');
      this.sdkOutputAdapter?.outputContextCompressionTriggered(reason);
      console.log(
        `${indent}${colors.warning(`${icons.brain} Context compression triggered: ${reason}`)}`
      );

      const toolRegistry = getToolRegistry();
      const baseSystemPrompt = this.currentAgent?.systemPrompt || 'You are a helpful AI assistant.';
      const systemPromptGenerator = new SystemPromptGenerator(toolRegistry, this.executionMode);
      const enhancedSystemPrompt =
        await systemPromptGenerator.generateEnhancedSystemPrompt(baseSystemPrompt);

      const result: CompressionResult = await this.contextCompressor.compressContext(
        this.conversation,
        enhancedSystemPrompt,
        compressionConfig
      );

      if (result.wasCompressed) {
        this.conversation = result.compressedMessages;
        const reductionPercent = Math.round((1 - result.compressedSize / result.originalSize) * 100);
        this.sdkOutputAdapter?.outputContextCompressionResult(
          result.originalSize,
          result.compressedSize,
          reductionPercent,
          result.originalMessageCount,
          result.compressedMessageCount
        );
        console.log(
          `${indent}${colors.textMuted(`✓ Size: ${result.originalSize} → ${result.compressedSize} chars (${reductionPercent}% reduction)`)}`
        );

        // Display compressed summary content
        const summaryMessage = result.compressedMessages.find((m) => m.role === 'assistant');
        if (summaryMessage && summaryMessage.content) {
          const maxPreviewLength = 800;
          let summaryContent = summaryMessage.content;
          const isTruncated = summaryContent.length > maxPreviewLength;

          if (isTruncated) {
            summaryContent = summaryContent.substring(0, maxPreviewLength) + '\n...';
          }

          this.sdkOutputAdapter?.outputContextCompressionSummary(
            summaryMessage.content,
            summaryContent,
            isTruncated,
            summaryMessage.content.length
          );

          console.log('');
          console.log(
            `${indent}${theme.predefinedStyles.title(`${icons.sparkles} Conversation Summary`)}`
          );
          const separator = icons.separator.repeat(
            Math.min(60, process.stdout.columns || 80) - indent.length * 2
          );
          console.log(`${indent}${colors.border(separator)}`);
          const renderedSummary = renderMarkdown(
            summaryContent,
            (process.stdout.columns || 80) - indent.length * 4
          );
          console.log(
            `${indent}${theme.predefinedStyles.dim(renderedSummary).replace(/^/gm, indent)}`
          );
          if (isTruncated) {
            console.log(
              `${indent}${colors.textMuted(`(... ${summaryMessage.content.length - maxPreviewLength} more chars hidden)`)}`
            );
          }
          console.log(`${indent}${colors.border(separator)}`);
        }

        // Restore user messages after compression, ensuring user message exists for API calls
        if (lastUserMessage) {
          this.conversation.push(lastUserMessage);
        }

        // Sync compressed conversation history to slashCommandHandler
        this.slashCommandHandler.setConversationHistory(this.conversation);
      }
    }
  }

  private async executeShellCommand(command: string): Promise<void> {
    const indent = this.getIndent();
    console.log('');
    console.log(`${indent}${colors.textMuted(`${icons.code} Executing:`)}`);
    console.log(`${indent}${colors.codeText(`  $ ${command}`)}`);
    console.log(
      `${indent}${colors.border(icons.separator.repeat(Math.min(60, process.stdout.columns || 80) - indent.length))}`
    );
    console.log('');

    const toolRegistry = getToolRegistry();

    try {
      const result = await toolRegistry.execute('Bash', { command }, this.executionMode);

      if (result.stdout) {
        console.log(`${indent}${result.stdout.replace(/^/gm, indent)}`);
      }

      if (result.stderr) {
        console.log(`${indent}${colors.warning(result.stderr.replace(/^/gm, indent))}`);
      }

      const toolCall: ToolCall = {
        tool: 'Bash',
        params: { command },
        result,
        timestamp: Date.now(),
      };

      this.toolCalls.push(toolCall);

      // Record command execution to session manager
      await this.sessionManager.addInput({
        type: 'command',
        content: command,
        rawInput: command,
        timestamp: Date.now(),
      });

      await this.sessionManager.addOutput({
        role: 'tool',
        content: JSON.stringify(result),
        toolName: 'Bash',
        toolParams: { command },
        toolResult: result,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      console.log(`${indent}${colors.error(`Command execution failed: ${error.message}`)}`);
    }
  }

  /**
   * Create unified LLM Caller
   * Implement transparency: caller doesn't need to care about remote vs local mode
   */
  private createLLMCaller() {
    // Remote mode: use RemoteAIClient
    if (this.remoteAIClient) {
      return this.createRemoteCaller();
    }

    // Local mode: use AIClient
    if (!this.aiClient) {
      throw new Error('AI client not initialized');
    }
    return this.createLocalCaller();
  }

  /**
   * Create remote mode LLM caller
   */
  private createRemoteCaller() {
    const client = this.remoteAIClient!;
    return {
      chatCompletion: (messages: ChatMessage[], options: any) =>
        client.chatCompletion(messages, options),
      isRemote: true,
    };
  }

  /**
   * Create local mode LLM caller
   */
  private createLocalCaller() {
    const client = this.aiClient!;
    return {
      chatCompletion: (messages: ChatMessage[], options: any) =>
        client.chatCompletion(messages as any, options),
      isRemote: false,
    };
  }

  private async generateResponse(thinkingTokens: number = 0): Promise<void> {
    // Update activity to prevent heartbeat timeout during AI response generation
    this.updateActivity();

    // Use unified LLM Caller

    const { chatCompletion, isRemote } = this.createLLMCaller();

    if (!isRemote && !this.aiClient) {
      this.output('error', 'general', { message: 'AI client not initialized' });

      return;
    }

    // Mark that an operation is in progress

    (this as any)._isOperationInProgress = true;

    const indent = this.getIndent();

    const thinkingText = colors.textMuted(`Thinking... (Press ESC to cancel)`);

    const icon = colors.primary(icons.brain);

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

    let frameIndex = 0;

    let spinnerInterval: NodeJS.Timeout | null = null;

    // SDK mode: use structured output instead of spinner

    if (this.isSdkMode && this.sdkOutputAdapter) {
      this.output('thinking', 'compact', {
        content: 'Thinking... (Press ESC to cancel)',
        status: 'started',
      });
    } else {
      // Custom spinner: only icon rotates, text stays static

      spinnerInterval = setInterval(() => {
        process.stdout.write(`\r${colors.primary(frames[frameIndex])} ${icon} ${thinkingText}`);

        frameIndex = (frameIndex + 1) % frames.length;
      }, 120);
    }

    try {
      const memory = await this.memoryManager.loadMemory();

      const toolRegistry = getToolRegistry();

      const allowedToolNames = this.currentAgent
        ? this.agentManager.getAvailableToolsForAgent(this.currentAgent, this.executionMode)
        : [];

      // MCP servers are already connected during initialization (eager mode)

      // MCP tools are already registered as local tools via registerMCPTools

      const toolDefinitions = toolRegistry.getToolDefinitions();

      // Available tools for this session

      const availableTools =
        this.executionMode !== ExecutionMode.DEFAULT && allowedToolNames.length > 0
          ? toolDefinitions.filter((tool: any) => allowedToolNames.includes(tool.function.name))
          : toolDefinitions;

      const baseSystemPrompt = this.currentAgent?.systemPrompt;

      const systemPromptGenerator = new SystemPromptGenerator(
        toolRegistry,
        this.executionMode,
        undefined,
        this.mcpManager
      );

      const enhancedSystemPrompt =
        await systemPromptGenerator.generateEnhancedSystemPrompt(baseSystemPrompt);

      const messages: ChatMessage[] = [
        { role: 'system', content: `${enhancedSystemPrompt}\n\n${memory}`, timestamp: Date.now() },

        ...this.conversation.map((msg) => ({
          role: msg.role,

          content: msg.content,

          timestamp: msg.timestamp,
        })),
      ];

      // Generate AI response with cancellation support

      const operationId = `ai-response-${Date.now()}`;

      const response = await this.cancellationManager.withCancellation(
        chatCompletion(messages, {
          tools: availableTools,

          toolChoice: availableTools.length > 0 ? 'auto' : 'none',

          thinkingTokens,
        }),

        operationId
      );

      if (this.isSdkMode && this.sdkOutputAdapter) {
        this.output('thinking', 'compact', {
          content: 'Thinking... (Press ESC to cancel)',
          status: 'completed',
        });
      } else {
        if (spinnerInterval) {
          clearInterval(spinnerInterval);
        }

        process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r'); // Clear spinner line
      }

      const assistantMessage = response.choices[0].message;

      const content = typeof assistantMessage.content === 'string' ? assistantMessage.content : '';

      const reasoningContent = assistantMessage.reasoning_content || '';

      // Display reasoning content if available and thinking mode is enabled

      if (reasoningContent && this.configManager.getThinkingConfig().enabled) {
        this.displayThinkingContent(reasoningContent);
      }

      // Output assistant response

      this.outputAssistant(content, reasoningContent);

      this.conversation.push({
        role: 'assistant',

        content,

        timestamp: Date.now(),

        reasoningContent,

        toolCalls: assistantMessage.tool_calls,
      });

      // Record output to session manager

      await this.sessionManager.addOutput({
        role: 'assistant',

        content,

        timestamp: Date.now(),

        reasoningContent,

        toolCalls: assistantMessage.tool_calls,
      });

      if (assistantMessage.tool_calls) {
        await this.handleToolCalls(assistantMessage.tool_calls);
      }

      if (this.checkpointManager.isEnabled()) {
        await this.checkpointManager.createCheckpoint(
          `Response generated at ${new Date().toLocaleString()}`,

          [...this.conversation],

          [...this.toolCalls]
        );
      }

      // Operation completed successfully, clear the flag

      (this as any)._isOperationInProgress = false;

      // Signal request completion to SDK
      if (this.isSdkMode && this.sdkOutputAdapter && this._currentRequestId) {
        this.sdkOutputAdapter.outputRequestDone(this._currentRequestId, 'success');
        this._currentRequestId = null;
      }
    } catch (error: any) {
      if (this.isSdkMode && this.sdkOutputAdapter) {
        this.output('thinking', 'compact', {
          content: 'Thinking... (Press ESC to cancel)',
          status: 'completed',
        });
      } else {
        if (spinnerInterval) {
          clearInterval(spinnerInterval);
        }

        process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
      }

      // Clear the operation flag

      (this as any)._isOperationInProgress = false;

      // Signal request completion to SDK
      if (this.isSdkMode && this.sdkOutputAdapter && this._currentRequestId) {
        const status = error.message === 'Operation cancelled by user' ? 'cancelled' : 'error';
        this.sdkOutputAdapter.outputRequestDone(this._currentRequestId, status);
        this._currentRequestId = null;
      }

      if (error.message === 'Operation cancelled by user') {
        return;
      }

      this.output('error', 'general', { message: error.message });
    }
  }

  /**
   * Generate response using remote AI service（OAuth XAGENT 模式）
   * Support full tool calling loop
   * 与本地模式 generateResponse 保持一致
   */
  private async generateRemoteResponse(thinkingTokens: number = 0): Promise<void> {
    // 使用统一的 LLM Caller
    const { chatCompletion, isRemote } = this.createLLMCaller();

    if (!isRemote) {
      // 如果不是远程模式，回退到本地模式
      return this.generateResponse(thinkingTokens);
    }

    const indent = this.getIndent();
    const thinkingText = colors.textMuted(`Thinking... (Press ESC to cancel)`);
    const icon = colors.primary(icons.brain);
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;

    // Mark that an operation is in progress
    (this as any)._isOperationInProgress = true;

    // Custom spinner: only icon rotates, text stays static
    const spinnerInterval = setInterval(() => {
      process.stdout.write(`\r${colors.primary(frames[frameIndex])} ${icon} ${thinkingText}`);
      frameIndex = (frameIndex + 1) % frames.length;
    }, 120);

    try {
      // Load memory (与本地模式一致)
      const memory = await this.memoryManager.loadMemory();

      // Get tool definitions
      const toolRegistry = getToolRegistry();
      const allowedToolNames = this.currentAgent
        ? this.agentManager.getAvailableToolsForAgent(this.currentAgent, this.executionMode)
        : [];

      const allToolDefinitions = toolRegistry.getToolDefinitions();

      const availableTools =
        this.executionMode !== ExecutionMode.DEFAULT && allowedToolNames.length > 0
          ? allToolDefinitions.filter((tool: any) => allowedToolNames.includes(tool.function.name))
          : allToolDefinitions;

      // Convert to the format expected by backend (与本地模式一致使用 availableTools)
      const tools = availableTools.map((tool: any) => ({
        type: 'function' as const,
        function: {
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: tool.function.parameters || {
            type: 'object' as const,
            properties: {},
          },
        },
      }));

      // Generate system prompt (与本地模式一致)
      const baseSystemPrompt = this.currentAgent?.systemPrompt || 'You are a helpful AI assistant.';
      const systemPromptGenerator = new SystemPromptGenerator(toolRegistry, this.executionMode);
      const enhancedSystemPrompt =
        await systemPromptGenerator.generateEnhancedSystemPrompt(baseSystemPrompt);

      // Build messages with system prompt (与本地模式一致)
      const messages: ChatMessage[] = [
        { role: 'system', content: `${enhancedSystemPrompt}\n\n${memory}`, timestamp: Date.now() },
        ...this.conversation.map((msg) => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
        })),
      ];

      // Call unified LLM API with cancellation support
      const operationId = `remote-ai-response-${Date.now()}`;
      const response = await this.cancellationManager.withCancellation(
        chatCompletion(messages, {
          tools,
          toolChoice: tools.length > 0 ? 'auto' : 'none',
          thinkingTokens,
        }),
        operationId
      );

      clearInterval(spinnerInterval);
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
      if (!this.isSdkMode) {
        console.log('');
      }

      // 使用统一的响应格式（与本地模式一致）
      const assistantMessage = response.choices[0].message;
      const content = typeof assistantMessage.content === 'string' ? assistantMessage.content : '';
      const reasoningContent = assistantMessage.reasoning_content || '';
      const toolCalls = assistantMessage.tool_calls || [];

      // Display reasoning content if available and thinking mode is enabled (与本地模式一致)
      if (reasoningContent && this.configManager.getThinkingConfig().enabled) {
        this.displayThinkingContent(reasoningContent);
      }

      // Output assistant response (SDK 模式使用适配器)
      this.outputAssistant(content, reasoningContent);

      // Add assistant message to conversation (consistent with local mode, including reasoningContent)
      this.conversation.push({
        role: 'assistant',
        content,
        timestamp: Date.now(),
        reasoningContent,
        toolCalls: toolCalls,
      });

      // Record output to session manager (consistent with local mode, including reasoningContent and toolCalls)
      await this.sessionManager.addOutput({
        role: 'assistant',
        content,
        timestamp: Date.now(),
        reasoningContent,
        toolCalls,
      });

      // Handle tool calls
      if (toolCalls.length > 0) {
        await this.handleRemoteToolCalls(toolCalls);
      }

      // Checkpoint support (consistent with local mode)
      if (this.checkpointManager.isEnabled()) {
        await this.checkpointManager.createCheckpoint(
          `Response generated at ${new Date().toLocaleString()}`,
          [...this.conversation],
          [...this.toolCalls]
        );
      }

      // Operation completed successfully
      (this as any)._isOperationInProgress = false;

      // Signal request completion to SDK
      if (this.isSdkMode && this.sdkOutputAdapter && this._currentRequestId) {
        this.sdkOutputAdapter.outputRequestDone(this._currentRequestId, 'success');
        this._currentRequestId = null;
      }
    } catch (error: any) {
      if (this.isSdkMode && this.sdkOutputAdapter) {
        this.output('thinking', 'compact', {
          content: 'Thinking... (Press ESC to cancel)',
          status: 'completed',
        });
      } else {
        if (spinnerInterval) {
          clearInterval(spinnerInterval);
        }
        process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
      }
      // Clear the operation flag
      (this as any)._isOperationInProgress = false;

      // Signal request completion to SDK
      if (this.isSdkMode && this.sdkOutputAdapter && this._currentRequestId) {
        const status = error.message === 'Operation cancelled by user' ? 'cancelled' : 'error';
        this.sdkOutputAdapter.outputRequestDone(this._currentRequestId, status);
        this._currentRequestId = null;
      }

      if (error.message === 'Operation cancelled by user') {
        return;
      }

      // Handle token invalid error - trigger re-authentication
      if (error instanceof TokenInvalidError) {
        if (!this.isSdkMode) {
          console.log('');
          console.log(colors.warning('⚠️  Authentication expired or invalid'));
          console.log(
            colors.info('Your browser session has been logged out. Please log in again.')
          );
          console.log('');
        }

        // Clear invalid credentials and persist
        await this.configManager.set('apiKey', '');
        await this.configManager.set('refreshToken', '');
        await this.configManager.set('selectedAuthType', AuthType.OAUTH_XAGENT);
        await this.configManager.save('global');

        logger.debug(
          '[DEBUG generateRemoteResponse] Cleared invalid credentials, starting re-authentication...'
        );

        // Re-authenticate
        await this.setupAuthentication();

        // Reload config to ensure we have the latest authConfig
        logger.debug(
          '[DEBUG generateRemoteResponse] Re-authentication completed, reloading config...'
        );
        await this.configManager.load();
        const authConfig = this.configManager.getAuthConfig();

        logger.debug('[DEBUG generateRemoteResponse] After re-auth:');
        logger.debug('  - authConfig.apiKey exists:', !!authConfig.apiKey ? 'true' : 'false');
        logger.debug(
          '  - authConfig.apiKey prefix:',
          authConfig.apiKey ? authConfig.apiKey.substring(0, 20) + '...' : 'empty'
        );

        // Recreate readline interface after inquirer
        this.rl.close();
        this.rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        this.rl.on('close', () => {
          logger.debug('DEBUG: readline interface closed');
        });

        // Reinitialize RemoteAIClient with new token
        if (authConfig.apiKey) {
          const webBaseUrl = authConfig.xagentApiBaseUrl || 'http://xagent-colife.net:3000';
          logger.debug(
            '[DEBUG generateRemoteResponse] Reinitializing RemoteAIClient with new token'
          );
          this.remoteAIClient = new RemoteAIClient(
            authConfig.apiKey,
            webBaseUrl,
            authConfig.showAIDebugInfo
          );
        } else {
          logger.debug(
            '[DEBUG generateRemoteResponse] WARNING: No apiKey after re-authentication!'
          );
        }

        // Retry the current operation
        if (!this.isSdkMode) {
          console.log('');
          console.log(colors.info('Retrying with new authentication...'));
          console.log('');
        }
        return this.generateRemoteResponse(thinkingTokens);
      }

      if (!this.isSdkMode) {
        console.log(colors.error(`Error: ${error.message}`));
      }
    }
  }

  private async handleToolCalls(toolCalls: any[]): Promise<void> {
    // Update activity to prevent heartbeat timeout during tool execution
    this.updateActivity();

    // Mark that tool execution is in progress
    (this as any)._isOperationInProgress = true;

    const toolRegistry = getToolRegistry();
    const showToolDetails = this.configManager.get('showToolDetails') || false;
    const indent = this.getIndent();

    // Set SDK mode for TaskTool if in SDK mode
    if (this.isSdkMode && this.sdkOutputAdapter) {
      const taskTool = toolRegistry.get('task');
      if (taskTool && (taskTool as any).setSdkMode) {
        (taskTool as any).setSdkMode(this.sdkOutputAdapter);
      }
    }

    // Prepare all tool calls
    const preparedToolCalls = toolCalls.map((toolCall, index) => {
      const { name, arguments: params } = toolCall.function;

      let parsedParams: any;
      try {
        parsedParams = typeof params === 'string' ? JSON.parse(params) : params;
      } catch (e) {
        parsedParams = params;
      }

      return { name, params: parsedParams, index };
    });

    // Display all tool calls info
    for (const { name, params } of preparedToolCalls) {
      if (this.isSdkMode && this.sdkOutputAdapter) {
        this.sdkOutputAdapter.outputToolStart(name, params);
      } else if (showToolDetails) {
        console.log('');
        console.log(`${indent}${colors.warning(`${icons.tool} Tool Call: ${name}`)}`);
        console.log(`${indent}${colors.textDim(JSON.stringify(params, null, 2))}`);
      } else {
        const toolDescription = this.getToolDescription(name, params);
        console.log('');
        console.log(`${indent}${colors.textMuted(`${icons.loading} ${toolDescription}`)}`);
      }
    }

    // Execute all tools in parallel
    const results = await toolRegistry.executeAll(
      preparedToolCalls.map((tc) => ({ name: tc.name, params: tc.params })),
      this.executionMode
    );

    // Process results and maintain order
    for (const { tool, result, error } of results) {
      const toolCall = preparedToolCalls.find((tc) => tc.name === tool);
      if (!toolCall) continue;

      const { params } = toolCall;

      if (error) {
        // Clear the operation flag
        (this as any)._isOperationInProgress = false;

        if (error === 'Operation cancelled by user') {
          return;
        }

        if (this.isSdkMode && this.sdkOutputAdapter) {
          this.sdkOutputAdapter.outputToolError(tool, error);
        } else {
          console.log('');
          console.log(`${indent}${colors.error(`${icons.cross} Tool Error: ${error}`)}`);
        }

        this.conversation.push({
          role: 'tool',
          content: JSON.stringify({ error }),
          timestamp: Date.now(),
        });
      } else {
        if (this.isSdkMode && this.sdkOutputAdapter) {
          this.sdkOutputAdapter.outputToolResult(tool, result);
        } else {
          // Use correct indent for gui-subagent tasks
          const isGuiSubagent = tool === 'task' && params?.subagent_type === 'gui-subagent';
          const displayIndent = isGuiSubagent ? indent + '  ' : indent;

          // Always show details for todo tools so users can see their task lists
          const isTodoTool = tool === 'todo_write' || tool === 'todo_read';
          if (isTodoTool) {
            console.log('');
            console.log(`${displayIndent}${colors.success(`${icons.check} Todo List:`)}`);
            console.log(this.renderTodoList(result?.todos || [], displayIndent));
            // Show summary if available
            if (result?.message) {
              console.log(`${displayIndent}${colors.textDim(result.message)}`);
            }
          } else if (showToolDetails) {
            console.log('');
            console.log(`${displayIndent}${colors.success(`${icons.check} Tool Result:`)}`);
            console.log(`${displayIndent}${colors.textDim(JSON.stringify(result, null, 2))}`);
          } else if (result && result.success === false) {
            // GUI task or other tool failed
            console.log(
              `${displayIndent}${colors.error(`${icons.cross} ${result.message || 'Failed'}`)}`
            );
          } else if (result) {
            console.log(`${displayIndent}${colors.success(`${icons.check} Completed`)}`);
          } else {
            console.log(`${displayIndent}${colors.textDim('(no result)')}`);
          }
        }

        const toolCallRecord: ToolCall = {
          tool,
          params,
          result,
          timestamp: Date.now(),
        };

        this.toolCalls.push(toolCallRecord);

        // Record tool output to session manager
        await this.sessionManager.addOutput({
          role: 'tool',
          content: JSON.stringify(result),
          toolName: tool,
          toolParams: params,
          toolResult: result,
          timestamp: Date.now(),
        });

        this.conversation.push({
          role: 'tool',
          content: JSON.stringify(result),
          timestamp: Date.now(),
        });
      }
    }

    // Logic: Only skip returning results to main agent when user explicitly cancelled (ESC)
    // For all other cases (success, failure, errors), always return results for further processing
    const guiSubagentFailed = preparedToolCalls.some(
      (tc) => tc.name === 'task' && tc.params?.subagent_type === 'gui-subagent'
    );
    const guiSubagentCancelled = preparedToolCalls.some(
      (tc) =>
        tc.name === 'task' &&
        tc.params?.subagent_type === 'gui-subagent' &&
        results.some((r) => r.tool === 'task' && (r.result as any)?.cancelled === true)
    );

    // If GUI agent was cancelled by user, don't continue generating response
    // This avoids wasting API calls and tokens on cancelled tasks
    if (guiSubagentCancelled) {
      if (this.isSdkMode && this.sdkOutputAdapter) {
        this.sdkOutputAdapter.outputInfo('GUI task cancelled by user');
      } else {
        console.log('');
        console.log(`${indent}${colors.textMuted('GUI task cancelled by user')}`);
      }
      (this as any)._isOperationInProgress = false;
      return;
    }

    // For all other cases (GUI success/failure, other tool errors), return results to main agent
    // This allows main agent to decide how to handle failures (retry, fallback, user notification, etc.)
    await this.generateResponse();
  }

  /**
   * Get user-friendly description for tool
   */
  private getToolDescription(toolName: string, params: any): string {
    const descriptions: Record<string, (params: any) => string> = {
      Read: (p) => `Read file: ${this.truncatePath(p.filePath)}`,
      Write: (p) => `Write file: ${this.truncatePath(p.filePath)}`,
      Grep: (p) => `Search text: "${p.pattern}"`,
      Bash: (p) => `Execute command: ${this.truncateCommand(p.command)}`,
      ListDirectory: (p) => `List directory: ${this.truncatePath(p.path || '.')}`,
      SearchCodebase: (p) => `Search files: ${p.pattern}`,
      DeleteFile: (p) => `Delete file: ${this.truncatePath(p.filePath)}`,
      CreateDirectory: (p) => `Create directory: ${this.truncatePath(p.dirPath)}`,
      replace: (p) => `Replace text: ${this.truncatePath(p.file_path)}`,
      web_search: (p) => `Web search: "${p.query}"`,
      todo_write: () => `Update todo list`,
      todo_read: () => `Read todo list`,
      task: (p) => `Launch subtask: ${p.description}`,
      ReadBashOutput: (p) => `Read task output: ${p.task_id}`,
      web_fetch: () => `Fetch web content`,
      ask_user_question: () => `Ask user`,
      save_memory: () => `Save memory`,
      exit_plan_mode: () => `Complete plan`,
      xml_escape: (p) => `XML escape: ${this.truncatePath(p.file_path)}`,
      image_read: (p) => `Read image: ${this.truncatePath(p.image_input)}`,
      // 'Skill': (p) => `Execute skill: ${p.skill}`,
      // 'ListSkills': () => `List available skills`,
      // 'GetSkillDetails': (p) => `Get skill details: ${p.skill}`,
      InvokeSkill: (p) =>
        `Invoke skill: ${p.skillId} - ${this.truncatePath(p.taskDescription || '', 40)}`,
    };

    const getDescription = descriptions[toolName];
    return getDescription ? getDescription(params) : `Execute tool: ${toolName}`;
  }

  /**
   * Handle tool calls for remote AI mode
   * Executes tools and then continues the conversation with results
   */
  private async handleRemoteToolCalls(toolCalls: any[]): Promise<void> {
    // Mark that tool execution is in progress
    (this as any)._isOperationInProgress = true;

    const toolRegistry = getToolRegistry();
    const showToolDetails = this.configManager.get('showToolDetails') || false;
    const indent = this.getIndent();

    // Set SDK mode for TaskTool if in SDK mode
    if (this.isSdkMode && this.sdkOutputAdapter) {
      const taskTool = toolRegistry.get('task');
      if (taskTool && (taskTool as any).setSdkMode) {
        (taskTool as any).setSdkMode(this.sdkOutputAdapter);
      }
    }

    // Prepare all tool calls
    const preparedToolCalls = toolCalls.map((toolCall, index) => {
      const { name, arguments: params } = toolCall.function;

      let parsedParams: any;
      try {
        parsedParams = typeof params === 'string' ? JSON.parse(params) : params;
      } catch (e) {
        parsedParams = params;
      }

      return { name, params: parsedParams, index };
    });

    // Display all tool calls info
    for (const { name, params } of preparedToolCalls) {
      if (this.isSdkMode && this.sdkOutputAdapter) {
        this.sdkOutputAdapter.outputToolStart(name, params);
      } else if (showToolDetails) {
        console.log('');
        console.log(`${indent}${colors.warning(`${icons.tool} Tool Call: ${name}`)}`);
        console.log(`${indent}${colors.textDim(JSON.stringify(params, null, 2))}`);
      } else {
        const toolDescription = this.getToolDescription(name, params);
        console.log('');
        console.log(`${indent}${colors.textMuted(`${icons.loading} ${toolDescription}`)}`);
      }
    }

    // Execute all tools in parallel
    const results = await toolRegistry.executeAll(
      preparedToolCalls.map((tc) => ({ name: tc.name, params: tc.params })),
      this.executionMode
    );

    // Process results and maintain order
    for (const { tool, result, error } of results) {
      const toolCall = preparedToolCalls.find((tc) => tc.name === tool);
      if (!toolCall) continue;

      const { params } = toolCall;

      if (error) {
        // Clear the operation flag
        (this as any)._isOperationInProgress = false;

        if (error === 'Operation cancelled by user') {
          return;
        }

        if (this.isSdkMode && this.sdkOutputAdapter) {
          this.sdkOutputAdapter.outputToolError(tool, error);
        } else {
          console.log('');
          console.log(`${indent}${colors.error(`${icons.cross} Tool Error: ${error}`)}`);
        }

        this.conversation.push({
          role: 'tool',
          content: JSON.stringify({ error }),
          timestamp: Date.now(),
        });
      } else {
        // Use correct indent for gui-subagent tasks
        const isGuiSubagent = tool === 'task' && params?.subagent_type === 'gui-subagent';
        const displayIndent = isGuiSubagent ? indent + '  ' : indent;

        // Always show details for todo tools so users can see their task lists
        const isTodoTool = tool === 'todo_write' || tool === 'todo_read';
        if (this.isSdkMode && this.sdkOutputAdapter) {
          this.sdkOutputAdapter.outputToolResult(tool, params, result);
        } else if (isTodoTool) {
          console.log('');
          console.log(`${displayIndent}${colors.success(`${icons.check} Todo List:`)}`);
          console.log(this.renderTodoList(result.todos || result.todos, displayIndent));
          // Show summary if available
          if (result.message) {
            console.log(`${displayIndent}${colors.textDim(result.message)}`);
          }
        } else if (showToolDetails) {
          console.log('');
          console.log(`${displayIndent}${colors.success(`${icons.check} Tool Result:`)}`);
          console.log(`${displayIndent}${colors.textDim(JSON.stringify(result, null, 2))}`);
        } else if (result.success === false) {
          // GUI task or other tool failed
          console.log(
            `${displayIndent}${colors.error(`${icons.cross} ${result.message || 'Failed'}`)}`
          );
        } else {
          console.log(`${displayIndent}${colors.success(`${icons.check} Completed`)}`);
        }

        const toolCallRecord: ToolCall = {
          tool,
          params,
          result,
          timestamp: Date.now(),
        };

        this.toolCalls.push(toolCallRecord);

        // Record tool output to session manager
        await this.sessionManager.addOutput({
          role: 'tool',
          content: JSON.stringify(result),
          toolName: tool,
          toolParams: params,
          toolResult: result,
          timestamp: Date.now(),
        });

        this.conversation.push({
          role: 'tool',
          content: JSON.stringify(result),
          timestamp: Date.now(),
        });
      }
    }

    // Logic: Only skip returning results to main agent when user explicitly cancelled (ESC)
    // For all other cases (success, failure, errors), always return results for further processing
    const guiSubagentFailed = preparedToolCalls.some(
      (tc) => tc.name === 'task' && tc.params?.subagent_type === 'gui-subagent'
    );
    const guiSubagentCancelled = preparedToolCalls.some(
      (tc) =>
        tc.name === 'task' &&
        tc.params?.subagent_type === 'gui-subagent' &&
        results.some((r) => r.tool === 'task' && (r.result as any)?.cancelled === true)
    );

    // If GUI agent was cancelled by user, don't continue generating response
    // This avoids wasting API calls and tokens on cancelled tasks
    if (guiSubagentCancelled) {
      console.log('');
      console.log(`${indent}${colors.textMuted('GUI task cancelled by user')}`);
      (this as any)._isOperationInProgress = false;
      return;
    }

    // For all other cases (GUI success/failure, other tool errors), return results to main agent
    // This allows main agent to decide how to handle failures (retry, fallback, user notification, etc.)
    await this.generateRemoteResponse();
  }

  /**
   * Truncate path for display
   */
  private truncatePath(path: string, maxLength: number = 30): string {
    if (!path) return '';
    if (path.length <= maxLength) return path;
    return '...' + path.slice(-(maxLength - 3));
  }

  /**
   * Truncate command for display
   */
  private truncateCommand(command: string, maxLength: number = 40): string {
    if (!command) return '';
    if (command.length <= maxLength) return command;
    return command.slice(0, maxLength - 3) + '...';
  }

  /**
   * Render todo list in a user-friendly format
   */
  private renderTodoList(todos: any[], indent: string = ''): string {
    if (!todos || todos.length === 0) {
      return `${indent}${colors.textMuted('No tasks')}`;
    }

    const statusConfig: Record<
      string,
      { icon: string; color: (text: string) => string; label: string }
    > = {
      pending: { icon: icons.circle, color: colors.textMuted, label: 'Pending' },
      in_progress: { icon: icons.loading, color: colors.warning, label: 'In Progress' },
      completed: { icon: icons.success, color: colors.success, label: 'Completed' },
      failed: { icon: icons.error, color: colors.error, label: 'Failed' },
    };

    const lines: string[] = [];

    for (const todo of todos) {
      const config = statusConfig[todo.status] || statusConfig['pending'];
      const statusPrefix = `${config.color(config.icon)} ${config.color(config.label)}:`;
      lines.push(`${indent}  ${statusPrefix} ${colors.text(todo.task)}`);
    }

    return lines.join('\n');
  }

  /**
   * Display AI debug information (input or output)
   */
  // AI debug info moved to ai-client.ts implementation
  // private displayAIDebugInfo(type: 'INPUT' | 'OUTPUT', data: any, extra?: any): void {
  //   const indent = this.getIndent();
  //   const boxChar = {
  //     topLeft: '╔', topRight: '╗', bottomLeft: '╚', bottomRight: '╝',
  //     horizontal: '═', vertical: '║'
  //   };
  //
  //   console.log('\n' + colors.border(
  //     `${boxChar.topLeft}${boxChar.horizontal.repeat(58)}${boxChar.topRight}`
  //   ));
  //   console.log(colors.border(`${boxChar.vertical}`) + ' ' +
  //     colors.primaryBright(type === 'INPUT' ? '🤖 AI INPUT DEBUG' : '📤 AI OUTPUT DEBUG') +
  //     ' '.repeat(36) + colors.border(boxChar.vertical));
  //   console.log(colors.border(
  //     `${boxChar.vertical}${boxChar.horizontal.repeat(58)}${boxChar.vertical}`
  //   ));
  //
  //   if (type === 'INPUT') {
  //     const messages = data as any[];
  //     const tools = extra as any[];
  //
  //     // System prompt
  //     const systemMsg = messages.find((m: any) => m.role === 'system');
  //     console.log(colors.border(`${boxChar.vertical}`) + ' 🟫 SYSTEM: ' +
  //       colors.textMuted(systemMsg?.content?.toString().substring(0, 50) || '(none)') + ' '.repeat(3) + colors.border(boxChar.vertical));
  //
  //     // Messages count
  //     console.log(colors.border(`${boxChar.vertical}`) + ' 💬 MESSAGES: ' +
  //       colors.text(messages.length.toString()) + ' items' + ' '.repeat(40) + colors.border(boxChar.vertical));
  //
  //     // Tools count
  //     console.log(colors.border(`${boxChar.vertical}`) + ' 🔧 TOOLS: ' +
  //       colors.text((tools?.length || 0).toString()) + '' + ' '.repeat(43) + colors.border(boxChar.vertical));  //
  //     // Show last 2 messages
  //     const recentMessages = messages.slice(-2);
  //     for (const msg of recentMessages) {
  //       const roleLabel: Record<string, string> = { user: '👤 USER', assistant: '🤖 ASSISTANT', tool: '🔧 TOOL' };
  //       const label = roleLabel[msg.role] || msg.role;
  //       const contentStr = typeof msg.content === 'string'
  //         ? msg.content.substring(0, 100)
  //         : JSON.stringify(msg.content).substring(0, 100);
  //       console.log(colors.border(`${boxChar.vertical}`) + ` ${label}: ` +
  //         colors.textDim(contentStr + '...') + ' '.repeat(Math.max(0, 50 - contentStr.length)) + colors.border(boxChar.vertical));
  //     }
  //   } else {
  //     // OUTPUT
  //     const response = data;
  //     const message = extra;
  //
  //     console.log(colors.border(`${boxChar.vertical}`) + ' 📋 MODEL: ' +
  //       colors.text(response.model || 'unknown') + ' '.repeat(45) + colors.border(boxChar.vertical));
  //
  //     console.log(colors.border(`${boxChar.vertical}`) + ' ⏱️  TOKENS: ' +
  //       colors.text(`Prompt: ${response.usage?.prompt_tokens || '?'}, Completion: ${response.usage?.completion_tokens || '?'}`) +
  //       ' '.repeat(15) + colors.border(boxChar.vertical));
  //
  // console.log(colors.border(`${boxChar.vertical}`) + ' 🔧 TOOL_CALLS: ' +
  //   colors.text((message.tool_calls?.length || 0).toString()) + '' + ' '.repeat(37) + colors.border(boxChar.vertical));
  //
  //     // Content preview
  //     const contentStr = typeof message.content === 'string'
  //       ? message.content.substring(0, 100)
  //       : JSON.stringify(message.content).substring(0, 100);
  //     console.log(colors.border(`${boxChar.vertical}`) + ' 📝 CONTENT: ' +
  //       colors.textDim(contentStr + '...') + ' '.repeat(Math.max(0, 40 - contentStr.length)) + colors.border(boxChar.vertical));
  //   }
  //
  //   console.log(colors.border(
  //     `${boxChar.bottomLeft}${boxChar.horizontal.repeat(58)}${boxChar.bottomRight}`
  //   ));
  // }

  shutdown(): void {
    this.rl.close();
    this.cancellationManager.cleanup();
    this.mcpManager.disconnectAllServers();

    // End the current session
    this.sessionManager.completeCurrentSession();

    const separator = icons.separator.repeat(40);
    console.log('');
    console.log(colors.border(separator));
    console.log(colors.primaryBright(`${icons.sparkles} Goodbye!`));
    console.log(colors.border(separator));
    console.log('');
  }

  /**
   * Get the RemoteAIClient instance
   * Used by tools.ts to access the remote AI client for GUI operations
   */
  getRemoteAIClient(): RemoteAIClient | null {
    return this.remoteAIClient;
  }

  /**
   * Get a VLM caller function that uses the RemoteAIClient
   * Returns a function compatible with GUIAgent's vlmCaller configuration
   * Now uses full messages array for consistent behavior with local mode
   */
  getVLMCaller(): ((messages: any[], systemPrompt: string) => Promise<string>) | undefined {
    if (!this.remoteAIClient) {
      return undefined;
    }

    return async (messages: any[], systemPrompt: string): Promise<string> => {
      return this.remoteAIClient!.invokeVLM(messages, systemPrompt);
    };
  }

  // ============================================================================
  // Remote Mode Tool Sync Methods
  // ============================================================================

  /**
   * Sync MCP tool definitions to remote server
   * @param allMcpTools - Map containing complete MCP tool information
   */
  private async syncMCPToRemote(allMcpTools: Map<string, any>): Promise<void> {
    if (!this.remoteAIClient) return;

    try {
      const tools: Array<{
        name: string;
        fullName: string;
        serverName: string;
        description: string;
        inputSchema: any;
      }> = [];

      for (const [fullName, tool] of allMcpTools) {
        const firstUnderscoreIndex = fullName.indexOf('__');
        if (firstUnderscoreIndex === -1) continue;

        const serverName = fullName.substring(0, firstUnderscoreIndex);
        const originalName = fullName.substring(firstUnderscoreIndex + 2);

        tools.push({
          name: originalName,
          fullName,
          serverName,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }

      await this.remoteAIClient.syncMCPTools(tools);
      console.log(`${colors.success(`✓ Synced ${tools.length} MCP tools to remote server`)}`);
    } catch (error: any) {
      console.log(`${colors.warning(`⚠ Failed to sync MCP tools to remote: ${error.message}`)}`);
      // Non-blocking failure, continue initialization
    }
  }

  /**
   * Sync Skill definitions to remote server
   */
  private async syncSkillsToRemote(): Promise<void> {
    if (!this.remoteAIClient) return;

    try {
      const { getSkillInvoker } = await import('./skill-invoker.js');
      const skillInvoker = getSkillInvoker();
      await skillInvoker.initialize();

      const skills: Array<{
        id: string;
        name: string;
        description: string;
        category: string;
        triggers: string[];
      }> = [];

      // Get all Skill info from SKILL_TRIGGERS
      const { SKILL_TRIGGERS } = await import('./skill-invoker.js');
      for (const [key, trigger] of Object.entries(SKILL_TRIGGERS)) {
        const skillTrigger = trigger as { skillId: string; keywords: string[]; category: string };
        const skill = await skillInvoker.getSkillDetails(skillTrigger.skillId);
        if (skill) {
          skills.push({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            category: skillTrigger.category,
            triggers: skillTrigger.keywords,
          });
        }
      }

      await this.remoteAIClient.syncSkills(skills);
      console.log(`${colors.success(`✓ Synced ${skills.length} skills to remote server`)}`);
    } catch (error: any) {
      console.log(`${colors.warning(`⚠ Failed to sync skills to remote: ${error.message}`)}`);
      // Non-blocking failure, continue initialization
    }
  }
}

export async function startInteractiveSession(): Promise<void> {
  const session = new InteractiveSession();

  // Flag to control shutdown
  (session as any)._isShuttingDown = false;

  // Also listen for raw Ctrl+C on stdin (works in Windows PowerShell)
  process.stdin.on('data', (chunk: Buffer) => {
    const str = chunk.toString();
    // Ctrl+C is character 0x03 or string '\u0003'
    if (str === '\u0003' || str.charCodeAt(0) === 3) {
      if (!(session as any)._isShuttingDown) {
        (session as any)._isShuttingDown = true;

        // Print goodbye immediately
        const separator = icons.separator.repeat(40);
        process.stdout.write('\n' + colors.border(separator) + '\n');
        process.stdout.write(colors.primaryBright(`${icons.sparkles} Goodbye!`) + '\n');
        process.stdout.write(colors.border(separator) + '\n\n');

        // Force exit
        process.exit(0);
      }
    }
  });

  process.on('SIGINT', () => {
    if ((session as any)._isShuttingDown) {
      return;
    }
    (session as any)._isShuttingDown = true;

    // Remove all SIGINT listeners to prevent re-entry
    process.removeAllListeners('SIGINT');

    // Print goodbye immediately
    const separator = icons.separator.repeat(40);
    process.stdout.write('\n' + colors.border(separator) + '\n');
    process.stdout.write(colors.primaryBright(`${icons.sparkles} Goodbye!`) + '\n');
    process.stdout.write(colors.border(separator) + '\n\n');

    // Force exit
    process.exit(0);
  });

  await session.start();
}

// Singleton session instance for access from other modules
let singletonSession: InteractiveSession | null = null;

export function setSingletonSession(session: InteractiveSession): void {
  singletonSession = session;
}

export function getSingletonSession(): InteractiveSession | null {
  return singletonSession;
}
