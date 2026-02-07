import { select, confirm, text } from '@clack/prompts';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { ExecutionMode, ChatMessage, InputType, Checkpoint, AgentConfig, CompressionConfig, AuthType } from './types.js';
import { fetchDefaultModels } from './ai-client/providers/remote.js';
import { getToolRegistry } from './tools.js';
import { getAgentManager } from './agents.js';
import { getMemoryManager, MemoryFile } from './memory.js';
import { getMCPManager, MCPServer } from './mcp.js';
import { getCheckpointManager } from './checkpoint.js';
import { getConfigManager, ConfigManager } from './config.js';
import { getLogger } from './logger.js';
import {
  getContextCompressor,
  ContextCompressor,
  CompressionResult,
} from './context-compressor.js';
import { getConversationManager, ConversationManager } from './conversation.js';
import { icons, colors } from './theme.js';
import { ensureTtySane } from './terminal.js';
import { AuthService, selectAuthType, ThirdPartyProvider, THIRD_PARTY_PROVIDERS, VLM_PROVIDERS, VLMProviderInfo } from './auth.js';

const logger = getLogger();

export class SlashCommandHandler {
  private configManager: ConfigManager;
  private agentManager: any;
  private memoryManager: any;
  private mcpManager: any;
  private checkpointManager: any;
  private contextCompressor: ContextCompressor;
  private conversationManager: ConversationManager;
  private conversationHistory: ChatMessage[] = [];
  private onClearCallback: (() => void) | null = null;
  private onSystemPromptUpdate: (() => Promise<void>) | null = null;
  private onConfigUpdate: (() => void) | null = null;
  private remoteAIClient: any = null; // Reference to InteractiveSession's remoteAIClient

  constructor() {
    this.configManager = getConfigManager(process.cwd());
    this.agentManager = getAgentManager(process.cwd());
    this.memoryManager = getMemoryManager(process.cwd());
    this.mcpManager = getMCPManager();
    this.checkpointManager = getCheckpointManager(process.cwd());
    this.contextCompressor = getContextCompressor();
    this.conversationManager = getConversationManager();
  }

  /**
   * Set remote AI client reference (called from InteractiveSession)
   */
  setRemoteAIClient(client: any): void {
    this.remoteAIClient = client;
  }

  /**
   * Set callback for clearing conversation
   */
  setClearCallback(callback: () => void): void {
    this.onClearCallback = callback;
  }

  /**
   * Set callback for system prompt update
   */
  setSystemPromptUpdateCallback(callback: () => Promise<void>): void {
    this.onSystemPromptUpdate = callback;
  }

  /**
   * Set callback for config update (called after /auth changes config)
   */
  setConfigUpdateCallback(callback: () => void): void {
    this.onConfigUpdate = callback;
  }

  /**
   * Set current conversation history (includes all user/assistant/tool messages)
   */
  setConversationHistory(messages: ChatMessage[]): void {
    this.conversationHistory = messages;
  }

  async handleCommand(input: string): Promise<boolean> {
    if (!input.startsWith('/')) {
      return false;
    }

    const [command, ...args] = input.slice(1).split(' ');

    switch (command.toLowerCase()) {
      case 'help':
        await this.showHelp();
        break;
      case 'init':
        await this.handleInit();
        break;
      case 'clear':
        await this.handleClear();
        break;
      case 'exit':
      case 'quit':
        await this.handleExit();
        break;
      case 'auth':
        await this.handleAuth();
        break;
      case 'login':
        await this.handleLogin();
        break;
      case 'mode':
        await this.handleMode(args);
        break;
      case 'think':
        await this.handleThink(args);
        break;
      case 'agents':
        await this.handleAgents(args);
        break;
      case 'mcp':
        await this.handleMcp(args);
        break;
      case 'skill':
        await this.handleSkill(args);
        break;
      case 'model':
        await this.handleModel();
        break;
      case 'memory':
        await this.handleMemory(args);
        break;
      case 'restore':
        await this.handleRestore(args);
        break;
      case 'tools':
        await this.handleToolsVerbose(args);
        break;
      case 'stats':
        await this.handleStats();
        break;
      case 'theme':
        await this.handleTheme();
        break;
      // case 'language':
      //   await this.handleLanguage();
      //   break;
      case 'about':
        await this.handleAbout();
        break;
      case 'compress':
        await this.handleCompress(args);
        break;
      case 'update':
        await this.handleUpdate();
        break;
      default:
        logger.warn(`Unknown command: /${command}`, 'Type /help for available commands');
    }

    // Ensure stdin is in raw mode for proper input handling after @clack/prompts usage
    ensureTtySane();

    return true;
  }

  private async showHelp(): Promise<void> {
    const separator = icons.separator.repeat(Math.min(60, process.stdout.columns || 80));

    console.log('');
    console.log(
      colors.primaryBright('╔════════════════════════════════════════════════════════════╗')
    );
    console.log(colors.primaryBright('║') + ' '.repeat(56) + colors.primaryBright('║'));
    console.log(
      ' '.repeat(14) +
        colors.gradient('📚 XAGENT CLI Help') +
        ' '.repeat(31) +
        colors.primaryBright('║')
    );
    console.log(colors.primaryBright('║') + ' '.repeat(56) + colors.primaryBright('║'));
    console.log(
      colors.primaryBright('╚════════════════════════════════════════════════════════════╝')
    );
    console.log('');

    // Shortcuts
    console.log(colors.accent('Shortcuts'));
    console.log(colors.border(separator));
    console.log('');
    console.log(
      colors.textDim(`  ${colors.accent('!')}  - ${colors.textMuted('Enter bash mode')}`)
    );
    console.log(colors.textDim(`  ${colors.accent('/')}  - ${colors.textMuted('Commands')}`));
    console.log(colors.textDim(`  ${colors.accent('@')}  - ${colors.textMuted('File paths')}`));
    console.log('');

    // Basic Commands
    this.showHelpCategory('Basic Commands', [
      {
        cmd: '/help [command]',
        desc: 'Show help information',
        detail: 'View all available commands or detailed description of specific command',
        example: '/help\n/help mode',
      },
      {
        cmd: '/clear',
        desc: 'Clear conversation history',
        detail: 'Clear all conversation records of current session, start new conversation',
        example: '/clear',
      },
      {
        cmd: '/exit',
        desc: 'Exit program',
        detail: 'Safely exit XAGENT CLI',
        example: '/exit',
      },
    ]);

    // Project Management
    this.showHelpCategory('Project Management', [
      {
        cmd: '/init',
        desc: 'Initialize project context',
        detail:
          'Create XAGENT.md file in current directory, used to store project context information',
        example: '/init',
      },
      {
        cmd: '/memory [show|clear]',
        desc: 'Manage project memory',
        detail: 'View or clear memory (global, current, all, or filename)',
        example: '/memory show\n/memory clear\n/memory clear global\n/memory clear all',
      },
    ]);

    // Authentication & Configuration
    this.showHelpCategory('Authentication & Configuration', [
      {
        cmd: '/auth',
        desc: 'Configure authentication information',
        detail: 'Change or view current authentication configuration',
        example: '/auth',
      },
      {
        cmd: '/mode [mode]',
        desc: 'Switch approval mode',
        detail: 'Switch security approval mode for tool execution',
        example: '/mode\n/mode smart\n/mode yolo',
        modes: [
          'yolo - Execute all operations without restriction',
          'accept_edits - Automatically accept edit operations',
          'plan - Plan before executing',
          'default - Safe execution, requires confirmation',
          'smart - Smart approval (recommended)',
        ],
      },
      {
        cmd: '/think [on|off|display]',
        desc: 'Control thinking mode',
        detail: 'Enable/disable AI thinking process display',
        example: '/think on\n/think off\n/think display compact',
      },
      // {
      //   cmd: '/language [zh|en]',
      //   desc: 'Switch language',
      //   detail: 'Switch between Chinese and English interface',
      //   example: '/language zh\n/language en'
      // },
      {
        cmd: '/theme',
        desc: 'Switch theme',
        detail: 'Change UI theme style',
        example: '/theme',
      },
    ]);

    // Feature Extensions
    this.showHelpCategory('Feature Extensions', [
      {
        cmd: '/agents [list|online|install|remove]',
        desc: 'Manage sub-agents',
        detail: 'View, install or remove specialized AI sub-agents',
        example: '/agents list\n/agents online\n/agents install explore-agent',
      },
      {
        cmd: '/mcp [list|add|remove|refresh]',
        desc: 'Manage MCP servers',
        detail: 'Manage Model Context Protocol servers',
        example: '/mcp list\n/mcp add server-name',
      },
      {
        cmd: '/skill [list|add|remove]',
        desc: 'Manage skills',
        detail: 'Install, list, or remove skills from ~/.xagent/skills',
        example: '/skill list\n/skill add ./my-skill\n/skill add owner/repo\n/skill remove my-skill'
      },
      {
        cmd: '/vlm',
        desc: 'Configure VLM for GUI Agent',
        detail: 'Configure Vision-Language Model for browser/desktop automation',
        example: '/vlm'
      },
      {
        cmd: '/model',
        desc: 'Configure LLM/VLM models',
        detail: 'Configure or switch LLM and VLM models for remote mode',
        example: '/model',
      },
      {
        cmd: '/tools [verbose|simple]',
        desc: 'Manage tool display',
        detail: 'View available tools or switch tool call display mode',
        example: '/tools\n/tools verbose\n/tools simple',
      },
    ]);

    // Advanced Features
    this.showHelpCategory('Advanced Features', [
      {
        cmd: '/restore',
        desc: 'Restore from checkpoint',
        detail: 'Restore conversation state from historical checkpoints',
        example: '/restore',
      },
      {
        cmd: '/compress [on|off|max_message|max_token|exec]',
        desc: 'Manage context compression',
        detail: 'Configure compression settings or execute compression manually',
        example:
          '/compress\n/compress exec\n/compress on\n/compress max_message 50\n/compress max_token 1500000',
      },
      {
        cmd: '/stats',
        desc: 'Show session statistics',
        detail: 'View statistics information of current session',
        example: '/stats',
      },
      {
        cmd: '/about',
        desc: 'Show version information',
        detail: 'View version and related information of XAGENT CLI',
        example: '/about',
      },
      {
        cmd: '/update',
        desc: 'Check for updates',
        detail: 'Check for new versions and update xAgent CLI',
        example: '/update',
      },
    ]);

    // Keyboard Shortcuts
    console.log('');
    console.log(colors.border(separator));
    console.log(colors.primaryBright('Keyboard Shortcuts'));
    console.log(colors.border(separator));
    console.log('');
    console.log(colors.textMuted('  ESC       - Cancel current operation'));
    console.log(colors.textMuted('  Ctrl+C    - Exit program'));
    console.log('');
  }

