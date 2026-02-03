import readline from 'readline';
import chalk from 'chalk';
import https from 'https';
import axios from 'axios';
import crypto from 'crypto';
import ora from 'ora';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
import {
  ExecutionMode,
  ChatMessage,
  ToolCall,
  AuthType,
  AuthConfig,
  AgentConfig,
  ToolCallItem,
} from './types.js';
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
import {
  theme,
  icons,
  colors,
  styleHelpers,
  renderMarkdown,
  renderDiff,
  renderLines,
  TERMINAL_BG,
} from './theme.js';
import { getCancellationManager, CancellationManager } from './cancellation.js';
import {
  getContextCompressor,
  ContextCompressor,
  CompressionResult,
} from './context-compressor.js';
import { Logger, LogLevel, getLogger } from './logger.js';

const logger = getLogger();

export class InteractiveSession {
  private conversationManager: ConversationManager;
  private sessionManager: SessionManager;
  private contextCompressor: ContextCompressor;
  private aiClient: AIClient | null = null;
  private remoteAIClient: RemoteAIClient | null = null;
  private conversation: ChatMessage[] = [];
  private tool_calls: ToolCall[] = [];
  private executionMode: ExecutionMode;
  private slashCommandHandler: SlashCommandHandler;
  private configManager: ConfigManager;
  private agentManager: AgentManager;
  private memoryManager: MemoryManager;
  private mcpManager: MCPManager;
  private checkpointManager: CheckpointManager;
  private currentAgent: AgentConfig | null = null;
  private rl: readline.Interface;
  private cancellationManager: CancellationManager;
  private indentLevel: number;
  private indentString: string;
  private remoteConversationId: string | null = null;
  private currentTaskId: string | null = null;
  private taskCompleted: boolean = false;
  private isFirstApiCall: boolean = true;

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
      this.tool_calls = [];
      this.currentTaskId = null;
      this.taskCompleted = false;
      this.isFirstApiCall = true;
      this.slashCommandHandler.setConversationHistory([]);
    });

    // Register MCP update callback, update system prompt
    this.slashCommandHandler.setSystemPromptUpdateCallback(async () => {
      await this.updateSystemPrompt();
    });

    // Register config update callback, update aiClient config when /auth changes config
    this.slashCommandHandler.setConfigUpdateCallback(() => {
      this.updateAiClientConfig();
    });

    this.executionMode = ExecutionMode.DEFAULT;

    this.cancellationManager = getCancellationManager();

    this.indentLevel = indentLevel;

    this.indentString = ' '.repeat(indentLevel);

    this.contextCompressor = getContextCompressor();
  }

  private getIndent(): string {
    return this.indentString;
  }

  setAIClient(aiClient: AIClient): void {
    this.aiClient = aiClient;
  }

  /**
   * Update aiClient config when /auth changes config (called from callback)
   */
  updateAiClientConfig(): void {
    const authConfig = this.configManager.getAuthConfig();
    const isRemote = authConfig.type === AuthType.OAUTH_XAGENT;

    if (isRemote) {
      // Already in remote mode, no change needed
      if (this.remoteAIClient !== null) {
        return;
      }
      // Switch to remote: clear local client, create remote client
      this.aiClient = null;
      const webBaseUrl = authConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
      this.remoteAIClient = new RemoteAIClient(
        authConfig.apiKey || '',
        webBaseUrl,
        authConfig.showAIDebugInfo
      );
    } else {
      // Already in local mode, no change needed
      if (this.aiClient !== null) {
        return;
      }
      // Switch to local: clear remote client, create local client
      this.remoteAIClient = null;
      this.aiClient = new AIClient(authConfig);
    }

    this.slashCommandHandler.setRemoteAIClient(this.remoteAIClient);
  }

  setExecutionMode(mode: ExecutionMode): void {
    this.executionMode = mode;
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

  setAgent(agent: AgentConfig): void {
    this.currentAgent = agent;
  }

  async start(): Promise<void> {
    // Set this session as the singleton for access from other modules
    setSingletonSession(this);

    // Initialize taskId for GUI operations
    this.currentTaskId = crypto.randomUUID();

    const separator = icons.separator.repeat(60);
    console.log('');
    console.log(colors.gradient('╔════════════════════════════════════════════════════════════╗'));
    console.log(colors.gradient('║') + ' '.repeat(58) + colors.gradient('  ║'));
    console.log(
      colors.gradient('║') +
        ' '.repeat(13) +
        '🤖 ' +
        colors.gradient('XAGENT CLI') +
        ' '.repeat(32) +
        colors.gradient('  ║')
    );
    console.log(
      colors.gradient('║') +
        ' '.repeat(16) +
        colors.textMuted(`v${packageJson.version}`) +
        ' '.repeat(36) +
        colors.gradient('  ║')
    );
    console.log(colors.gradient('║') + ' '.repeat(58) + colors.gradient('  ║'));
    console.log(colors.gradient('╚════════════════════════════════════════════════════════════╝'));
    console.log(colors.textMuted('  AI-powered command-line assistant'));
    console.log('');

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

    // Keep the promise pending until shutdown
    return new Promise((resolve) => {
      (this as any)._shutdownResolver = resolve;
    });
  }

  private async initialize(): Promise<void> {
    logger.debug('\n[SESSION] ========== initialize() 开始 ==========\n');

    try {
      // Custom spinner for initialization (like Thinking...)
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let frameIndex = 0;
      const validatingText = colors.textMuted('Validating authentication...');

      const spinnerInterval = setInterval(() => {
        process.stdout.write(`\r${colors.primary(frames[frameIndex])} ${validatingText}`);
        frameIndex = (frameIndex + 1) % frames.length;
      }, 120);
      logger.debug('[SESSION] 调用 configManager.load()...');
      this.configManager.load();

      logger.debug('[SESSION] Config loaded');
      let authConfig = this.configManager.getAuthConfig();
      let selectedAuthType = this.configManager.get('selectedAuthType');

      logger.debug('[SESSION] authConfig.apiKey exists:', String(!!authConfig.apiKey));
      logger.debug('[SESSION] selectedAuthType (initial):', String(selectedAuthType));
      logger.debug('[SESSION] AuthType.OAUTH_XAGENT:', String(AuthType.OAUTH_XAGENT));
      logger.debug('[SESSION] AuthType.OPENAI_COMPATIBLE:', String(AuthType.OPENAI_COMPATIBLE));
      logger.debug(
        '[SESSION] Will validate OAuth:',
        String(!!(authConfig.apiKey && selectedAuthType === AuthType.OAUTH_XAGENT))
      );

      // Only validate OAuth tokens, skip validation for third-party API keys
      if (authConfig.apiKey && selectedAuthType === AuthType.OAUTH_XAGENT) {
        clearInterval(spinnerInterval);
        process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear the line

        const baseUrl = authConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
        let isValid = await this.validateToken(baseUrl, authConfig.apiKey);

        // Try refresh token if validation failed
        if (!isValid && authConfig.refreshToken) {
          const refreshingText = colors.textMuted('Refreshing authentication...');
          frameIndex = 0;
          const refreshInterval = setInterval(() => {
            process.stdout.write(`\r${colors.primary(frames[frameIndex])} ${refreshingText}`);
            frameIndex = (frameIndex + 1) % frames.length;
          }, 120);

          const newToken = await this.refreshToken(baseUrl, authConfig.refreshToken);
          clearInterval(refreshInterval);
          process.stdout.write('\r' + ' '.repeat(50) + '\r');

          if (newToken) {
            this.configManager.set('apiKey', newToken);
            this.configManager.save('global');
            authConfig.apiKey = newToken;
            isValid = true;
          }
        }

        if (!isValid) {
          console.log('');
          console.log(colors.warning('Your xAgent session has expired or is not configured'));
          console.log(colors.info('Please select an authentication method to continue.'));
          console.log('');

          this.configManager.set('apiKey', '');
          this.configManager.set('refreshToken', '');
          this.configManager.save('global');

          this.configManager.load();
          authConfig = this.configManager.getAuthConfig();

          await this.setupAuthentication();
          authConfig = this.configManager.getAuthConfig();

          // Recreate readline interface after inquirer
          this.rl.close();
          this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          this.rl.on('close', () => {
            // readline closed
          });
        }
      } else if (!authConfig.apiKey) {
        // No API key configured, need to set up authentication
        clearInterval(spinnerInterval);
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        await this.setupAuthentication();
        authConfig = this.configManager.getAuthConfig();
        selectedAuthType = this.configManager.get('selectedAuthType');
        logger.debug('[SESSION] selectedAuthType (after setup):', String(selectedAuthType));

        // Recreate readline interface after inquirer
        this.rl.close();
        this.rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        this.rl.on('close', () => {
          // readline closed
        });
      } else {
        clearInterval(spinnerInterval);
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
      }
      // For OPENAI_COMPATIBLE with API key, skip validation and proceed directly

      // Initialize AI clients and set contextCompressor appropriately
      if (selectedAuthType === AuthType.OAUTH_XAGENT) {
        // Remote mode: create RemoteAIClient and use it for context compression
        const webBaseUrl = authConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
        this.remoteAIClient = new RemoteAIClient(
          authConfig.apiKey || '',
          webBaseUrl,
          authConfig.showAIDebugInfo
        );
        this.contextCompressor.setAIClient(this.remoteAIClient);
        logger.debug('[DEBUG Initialize] RemoteAIClient created successfully');
      } else {
        // Local mode: create local AIClient
        this.aiClient = new AIClient(authConfig);
        this.contextCompressor.setAIClient(this.aiClient);
        logger.debug('[DEBUG Initialize] RemoteAIClient NOT created (not OAuth XAGENT mode)');
      }

      // Sync remoteAIClient reference to slashCommandHandler for /provider command
      this.slashCommandHandler.setRemoteAIClient(this.remoteAIClient);

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
      Object.entries(mcpServers).forEach(([name, config]) => {
        console.log(`📝 Registering MCP server: ${name} (${config.transport})`);
        this.mcpManager.registerServer(name, config);
      });

      // Eagerly connect to MCP servers to get tool definitions
      if (mcpServers && Object.keys(mcpServers).length > 0) {
        try {
          console.log(
            `${colors.info(`${icons.brain} Connecting to ${Object.keys(mcpServers).length} MCP server(s)...`)}`
          );
          await this.mcpManager.connectAllServers();
          const connectedCount = Array.from(this.mcpManager.getAllServers()).filter((s: any) =>
            s.isServerConnected()
          ).length;
          const mcpTools = this.mcpManager.getToolDefinitions();
          console.log(
            `${colors.success(`✓ ${connectedCount}/${Object.keys(mcpServers).length} MCP server(s) connected (${mcpTools.length} tools available)`)}`
          );

          // Register MCP tools with the tool registry (hide MCP origin from LLM)
          const toolRegistry = getToolRegistry();
          const allMcpTools = this.mcpManager.getAllTools();
          toolRegistry.registerMCPTools(allMcpTools);
        } catch (error: any) {
          console.log(`${colors.warning(`⚠ MCP connection failed: ${error.message}`)}`);
        }
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

      this.currentAgent = this.agentManager.getAgent('general-purpose') ?? null;

      console.log(colors.success('✔ Initialization complete'));
    } catch (error: any) {
      const spinner = ora({ text: '', spinner: 'dots', color: 'red' }).start();
      spinner.fail(colors.error(`Initialization failed: ${error.message}`));
      throw error;
    }
  }

  /**
   * Validate token with the backend
   * Returns true if token is valid, false otherwise
   */
  private async validateToken(baseUrl: string, apiKey: string): Promise<boolean> {
    logger.debug('[SESSION] validateToken called with baseUrl:', baseUrl);
    logger.debug('[SESSION] apiKey exists:', apiKey ? 'yes' : 'no');

    try {
      // For OAuth XAGENT auth, use /api/auth/me endpoint
      const url = `${baseUrl}/api/auth/me`;
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });

      logger.debug('[SESSION] Sending validation request to:', url);

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        httpsAgent,
        timeout: 10000,
      });

      logger.debug('[SESSION] Validation response status:', String(response.status));
      return response.status === 200;
    } catch (error: any) {
      // Network error - log details but still consider token may be invalid
      logger.debug('[SESSION] Error:', error.message);
      if (error.response) {
        logger.debug('[SESSION] Response status:', error.response.status);
      }
      // For network errors, we still return false to trigger re-authentication
      // This ensures security but the user can retry
      return false;
    }
  }

  private async refreshToken(baseUrl: string, refreshToken: string): Promise<string | null> {
    try {
      const url = `${baseUrl}/api/auth/refresh`;
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });

      const response = await axios.post(
        url,
        { refreshToken },
        {
          httpsAgent,
          timeout: 10000,
        }
      );

      if (response.status === 200) {
        const data = response.data as { token?: string; refreshToken?: string };
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

    // Get xagentApiBaseUrl from config (respects XAGENT_BASE_URL env var)
    const config = this.configManager.getAuthConfig();

    const authService = new AuthService({
      type: authType,
      apiKey: '',
      baseUrl: '',
      modelName: '',
      xagentApiBaseUrl: config.xagentApiBaseUrl,
    });

    const success = await authService.authenticate();

    if (!success) {
      console.log('');
      console.log(colors.error('Authentication failed. Exiting...'));
      console.log('');
      process.exit(1);
    }

    const authConfig = authService.getAuthConfig();

    // Clear modelName for remote mode
    if (authType === AuthType.OAUTH_XAGENT) {
      authConfig.modelName = '';
    }

    // VLM configuration is optional - only show for non-OAuth (local) mode
    // Remote mode uses backend VLM configuration
    if (authType !== AuthType.OAUTH_XAGENT) {
      console.log('');
      console.log(colors.info(`${icons.info} VLM configuration is optional.`));
      console.log(colors.info(`You can configure it later using the /vlm command if needed.`));
      console.log('');
    }

    this.configManager.setAuthConfig(authConfig);

    // Set default remote provider settings if not already set
    if (authType === AuthType.OAUTH_XAGENT) {
      if (!this.configManager.get('remote_llmProvider')) {
        this.configManager.set('remote_llmProvider', 'Default');
      }
      if (!this.configManager.get('remote_vlmProvider')) {
        this.configManager.set('remote_vlmProvider', 'Default');
      }
      this.configManager.save('global');
    }
  }

  private showWelcomeMessage(): void {
    const language = this.configManager.getLanguage();
    const separator = icons.separator.repeat(40);

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

    this.showExecutionMode();
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

    console.log(colors.textMuted(`${icons.info} Current Mode:`));
    console.log(`  ${config.color(config.icon)} ${styleHelpers.text.bold(config.color(modeName))}`);
    console.log(`  ${colors.textDim(`  ${config.description}`)}`);
    console.log('');
  }

  private async promptLoop(): Promise<void> {
    // Check if we're shutting down
    if ((this as any)._isShuttingDown) {
      return;
    }

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

  private async handleInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
      return;
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

  private async handleSubAgentCommand(input: string): Promise<void> {
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

  public async processUserMessage(message: string, agent?: AgentConfig): Promise<void> {
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

    this.conversation.push(userMessage);
    await this.conversationManager.addMessage(userMessage);

    // Use remote AI client if available (OAuth XAGENT mode)
    const currentSelectedAuthType = this.configManager.get('selectedAuthType');
    logger.debug(
      `[DEBUG] processUserMessage: remoteAIClient exists=${!!this.remoteAIClient}, selectedAuthType=${currentSelectedAuthType}`
    );

    if (this.remoteAIClient) {
      logger.debug('[DEBUG] Using generateRemoteResponse (remote mode)');
      await this.generateRemoteResponse(thinkingTokens);
    } else {
      logger.debug('[DEBUG] Using generateResponse (local mode)');
      await this.generateResponse(thinkingTokens);
    }
  }

  private displayThinkingContent(reasoningContent: string): void {
    const indent = this.getIndent();
    const thinkingConfig = this.configManager.getThinkingConfig();
    const displayMode = thinkingConfig.displayMode || 'compact';

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
  private async checkAndCompressContext(): Promise<void> {
    const compressionConfig = this.configManager.getContextCompressionConfig();

    if (!compressionConfig.enabled) {
      return;
    }

    const indent = this.getIndent();
    const currentTokens = this.contextCompressor.estimateContextTokens(this.conversation);
    const currentMessages = this.conversation.length;
    const { needsCompression, reason, tokenCount } = this.contextCompressor.needsCompression(
      this.conversation,
      compressionConfig
    );

    if (!needsCompression) {
      return;
    }

    // Extract threshold and contextWindow from reason
    const thresholdMatch = reason.match(/budget\s*\((\d+)/);
    const contextWindowMatch = reason.match(/contextWindow:\s*(\d+)/);
    const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 0;
    const contextWindow = contextWindowMatch ? parseInt(contextWindowMatch[1], 10) : 0;

    console.log('');
    console.log(
      `${indent}${colors.success(`${icons.sparkles} Compressing context (${currentMessages} msgs, ${tokenCount.toLocaleString()} > ${threshold.toLocaleString()}/${contextWindow.toLocaleString()} tokens, ${Math.round((tokenCount / contextWindow) * 100)}% of context window)...`)}`
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
      console.log(
        `${indent}${colors.success(`${icons.success} Compressed ${result.originalMessageCount} → ${result.compressedMessageCount} messages (${reductionPercent}% smaller)`)}`
      );

      // Summary is embedded in first user message, look for it
      // The format is: "[Conversation Summary - X messages compressed]\n\n${summary}"
      let summaryMessage: ChatMessage | undefined = result.compressedMessages.find(
        (m) => m.role === 'user' && m.content.includes('[Conversation Summary')
      );

      if (summaryMessage) {
        // Extract summary content after the header
        const match = summaryMessage.content.match(/\[Conversation Summary.*?\]:\n\n(.+)/s);
        if (match) {
          summaryMessage = {
            role: 'assistant',
            content: match[1],
            timestamp: summaryMessage.timestamp,
          };
        }
      }

      if (summaryMessage && summaryMessage.content) {
        const maxPreviewLength = 800;
        let summaryContent = summaryMessage.content;
        const isTruncated = summaryContent.length > maxPreviewLength;

        if (isTruncated) {
          summaryContent = summaryContent.substring(0, maxPreviewLength) + '\n...';
        }

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

      // Sync compressed conversation history to slashCommandHandler
      this.slashCommandHandler.setConversationHistory(this.conversation);
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

      this.tool_calls.push(toolCall);

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
  private createLLMCaller(taskId: string, status: 'begin' | 'continue') {
    // Remote mode: use RemoteAIClient
    if (this.remoteAIClient) {
      return this.createRemoteCaller(taskId, status);
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
  private createRemoteCaller(taskId: string, status: 'begin' | 'continue') {
    const client = this.remoteAIClient!;

    return {
      chatCompletion: (messages: ChatMessage[], options: any) => {
        // Must fetch authConfig inside the closure, otherwise it captures stale config
        const authConfig = this.configManager.getAuthConfig();
        logger.debug(
          `[DEBUG] createRemoteCaller: llmProvider=${authConfig.remote_llmProvider}, vlmProvider=${authConfig.remote_vlmProvider}`
        );
        return client.chatCompletion(messages, {
          ...options,
          taskId,
          status: options.isFirstApiCall ? 'begin' : 'continue',
          llmProvider: authConfig.remote_llmProvider,
          vlmProvider: authConfig.remote_vlmProvider,
        });
      },
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

  private async generateResponse(
    thinkingTokens: number = 0,
    _customAIClient?: AIClient,
    existingTaskId?: string
  ): Promise<void> {
    // Use existing taskId or create new one for this user interaction
    // If taskId already exists (e.g., from tool calls), reuse it
    const taskId = existingTaskId || this.currentTaskId || crypto.randomUUID();
    this.currentTaskId = taskId;

    // isFirstApiCall is reset in generateRemoteResponse for new tasks
    // For continuation calls (existingTaskId provided), keep previous value

    // Use unified LLM Caller with taskId (automatically selects local or remote mode)
    const status: 'begin' | 'continue' = this.isFirstApiCall ? 'begin' : 'continue';
    const caller = this.createLLMCaller(taskId, status);
    const chatCompletion = caller.chatCompletion;
    const isRemote = caller.isRemote;

    if (!isRemote && !this.aiClient) {
      console.log(colors.error('AI client not initialized'));
      return;
    }

    // Mark that an operation is in progress
    (this as any)._isOperationInProgress = true;

    const indent = this.getIndent();
    const thinkingText = colors.textMuted(`Thinking... (Press ESC to cancel)`);
    const icon = colors.primary(icons.brain);
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;

    // Custom spinner: only icon rotates, text stays static
    const spinnerInterval = setInterval(() => {
      process.stdout.write(`\r${colors.primary(frames[frameIndex])} ${icon} ${thinkingText}`);
      frameIndex = (frameIndex + 1) % frames.length;
    }, 120);

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
          ? toolDefinitions.filter(
              (tool): tool is { function: { name: string } } =>
                typeof tool.function?.name === 'string' &&
                allowedToolNames.includes(tool.function.name)
            )
          : toolDefinitions;

      const baseSystemPrompt = this.currentAgent?.systemPrompt ?? '';
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
        ...this.conversation,
      ];

      const operationId = `ai-response-${Date.now()}`;
      const response = await this.cancellationManager.withCancellation(
        chatCompletion(messages, {
          tools: availableTools,
          toolChoice: availableTools.length > 0 ? 'auto' : 'none',
          thinkingTokens,
          isFirstApiCall: this.isFirstApiCall,
        }),
        operationId
      );

      // Mark that first API call is complete
      this.isFirstApiCall = false;

      clearInterval(spinnerInterval);
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r'); // Clear spinner line

      const assistantMessage = response.choices[0].message;

      const content = typeof assistantMessage.content === 'string' ? assistantMessage.content : '';
      const reasoningContent = assistantMessage.reasoning_content || '';
      // Display reasoning content if available and thinking mode is enabled
      if (reasoningContent && this.configManager.getThinkingConfig().enabled) {
        this.displayThinkingContent(reasoningContent);
      }

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

      this.conversation.push({
        role: 'assistant',
        content,
        timestamp: Date.now(),
        reasoningContent,
        tool_calls: assistantMessage.tool_calls,
      });

      // Record output to session manager
      await this.sessionManager.addOutput({
        role: 'assistant',
        content,
        timestamp: Date.now(),
        reasoningContent,
        tool_calls: assistantMessage.tool_calls,
      });

      if (assistantMessage.tool_calls) {
        await this.handleToolCalls(assistantMessage.tool_calls);
      } else {
        await this.checkAndCompressContext();
      }

      if (this.checkpointManager.isEnabled()) {
        await this.checkpointManager.createCheckpoint(
          `Response generated at ${new Date().toLocaleString()}`,
          [...this.conversation],
          [...this.tool_calls]
        );
      }

      // Operation completed successfully, clear the flag
      (this as any)._isOperationInProgress = false;
    } catch (error: any) {
      clearInterval(spinnerInterval);
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');

      // Clear the operation flag
      (this as any)._isOperationInProgress = false;

      if (error.message === 'Operation cancelled by user') {
        // 用户手动取消 → 发送 cancel
        if (this.remoteAIClient && this.currentTaskId) {
          await this.remoteAIClient.cancelTask(this.currentTaskId).catch(() => {});
        }
        return;
      }
      // Distinguish error types: timeout vs other failures
      const isTimeout = error.message.includes('timeout') || error.message.includes('Timeout');
      const failureReason = isTimeout ? 'timeout' : 'failure';

      logger.debug(
        `[Session] Task failed: taskId=${this.currentTaskId}, error: ${error.message}, reason: ${failureReason}`
      );
      if (this.remoteAIClient && this.currentTaskId) {
        await this.remoteAIClient.failTask(this.currentTaskId, failureReason).catch(() => {});
      }

      console.log(colors.error(`Error: ${error.message}`));
    }
  }

  /**
   * Generate response using remote AI service（OAuth XAGENT 模式）
   * Support full tool calling loop
   * 与本地模式 generateResponse 保持一致
   * @param thinkingTokens - Optional thinking tokens config
   * @param existingTaskId - Optional existing taskId to reuse (for tool call continuation)
   */
  private async generateRemoteResponse(
    thinkingTokens: number = 0,
    existingTaskId?: string
  ): Promise<void> {
    // Reuse existing taskId or create new one for this user interaction
    const taskId = existingTaskId || crypto.randomUUID();
    this.currentTaskId = taskId;
    logger.debug(
      `[Session] generateRemoteResponse: taskId=${taskId}, existingTaskId=${!!existingTaskId}`
    );

    // Each new user message is a fresh task - always set isFirstApiCall = true
    // This ensures status is 'begin' for every user message
    this.isFirstApiCall = true;
    const status: 'begin' | 'continue' = 'begin';
    logger.debug(
      `[Session] Status for this call: ${status}, isFirstApiCall=${this.isFirstApiCall}`
    );

    // Check if remote client is available
    if (!this.remoteAIClient) {
      console.log(colors.error('Remote AI client not initialized'));
      return;
    }

    try {
      // Use unified generateResponse without passing customAIClient,
      // let createLLMCaller handle remote/local selection
      await this.generateResponse(thinkingTokens, undefined, taskId);

      // Mark task as completed (发送 status: 'end')
      logger.debug(`[Session] Task completed: taskId=${this.currentTaskId}`);
      if (this.currentTaskId) {
        await this.remoteAIClient.completeTask(this.currentTaskId);
      }
    } catch (error: any) {
      // Clear the operation flag
      (this as any)._isOperationInProgress = false;

      if (error.message === 'Operation cancelled by user') {
        // Notify backend to cancel the task
        if (this.remoteAIClient && this.currentTaskId) {
          await this.remoteAIClient.cancelTask(this.currentTaskId).catch(() => {});
        }
        return;
      }

      // Handle token invalid error - trigger re-authentication
      if (error instanceof TokenInvalidError) {
        console.log('');
        console.log(colors.warning('⚠️  Authentication expired or invalid'));
        console.log(colors.info('Your browser session has been logged out. Please log in again.'));
        console.log('');

        // Clear invalid credentials and persist
        this.configManager.set('apiKey', '');
        this.configManager.set('refreshToken', '');
        this.configManager.save('global');

        logger.debug(
          '[DEBUG generateRemoteResponse] Cleared invalid credentials, starting re-authentication...'
        );

        // Re-authenticate
        await this.setupAuthentication();

        // Reload config to ensure we have the latest authConfig
        this.configManager.load();
        const authConfig = this.configManager.getAuthConfig();

        logger.debug('[DEBUG generateRemoteResponse] After re-auth:');
        logger.debug('  - authConfig.apiKey exists:', !!authConfig.apiKey ? 'true' : 'false');

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
          const webBaseUrl = authConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
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

        // Sync remoteAIClient reference to slashCommandHandler for /provider command
        this.slashCommandHandler.setRemoteAIClient(this.remoteAIClient);

        // Retry the current operation
        console.log('');
        console.log(colors.info('Retrying with new authentication...'));
        console.log('');
        return this.generateRemoteResponse(thinkingTokens);
      }

      // Distinguish error types: timeout vs other failures
      const isTimeout = error.message.includes('timeout') || error.message.includes('Timeout');
      const failureReason = isTimeout ? 'timeout' : 'failure';

      logger.debug(
        `[Session] Task failed: taskId=${this.currentTaskId}, error: ${error.message}, reason: ${failureReason}`
      );
      if (this.remoteAIClient && this.currentTaskId) {
        await this.remoteAIClient.failTask(this.currentTaskId, failureReason).catch(() => {});
      }

      console.log(colors.error(`Error: ${error.message}`));
      return;
    }
  }

  private async handleToolCalls(
    toolCalls: ToolCallItem[],
    onComplete?: () => Promise<void>
  ): Promise<void> {
    // Mark that tool execution is in progress
    (this as any)._isOperationInProgress = true;

    const toolRegistry = getToolRegistry();
    const showToolDetails = this.configManager.get('showToolDetails') || false;
    const indent = this.getIndent();

    // Prepare all tool calls
    const preparedToolCalls = toolCalls.map((toolCall, index) => {
      const { name, arguments: params } = toolCall.function;

      let parsedParams: any;
      try {
        parsedParams = typeof params === 'string' ? JSON.parse(params) : params;
      } catch (e) {
        parsedParams = params;
      }

      return { name, params: parsedParams, index, id: toolCall.id };
    });

    // Display all tool calls info
    for (const { name, params } of preparedToolCalls) {
      if (showToolDetails) {
        console.log('');
        console.log(`${indent}${colors.warning(`${icons.tool} Tool Call: ${name}`)}`);
        console.log(`${indent}${colors.textDim(JSON.stringify(params, null, 2))}`);
      } else {
        const toolDescription = this.getToolDescription(name, params);
        console.log(`${indent}${colors.textMuted(`${icons.loading} ${toolDescription}`)}`);
      }
    }

    // Execute all tools in parallel
    const results = await toolRegistry.executeAll(
      preparedToolCalls.map((tc) => ({ name: tc.name, params: tc.params })),
      this.executionMode
    );

    // Process results and maintain order
    let hasError = false;
    for (const { tool, result, error } of results) {
      const toolCall = preparedToolCalls.find((tc) => tc.name === tool);
      if (!toolCall) continue;

      const { params } = toolCall;

      if (error) {
        if (error === 'Operation cancelled by user') {
          // Notify backend to cancel the task
          if (this.remoteAIClient && this.currentTaskId) {
            await this.remoteAIClient.cancelTask(this.currentTaskId).catch(() => {});
          }
          (this as any)._isOperationInProgress = false;
          return;
        }

        hasError = true;

        console.log('');
        console.log(`${indent}${colors.error(`${icons.cross} Tool Error: ${tool} - ${error}`)}`);

        // Add detailed error info including tool name and params for AI understanding and correction
        this.conversation.push({
          role: 'tool',
          content: JSON.stringify({
            name: tool,
            parameters: params,
            error: error,
          }),
          tool_call_id: toolCall.id,
          timestamp: Date.now(),
        });
      } else {
        // Use correct indent for gui-subagent tasks
        const isGuiSubagent = tool === 'task' && params?.subagent_type === 'gui-subagent';
        const displayIndent = isGuiSubagent ? indent + '  ' : indent;

        // Always show details for todo tools so users can see their task lists
        const isTodoTool = tool === 'todo_write' || tool === 'todo_read';

        // Special handling for edit tool with diff
        const isEditTool = tool === 'Edit';
        const hasDiff = isEditTool && result?.diff;

        // Special handling for Write tool with file preview
        const isWriteTool = tool === 'Write';
        const hasFilePreview = isWriteTool && result?.preview;

        // Special handling for DeleteFile tool
        const isDeleteTool = tool === 'DeleteFile';
        const hasDeleteInfo = isDeleteTool && result?.filePath;

        // Special handling for task tool (subagent)
        const isTaskTool = tool === 'task' && params?.subagent_type;

        // Check if tool is an MCP wrapper tool by looking up in tool registry
        const { getToolRegistry } = await import('./tools.js');
        const toolRegistry = getToolRegistry();
        const toolDef = toolRegistry.get(tool);
        const isMcpTool = toolDef && (toolDef as any)._isMcpTool === true;

        if (isTodoTool) {
          console.log('');
          console.log(`${displayIndent}${colors.success(`${icons.check} Todo List:`)}`);
          console.log(this.renderTodoList(result?.todos || [], displayIndent));
          // Show summary if available
          if (result?.message) {
            console.log(`${displayIndent}${colors.textDim(result.message)}`);
          }
        } else if (hasDiff) {
          // Show edit result with diff
          console.log('');
          const diffOutput = renderDiff(result.diff);
          const indentedDiff = diffOutput
            .split('\n')
            .map((line) => `${displayIndent}  ${line}`)
            .join('\n');
          console.log(`${indentedDiff}`);
        } else if (hasFilePreview) {
          // Show new file content in diff-like style
          console.log('');
          console.log(`${displayIndent}${colors.success(`${icons.file} ${result.filePath}`)}`);
          console.log(`${displayIndent}${colors.textDim(`  ${result.lineCount} lines`)}`);
          console.log('');
          console.log(renderLines(result.preview, { maxLines: 10, indent: displayIndent + '  ' }));
        } else if (hasDeleteInfo) {
          // Show DeleteFile result
          console.log('');
          console.log(
            `${displayIndent}${colors.success(`${icons.check} Deleted: ${result.filePath}`)}`
          );
        } else if (isTaskTool) {
          // Special handling for task tool (subagent) - show friendly summary
          console.log('');
          const subagentType = params.subagent_type;
          const subagentName =
            params.description ||
            (params.prompt ? params.prompt.substring(0, 50).replace(/\n/g, ' ') : 'Unknown task');

          if (result?.success) {
            console.log(
              `${displayIndent}${colors.success(`${icons.check} ${subagentType}: Completed`)}`
            );
            console.log(`${displayIndent}${colors.textDim(`  Task: ${subagentName}`)}`);
            if (result.message) {
              console.log(`${displayIndent}${colors.textDim(`  ${result.message}`)}`);
            }
          } else if (result?.cancelled) {
            console.log(
              `${displayIndent}${colors.warning(`${icons.cross} ${subagentType}: Cancelled`)}`
            );
            console.log(`${displayIndent}${colors.textDim(`  Task: ${subagentName}`)}`);
          } else {
            console.log(
              `${displayIndent}${colors.error(`${icons.cross} ${subagentType}: Failed`)}`
            );
            console.log(`${displayIndent}${colors.textDim(`  Task: ${subagentName}`)}`);
            if (result?.message) {
              console.log(`${displayIndent}${colors.textDim(`  ${result.message}`)}`);
            }
          }
        } else if (isMcpTool) {
          // Special handling for MCP tools - show friendly summary
          console.log('');
          // Extract server name and tool name from tool name (format: serverName__toolName)
          let serverName = 'MCP';
          let toolDisplayName = tool;
          if (tool.includes('__')) {
            const parts = tool.split('__');
            serverName = parts[0];
            toolDisplayName = parts.slice(1).join('__');
          }

          // Try to extract meaningful content from MCP result
          let summary = '';
          if (result?.content && Array.isArray(result.content) && result.content.length > 0) {
            const firstBlock = result.content[0];
            if (firstBlock?.type === 'text' && firstBlock?.text) {
              const text = firstBlock.text;
              if (typeof text === 'string') {
                // Detect HTML content
                if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
                  summary = '[HTML content fetched]';
                } else {
                  // Try to parse if it's JSON
                  try {
                    const parsed = JSON.parse(text);
                    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.title) {
                      // Search results format
                      summary = `Found ${parsed.length} result(s)`;
                    } else if (parsed?.message) {
                      summary = parsed.message;
                    } else if (typeof parsed === 'string') {
                      summary = parsed.substring(0, 100);
                    }
                  } catch {
                    // Not JSON, use as-is with truncation
                    summary = text.substring(0, 100);
                  }
                }
              }
            }
          } else if (result?.message) {
            summary = result.message;
          }

          if (result?.success !== false) {
            console.log(
              `${displayIndent}${colors.success(`${icons.check} ${serverName}: Success`)}`
            );
            console.log(`${displayIndent}${colors.textDim(`  Tool: ${toolDisplayName}`)}`);
            if (summary) {
              console.log(`${displayIndent}${colors.textDim(`  ${summary}`)}`);
            }
          } else {
            console.log(`${displayIndent}${colors.error(`${icons.cross} ${serverName}: Failed`)}`);
            console.log(`${displayIndent}${colors.textDim(`  Tool: ${toolDisplayName}`)}`);
            if (result?.message || result?.error) {
              console.log(
                `${displayIndent}${colors.textDim(`  ${result?.message || result?.error}`)}`
              );
            }
          }
        } else if (tool === 'InvokeSkill') {
          // Special handling for InvokeSkill - show friendly summary
          console.log('');
          const skillName = params?.skillId || 'Unknown skill';
          const taskDesc = params?.taskDescription || '';

          if (result?.success) {
            console.log(`${displayIndent}${colors.success(`${icons.check} Skill: Completed`)}`);
            console.log(`${displayIndent}${colors.textDim(`  Skill: ${skillName}`)}`);
            if (taskDesc) {
              const truncatedTask =
                taskDesc.length > 60 ? taskDesc.substring(0, 60) + '...' : taskDesc;
              console.log(`${displayIndent}${colors.textDim(`  Task: ${truncatedTask}`)}`);
            }
          } else {
            console.log(`${displayIndent}${colors.error(`${icons.cross} Skill: Failed`)}`);
            console.log(`${displayIndent}${colors.textDim(`  Skill: ${skillName}`)}`);
            if (result?.message) {
              console.log(`${displayIndent}${colors.textDim(`  ${result.message}`)}`);
            }
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
          // Show brief preview by default (consistent with subagent behavior)
          const resultPreview =
            typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          const truncatedPreview =
            resultPreview.length > 200 ? resultPreview.substring(0, 200) + '...' : resultPreview;
          // Indent the preview
          const indentedPreview = truncatedPreview
            .split('\n')
            .map((line) => `${displayIndent}  ${line}`)
            .join('\n');
          console.log(`${indentedPreview}`);
        } else {
          console.log(`${displayIndent}${colors.textDim('(no result)')}`);
        }

        const toolCallRecord: ToolCall = {
          tool,
          params,
          result,
          timestamp: Date.now(),
        };

        this.tool_calls.push(toolCallRecord);

        // Record tool output to session manager
        await this.sessionManager.addOutput({
          role: 'tool',
          content: JSON.stringify(result),
          toolName: tool,
          toolParams: params,
          toolResult: result,
          timestamp: Date.now(),
        });

        // Unified message format with tool name and params
        // Format: OpenAI-compatible tool result with plain text content
        // MiniMax requires content to be plain text, not JSON string
        this.conversation.push({
          role: 'tool',
          content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          tool_call_id: toolCall.id,
          timestamp: Date.now(),
        });
      }
    }

    // Logic: Only skip returning results to main agent when user explicitly cancelled (ESC)
    // For all other cases (success, failure, errors), always return results for further processing
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

    // Continue based on mode - unified handling for both success and error cases
    if (onComplete) {
      await this.checkAndCompressContext();
      // Remote mode: use provided callback
      await onComplete();
    } else {
      await this.checkAndCompressContext();
      // Local mode: default behavior - continue with generateResponse
      await this.generateResponse();
    }
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
      SearchFiles: (p) => `Search files: ${p.pattern}`,
      DeleteFile: (p) => `Delete file: ${this.truncatePath(p.filePath)}`,
      CreateDirectory: (p) => `Create directory: ${this.truncatePath(p.dirPath)}`,
      Edit: (p) => `Edit text: ${this.truncatePath(p.file_path)}`,
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
   * Get the current taskId for this user interaction
   * Used by GUI operations to track the same task
   */
  getTaskId(): string | null {
    return this.currentTaskId;
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
