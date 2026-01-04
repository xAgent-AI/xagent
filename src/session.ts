import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { ExecutionMode, ChatMessage, ToolCall } from './types.js';
import { AIClient, Message, detectThinkingKeywords, getThinkingTokens } from './ai-client.js';
import { getConfigManager, ConfigManager } from './config.js';
import { AuthService, selectAuthType } from './auth.js';
import { getToolRegistry } from './tools.js';
import { getAgentManager, DEFAULT_AGENTS, AgentManager } from './agents.js';
import { getMemoryManager, MemoryManager } from './memory.js';
import { getMCPManager, MCPManager } from './mcp.js';
import { getCheckpointManager, CheckpointManager } from './checkpoint.js';
import { SlashCommandHandler, parseInput, detectImageInput } from './slash-commands.js';

export class InteractiveSession {
  private rl: readline.Interface;
  private aiClient: AIClient | null = null;
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

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.configManager = getConfigManager(process.cwd());
    this.agentManager = getAgentManager(process.cwd());
    this.memoryManager = getMemoryManager(process.cwd());
    this.mcpManager = getMCPManager();
    this.checkpointManager = getCheckpointManager(process.cwd());
    this.slashCommandHandler = new SlashCommandHandler();
    this.executionMode = ExecutionMode.DEFAULT;
  }

  async start(): Promise<void> {
    console.log(chalk.cyan('\n🤖 XAGENT CLI v1.0.0\n'));
    console.log(chalk.gray('AI-powered command-line assistant\n'));

    await this.initialize();

    this.showWelcomeMessage();

    this.promptLoop();
  }

  private async initialize(): Promise<void> {
    try {
      console.log(chalk.gray('Initializing...'));

      await this.configManager.load();

      const authConfig = this.configManager.getAuthConfig();

      if (!authConfig.apiKey) {
        await this.setupAuthentication();
        // inquirer 可能会关闭 stdin，所以需要重新创建 readline 接口
        this.rl.close();
        this.rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        this.rl.on('close', () => {
          console.error('DEBUG: readline interface closed');
        });
      }

      this.aiClient = new AIClient(authConfig);
      this.executionMode = this.configManager.getExecutionMode();

      await this.agentManager.loadAgents();
      await this.memoryManager.loadMemory();

      const mcpServers = this.configManager.getMcpServers();
      Object.entries(mcpServers).forEach(([name, config]) => {
        this.mcpManager.registerServer(name, config);
      });

      await this.mcpManager.connectAllServers();

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

      console.log(chalk.green('✔ Initialization complete'));
    } catch (error: any) {
      console.log(chalk.red(`✖ Initialization failed: ${error.message}`));
      throw error;
    }
  }

  private async setupAuthentication(): Promise<void> {
    console.log(chalk.cyan('\n🔐 Setup Authentication\n'));

    const authType = await selectAuthType();
    this.configManager.set('selectedAuthType', authType);

    const authService = new AuthService({
      type: authType,
      apiKey: '',
      baseUrl: '',
      modelName: ''
    });

    const success = await authService.authenticate();

    if (!success) {
      console.log(chalk.red('Authentication failed. Exiting...'));
      process.exit(1);
    }

    const authConfig = authService.getAuthConfig();
    await this.configManager.setAuthConfig(authConfig);
  }

  private showWelcomeMessage(): void {
    const language = this.configManager.getLanguage();
    
    if (language === 'zh') {
      console.log(chalk.gray('欢迎使用 XAGENT CLI!'));
      console.log(chalk.gray('输入 /help 查看可用命令\n'));
    } else {
      console.log(chalk.gray('Welcome to XAGENT CLI!'));
      console.log(chalk.gray('Type /help to see available commands\n'));
    }

    this.showExecutionMode();
  }

  private showExecutionMode(): void {
    const modeColors = {
      [ExecutionMode.YOLO]: chalk.red,
      [ExecutionMode.ACCEPT_EDITS]: chalk.yellow,
      [ExecutionMode.PLAN]: chalk.blue,
      [ExecutionMode.DEFAULT]: chalk.green
    };

    const modeName = {
      [ExecutionMode.YOLO]: 'YOLO',
      [ExecutionMode.ACCEPT_EDITS]: 'ACCEPT_EDITS',
      [ExecutionMode.PLAN]: 'PLAN',
      [ExecutionMode.DEFAULT]: 'DEFAULT'
    };

    const color = modeColors[this.executionMode];
    console.log(chalk.gray(`Current Mode: ${color(modeName[this.executionMode])}\n`));
  }

  private promptLoop(): void {
    // 重新创建 readline 接口，因为之前的接口可能已经被关闭
    if (this.rl) {
      this.rl.close();
    }
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      this.rl.question(chalk.green('> '), async (input) => {
        try {
          await this.handleInput(input);
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
        }

        this.promptLoop();
      });
    } catch (error: any) {
      console.error('Error in promptLoop:', error);
    }
  }

  private async handleInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
      return;
    }

    if (trimmedInput.startsWith('/')) {
      const handled = await this.slashCommandHandler.handleCommand(trimmedInput);
      if (handled) {
        this.executionMode = this.configManager.getExecutionMode();
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
      console.log(chalk.yellow(`Agent not found: ${agentType}`));
      console.log(chalk.gray('Use /agents list to see available agents'));
      return;
    }

    console.log(chalk.cyan(`🤖 Using agent: ${agent.name || agent.agentType}`));

    this.currentAgent = agent;
    await this.processUserMessage(task, agent);
  }

  public async processUserMessage(message: string, agent?: any): Promise<void> {
    const inputs = parseInput(message);
    const textInput = inputs.find(i => i.type === 'text');
    const fileInputs = inputs.filter(i => i.type === 'file');
    const commandInput = inputs.find(i => i.type === 'command');

    if (commandInput) {
      await this.executeShellCommand(commandInput.content);
      return;
    }

    let userContent = textInput?.content || '';

    if (fileInputs.length > 0) {
      const toolRegistry = getToolRegistry();
      for (const fileInput of fileInputs) {
        try {
          const content = await toolRegistry.execute('Read', { filePath: fileInput.content }, this.executionMode);
          userContent += `\n\n--- File: ${fileInput.content} ---\n${content}`;
        } catch (error: any) {
          console.log(chalk.yellow(`Warning: Failed to read file ${fileInput.content}: ${error.message}`));
        }
      }
    }

    const thinkingMode = detectThinkingKeywords(userContent);
    const thinkingTokens = getThinkingTokens(thinkingMode);

    const userMessage: ChatMessage = {
      role: 'user',
      content: userContent,
      timestamp: Date.now()
    };

    this.conversation.push(userMessage);

    await this.generateResponse(agent, thinkingTokens);
  }

  private async executeShellCommand(command: string): Promise<void> {
    console.log(chalk.gray(`Executing: ${command}`));

    const toolRegistry = getToolRegistry();
    
    try {
      const result = await toolRegistry.execute('Bash', { command }, this.executionMode);
      
      if (result.stdout) {
        console.log(result.stdout);
      }
      
      if (result.stderr) {
        console.log(chalk.yellow(result.stderr));
      }

      const toolCall: ToolCall = {
        tool: 'Bash',
        params: { command },
        result,
        timestamp: Date.now()
      };

      this.toolCalls.push(toolCall);
    } catch (error: any) {
      console.log(chalk.red(`Command execution failed: ${error.message}`));
    }
  }

  private async generateResponse(agent?: any, thinkingTokens: number = 0): Promise<void> {
    if (!this.aiClient) {
      console.log(chalk.red('AI client not initialized'));
      return;
    }

    const spinner = ora('Thinking...').start();

    try {
      const memory = await this.memoryManager.loadMemory();
      const toolRegistry = getToolRegistry();
      const availableTools = this.executionMode !== ExecutionMode.DEFAULT 
        ? toolRegistry.getToolDefinitions()
        : [];

      const systemPrompt = agent?.systemPrompt || 'You are a helpful AI assistant.';
      
      const messages: Message[] = [
        { role: 'system', content: `${systemPrompt}\n\n${memory}` },
        ...this.conversation.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];

      const response = await this.aiClient.chatCompletion(messages, {
        tools: availableTools,
        toolChoice: availableTools.length > 0 ? 'auto' : 'none',
        thinkingTokens
      });

      spinner.stop();

      const assistantMessage = response.choices[0].message;
      const content = typeof assistantMessage.content === 'string' 
        ? assistantMessage.content 
        : '';

      console.log(chalk.cyan('\n🤖 Assistant:'));
      console.log(content);
      console.log();

      this.conversation.push({
        role: 'assistant',
        content,
        timestamp: Date.now()
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
    } catch (error: any) {
      spinner.fail(`Error: ${error.message}`);
      console.log(chalk.red(error.message));
    }
  }

  private async handleToolCalls(toolCalls: any[]): Promise<void> {
    const toolRegistry = getToolRegistry();

    for (const toolCall of toolCalls) {
      console.log(chalk.yellow('\n🔧 Raw Tool Call:'));
      console.log(chalk.gray(JSON.stringify(toolCall, null, 2)));

      const { name, arguments: params } = toolCall.function;
      
      console.log(chalk.yellow('\n🔧 Extracted params:'));
      console.log(chalk.gray(`Type: ${typeof params}`));
      console.log(chalk.gray(`Value: ${params}`));
      
      // Parse arguments if it's a JSON string (OpenAI API format)
      let parsedParams: any;
      try {
        parsedParams = typeof params === 'string' ? JSON.parse(params) : params;
      } catch (e) {
        console.log(chalk.red(`❌ Failed to parse tool arguments: ${e}`));
        parsedParams = params;
      }
      
      console.log(chalk.yellow(`\n🔧 Tool Call: ${name}`));
      console.log(chalk.gray(JSON.stringify(parsedParams, null, 2)));

      try {
        const result = await toolRegistry.execute(name, parsedParams, this.executionMode);
        
        console.log(chalk.green('✅ Tool Result:'));
        console.log(chalk.gray(JSON.stringify(result, null, 2)));

        const toolCallRecord: ToolCall = {
          tool: name,
          params: parsedParams,
          result,
          timestamp: Date.now()
        };

        this.toolCalls.push(toolCallRecord);

        this.conversation.push({
          role: 'tool',
          content: JSON.stringify(result),
          timestamp: Date.now()
        });
      } catch (error: any) {
        console.log(chalk.red(`❌ Tool Error: ${error.message}`));

        this.conversation.push({
          role: 'tool',
          content: JSON.stringify({ error: error.message }),
          timestamp: Date.now()
        });
      }
    }

    await this.generateResponse(this.currentAgent);
  }

  shutdown(): void {
    this.rl.close();
    this.mcpManager.disconnectAllServers();
    console.log(chalk.cyan('\n👋 Goodbye!\n'));
  }
}

export async function startInteractiveSession(): Promise<void> {
  const session = new InteractiveSession();

  process.on('SIGINT', () => {
    session.shutdown();
    process.exit(0);
  });

  await session.start();
}