  private showHelpCategory(
    title: string,
    commands: Array<{
      cmd: string;
      desc: string;
      detail: string;
      example: string;
      modes?: string[];
    }>
  ): void {
    const separator = icons.separator.repeat(Math.min(60, process.stdout.columns || 80));

    console.log('');
    console.log(colors.border(separator));
    console.log(colors.primaryBright(title));
    console.log(colors.border(separator));
    console.log('');

    commands.forEach((cmd) => {
      console.log(colors.primaryBright(`  ${cmd.cmd}`));
      console.log(colors.textDim(`    ${cmd.desc}`));
      console.log(colors.textMuted(`    ${cmd.detail}`));

      if (cmd.modes) {
        console.log(colors.textDim(`    Available modes:`));
        cmd.modes.forEach((mode) => {
          console.log(colors.textDim(`      • ${mode}`));
        });
      }

      console.log(colors.accent(`    Examples:`));
      cmd.example.split('\n').forEach((ex) => {
        console.log(colors.codeText(`      ${ex}`));
      });
      console.log('');
    });
  }

  private async handleInit(): Promise<void> {
    const spinner = ora('Initializing project...').start();

    try {
      await this.memoryManager.initializeProject(process.cwd());
      spinner.succeed('Project initialized successfully');
    } catch (error: any) {
      spinner.fail(`Initialization failed: ${error.message}`);
    }
  }

  private async handleClear(): Promise<void> {
    // Clear local conversation history
    this.conversationHistory = [];

    // Clear current conversation in ConversationManager
    await this.conversationManager.clearCurrentConversation();

    // Call callback to notify InteractiveSession to clear conversation
    if (this.onClearCallback) {
      this.onClearCallback();
    }

    logger.success('Conversation history cleared', 'Start a new conversation');
  }

  private async handleExit(): Promise<void> {
    logger.info('Goodbye!', 'Thank you for using xAgent CLI');
    process.exit(0);
  }

  private async handleAuth(): Promise<void> {
    logger.section('Authentication Management');

    // Show current authentication configuration
    const authConfig = this.configManager.getAuthConfig();
    const isRemote = authConfig.type === AuthType.OAUTH_XAGENT;
    const currentType = isRemote ? 'xAgent (Remote)' : 'Third-party API (Local)';

    console.log(chalk.cyan('\n📋 Current Authentication Configuration:\n'));
    console.log(`  ${chalk.yellow('Mode:')} ${currentType}`);

    if (isRemote) {
      // Remote mode: show remote_llmModelName and remote_vlmModelName
      const llmModel = authConfig.remote_llmModelName || 'Not set';
      const vlmModel = authConfig.remote_vlmModelName || 'Not set';
      console.log(`  ${chalk.yellow('LLM Model:')} ${llmModel}`);
      console.log(`  ${chalk.yellow('VLM Model:')} ${vlmModel}`);
    } else {
      // Local mode: show modelName (LLM) and guiSubagentModel (VLM)
      const llmModel = authConfig.modelName || 'Not set';
      const vlmModel = this.configManager.get('guiSubagentModel') || 'Not set';
      console.log(`  ${chalk.yellow('LLM Model:')} ${llmModel}`);
      console.log(`  ${chalk.yellow('VLM Model:')} ${vlmModel}`);
    }
    console.log('');

    const action = await select({
      message: 'Select action:',
      options: [
        { value: 'switch', label: 'Switch authentication method' },
        { value: 'back', label: 'Back' },
      ],
    });

    if (action === 'back') {
      return;
    }

    if (action === 'switch') {
      // Use the same selection UI as initial setup
      const confirmSwitch = await confirm({
        message: `Switch from "${currentType}" to another authentication method?`,
      });

      if (confirmSwitch === false || confirmSwitch === undefined) {
        return;
      }

      // Select authentication type (same as initial setup)
      const authType = await selectAuthType();

      if (authType === AuthType.OAUTH_XAGENT) {
        // Switch to xAgent (Remote mode)
        const authService = new AuthService({
          type: AuthType.OAUTH_XAGENT,
          apiKey: '',
          baseUrl: '',
          xagentApiBaseUrl: authConfig.xagentApiBaseUrl,
        });

        const success = await authService.authenticate();
        if (success) {
          const newAuthConfig = authService.getAuthConfig();
          this.configManager.setAuthConfig({
            selectedAuthType: newAuthConfig.type,
            apiKey: newAuthConfig.apiKey,
            refreshToken: newAuthConfig.refreshToken,
            baseUrl: newAuthConfig.baseUrl,
            modelName: '',
            xagentApiBaseUrl: newAuthConfig.xagentApiBaseUrl,
            guiSubagentModel: '',
            guiSubagentBaseUrl: 'https://www.xagent-colife.net/v3',
            guiSubagentApiKey: '',
          });
          // Set default remote model settings if not already set
          // Fetch default models from /models/default endpoint
          const webBaseUrl = newAuthConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
          let defaultLlmName = '';
          let defaultVlmName = '';

          try {
            console.log(chalk.cyan('\n📊 Fetching default models from remote server...'));
            const defaults = await fetchDefaultModels(newAuthConfig.apiKey || '', webBaseUrl);

            if (defaults.llm?.name) {
              defaultLlmName = defaults.llm.name;
              console.log(chalk.cyan(`   LLM Model: ${defaults.llm.name}`));
            }
            if (defaults.vlm?.name) {
              defaultVlmName = defaults.vlm.name;
              console.log(chalk.cyan(`   VLM Model: ${defaults.vlm.name}`));
            }
          } catch (error: any) {
            console.log(chalk.yellow(`   ⚠️  Failed to fetch default models: ${error.message}`));
            console.log(chalk.yellow('   ⚠️  Use /model command to select models manually.'));
          }

          console.log('');

          this.configManager.set('remote_llmModelName', defaultLlmName);
          this.configManager.set('remote_vlmModelName', defaultVlmName);
          this.configManager.save('global');

          // Notify InteractiveSession to update aiClient config
          if (this.onConfigUpdate) {
            this.onConfigUpdate();
          }

          console.log(chalk.green('\n✅ Authentication switched to xAgent (Remote mode)!'));
          // Removed: logging partial token for security
        }
      } else {
        // Switch to Third-party API (Local mode)
        const authService = new AuthService({
          type: AuthType.OPENAI_COMPATIBLE,
          apiKey: '',
          baseUrl: '',
          modelName: '',
        });

        const success = await authService.authenticate();
        if (success) {
          const newAuthConfig = authService.getAuthConfig();
          this.configManager.setAuthConfig({
            selectedAuthType: newAuthConfig.type,
            apiKey: newAuthConfig.apiKey,
            baseUrl: newAuthConfig.baseUrl,
            modelName: newAuthConfig.modelName,
            xagentApiBaseUrl: '',
            refreshToken: '',
            guiSubagentModel: '',
            guiSubagentBaseUrl: '',
            guiSubagentApiKey: '',
          });
          this.configManager.save('global');

          // Notify InteractiveSession to update aiClient config
          if (this.onConfigUpdate) {
            this.onConfigUpdate();
          }

          console.log(chalk.green('\n✅ Authentication switched to Third-party API (Local mode)!'));
        }
      }
    }
  }

