import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ExecutionMode, ChatMessage, InputType, ToolCall, Checkpoint, AgentConfig, CompressionConfig, AuthType } from './types.js';
import { AIClient, Message, detectThinkingKeywords, getThinkingTokens } from './ai-client.js';
import { getToolRegistry } from './tools.js';
import { getAgentManager } from './agents.js';
import { getMemoryManager, MemoryFile } from './memory.js';
import { getMCPManager, MCPServer } from './mcp.js';
import { getCheckpointManager } from './checkpoint.js';
import { getConfigManager, ConfigManager } from './config.js';
import { getLogger } from './logger.js';
import { getContextCompressor, ContextCompressor, CompressionResult } from './context-compressor.js';
import { getConversationManager, ConversationManager } from './conversation.js';
import { icons, colors } from './theme.js';
import { SystemPromptGenerator } from './system-prompt-generator.js';
import { AuthService } from './auth.js';

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
      case 'vlm':
        await this.handleVlm();
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
      default:
        logger.warn(`Unknown command: /${command}`, 'Type /help for available commands');
    }

    return true;
  }

  private async showHelp(): Promise<void> {
    const separator = icons.separator.repeat(Math.min(60, process.stdout.columns || 80));

    console.log('');
    console.log(colors.primaryBright('╔════════════════════════════════════════════════════════════╗'));
    console.log(colors.primaryBright('║') + ' '.repeat(56) + colors.primaryBright('║'));
    console.log(' '.repeat(14) + colors.gradient('📚 XAGENT CLI Help') + ' '.repeat(31) + colors.primaryBright('║'));
    console.log(colors.primaryBright('║') + ' '.repeat(56) + colors.primaryBright('║'));
    console.log(colors.primaryBright('╚════════════════════════════════════════════════════════════╝'));
    console.log('');

    // Shortcuts
    console.log(colors.accent('Shortcuts'));
    console.log(colors.border(separator));
    console.log('');
    console.log(colors.textDim(`  ${colors.accent('!')}  - ${colors.textMuted('Enter bash mode')}`));
    console.log(colors.textDim(`  ${colors.accent('/')}  - ${colors.textMuted('Commands')}`));
    console.log(colors.textDim(`  ${colors.accent('@')}  - ${colors.textMuted('File paths')}`));
    console.log('');

    // Basic Commands
    this.showHelpCategory('Basic Commands', [
      {
        cmd: '/help [command]',
        desc: 'Show help information',
        detail: 'View all available commands or detailed description of specific command',
        example: '/help\n/help mode'
      },
      {
        cmd: '/clear',
        desc: 'Clear conversation history',
        detail: 'Clear all conversation records of current session, start new conversation',
        example: '/clear'
      },
      {
        cmd: '/exit',
        desc: 'Exit program',
        detail: 'Safely exit XAGENT CLI',
        example: '/exit'
      }
    ]);

    // Project Management
    this.showHelpCategory('Project Management', [
      {
        cmd: '/init',
        desc: 'Initialize project context',
        detail: 'Create XAGENT.md file in current directory, used to store project context information',
        example: '/init'
      },
      {
        cmd: '/memory [show|add|refresh]',
        desc: 'Manage project memory',
        detail: 'View, add or refresh project memory information',
        example: '/memory show\n/memory add "Project uses TypeScript"'
      }
    ]);

    // Authentication & Configuration
    this.showHelpCategory('Authentication & Configuration', [
      {
        cmd: '/auth',
        desc: 'Configure authentication information',
        detail: 'Change or view current authentication configuration',
        example: '/auth'
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
          'smart - Smart approval (recommended)'
        ]
      },
      {
        cmd: '/think [on|off|display]',
        desc: 'Control thinking mode',
        detail: 'Enable/disable AI thinking process display',
        example: '/think on\n/think off\n/think display compact'
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
        example: '/theme'
      }
    ]);

    // Feature Extensions
    this.showHelpCategory('Feature Extensions', [
      {
        cmd: '/agents [list|online|install|remove]',
        desc: 'Manage sub-agents',
        detail: 'View, install or remove specialized AI sub-agents',
        example: '/agents list\n/agents online\n/agents install explore-agent'
      },
      {
        cmd: '/mcp [list|add|remove|refresh]',
        desc: 'Manage MCP servers',
        detail: 'Manage Model Context Protocol servers',
        example: '/mcp list\n/mcp add server-name'
      },
      {
        cmd: '/vlm',
        desc: 'Configure VLM for GUI Agent',
        detail: 'Configure Vision-Language Model for browser/desktop automation',
        example: '/vlm'
      },
      {
        cmd: '/tools [verbose|simple]',
        desc: 'Manage tool display',
        detail: 'View available tools or switch tool call display mode',
        example: '/tools\n/tools verbose\n/tools simple'
      }
    ]);

    // Advanced Features
    this.showHelpCategory('Advanced Features', [
      {
        cmd: '/restore',
        desc: 'Restore from checkpoint',
        detail: 'Restore conversation state from historical checkpoints',
        example: '/restore'
      },
      {
        cmd: '/compress [on|off|max_message|max_token|exec]',
        desc: 'Manage context compression',
        detail: 'Configure compression settings or execute compression manually',
        example: '/compress\n/compress exec\n/compress on\n/compress max_message 50\n/compress max_token 1500000'
      },
      {
        cmd: '/stats',
        desc: 'Show session statistics',
        detail: 'View statistics information of current session',
        example: '/stats'
      },
      {
        cmd: '/about',
        desc: 'Show version information',
        detail: 'View version and related information of XAGENT CLI',
        example: '/about'
      }
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

  private showHelpCategory(title: string, commands: Array<{
    cmd: string;
    desc: string;
    detail: string;
    example: string;
    modes?: string[];
  }>): void {
    const separator = icons.separator.repeat(Math.min(60, process.stdout.columns || 80));

    console.log('');
    console.log(colors.border(separator));
    console.log(colors.primaryBright(title));
    console.log(colors.border(separator));
    console.log('');

    commands.forEach(cmd => {
      console.log(colors.primaryBright(`  ${cmd.cmd}`));
      console.log(colors.textDim(`    ${cmd.desc}`));
      console.log(colors.textMuted(`    ${cmd.detail}`));

      if (cmd.modes) {
        console.log(colors.textDim(`    Available modes:`));
        cmd.modes.forEach(mode => {
          console.log(colors.textDim(`      • ${mode}`));
        });
      }

      console.log(colors.accent(`    Examples:`));
      cmd.example.split('\n').forEach(ex => {
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

    // Clear ConversationManager 中的当前对话
    await this.conversationManager.clearCurrentConversation();

    // Call callback to notify InteractiveSession 清空对话
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

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Select action:',
        choices: [
          { name: 'Change authentication method', value: 'change' },
          { name: 'Show current auth config', value: 'show' },
          { name: 'Back', value: 'back' }
        ]
      }
    ]);

    if (action === 'back') {
      return;
    }

    if (action === 'show') {
      const authConfig = this.configManager.getAuthConfig();
      logger.subsection('Current Authentication Configuration');
      console.log(JSON.stringify(authConfig, null, 2));
    } else if (action === 'change') {
      const { selectAuthType } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'selectAuthType',
          message: 'Do you want to change authentication type?',
          default: false
        }
      ]);

      if (selectAuthType) {
        logger.warn('Please restart xAgent CLI and run /auth again', 'Authentication changes require restart');
      }
    }
  }

  private async handleLogin(): Promise<void> {
    logger.section('Login to xAgent');

    const authConfig = this.configManager.getAuthConfig();
    const currentAuthType = authConfig.type;

    if (currentAuthType !== AuthType.OAUTH_XAGENT) {
      console.log(chalk.yellow('\n⚠️  Current authentication type is not OAuth xAgent.'));
      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Do you want to switch to OAuth xAgent authentication?',
          default: false
        }
      ]);

      if (!proceed) {
        return;
      }

      // Switch to OAuth xAgent
      await this.configManager.setAuthConfig({
        selectedAuthType: AuthType.OAUTH_XAGENT,
        apiKey: '',
        refreshToken: '',
        baseUrl: ''
      });
      await this.configManager.save('global');
      console.log(chalk.green('✅ Switched to OAuth xAgent authentication.'));
    }

    console.log(chalk.cyan('\n🔐 Starting OAuth xAgent login...'));
    console.log(chalk.gray('   A browser will open for you to complete authentication.\n'));

    try {
      const authService = new AuthService({
        type: AuthType.OAUTH_XAGENT,
        apiKey: '',
        baseUrl: '',
        refreshToken: ''
      });

      const success = await authService.authenticate();

      if (success) {
        const newConfig = this.configManager.getAuthConfig();
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

  private async handleVlm(): Promise<void> {
    logger.section('VLM Configuration for GUI Agent');

    // Show current VLM config
    const currentVlmConfig = {
      model: this.configManager.get('guiSubagentModel'),
      baseUrl: this.configManager.get('guiSubagentBaseUrl'),
      apiKey: this.configManager.get('guiSubagentApiKey') ? '***' : ''
    };

    console.log(chalk.cyan('\n📊 Current VLM Configuration:\n'));
    console.log(`  Model: ${chalk.yellow(currentVlmConfig.model || 'Not configured')}`);
    console.log(`  Base URL: ${chalk.yellow(currentVlmConfig.baseUrl || 'Not configured')}`);
    console.log(`  API Key: ${chalk.yellow(currentVlmConfig.apiKey || 'Not configured')}`);
    console.log();

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Select action:',
        choices: [
          { name: 'Configure VLM', value: 'configure' },
          { name: 'Remove VLM configuration', value: 'remove' },
          { name: 'Back', value: 'back' }
        ]
      }
    ]);

    if (action === 'back') {
      return;
    }

    if (action === 'remove') {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Are you sure you want to remove VLM configuration?',
          default: false
        }
      ]);

      if (confirm) {
        await this.configManager.set('guiSubagentModel', '');
        await this.configManager.set('guiSubagentBaseUrl', '');
        await this.configManager.set('guiSubagentApiKey', '');
        await this.configManager.save('global');
        console.log(chalk.green('✅ VLM configuration removed successfully!'));
      }
      return;
    }

    if (action === 'configure') {
      // Use AuthService to configure VLM
      const authService = new AuthService({
        type: 'openai_compatible' as any,
        apiKey: '',
        baseUrl: '',
        modelName: ''
      });

      const vlmConfig = await authService.configureAndValidateVLM();

      if (vlmConfig) {
        // Save VLM configuration
        await this.configManager.set('guiSubagentModel', vlmConfig.model);
        await this.configManager.set('guiSubagentBaseUrl', vlmConfig.baseUrl);
        await this.configManager.set('guiSubagentApiKey', vlmConfig.apiKey);
        await this.configManager.save('global');
        console.log(chalk.green('✅ VLM configuration saved successfully!'));
        console.log(chalk.cyan(`   Model: ${vlmConfig.model}`));
        console.log(chalk.cyan(`   Base URL: ${vlmConfig.baseUrl}`));
      } else {
        console.log(chalk.red('❌ VLM configuration failed or cancelled'));
      }
    }
  }

  private async handleMode(args: string[]): Promise<void> {
    const modes = Object.values(ExecutionMode);
    const currentMode = this.configManager.getApprovalMode() || this.configManager.getExecutionMode();

    if (args.length > 0) {
      const newMode = args[0].toLowerCase();
      if (modes.includes(newMode as ExecutionMode)) {
        this.configManager.setApprovalMode(newMode as ExecutionMode);
        await this.configManager.save('global');
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
        { mode: 'smart', desc: 'Smart approval with intelligent security checks' }
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
        await this.configManager.save('global');
        console.log(chalk.green('✅ Thinking mode enabled'));
      } else if (action === 'off' || action === 'false' || action === '0') {
        thinkingConfig.enabled = false;
        this.configManager.setThinkingConfig(thinkingConfig);
        await this.configManager.save('global');
        console.log(chalk.green('✅ Thinking mode disabled'));
      } else if (action === 'display' && args[1]) {
        const displayMode = args[1].toLowerCase();
        const validModes = ['full', 'compact', 'indicator'];

        if (validModes.includes(displayMode)) {
          thinkingConfig.displayMode = displayMode as 'full' | 'compact' | 'indicator';
          thinkingConfig.enabled = true; // Auto-enable when setting display mode
          this.configManager.setThinkingConfig(thinkingConfig);
          await this.configManager.save('global');
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
      console.log(`  Status: ${thinkingConfig.enabled ? chalk.green('Enabled') : chalk.red('Disabled')}`);
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
        logger.warn('Agent installation wizard not implemented yet', 'Use /agents install in interactive mode');
        break;
      case 'remove':
        logger.warn('Agent removal not implemented yet', 'Use /agents remove in interactive mode');
        break;
      default:
        logger.warn(`Unknown agents action: ${action}`, 'Use /agents list to see available actions');
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

    serverConfigs.forEach(({ name: serverName, config: serverConfig }: { name: string; config: any }) => {
      const server = this.mcpManager.getServer(serverName);
      const isConnected = server?.isServerConnected() || false;
      const status = isConnected ? chalk.green('✓ Connected') : chalk.red('✗ Disconnected');
      const tools = server?.getToolNames() || [];
      const transport = serverConfig?.transport || serverConfig?.type || 'unknown';
      const command = serverConfig?.command ? `${serverConfig.command} ${(serverConfig.args || []).join(' ')}` : serverConfig?.url || 'N/A';

      console.log('');
      console.log(`  ${chalk.cyan(serverName)} ${status}`);
      console.log(`    Transport: ${transport}`);
      console.log(`    Command: ${command}`);
      console.log(`    Tools: ${isConnected ? tools.length : 'N/A'} (${isConnected ? tools.join(', ') : 'wait for connection'})`);
    });

    console.log('');
    logger.info(`Total: ${serverConfigs.length} server(s)`);
  }

  private async addMcpServerInteractive(serverName?: string): Promise<void> {
    const { name, command, args: serverArgs, transport, url, authToken, headers } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter MCP server name:',
        default: serverName,
        validate: (input: string) => {
          if (!input.trim()) {
            return 'Server name is required';
          }
          const servers = this.mcpManager.getAllServers();
          if (servers.some((s: MCPServer) => (s as any).config?.name === input)) {
            return 'Server with this name already exists';
          }
          return true;
        }
      },
      {
        type: 'list',
        name: 'transport',
        message: 'Select transport type:',
        choices: [
          { name: 'Stdio (stdin/stdout)', value: 'stdio' },
          { name: 'HTTP/SSE', value: 'sse' },
          { name: 'HTTP (POST)', value: 'http' }
        ],
        default: 'stdio'
      },
      {
        type: 'input',
        name: 'command',
        message: 'Enter command (for stdio transport):',
        when: (answers: any) => answers.transport === 'stdio',
        validate: (input: string) => input.trim() ? true : 'Command is required'
      },
      {
        type: 'input',
        name: 'args',
        message: 'Enter arguments (comma-separated, for stdio transport):',
        when: (answers: any) => answers.transport === 'stdio',
        filter: (input: string) => input ? input.split(',').map((a: string) => a.trim()) : []
      },
      {
        type: 'input',
        name: 'url',
        message: 'Enter server URL (for HTTP/SSE/HTTP transport):',
        when: (answers: any) => answers.transport === 'sse' || answers.transport === 'http',
        validate: (input: string) => input.trim() ? true : 'URL is required'
      },
      {
        type: 'password',
        name: 'authToken',
        message: 'Enter authentication token (optional):',
        when: (answers: any) => answers.transport === 'sse' || answers.transport === 'http'
      },
      {
        type: 'input',
        name: 'headers',
        message: 'Enter custom headers as JSON (optional, e.g., {"Authorization": "Bearer token"}):',
        when: (answers: any) => answers.transport === 'sse' || answers.transport === 'http',
        filter: (input: string) => {
          if (!input.trim()) return undefined;
          try {
            return JSON.parse(input);
          } catch {
            return undefined;
          }
        }
      }
    ]);

    const config: any = {
      transport: transport as 'stdio' | 'sse' | 'http'
    };

    if (transport === 'stdio') {
      config.command = command;
      if (serverArgs && serverArgs.length > 0) {
        config.args = serverArgs;
      }
    } else {
      config.url = url;
      if (authToken) {
        config.authToken = authToken;
      }
      if (headers) {
        config.headers = headers;
      }
    }

    try {
      // Save to config file
      this.configManager.addMcpServer(name, config);
      await this.configManager.save('global');

      // Register to MCP Manager
      this.mcpManager.registerServer(name, config);

      // Connect to server (with error handling)
      let connected = false;
      try {
        await this.mcpManager.connectServer(name);
        connected = true;
      } catch (error: any) {
        // Connection failed - cleanup
        this.mcpManager.disconnectServer(name);
        this.configManager.removeMcpServer(name);
        await this.configManager.save('global');
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

    const serverNames = servers.map((s: MCPServer) => {
      const tools = s.getToolNames();
      const status = s.isServerConnected() ? '✓' : '✗';
      return {
        name: `${status} ${(s as any).config?.name || 'unknown'} (${tools.length} tools)`,
        value: (s as any).config?.name
      };
    });

    const { serverName } = await inquirer.prompt([
      {
        type: 'list',
        name: 'serverName',
        message: 'Select MCP server to remove:',
        choices: serverNames
      }
    ]);

    await this.removeMcpServer(serverName);
  }

  private async removeMcpServer(serverName: string): Promise<void> {
    try {
      // Get server info before disconnecting to notify LLM
      const server = this.mcpManager.getServer(serverName);
      const removedTools = server ? server.getToolNames() : [];
      const removedToolNames = removedTools.map((t: string) => `${serverName}__${t}`).join(', ');

      // Disconnect
      this.mcpManager.disconnectServer(serverName);

      // Unregister MCP tools for this server
      const toolRegistry = getToolRegistry();
      toolRegistry.unregisterMCPTools(serverName);

      // Remove from config
      this.configManager.removeMcpServer(serverName);
      await this.configManager.save('global');

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

    switch (action) {
      case 'show':
        await this.showMemory();
        break;
      case 'add':
        logger.warn('Memory addition not implemented yet', 'Use /memory add in interactive mode');
        break;
      case 'refresh':
        logger.warn('Memory refresh not implemented yet', 'Check back later for updates');
        break;
      default:
        logger.warn(`Unknown memory action: ${action}`, 'Use /memory show to see available actions');
    }
  }

  private async showMemory(): Promise<void> {
    const memoryFiles = this.memoryManager.getMemoryFiles();

    if (memoryFiles.length === 0) {
      logger.warn('No memory files loaded', 'Use /init to initialize project context');
      return;
    }

    logger.section('Memory Files');

    memoryFiles.forEach((file: MemoryFile) => {
      const level = file.level === 'global' ? chalk.blue('[global]') :
                     file.level === 'project' ? chalk.green('[project]') :
                     chalk.yellow('[subdirectory]');
      logger.info(`  ${level} ${file.path}`);
    });
  }

  private async addMemory(): Promise<void> {
    const { entry } = await inquirer.prompt([
      {
        type: 'editor',
        name: 'entry',
        message: 'Enter memory entry (opens editor):'
      }
    ]);

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
      const choices = checkpoints.map((cp: Checkpoint) => ({
        name: `${new Date(cp.timestamp).toLocaleString()} - ${cp.description}`,
        value: cp.id
      }));

      const { checkpointId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'checkpointId',
          message: 'Select checkpoint to restore:',
          choices
        }
      ]);

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

    tools.forEach(tool => {
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
      await this.configManager.save('global');
      logger.success('Tool display mode switched to verbose mode', 'Will show complete tool call information');
    } else if (mode === 'simple' || mode === 'concise' || mode === 'false' || mode === 'off') {
      this.configManager.set('showToolDetails', false);
      await this.configManager.save('global');
      logger.success('Tool display mode switched to simple mode', 'Only show tool execution status');
    } else {
      logger.warn('Invalid mode', 'Use verbose or simple');
    }
  }

  private async handleStats(): Promise<void> {
    logger.section('Session Statistics');
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
    const { language } = await inquirer.prompt([
      {
        type: 'list',
        name: 'language',
        message: 'Select language:',
        choices: [
          { name: 'Chinese', value: 'zh' },
          { name: 'English', value: 'en' }
        ]
      }
    ]);

    this.configManager.setLanguage(language);
    logger.success(`Language changed to: ${language === 'zh' ? 'Chinese' : 'English'}`, 'Restart CLI to apply changes');
  }

  private async handleAbout(): Promise<void> {
    logger.section('xAgent CLI');
    logger.info('Version: 1.0.0');
    logger.info('A powerful AI-powered command-line assistant');
    logger.blank();
    logger.link('Documentation', 'https://platform.xagent.cn/');
    logger.link('GitHub', 'https://github.com/xagent-ai/xagent-cli');
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
    console.log(`  Max Messages: ${chalk.yellow(config.maxMessages.toString())}`);
    console.log(`  Max Tokens: ${chalk.yellow(config.maxContextSize.toString())}`);

    console.log('');
    console.log(chalk.gray('Usage:'));
    console.log(chalk.gray('  /compress                 - Show current configuration'));
    console.log(chalk.gray('  /compress exec            - Execute compression now'));
    console.log(chalk.gray('  /compress on|off          - Enable/disable compression'));
    console.log(chalk.gray('  /compress max_message <n> - Set max messages before compression'));
    console.log(chalk.gray('  /compress max_token <n>   - Set max tokens before compression'));
    console.log('');
  }

  private async executeCompression(config: CompressionConfig): Promise<void> {
    const messages = this.conversationHistory;

    if (!messages || messages.length === 0) {
      console.log(chalk.yellow('⚠️  No conversation to compress'));
      return;
    }

    const { needsCompression, reason } = this.contextCompressor.needsCompression(
      messages,
      config
    );

    if (!needsCompression) {
      console.log(chalk.green('✅ No compression needed'));
      console.log(chalk.gray(`  ${reason}`));
      return;
    }

    console.log(chalk.cyan('\n🚀 Executing context compression...\n'));

    const spinner = ora({
      text: 'Compressing context...',
      spinner: 'dots',
      color: 'cyan'
    }).start();

    try {
      const result: CompressionResult = await this.contextCompressor.compressContext(
        messages,
        'You are a helpful AI assistant.',
        config
      );

      spinner.succeed(chalk.green('✅ Compression complete'));

      console.log('');
      console.log(`  ${chalk.cyan('Original:')} ${chalk.yellow(result.originalMessageCount.toString())} messages (${result.originalSize} chars)`);
      console.log(`  ${chalk.cyan('Compressed:')} ${chalk.yellow(result.compressedMessageCount.toString())} messages (${result.compressedSize} chars)`);
      console.log(`  ${chalk.cyan('Reduction:')} ${chalk.green(Math.round((1 - result.compressedSize / result.originalSize) * 100) + '%')}`);
      console.log(`  ${chalk.cyan('Method:')} ${chalk.yellow(result.compressionMethod)}`);

      console.log('');
      console.log(chalk.gray('Use /clear to start a new conversation, or continue chatting to see the compressed summary.'));
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
        await this.configManager.save('global');
        console.log(chalk.green('✅ Context compression enabled'));
        break;

      case 'off':
        config.enabled = false;
        this.configManager.setContextCompressionConfig(config);
        await this.configManager.save('global');
        console.log(chalk.green('✅ Context compression disabled'));
        break;

      case 'max_message':
        if (args[1]) {
          const maxMessages = parseInt(args[1], 10);
          if (isNaN(maxMessages) || maxMessages < 1) {
            console.log(chalk.red('❌ Invalid value for max_message. Must be a positive number.'));
            return;
          }
          config.maxMessages = maxMessages;
          this.configManager.setContextCompressionConfig(config);
          await this.configManager.save('global');
          console.log(chalk.green(`✅ Max messages set to: ${maxMessages}`));
        } else {
          console.log(chalk.gray('Usage: /compress max_message <number>'));
        }
        break;

      case 'max_token':
        if (args[1]) {
          const maxContextSize = parseInt(args[1], 10);
          if (isNaN(maxContextSize) || maxContextSize < 1000) {
            console.log(chalk.red('❌ Invalid value for max_token. Must be at least 1000.'));
            return;
          }
          config.maxContextSize = maxContextSize;
          this.configManager.setContextCompressionConfig(config);
          await this.configManager.save('global');
          console.log(chalk.green(`✅ Max tokens set to: ${maxContextSize}`));
        } else {
          console.log(chalk.gray('Usage: /compress max_token <number>'));
        }
        break;

      default:
        console.log(chalk.red(`❌ Unknown action: ${action}`));
        console.log(chalk.gray('Available actions: on, off, max_message, max_token, exec'));
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
