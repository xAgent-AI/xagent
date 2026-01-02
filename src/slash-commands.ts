import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ExecutionMode, ChatMessage, InputType, ToolCall, Checkpoint } from './types.js';
import { AIClient, Message, detectThinkingKeywords, getThinkingTokens } from './ai-client.js';
import { getToolRegistry } from './tools.js';
import { getAgentManager, AgentConfig } from './agents.js';
import { getMemoryManager, MemoryFile } from './memory.js';
import { getMCPManager, MCPServer } from './mcp.js';
import { getCheckpointManager } from './checkpoint.js';
import { getConfigManager, ConfigManager } from './config.js';

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
        console.log(chalk.yellow(`Unknown command: /${command}`));
        console.log(chalk.gray('Type /help for available commands'));
    }

    return true;
  }

  private async showHelp(): Promise<void> {
    console.log(chalk.cyan('\n📚 Available Commands:\n'));

    const commands = [
      { cmd: '/help', desc: 'Show this help message' },
      { cmd: '/init', desc: 'Initialize project context (IFLOW.md)' },
      { cmd: '/clear', desc: 'Clear conversation history' },
      { cmd: '/exit', desc: 'Exit iFlow CLI' },
      { cmd: '/auth', desc: 'Change authentication method' },
      { cmd: '/mode', desc: 'Switch execution mode (yolo/accept_edits/plan/default)' },
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

    commands.forEach(({ cmd, desc }) => {
      console.log(`  ${chalk.green(cmd.padEnd(20))} ${chalk.gray(desc)}`);
    });

    console.log();
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
    console.log(chalk.yellow('Conversation history cleared'));
  }

  private async handleExit(): Promise<void> {
    console.log(chalk.cyan('\n👋 Goodbye!'));
    process.exit(0);
  }

  private async handleAuth(): Promise<void> {
    console.log(chalk.cyan('\n🔐 Authentication Management\n'));

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
      console.log(chalk.gray('\nCurrent Authentication Configuration:'));
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
        console.log(chalk.yellow('Please restart iFlow CLI and run /auth again'));
      }
    }
  }

  private async handleMode(args: string[]): Promise<void> {
    const modes = Object.values(ExecutionMode);
    const currentMode = this.configManager.getExecutionMode();

    if (args.length > 0) {
      const newMode = args[0].toUpperCase();
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
        { mode: 'YOLO', desc: 'Full permissions - can execute any operation' },
        { mode: 'ACCEPT_EDITS', desc: 'File edit permissions only' },
        { mode: 'PLAN', desc: 'Plan first, execute later' },
        { mode: 'DEFAULT', desc: 'No permissions - read-only' }
      ];

      descriptions.forEach(({ mode, desc }) => {
        const current = mode === currentMode ? chalk.green(' [current]') : '';
        console.log(`  ${chalk.yellow(mode)}${current}`);
        console.log(`    ${chalk.gray(desc)}`);
      });

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
        console.log(chalk.yellow('Online marketplace not implemented yet'));
        break;
      case 'install':
        console.log(chalk.yellow('Agent installation wizard not implemented yet'));
        break;
      case 'remove':
        console.log(chalk.yellow('Agent removal not implemented yet'));
        break;
      default:
        console.log(chalk.yellow(`Unknown agents action: ${action}`));
    }
  }

  private async listAgents(): Promise<void> {
    const agents = this.agentManager.getAllAgents();

    if (agents.length === 0) {
      console.log(chalk.yellow('No agents configured'));
      return;
    }

    console.log(chalk.cyan('\n🤖 Available Agents:\n'));

    agents.forEach((agent: AgentConfig) => {
      const color = agent.color || '#FFFFFF';
      console.log(`  ${chalk.hex(color)(agent.name || agent.agentType)}`);
      console.log(`    Type: ${chalk.gray(agent.agentType)}`);
      console.log(`    ${chalk.gray(agent.whenToUse)}\n`);
    });
  }

  private async handleMcp(args: string[]): Promise<void> {
    const action = args[0] || 'list';

    switch (action) {
      case 'list':
        await this.listMcpServers();
        break;
      case 'add':
        console.log(chalk.yellow('MCP server addition not implemented yet'));
        break;
      case 'remove':
        console.log(chalk.yellow('MCP server removal not implemented yet'));
        break;
      case 'refresh':
        console.log(chalk.yellow('MCP server refresh not implemented yet'));
        break;
      default:
        console.log(chalk.yellow(`Unknown MCP action: ${action}`));
    }
  }

  private async listMcpServers(): Promise<void> {
    const servers = this.mcpManager.getAllServers();

    if (servers.length === 0) {
      console.log(chalk.yellow('No MCP servers configured'));
      return;
    }

    console.log(chalk.cyan('\n🔌 MCP Servers:\n'));

    servers.forEach((server: MCPServer) => {
      const connected = server.isServerConnected() ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${connected} ${chalk.white(server.getToolNames().join(', '))}`);
    });

    console.log();
  }

  private async handleMemory(args: string[]): Promise<void> {
    const action = args[0] || 'show';

    switch (action) {
      case 'show':
        await this.showMemory();
        break;
      case 'add':
        await this.addMemory();
        break;
      case 'refresh':
        await this.refreshMemory();
        break;
      default:
        console.log(chalk.yellow(`Unknown memory action: ${action}`));
    }
  }

  private async showMemory(): Promise<void> {
    const memoryFiles = this.memoryManager.getMemoryFiles();

    if (memoryFiles.length === 0) {
      console.log(chalk.yellow('No memory files loaded'));
      return;
    }

    console.log(chalk.cyan('\n📝 Memory Files:\n'));

    memoryFiles.forEach((file: MemoryFile) => {
      const level = file.level === 'global' ? chalk.blue('[global]') :
                     file.level === 'project' ? chalk.green('[project]') :
                     chalk.yellow('[subdirectory]');
      console.log(`  ${level} ${file.path}`);
    });

    console.log();
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
      console.log(chalk.yellow('Checkpointing is not enabled'));
      console.log(chalk.gray('Enable it with /mode or in settings'));
      return;
    }

    const checkpoints = this.checkpointManager.listCheckpoints();

    if (checkpoints.length === 0) {
      console.log(chalk.yellow('No checkpoints available'));
      return;
    }

    if (args.length > 0) {
      const checkpointId = args[0];
      try {
        await this.checkpointManager.restoreCheckpoint(checkpointId);
      } catch (error: any) {
        console.log(chalk.red(`❌ ${error.message}`));
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
      } catch (error: any) {
        console.log(chalk.red(`❌ ${error.message}`));
      }
    }
  }

  private async handleTools(): Promise<void> {
    const toolRegistry = getToolRegistry();
    const tools = toolRegistry.getAll();

    console.log(chalk.cyan('\n🔧 Available Tools:\n'));

    tools.forEach(tool => {
      console.log(`  ${chalk.green(tool.name)}`);
      console.log(`    ${chalk.gray(tool.description)}\n`);
    });
  }

  private async handleStats(): Promise<void> {
    console.log(chalk.cyan('\n📊 Session Statistics:\n'));
    console.log(`  Execution Mode: ${chalk.green(this.configManager.getExecutionMode())}`);
    console.log(`  Language: ${chalk.green(this.configManager.getLanguage())}`);
    console.log(`  Checkpointing: ${this.checkpointManager.isEnabled() ? chalk.green('Enabled') : chalk.red('Disabled')}`);
    console.log(`  MCP Servers: ${chalk.green(this.mcpManager.getAllServers().length)}`);
    console.log(`  Agents: ${chalk.green(this.agentManager.getAllAgents().length)}`);
    console.log();
  }

  private async handleTheme(): Promise<void> {
    console.log(chalk.yellow('Theme switching not implemented yet'));
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
    console.log(chalk.green(`✅ Language changed to: ${language === 'zh' ? '中文' : 'English'}`));
  }

  private async handleAbout(): Promise<void> {
    console.log(chalk.cyan('\nℹ️  iFlow CLI\n'));
    console.log(chalk.gray('Version: 1.0.0'));
    console.log(chalk.gray('A powerful AI-powered command-line assistant'));
    console.log(chalk.gray('\nDocumentation: https://platform.xagent.cn/'));
    console.log(chalk.gray('GitHub: https://github.com/xagent-ai/xagent-cli\n'));
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