  private async handleLogin(): Promise<void> {
    logger.section('Login to xAgent');

    const authConfig = this.configManager.getAuthConfig();
    const currentAuthType = authConfig.type;

    if (currentAuthType !== AuthType.OAUTH_XAGENT) {
      console.log(chalk.yellow('\n⚠️  Current authentication type is not OAuth xAgent.'));
      const proceed = await confirm({
        message: 'Do you want to switch to OAuth xAgent authentication?',
      });

      if (proceed === false || proceed === undefined) {
        return;
      }

      // Switch to OAuth xAgent
      this.configManager.setAuthConfig({
        selectedAuthType: AuthType.OAUTH_XAGENT,
        apiKey: '',
        refreshToken: '',
        baseUrl: '',
      });
      this.configManager.save('global');
      console.log(chalk.green('✅ Switched to OAuth xAgent authentication.'));
    }

    console.log(chalk.cyan('\n🔐 Starting OAuth xAgent login...'));
    console.log(chalk.gray('   A browser will open for you to complete authentication.\n'));

    try {
      // Get xagentApiBaseUrl from config (respects XAGENT_BASE_URL env var)
      const config = this.configManager.getAuthConfig();

      const authService = new AuthService({
        type: AuthType.OAUTH_XAGENT,
        apiKey: '',
        baseUrl: '',
        refreshToken: '',
        xagentApiBaseUrl: config.xagentApiBaseUrl,
      });

      const success = await authService.authenticate();

      if (success) {
        console.log(chalk.green('\n✅ Login successful!'));
        console.log(chalk.cyan(`   Token saved to: ~/.xagent/settings.json`));
        console.log(chalk.gray('   You can now use xAgent CLI with remote AI services.\n'));
      } else {
        console.log(chalk.red('\n❌ Login failed or was cancelled.'));
      }
    } catch (error: any) {
      console.log(chalk.red(`\n❌ Login error: ${error.message || 'Unknown error'}`));
    }
  }

  /**
   * Handle /model command - Configure LLM/VLM models
   * Supports both remote mode (xAgent) and local mode (third-party API)
   */
  private async handleModel(): Promise<void> {
    const authConfig = this.configManager.getAuthConfig();

    // Determine mode and show appropriate UI
    if (authConfig.type === AuthType.OAUTH_XAGENT) {
      // Remote mode - use backend models
      await this.handleRemoteModel();
    } else {
      // Local mode - configure third-party API directly
      await this.handleLocalModel();
    }
  }

  /**
   * Handle /model command for remote mode - Configure models from backend
   */
  private async handleRemoteModel(): Promise<void> {
    const authConfig = this.configManager.getAuthConfig();

    // Auto-fetch default models if not set
    let currentLlm = authConfig.remote_llmModelName;
    let currentVlm = authConfig.remote_vlmModelName;

    if (!currentLlm || !currentVlm) {
      console.log(chalk.cyan('\n📊 Fetching default models from remote server...'));

      // Try to use RemoteAIClient first, otherwise fetch directly
      let defaults: { llm?: { name: string; displayName?: string }; vlm?: { name: string; displayName?: string } } | null = null;

      if (this.remoteAIClient) {
        try {
          defaults = await this.remoteAIClient.getDefaultModels();
        } catch (error: any) {
          console.log(chalk.yellow(`   ⚠️  Failed to get defaults from RemoteAIClient: ${error.message}`));
        }
      }

      // If RemoteAIClient failed or not available, fetch directly
      if (!defaults) {
        try {
          const webBaseUrl = authConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
          defaults = await fetchDefaultModels(authConfig.apiKey || '', webBaseUrl);
        } catch (error: any) {
          console.log(chalk.yellow(`   ⚠️  Failed to fetch default models: ${error.message}`));
        }
      }

      if (defaults) {
        if (!currentLlm && defaults.llm?.name) {
          currentLlm = defaults.llm.name;
          this.configManager.set('remote_llmModelName', currentLlm);
          console.log(chalk.cyan(`   Default LLM: ${defaults.llm.displayName || currentLlm}`));
        }
        if (!currentVlm && defaults.vlm?.name) {
          currentVlm = defaults.vlm.name;
          this.configManager.set('remote_vlmModelName', currentVlm);
          console.log(chalk.cyan(`   Default VLM: ${defaults.vlm.displayName || currentVlm}`));
        }
        this.configManager.save('global');
      } else {
        console.log(chalk.yellow('   ⚠️  Use /auth to configure remote mode first.'));
        return;
      }
    }

    // Get RemoteAIClient instance (from InteractiveSession) for model selection
    const remoteClient = this.remoteAIClient;

    // Display current configuration
    console.log(chalk.cyan('\n📊 Current Model Configuration:\n'));
    console.log(`  ${chalk.yellow('LLM Model:')} ${currentLlm || 'Not set'}`);
    console.log(`  ${chalk.yellow('VLM Model:')} ${currentVlm || 'Not set'}`);
    console.log('');

    // Main menu
    const action = await select({
      message: 'Select action:',
      options: [
        { value: 'llm', label: 'Change LLM model' },
        { value: 'vlm', label: 'Change VLM model' },
        { value: 'back', label: 'Back' },
      ],
    }) as string | symbol;

    if (action === 'back' || typeof action === 'symbol') {
      return;
    }

    // Restore stdin raw mode after @clack/prompts interaction
    ensureTtySane();

    // Get and display provider list
    try {
      const models = await remoteClient.getRemoteModels();
      const modelList = action === 'llm' ? models.llm : models.vlm;

      if (modelList.length === 0) {
        console.log(chalk.yellow('\n⚠️  No models available.'));
        return;
      }

      // Build choice list
      const choices = modelList.map((m: any) => ({
        name: `${m.displayName} (${m.name})`,
        value: m.name
      }));

      const selectedModel = await select({
        message: action === 'llm' ? 'Select LLM Model:' : 'Select VLM Model:',
        options: choices
      });

      if (typeof selectedModel !== 'string') {
        return;
      }

      const configKey = action === 'llm' ? 'remote_llmModelName' : 'remote_vlmModelName';
      this.configManager.set(configKey, selectedModel);
      this.configManager.save('global');

      // Clear conversation history to avoid tool call ID conflicts between providers
      if (this.onClearCallback) {
        this.onClearCallback();
        console.log(
          chalk.cyan('   Conversation cleared to avoid tool call ID conflicts between models.')
        );
      }

      // Notify InteractiveSession to update aiClient config
      if (this.onConfigUpdate) {
        this.onConfigUpdate();
      }

      console.log(chalk.green('\n✅ Model updated successfully!'));
      console.log(`   ${action === 'llm' ? 'LLM' : 'VLM'}: ${selectedModel}`);
    } catch (error: any) {
      console.log(chalk.red(`\n❌ Failed to get models: ${error.message}`));
    }
  }

  /**
   * Handle /model command for local mode - Configure third-party API directly
   * Reuses code from initial setup flow (authenticateWithOpenAICompatible and configureAndValidateVLM)
   */
  private async handleLocalModel(): Promise<void> {
    // Display current configuration
    const currentLlmModel = this.configManager.get('modelName') || this.configManager.getAuthConfig().modelName;
    const currentVlmModel = this.configManager.get('guiSubagentModel');

    console.log(chalk.cyan('\n📊 Current Local Model Configuration:\n'));
    console.log(`  ${chalk.yellow('LLM Model:')} ${currentLlmModel || 'Not set'}`);
    console.log(`  ${chalk.yellow('VLM Model:')} ${currentVlmModel || 'Not set'}`);
    console.log('');

    // Main menu - choose to configure LLM or VLM
    const action = await select({
      message: 'Select action:',
      options: [
        { value: 'llm', label: 'Change LLM (select provider and API)' },
        { value: 'vlm', label: 'Change VLM (for GUI automation)' },
        { value: 'back', label: 'Back' },
      ],
    }) as string | symbol;

    if (action === 'back' || typeof action === 'symbol') {
      return;
    }

    if (action === 'llm') {
      await this.configureLocalLLM();
    } else if (action === 'vlm') {
      await this.configureLocalVLM();
    }
  }

