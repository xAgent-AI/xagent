import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ExecutionMode, ChatMessage, InputType, ToolCall, Checkpoint, AgentConfig } from './types.js';
import { AIClient, Message, detectThinkingKeywords, getThinkingTokens } from './ai-client.js';
import { getToolRegistry } from './tools.js';
import { getAgentManager } from './agents.js';
import { getMemoryManager, MemoryFile } from './memory.js';
import { getMCPManager, MCPServer } from './mcp.js';
import { getCheckpointManager } from './checkpoint.js';
import { getConfigManager, ConfigManager } from './config.js';
import { getLogger } from './logger.js';

const logger = getLogger();

export class SlashCommandHandler {
  private configManager: ConfigManager;
  private agentManager: any;
  private memoryManager: any;
  private mcpManager: any;
  private checkpointManager: any;

  constructor() {
    this.configManager = getConfigManager(process.cwd());
    this.agentManager = getAgentManager(process.cwd());
    this.memoryManager = getMemoryManager(process.cwd());
    this.mcpManager = getMCPManager();
    this.checkpointManager = getCheckpointManager(process.cwd());
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
      case 'memory':
        await this.handleMemory(args);
        break;
      case 'restore':
        await this.handleRestore(args);
        break;
      case 'tools':
        await this.handleTools();
        break;
      case 'stats':
        await this.handleStats();
        break;
      case 'theme':
        await this.handleTheme();
        break;
      case 'language':
        await this.handleLanguage();
        break;
      case 'about':
        await this.handleAbout();
        break;
      default:
        logger.warn(`Unknown command: /${command}`, 'Type /help for available commands');
    }

    return true;
  }

  private async showHelp(): Promise<void> {
    logger.section('Available Commands');

    const commands = [
      { cmd: '/help', desc: 'Show this help message' },
      { cmd: '/init', desc: 'Initialize project context (XAGENT.md)' },
      { cmd: '/clear', desc: 'Clear conversation history' },
      { cmd: '/exit', desc: 'Exit xAgent CLI' },
      { cmd: '/auth', desc: 'Change authentication method' },
      { cmd: '/mode', desc: 'Switch execution mode (yolo/accept_edits/plan/default)' },
      { cmd: '/think', desc: 'Toggle thinking mode and display (on/off/display)' },
      { cmd: '/agents', desc: 'Manage SubAgents (list/online/install/remove)' },
      { cmd: '/mcp', desc: 'Manage MCP servers (list/add/remove/refresh)' },
      { cmd: '/memory', desc: 'Manage memory (show/add/refresh)' },
      { cmd: '/restore', desc: 'Restore from checkpoint' },
      { cmd: '/tools', desc: 'List available tools' },
      { cmd: '/stats', desc: 'Show session statistics' },
      { cmd: '/theme', desc: 'Change UI theme' },
      { cmd: '/language', desc: 'Change language (zh/en)' },
      { cmd: '/about', desc: 'Show version and information' }
    ];

    logger.list(commands.map(c => `${c.cmd.padEnd(20)} ${c.desc}`), { indent: 2 });
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

  private async handleMode(args: string[]): Promise<void> {
    const modes = Object.values(ExecutionMode);
    const currentMode = this.configManager.getExecutionMode();

    if (args.length > 0) {
      const newMode = args[0].toLowerCase();
      if (modes.includes(newMode as ExecutionMode)) {
        this.configManager.setExecutionMode(newMode as ExecutionMode);
        console.log(chalk.green(`✅ Execution mode changed to: ${newMode}`));
      } else {
        console.log(chalk.red(`❌ Invalid mode: ${newMode}`));
        console.log(chalk.gray(`Available modes: ${modes.join(', ')}`));
      }
    } else {
      console.log(chalk.cyan('\n🎯 Execution Modes:\n'));
      console.log(`  Current: ${chalk.green(currentMode)}\n`);

      const descriptions = [
        { mode: 'yolo', desc: 'Full permissions - can execute any operation' },
        { mode: 'accept_edits', desc: 'File edit permissions only' },
        { mode: 'plan', desc: 'Plan first, execute later' },
        { mode: 'default', desc: 'No permissions - read-only' }
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
        logger.warn('MCP server addition not implemented yet', 'Use /mcp add in interactive mode');
        break;
      case 'remove':
        logger.warn('MCP server removal not implemented yet', 'Use /mcp remove in interactive mode');
        break;
      case 'refresh':
        logger.warn('MCP server refresh not implemented yet', 'Check back later for updates');
        break;
      default:
        logger.warn(`Unknown MCP action: ${action}`, 'Use /mcp list to see available actions');
    }
  }

  private async listMcpServers(): Promise<void> {
    const servers = this.mcpManager.getAllServers();

    if (servers.length === 0) {
      logger.warn('No MCP servers configured', 'Use /mcp add to add servers');
      return;
    }

    logger.section('MCP Servers');

    servers.forEach((server: MCPServer) => {
      const connected = server.isServerConnected() ? '✓' : '✗';
      const status = server.isServerConnected() ? chalk.green(connected) : chalk.red(connected);
      logger.info(`  ${status} ${server.getToolNames().join(', ')}`);
    });
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
    const spinner = ora('Refreshing memory...').start();

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
          { name: '中文', value: 'zh' },
          { name: 'English', value: 'en' }
        ]
      }
    ]);

    this.configManager.setLanguage(language);
    logger.success(`Language changed to: ${language === 'zh' ? '中文' : 'English'}`, 'Restart CLI to apply changes');
  }

  private async handleAbout(): Promise<void> {
    logger.section('xAgent CLI');
    logger.info('Version: 1.0.0');
    logger.info('A powerful AI-powered command-line assistant');
    logger.blank();
    logger.link('Documentation', 'https://platform.xagent.cn/');
    logger.link('GitHub', 'https://github.com/xagent-ai/xagent-cli');
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