  /**
   * Configure LLM for local mode - Reuses authenticateWithOpenAICompatible logic
   */
  private async configureLocalLLM(): Promise<void> {
    // THIRD_PARTY_PROVIDERS already imported at top level
    const provider = await select({
      message: 'Select third-party model provider:',
      options: THIRD_PARTY_PROVIDERS.map((p) => ({
        value: p,
        label: `${p.name} - ${p.description}`,
      })),
    }) as ThirdPartyProvider | symbol;

    if (typeof provider === 'symbol') {
      return;
    }

    const selectedProvider = provider;

    let baseUrl = selectedProvider.baseUrl;
    let modelName = selectedProvider.defaultModel;

    if (selectedProvider.name === 'Custom') {
      baseUrl = (await import('@clack/prompts').then(m =>
        m.text({
          message: 'Enter API Base URL:',
          defaultValue: 'https://api.openai.com/v1',
          validate: (value: string | undefined) => {
            if (!value || value.trim().length === 0) {
              return 'Base URL cannot be empty';
            }
            return undefined;
          },
        })
      )) as string;

      modelName = (await import('@clack/prompts').then(m =>
        m.text({
          message: 'Enter model name:',
          defaultValue: 'gpt-4',
          validate: (value: string | undefined) => {
            if (!value || value.trim().length === 0) {
              return 'Model name cannot be empty';
            }
            return undefined;
          },
        })
      )) as string;

      baseUrl = baseUrl.trim();
      modelName = modelName.trim();
    } else {
      console.log(chalk.cyan(`\nSelected: ${selectedProvider.name}`));
      console.log(chalk.cyan(`API URL: ${baseUrl}`));

      if (selectedProvider.models && selectedProvider.models.length > 0) {
        console.log(chalk.cyan(`Available models: ${selectedProvider.models.join(', ')}`));

        const selectedModel = await select({
          message: 'Select model:',
          options: selectedProvider.models.map((model) => ({
            value: model,
            label: model === selectedProvider.defaultModel ? `${model} (default)` : model,
          })),
        }) as string | symbol;

        if (typeof selectedModel === 'symbol') {
          return;
        }

        modelName = selectedModel as string;
      } else {
        console.log(chalk.cyan(`Default model: ${modelName}`));

        const confirmModel = (await import('@clack/prompts').then(m =>
          m.text({
            message: `Enter model name (press Enter to use default value ${modelName}):`,
            defaultValue: modelName,
            validate: (value: string | undefined) => {
              if (!value || value.trim().length === 0) {
                return 'Model name cannot be empty';
              }
              return undefined;
            },
          })
        )) as string;

        modelName = confirmModel.trim();
      }
    }

    const apiKey = (await import('@clack/prompts').then(m =>
      m.password({
      message: `Enter ${selectedProvider.name} API Key:`,
      validate: (value: string | undefined) => {
        if (!value || value.trim().length === 0) {
          return 'API Key cannot be empty';
        }
        return undefined;
      },
      })
    )) as string;

    // Update config
    this.configManager.set('baseUrl', baseUrl);
    this.configManager.set('apiKey', apiKey.trim());
    this.configManager.set('modelName', modelName);
    this.configManager.save('global');

    console.log(chalk.green('\n✅ LLM configuration updated successfully!'));
    console.log(chalk.cyan(`   Provider: ${selectedProvider.name}`));
    console.log(chalk.cyan(`   Model: ${modelName}`));
    console.log(chalk.cyan(`   API URL: ${baseUrl}`));

    // Clear conversation and notify config update
    if (this.onClearCallback) {
      this.onClearCallback();
    }
    if (this.onConfigUpdate) {
      this.onConfigUpdate();
    }
  }

  /**
   * Configure VLM for local mode - Select provider and modelName (baseUrl from VLM_PROVIDERS)
   */
  private async configureLocalVLM(): Promise<void> {
    // Get current VLM config
    const currentModel = this.configManager.get('guiSubagentModel');
    const currentBaseUrl = this.configManager.get('guiSubagentBaseUrl');

    console.log(chalk.cyan('\n📊 Current VLM Configuration:\n'));
    console.log(`  ${chalk.yellow('Model:')} ${currentModel || 'Not set'}`);
    console.log(`  ${chalk.yellow('Base URL:')} ${currentBaseUrl || 'Not set'}`);
    console.log('');

    // Step 1: Select VLM provider
    const provider = await select({
      message: 'Select VLM provider:',
      options: VLM_PROVIDERS.map((p) => ({
        value: p,
        label: `${p.name} - ${p.defaultModel}`,
      })),
    }) as VLMProviderInfo | symbol;

    // User cancelled
    if (typeof provider === 'symbol') {
      return;
    }

    const selectedProvider = provider;

    // Step 2: Select model from provider's models list
    const model = await select({
      message: 'Select VLM Model:',
      options: selectedProvider.models.map((m) => ({
        value: m,
        label: m,
      })),
    }) as string | symbol;

    // User cancelled
    if (typeof model === 'symbol') {
      return;
    }

    // Step 3: Get API Key
    const apiKey = (await text({
      message: `Enter ${selectedProvider.name} API Key:`,
      validate: (value: string | undefined) => {
        if (!value || value.trim().length === 0) {
          return 'API Key cannot be empty';
        }
        return undefined;
      },
    })) as string;

    // Save configuration
    this.configManager.set('guiSubagentModel', model);
    this.configManager.set('guiSubagentBaseUrl', selectedProvider.baseUrl);
    this.configManager.set('guiSubagentApiKey', apiKey);
    this.configManager.save('global');

    console.log(chalk.green('\n✅ VLM configuration updated successfully!'));
    console.log(chalk.cyan(`   Provider: ${selectedProvider.name}`));
    console.log(chalk.cyan(`   Model: ${model}`));
    console.log(chalk.cyan(`   Base URL: ${selectedProvider.baseUrl}`));

    // Notify config update
    if (this.onConfigUpdate) {
      this.onConfigUpdate();
    }
  }

  private async handleMode(args: string[]): Promise<void> {
    const modes = Object.values(ExecutionMode);
    const currentMode =
      this.configManager.getApprovalMode() || this.configManager.getExecutionMode();

    if (args.length > 0) {
      const newMode = args[0].toLowerCase();
      if (modes.includes(newMode as ExecutionMode)) {
        this.configManager.setApprovalMode(newMode as ExecutionMode);
        this.configManager.save('global');
        console.log(chalk.green(`✅ Approval mode changed to: ${newMode}`));
      } else {
        console.log(chalk.red(`❌ Invalid mode: ${newMode}`));
        console.log(chalk.gray(`Available modes: ${modes.join(', ')}`));
      }
    } else {
      console.log(chalk.cyan('\n🎯 Approval Modes:\n'));
      console.log(`  Current: ${chalk.green(currentMode)}\n`);

      const descriptions = [
        { mode: 'yolo', desc: 'Execute commands without confirmation' },
        { mode: 'accept_edits', desc: 'Accept all edits automatically' },
        { mode: 'plan', desc: 'Plan before executing' },
        { mode: 'default', desc: 'Safe execution with confirmations' },
        { mode: 'smart', desc: 'Smart approval with intelligent security checks' },
      ];

      descriptions.forEach(({ mode, desc }) => {
        const current = mode === currentMode ? chalk.green(' [current]') : '';
        console.log(`  ${chalk.yellow(mode)}${current}`);
        console.log(`    ${chalk.gray(desc)}`);
      });

      console.log();
    }
  }

  private async handleThink(args: string[]): Promise<void> {
    const thinkingConfig = this.configManager.getThinkingConfig();

    if (args.length > 0) {
      const action = args[0].toLowerCase();

      if (action === 'on' || action === 'true' || action === '1') {
        thinkingConfig.enabled = true;
        this.configManager.setThinkingConfig(thinkingConfig);
        this.configManager.save('global');
        console.log(chalk.green('✅ Thinking mode enabled'));
      } else if (action === 'off' || action === 'false' || action === '0') {
        thinkingConfig.enabled = false;
        this.configManager.setThinkingConfig(thinkingConfig);
        this.configManager.save('global');
        console.log(chalk.green('✅ Thinking mode disabled'));
      } else if (action === 'display' && args[1]) {
        const displayMode = args[1].toLowerCase();
        const validModes = ['full', 'compact', 'indicator'];

        if (validModes.includes(displayMode)) {
          thinkingConfig.displayMode = displayMode as 'full' | 'compact' | 'indicator';
          thinkingConfig.enabled = true;
          this.configManager.setThinkingConfig(thinkingConfig);
          this.configManager.save('global');
          console.log(chalk.green(`✅ Thinking display mode set to: ${displayMode}`));
        } else {
          console.log(chalk.red(`❌ Invalid display mode: ${displayMode}`));
          console.log(chalk.gray(`Valid modes: ${validModes.join(', ')}`));
        }
      } else {
        console.log(chalk.red(`❌ Invalid action: ${action}`));
        console.log(chalk.gray('Usage: /think [on|off|display <mode>]'));
      }
    } else {
      console.log(chalk.cyan('\n🧠 Thinking Mode:\n'));
      console.log(
        `  Status: ${thinkingConfig.enabled ? chalk.green('Enabled') : chalk.red('Disabled')}`
      );
      console.log(`  Mode: ${chalk.yellow(thinkingConfig.mode)}`);
      console.log(`  Display: ${chalk.yellow(thinkingConfig.displayMode)}\n`);

      console.log(chalk.gray('Usage:'));
      console.log(chalk.gray('  /think on           - Enable thinking mode'));
      console.log(chalk.gray('  /think off          - Disable thinking mode'));
      console.log(chalk.gray('  /think display full - Show full thinking process'));
      console.log(chalk.gray('  /think display compact - Show compact thinking (500 chars)'));
      console.log(chalk.gray('  /think display indicator - Show only indicator'));
      console.log();
    }
  }

  private async handleAgents(args: string[]): Promise<void> {
    const action = args[0] || 'list';

    switch (action) {
      case 'list':
        await this.listAgents();
        break;
      case 'online':
        logger.warn('Online marketplace not implemented yet', 'Check back later for updates');
        break;
      case 'install':
        logger.warn(
          'Agent installation wizard not implemented yet',
          'Use /agents install in interactive mode'
        );
        break;
      case 'remove':
        logger.warn('Agent removal not implemented yet', 'Use /agents remove in interactive mode');
        break;
      default:
        logger.warn(
          `Unknown agents action: ${action}`,
          'Use /agents list to see available actions'
        );
    }
  }

  private async listAgents(): Promise<void> {
    const agents = this.agentManager.getAllAgents();

    if (agents.length === 0) {
      logger.warn('No agents configured', 'Use /agents install to add agents');
      return;
    }

    logger.section('Available Agents');

    agents.forEach((agent: AgentConfig) => {
      const color = agent.color || '#FFFFFF';
      logger.info(`  ${chalk.hex(color)(agent.name || agent.agentType)}`);
      logger.info(`    Type: ${agent.agentType}`);
      logger.info(`    ${agent.whenToUse}`);
    });
  }

  private async handleMcp(args: string[]): Promise<void> {
    const action = args[0] || 'list';

    switch (action) {
      case 'list':
        await this.listMcpServers();
        break;
      case 'add':
        if (args[1]) {
          // Non-interactive mode: use command line arguments
          await this.addMcpServerInteractive(args[1]);
        } else {
          // Interactive mode
          await this.addMcpServerInteractive();
        }
        break;
      case 'remove':
        if (args[1]) {
          // Non-interactive mode
          await this.removeMcpServer(args[1]);
        } else {
          // Interactive mode
          await this.removeMcpServerInteractive();
        }
        break;
      case 'refresh':
        await this.refreshMcpServers();
        break;
      default:
        logger.warn(`Unknown MCP action: ${action}`, 'Use /mcp list to see available actions');
    }
  }

  private async listMcpServers(): Promise<void> {
    const serverConfigs = this.mcpManager.getAllServerConfigs();

    if (serverConfigs.length === 0) {
      logger.section('MCP Servers');
      logger.warn('No MCP servers configured');
      logger.info('Use /mcp add to add a new MCP server');
      return;
    }

    logger.section('MCP Servers');

    serverConfigs.forEach(
      ({ name: serverName, config: serverConfig }: { name: string; config: any }) => {
        const server = this.mcpManager.getServer(serverName);
        const isConnected = server?.isServerConnected() || false;
        const status = isConnected ? chalk.green('✓ Connected') : chalk.red('✗ Disconnected');
        const tools = server?.getToolNames() || [];
        const transport = serverConfig?.transport || serverConfig?.type || 'unknown';
        const command = serverConfig?.command
          ? `${serverConfig.command} ${(serverConfig.args || []).join(' ')}`
          : serverConfig?.url || 'N/A';

        console.log('');
        console.log(`  ${chalk.cyan(serverName)} ${status}`);
        console.log(`    Transport: ${transport}`);
        console.log(`    Command: ${command}`);
        console.log(
          `    Tools: ${isConnected ? tools.length : 'N/A'} (${isConnected ? tools.join(', ') : 'wait for connection'})`
        );
      }
    );

    console.log('');
    logger.info(`Total: ${serverConfigs.length} server(s)`);
  }

  private async addMcpServerInteractive(serverName?: string): Promise<void> {
    const name = (await text({
      message: 'Enter MCP server name:',
      defaultValue: serverName,
      validate: (value: string | undefined) => {
        if (!value || !value.trim()) {
          return 'Server name is required';
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
          return 'Server name must contain only alphanumeric characters, hyphens, and underscores';
        }
        const servers = this.mcpManager.getAllServers();
        if (servers.some((s: MCPServer) => (s as any).config?.name === value)) {
          return 'Server with this name already exists';
        }
        return undefined;
      },
    })) as string;

    const transport = await select({
      message: 'Select transport type:',
      options: [
        { value: 'stdio', label: 'Stdio (stdin/stdout)' },
        { value: 'sse', label: 'HTTP/SSE' },
        { value: 'http', label: 'HTTP (POST)' },
      ],
    }) as string | symbol;

    if (typeof transport === 'symbol') {
      return;
    }

    let command = '';
    let serverArgs: string[] = [];
    let url = '';
    let authToken = '';
    let headers: Record<string, string> | string | undefined;

    if (transport === 'stdio') {
      command = (await text({
        message: 'Enter command (for stdio transport):',
        validate: (value: string | undefined) =>
          value && value.trim() ? undefined : 'Command is required',
      })) as string;

      const argsInput = (await text({
        message: 'Enter arguments (comma-separated, for stdio transport):',
        defaultValue: '',
      })) as string;

      if (argsInput.trim()) {
        serverArgs = argsInput.split(',').map((a: string) => a.trim());
      }
    } else {
      url = (await text({
        message: 'Enter server URL (for HTTP/SSE/HTTP transport):',
        validate: (value: string | undefined) => {
          if (!value || !value.trim()) {
            return 'URL is required';
          }
          try {
            new URL(value);
            return undefined;
          } catch {
            return 'Invalid URL format (e.g., https://example.com)';
          }
        },
      })) as string;

      authToken = (await text({
        message: 'Enter authentication token (optional):',
        defaultValue: '',
      })) as string;

      const headersInput = (await text({
        message:
          'Enter custom headers as JSON (optional, e.g., {"Authorization": "Bearer token"}):',
        defaultValue: '',
      })) as string;

      if (headersInput.trim()) {
        try {
          headers = JSON.parse(headersInput);
        } catch {
          headers = undefined;
        }
      }
    }

    const config: any = {
      transport: transport as 'stdio' | 'sse' | 'http',
    };

    if (transport === 'stdio') {
      config.command = command;
      if (serverArgs && serverArgs.length > 0) {
        config.args = serverArgs;
      }
    } else {
      config.url = url;

      // Handle user input that mistakenly puts Bearer token in headers field
      // Detect pattern: headers looks like "Bearer xxx.yyy.zzz" (JWT token)
      let resolvedAuthToken = authToken;
      let resolvedHeaders = headers;

      if (headers && typeof headers === 'string' && !authToken) {
        const trimmedHeaders = headers.trim();
        if (trimmedHeaders.startsWith('Bearer ') && trimmedHeaders.split('.').length === 3) {
          // User mistakenly put token in headers field - extract it
          resolvedAuthToken = trimmedHeaders;
          resolvedHeaders = undefined;
          console.log('[MCP] Note: Detected Bearer token in headers field, moved to authToken');
        }
      }

      if (resolvedAuthToken) {
        config.authToken = resolvedAuthToken;
      }
      if (resolvedHeaders) {
        config.headers = resolvedHeaders;
      }
    }

    try {
      this.configManager.addMcpServer(name, config);
      this.configManager.save('global');

      this.mcpManager.registerServer(name, config);

      try {
        await this.mcpManager.connectServer(name);
      } catch (error: any) {
        this.mcpManager.disconnectServer(name);
        this.configManager.removeMcpServer(name);
        this.configManager.save('global');
        throw new Error(`Connection failed: ${error.message}`);
      }

      // Register MCP tools with simple names
      const allMcpTools = this.mcpManager.getAllTools();
      const toolRegistry = getToolRegistry();
      toolRegistry.registerMCPTools(allMcpTools);

      // Update system prompt to include new MCP tools
      if (this.onSystemPromptUpdate) {
        await this.onSystemPromptUpdate();
      }

      console.log(chalk.green(`✅ MCP server '${name}' added and connected successfully`));
    } catch (error: any) {
      console.log(chalk.red(`❌ Failed to add MCP server: ${error.message}`));
    }
  }

  private async removeMcpServerInteractive(): Promise<void> {
    const servers = this.mcpManager.getAllServers();

    if (servers.length === 0) {
      logger.warn('No MCP servers configured', 'Use /mcp add to add servers');
      return;
    }

    const serverOptions = servers.map((s: MCPServer) => {
      const tools = s.getToolNames();
      const status = s.isServerConnected() ? '✓' : '✗';
      return {
        value: (s as any).config?.name,
        label: `${status} ${(s as any).config?.name || 'unknown'} (${tools.length} tools)`,
      };
    });

    const serverName = (await select({
      message: 'Select MCP server to remove:',
      options: serverOptions,
    })) as string | symbol;

    if (typeof serverName === 'symbol') {
      return;
    }

    await this.removeMcpServer(serverName);
  }

  private async removeMcpServer(serverName: string): Promise<void> {
    try {
      // Disconnect
      this.mcpManager.disconnectServer(serverName);

      // Unregister MCP tools for this server
      const toolRegistry = getToolRegistry();
      toolRegistry.unregisterMCPTools(serverName);

      // Remove from config
      this.configManager.removeMcpServer(serverName);
      this.configManager.save('global');

      // Update system prompt to reflect removed MCP tools
      if (this.onSystemPromptUpdate) {
        await this.onSystemPromptUpdate();
      }

      console.log(chalk.green(`✅ MCP server '${serverName}' removed successfully`));
    } catch (error: any) {
      console.log(chalk.red(`❌ Failed to remove MCP server: ${error.message}`));
    }
  }

  private async refreshMcpServers(): Promise<void> {
    const spinner = ora({ text: 'Refreshing MCP servers...', interval: 200 }).start();

    try {
      // Disconnect all existing connections
      this.mcpManager.disconnectAllServers();

      // Reconnect all servers
      await this.mcpManager.connectAllServers();

      spinner.succeed('MCP servers refreshed successfully');

      // Show current server status
      await this.listMcpServers();
    } catch (error: any) {
      spinner.fail(`Failed to refresh MCP servers: ${error.message}`);
    }
  }

  private async handleMemory(args: string[]): Promise<void> {
    const action = args[0] || 'show';

    // Load memory files before showing
    try {
      await this.memoryManager.loadMemory();
    } catch (error) {
      logger.error(
        'Failed to load memory files',
        error instanceof Error ? error.message : String(error)
      );
      return;
    }

    switch (action) {
      case 'show':
        await this.showMemory();
        break;
      case 'clear':
        await this.clearMemory(args[1]);
        break;
      default:
        logger.warn(
          `Unknown memory action: ${action}`,
          'Use /memory show to see available actions'
        );
    }
  }

  private async clearMemory(target?: string): Promise<void> {
    const memoryFiles = this.memoryManager.getMemoryFiles();

    // Handle different clear targets
    if (!target || target === '.' || target === 'current') {
      // Clear current project's memory
      const currentProjectMemory = memoryFiles.find((m: MemoryFile) => m.level === 'project');
      if (currentProjectMemory) {
        await fs.unlink(currentProjectMemory.path);
        logger.success('Project memory cleared');
        logger.info('Use /init to initialize if needed');
      } else {
        logger.warn('No project memory found for current directory');
      }
      return;
    }

    if (target === 'all') {
      // Clear all memories including global
      let cleared = 0;
      for (const file of memoryFiles) {
        await fs.unlink(file.path);
        cleared++;
      }
      logger.success(`Cleared ${cleared} memory file(s)`);

      // Recreate global memory
      await this.memoryManager.saveMemory(
        '# Global Context\n\nGlobal preferences and settings will be added here.',
        'global'
      );
      logger.info('Recreated global memory');
      logger.info('Use /init to initialize project memory if needed');
      return;
    }

    if (target === 'global') {
      // Clear global memory
      const globalMemory = memoryFiles.find((m: MemoryFile) => m.level === 'global');
      if (globalMemory) {
        await fs.unlink(globalMemory.path);
        logger.success('Global memory cleared');

        // Recreate global memory
        await this.memoryManager.saveMemory(
          '# Global Context\n\nGlobal preferences and settings will be added here.',
          'global'
        );
        logger.info('Recreated with default content');
      } else {
        logger.warn('No global memory found');
      }
      return;
    }

    // Clear specific file by filename or path
    const targetMemory = memoryFiles.find(
      (m: MemoryFile) => path.basename(m.path) === target || m.path === target
    );

    if (targetMemory) {
      try {
        await fs.unlink(targetMemory.path);
        const levelLabel = targetMemory.level === 'global' ? 'Global' : 'Project';
        logger.success(`${levelLabel} memory cleared: ${path.basename(targetMemory.path)}`);

        // Recreate global memory, not project memory
        if (targetMemory.level === 'global') {
          await this.memoryManager.saveMemory(
            '# Global Context\n\nGlobal preferences and settings will be added here.',
            'global'
          );
          logger.info('Recreated with default content');
        } else {
          logger.info('Use /init to initialize if needed');
        }
      } catch (error) {
        logger.error(
          'Failed to clear memory',
          error instanceof Error ? error.message : String(error)
        );
      }
    } else {
      logger.warn(`Memory file not found: ${target}`, 'Use /memory show to see available files');
    }
  }

  private async showMemory(): Promise<void> {
    const memoryFiles = this.memoryManager.getMemoryFiles();

    if (memoryFiles.length === 0) {
      logger.warn('No memory files loaded', 'Use /init to initialize project context');
      return;
    }

    const memoriesDir = this.memoryManager.getMemoriesDir();
    logger.section('Memory Files');
    logger.info(`Directory: ${memoriesDir}`);
    console.log('');

    memoryFiles.forEach((file: MemoryFile) => {
      const level =
        file.level === 'global'
          ? chalk.blue('[global]')
          : file.level === 'project'
            ? chalk.green('[project]')
            : chalk.yellow('[subdirectory]');
      logger.info(`  ${level} ${path.basename(file.path)}`);
    });

    console.log('');
    // logger.info('Usage: /memory clear [global|current|all|<filename>]');
  }

  private async addMemory(): Promise<void> {
    const entry = (await text({
      message: 'Enter memory entry (opens editor):',
    })) as string;

    if (entry && entry.trim()) {
      await this.memoryManager.addMemoryEntry(entry.trim());
      console.log(chalk.green('✅ Memory entry added'));
    }
  }

  private async refreshMemory(): Promise<void> {
    const spinner = ora({ text: 'Refreshing memory...', interval: 200 }).start();

    try {
      await this.memoryManager.loadMemory();
      spinner.succeed('Memory refreshed successfully');
    } catch (error: any) {
      spinner.fail(`Failed to refresh memory: ${error.message}`);
    }
  }

  private async handleRestore(args: string[]): Promise<void> {
    if (!this.checkpointManager.isEnabled()) {
      logger.warn('Checkpointing is not enabled', 'Enable it with /mode or in settings');
      return;
    }

    const checkpoints = this.checkpointManager.listCheckpoints();

    if (checkpoints.length === 0) {
      logger.warn('No checkpoints available', 'Create checkpoints during your session');
      return;
    }

    if (args.length > 0) {
      const checkpointId = args[0];
      try {
        await this.checkpointManager.restoreCheckpoint(checkpointId);
        logger.success(`Checkpoint ${checkpointId} restored successfully!`);
      } catch (error: any) {
        logger.error(error.message, 'Check if checkpoint ID is valid');
      }
    } else {
      const checkpointOptions = checkpoints.map((cp: Checkpoint) => ({
        value: cp.id,
        label: `${new Date(cp.timestamp).toLocaleString()} - ${cp.description}`,
      }));

      const checkpointId = await select({
        message: 'Select checkpoint to restore:',
        options: checkpointOptions,
      }) as string | symbol;

      if (typeof checkpointId === 'symbol') {
        return;
      }

      try {
        await this.checkpointManager.restoreCheckpoint(checkpointId);
        logger.success(`Checkpoint ${checkpointId} restored successfully!`);
      } catch (error: any) {
        logger.error(error.message, 'Check if checkpoint ID is valid');
      }
    }
  }

  private async handleTools(): Promise<void> {
    const toolRegistry = getToolRegistry();
    const tools = toolRegistry.getAll();

    logger.section('Available Tools');

    tools.forEach((tool) => {
      logger.info(`  ${tool.name}`);
      logger.info(`    ${tool.description}`);
    });

    console.log('');
    const currentSetting = this.configManager.get('showToolDetails') ? 'verbose' : 'simple';
    logger.info(`Current tool display mode: ${currentSetting}`);
    logger.info('Use /tools verbose to switch to verbose mode');
    logger.info('Use /tools simple to switch to simple mode');
  }

  private async handleToolsVerbose(args: string[]): Promise<void> {
    if (args.length === 0) {
      const currentSetting = this.configManager.get('showToolDetails') ? 'verbose' : 'simple';
      logger.info(`Current tool display mode: ${currentSetting}`);
      return;
    }

    const mode = args[0].toLowerCase();

    if (mode === 'verbose' || mode === 'detail' || mode === 'true' || mode === 'on') {
      this.configManager.set('showToolDetails', true);
      this.configManager.save('global');
      logger.success(
        'Tool display mode switched to verbose mode',
        'Will show complete tool call information'
      );
    } else if (mode === 'simple' || mode === 'concise' || mode === 'false' || mode === 'off') {
      this.configManager.set('showToolDetails', false);
      this.configManager.save('global');
      logger.success(
        'Tool display mode switched to simple mode',
        'Only show tool execution status'
      );
    } else {
      logger.warn('Invalid mode', 'Use verbose or simple');
    }
  }

  private async handleStats(): Promise<void> {
    logger.section('Session Statistics');
    const authConfig = this.configManager.getAuthConfig();
    logger.info(`  Base URL: ${authConfig.baseUrl}`);
    logger.info(`  Execution Mode: ${this.configManager.getExecutionMode()}`);
    logger.info(`  Language: ${this.configManager.getLanguage()}`);
    logger.info(`  Checkpointing: ${this.checkpointManager.isEnabled() ? 'Enabled' : 'Disabled'}`);
    logger.info(`  MCP Servers: ${this.mcpManager.getAllServers().length}`);
    logger.info(`  Agents: ${this.agentManager.getAllAgents().length}`);
  }

  private async handleTheme(): Promise<void> {
    logger.warn('Theme switching not implemented yet', 'Check back later for updates');
  }

  private async handleLanguage(): Promise<void> {
    const language = (await select({
      message: 'Select language:',
      options: [
        { value: 'zh', label: 'Chinese' },
        { value: 'en', label: 'English' },
      ],
    })) as 'zh' | 'en' | symbol;

    if (typeof language === 'symbol') {
      return;
    }

    this.configManager.setLanguage(language);
    logger.success(
      `Language changed to: ${language === 'zh' ? 'Chinese' : 'English'}`,
      'Restart CLI to apply changes'
    );
  }

  private async handleAbout(): Promise<void> {
    logger.section('xAgent CLI');
    logger.info('Version: 1.0.0');
    logger.info('A powerful AI-powered command-line assistant');
    logger.blank();
    logger.link('Documentation', 'https://platform.xagent.cn/');
    logger.link('GitHub', 'https://github.com/xagent-ai/xagent-cli');
  }

  private async handleUpdate(): Promise<void> {
    const separator = icons.separator.repeat(Math.min(40, process.stdout.columns || 80));

    console.log('');
    console.log(colors.primaryBright(`${icons.rocket} Update Check`));
    console.log(colors.border(separator));
    console.log('');

    try {
      const { getUpdateManager } = await import('./update.js');
      const updateManager = getUpdateManager();
      const versionInfo = await updateManager.checkForUpdates();

      console.log(`  ${icons.info}  ${colors.textMuted('Current version:')} ${colors.primaryBright(versionInfo.currentVersion)}`);
      console.log(`  ${icons.code} ${colors.textMuted('Latest version:')} ${colors.primaryBright(versionInfo.latestVersion)}`);
      console.log('');

      if (versionInfo.updateAvailable) {
        console.log(colors.success(`  📦 A new version is available!`));
        console.log('');

        if (versionInfo.releaseNotes) {
          console.log(colors.textMuted('  Release Notes:'));
          console.log(colors.textDim(`  ${versionInfo.releaseNotes}`));
          console.log('');
        }

        const shouldUpdate = await confirm({
          message: 'Do you want to update now?',
        });

        if (shouldUpdate === true) {
          console.log('');
          await updateManager.autoUpdate();
        }
      } else {
        console.log(colors.success(`  ✅ You are using the latest version`));
        console.log('');
      }
    } catch (error: any) {
      console.log(colors.error(`  ❌ Failed to check for updates: ${error.message}`));
      console.log('');
    }
  }

  private async handleCompress(args: string[]): Promise<void> {
    const config = this.configManager.getContextCompressionConfig();

    // If there are arguments, process config or execute
    if (args.length > 0) {
      const action = args[0].toLowerCase();

      if (action === 'exec' || action === 'run' || action === 'now') {
        await this.executeCompression(config);
        return;
      }

      await this.setCompressConfig(args);
      return;
    }

    // Display current configuration
    console.log(chalk.cyan('\n📦 Context Compression:\n'));

    console.log(`  Status: ${config.enabled ? chalk.green('Enabled') : chalk.red('Disabled')}`);

    console.log('');
    console.log(chalk.gray('Usage:'));
    console.log(chalk.gray('  /compress                 - Show current configuration'));
    console.log(chalk.gray('  /compress exec            - Execute compression now'));
    console.log(chalk.gray('  /compress on|off          - Enable/disable compression'));
    console.log('');
  }

  private async executeCompression(config: CompressionConfig): Promise<void> {
    const messages = this.conversationHistory;

    if (!messages || messages.length === 0) {
      console.log(chalk.yellow('⚠️  No conversation to compress'));
      return;
    }

    const { needsCompression, reason } = this.contextCompressor.needsCompression(messages, config);

    if (!needsCompression) {
      console.log(chalk.green('✅ No compression needed'));
      console.log(chalk.gray(`  ${reason}`));
      return;
    }

    console.log(chalk.cyan('\n🚀 Executing context compression...\n'));

    const spinner = ora({
      text: 'Compressing context...',
      spinner: 'dots',
      color: 'cyan',
    }).start();

    try {
      const result: CompressionResult = await this.contextCompressor.compressContext(
        messages,
        'You are a helpful AI assistant.',
        config
      );

      spinner.succeed(chalk.green('✅ Compression complete'));

      console.log('');
      console.log(
        `  ${chalk.cyan('Original:')} ${chalk.yellow(result.originalMessageCount.toString())} messages (${result.originalSize} chars)`
      );
      console.log(
        `  ${chalk.cyan('Compressed:')} ${chalk.yellow(result.compressedMessageCount.toString())} messages (${result.compressedSize} chars)`
      );
      console.log(
        `  ${chalk.cyan('Reduction:')} ${chalk.green(Math.round((1 - result.compressedSize / result.originalSize) * 100) + '%')}`
      );
      console.log(`  ${chalk.cyan('Method:')} ${chalk.yellow(result.compressionMethod)}`);

      console.log('');
      console.log(
        chalk.gray(
          'Use /clear to start a new conversation, or continue chatting to see the compressed summary.'
        )
      );
      console.log('');
    } catch (error: any) {
      spinner.fail(chalk.red('Compression failed'));
      console.log(chalk.red(`  ${error.message}`));
    }
  }

  private async setCompressConfig(args: string[]): Promise<void> {
    const config = this.configManager.getContextCompressionConfig();
    const action = args[0].toLowerCase();

    switch (action) {
      case 'on':
        config.enabled = true;
        this.configManager.setContextCompressionConfig(config);
        this.configManager.save('global');
        console.log(chalk.green('✅ Context compression enabled'));
        break;

      case 'off':
        config.enabled = false;
        this.configManager.setContextCompressionConfig(config);
        this.configManager.save('global');
        console.log(chalk.green('✅ Context compression disabled'));
        break;

      default:
        console.log(chalk.red(`❌ Unknown action: ${action}`));
        console.log(chalk.gray('Available actions: on, off, exec'));
    }
  }

  private async handleSkill(args: string[]): Promise<void> {
    const os = await import('os');
    const path = await import('path');
    const { promises: fs } = await import('fs');

    const action = args[0] || 'list';
    const userSkillsPath = this.configManager.getUserSkillsPath() || path.join(os.homedir(), '.xagent', 'skills');

    switch (action) {
      case 'list':
        await this.listUserSkills(userSkillsPath, fs, path);
        break;
      case 'add':
        await this.addSkill(args[1], userSkillsPath, fs, path);
        break;
      case 'remove':
        await this.removeSkill(args[1], userSkillsPath, fs, path);
        break;
      default:
        console.log(chalk.cyan('\n🔧 Skills:\n'));
        console.log(`  Skills directory: ${chalk.yellow(userSkillsPath)}\n`);
        console.log(chalk.gray('Available commands:'));
        console.log(chalk.gray('  /skill list                   - List installed skills'));
        console.log(chalk.gray('  /skill add <source>           - Add a skill (local path or remote URL)'));
        console.log(chalk.gray('  /skill remove <name>          - Remove a user-installed skill'));
        console.log();
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  /skill add ./my-skill                    - Local path'));
        console.log(chalk.gray('  /skill add owner/repo                     - GitHub shorthand'));
        console.log(chalk.gray('  /skill add https://github.com/owner/repo  - GitHub URL'));
        console.log();
    }
  }

  private async listUserSkills(userSkillsPath: string, fs: any, path: any): Promise<void> {
    console.log(chalk.cyan('\n🔧 Skills:\n'));

    try {
      const entries = await fs.readdir(userSkillsPath, { withFileTypes: true });
      const skills = entries.filter((e: any) => e.isDirectory());

      if (skills.length === 0) {
        console.log(chalk.gray('  No skills installed'));
        console.log(chalk.cyan('\n  To add a skill, use:'));
        console.log(chalk.cyan('    /skill add <path-to-skill>\n'));
        return;
      }

      for (const skill of skills) {
        const skillPath = path.join(userSkillsPath, skill.name as string);
        const skillMdPath = path.join(skillPath, 'SKILL.md');

        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          const descMatch = content.match(/^description:\s*(.+)$/m);
          const name = nameMatch ? nameMatch[1].trim() : skill.name;
          const description = descMatch ? descMatch[1].trim() : 'No description';

          console.log(`  ${chalk.cyan('•')} ${chalk.yellow(name)}`);
          console.log(`    ${chalk.gray(description)}`);
          console.log();
        } catch {
          console.log(`  ${chalk.cyan('•')} ${chalk.yellow(skill.name)}`);
          console.log(`    ${chalk.gray('(Missing SKILL.md)')}`);
          console.log();
        }
      }

      console.log(chalk.gray(`  Skills directory: ${userSkillsPath}`));
      console.log();
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log(chalk.gray('  No skills installed'));
        console.log(chalk.cyan('\n  To add a skill, use:'));
        console.log(chalk.cyan('    /skill add <path-to-skill>\n'));
      } else {
        console.log(chalk.red(`  Error: ${error.message}`));
      }
    }
  }

  private async addSkill(source: string, userSkillsPath: string, fs: any, path: any): Promise<void> {
    if (!source) {
      console.log(chalk.yellow('\n⚠️  Please specify a skill source'));
      console.log(chalk.cyan('  Usage: /skill add <source>\n'));
      console.log(chalk.gray('  Examples:'));
      console.log(chalk.gray('    /skill add ./my-skill           - Local path'));
      console.log(chalk.gray('    /skill add owner/repo            - GitHub shorthand'));
      console.log(chalk.gray('    /skill add https://github.com/owner/repo'));
      console.log();
      return;
    }

    const { parseSource, installSkill } = await import('./skill-installer.js');
    const parsed = parseSource(source.trim());
    const isLocal = parsed.type === 'local';

    if (isLocal) {
      // Local installation
      const resolvedPath = path.resolve(source);
      const skillName = path.basename(resolvedPath);
      const destPath = path.join(userSkillsPath, skillName);

      try {
        // Check if source exists
        await fs.access(resolvedPath);

        // Check if SKILL.md exists
        const skillMdPath = path.join(resolvedPath, 'SKILL.md');
        try {
          await fs.access(skillMdPath);
        } catch {
          console.log(chalk.red(`\n❌ SKILL.md not found in ${resolvedPath}`));
          console.log(chalk.gray('  Each skill must have a SKILL.md file\n'));
          return;
        }

        // Check if skill already exists
        try {
          await fs.access(destPath);
          console.log(chalk.yellow(`\n⚠️  Skill "${skillName}" already installed`));
          console.log(chalk.cyan(`  Use: /skill remove ${skillName} to remove it first\n`));
          return;
        } catch {
          // Doesn't exist, proceed
        }

        // Ensure skills directory exists
        await fs.mkdir(userSkillsPath, { recursive: true });

        // Copy the skill
        await this.copyDirectory(resolvedPath, destPath);

        console.log(chalk.green('\n✅ Skill installed successfully'));
        console.log(chalk.gray(`  Name: ${skillName}`));
        console.log(chalk.gray(`  Location: ${destPath}`));
        console.log(chalk.gray(`  Type: Local`));
        console.log();

        // Trigger system prompt update
        this.onSystemPromptUpdate?.();
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          console.log(chalk.red(`\n❌ Skill not found: ${source}\n`));
        } else {
          console.log(chalk.red(`\n❌ Error installing skill: ${error.message}\n`));
        }
      }
    } else {
      // Remote installation
      console.log(chalk.cyan('\n📦 Installing skill from remote source...\n'));
      console.log(chalk.gray(`  Source: ${source}`));
      console.log(chalk.gray(`  Type: Remote`));
      console.log();

      try {
        const result = await installSkill(source);

        if (result.success) {
          console.log(chalk.green('✅ Skill installed successfully'));
          console.log(chalk.gray(`  Name: ${result.skillName}`));
          console.log(chalk.gray(`  Location: ${result.skillPath}`));
          console.log(chalk.gray('  Type: Remote'));
          console.log();

          // Trigger system prompt update - skill is immediately available
          this.onSystemPromptUpdate?.();
        } else {
          console.log(chalk.red(`\n❌ Failed to install skill: ${result.error}\n`));
        }
      } catch (error: any) {
        console.log(chalk.red(`\n❌ Error installing skill: ${error.message}\n`));
      }
    }
  }

  private async removeSkill(skillName: string, userSkillsPath: string, fs: any, path: any): Promise<void> {
    if (!skillName) {
      console.log(chalk.yellow('\n⚠️  Please specify a skill name'));
      console.log(chalk.cyan('  Usage: /skill remove <skill-name>\n'));
      return;
    }

    // Protect find-skills from deletion
    if (skillName === 'find-skills') {
      console.log(chalk.red('\n❌ Cannot remove protected skill: find-skills'));
      console.log(chalk.gray('  find-skills is a built-in skill that helps you discover and install other skills.\n'));
      return;
    }

    const skillPath = path.join(userSkillsPath, skillName);

    try {
      await fs.access(skillPath);

      // Verify it's in skills path
      if (!skillPath.startsWith(userSkillsPath)) {
        console.log(chalk.red(`\n❌ Cannot remove skill outside user directory\n`));
        return;
      }

      // Remove the skill directory
      await fs.rm(skillPath, { recursive: true, force: true });

      console.log(chalk.green('\n✅ Skill removed successfully'));
      console.log();

      // Trigger system prompt update
      this.onSystemPromptUpdate?.();
    } catch (error: any) {
      if (error.code === 'ENOENT' || error.code === 'ENOENT') {
        console.log(chalk.yellow(`\n⚠️  Skill not found: ${skillName}\n`));
      } else {
        console.log(chalk.red(`\n❌ Error removing skill: ${error.message}\n`));
      }
    }
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });
    await fs.mkdir(dest, { recursive: true });

    for (const entry of entries) {
      // Skip node_modules to keep dependencies isolated
      // if (entry.name === 'node_modules') continue;

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

export function parseInput(input: string): InputType[] {
  const inputs: InputType[] = [];
  let remaining = input;

  const fileRefRegex = /@([^\s]+)/g;
  let match;
  while ((match = fileRefRegex.exec(remaining)) !== null) {
    const filePath = match[1];
    const beforeMatch = remaining.substring(0, match.index);
    const afterMatch = remaining.substring(match.index + match[0].length);

    if (beforeMatch.trim()) {
      inputs.push({ type: 'text', content: beforeMatch.trim() });
    }

    inputs.push({ type: 'file', content: filePath });
    remaining = afterMatch;
  }

  if (remaining.trim()) {
    if (remaining.startsWith('!')) {
      inputs.push({ type: 'command', content: remaining.slice(1).trim() });
    } else {
      inputs.push({ type: 'text', content: remaining.trim() });
    }
  }

  return inputs;
}

export function detectImageInput(input: string): boolean {
  return input.includes('[Pasted image') || input.includes('<image');
}
