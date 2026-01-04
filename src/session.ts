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
import { SystemPromptGenerator } from './system-prompt-generator.js';
import { theme, icons, colors, styleHelpers } from './theme.js';
import { getCancellationManager, CancellationManager } from './cancellation.js';

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
  private cancellationManager: CancellationManager;

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
    this.cancellationManager = getCancellationManager();
  }

  async start(): Promise<void> {
    const separator = icons.separator.repeat(60);
    console.log('');
    console.log(colors.gradient('╔════════════════════════════════════════════════════════════╗'));
    console.log(colors.gradient('║') + ' '.repeat(56) + colors.gradient('║'));
    console.log(' '.repeat(12) + colors.gradient('🤖 XAGENT CLI') + ' '.repeat(37) + colors.gradient('║'));
    console.log(' '.repeat(14) + colors.textMuted('v1.0.0') + ' '.repeat(40) + colors.gradient('║'));
    console.log(colors.gradient('║') + ' '.repeat(56) + colors.gradient('║'));
    console.log(colors.gradient('╚════════════════════════════════════════════════════════════╝'));
    console.log(colors.textMuted('  AI-powered command-line assistant'));
    console.log('');

    await this.initialize();

    this.showWelcomeMessage();

    this.promptLoop();
  }

  private async initialize(): Promise<void> {
    try {
      const spinner = ora({
        text: colors.textMuted('Initializing XAGENT CLI...'),
        spinner: 'dots',
        color: 'cyan'
      }).start();

      await this.configManager.load();

      const authConfig = this.configManager.getAuthConfig();

      if (!authConfig.apiKey) {
        spinner.stop();
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
        spinner.start();
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

      spinner.succeed(colors.success('Initialization complete'));
    } catch (error: any) {
      const spinner = ora({ text: '', spinner: 'dots', color: 'red' }).start();
      spinner.fail(colors.error(`Initialization failed: ${error.message}`));
      throw error;
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
      modelName: ''
    });

    const success = await authService.authenticate();

    if (!success) {
      console.log('');
      console.log(colors.error('Authentication failed. Exiting...'));
      console.log('');
      process.exit(1);
    }

    const authConfig = authService.getAuthConfig();
    await this.configManager.setAuthConfig(authConfig);
  }

  private showWelcomeMessage(): void {
    const language = this.configManager.getLanguage();
    const separator = icons.separator.repeat(40);

    console.log('');
    console.log(colors.border(separator));

    if (language === 'zh') {
      console.log(colors.primaryBright(`${icons.sparkles} 欢迎使用 XAGENT CLI!`));
      console.log(colors.textMuted('输入 /help 查看可用命令'));
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
        description: 'Execute commands without confirmation'
      },
      [ExecutionMode.ACCEPT_EDITS]: {
        color: colors.warning,
        icon: icons.check,
        description: 'Accept all edits automatically'
      },
      [ExecutionMode.PLAN]: {
        color: colors.info,
        icon: icons.brain,
        description: 'Plan before executing'
      },
      [ExecutionMode.DEFAULT]: {
        color: colors.success,
        icon: icons.bolt,
        description: 'Safe execution with confirmations'
      }
    };

    const config = modeConfig[this.executionMode];
    const modeName = this.executionMode;

    console.log(colors.textMuted(`${icons.info} Current Mode:`));
    console.log(`  ${config.color(config.icon)} ${styleHelpers.text.bold(config.color(modeName))}`);
    console.log(`  ${colors.textDim(`  ${config.description}`)}`);
    console.log('');
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
      const prompt = `${colors.primaryBright('❯')} `;
      this.rl.question(prompt, async (input) => {
        try {
          await this.handleInput(input);
        } catch (error: any) {
          console.log(colors.error(`Error: ${error.message}`));
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
      console.log('');
      console.log(colors.warning(`Agent not found: ${agentType}`));
      console.log(colors.textMuted('Use /agents list to see available agents'));
      console.log('');
      return;
    }

    console.log('');
    console.log(colors.primaryBright(`${icons.robot} Using agent: ${agent.name || agent.agentType}`));
    console.log(colors.border(icons.separator.repeat(40)));
    console.log('');

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
      timestamp: Date.now()
    };

    this.conversation.push(userMessage);

    await this.generateResponse(agent, thinkingTokens);
  }

  private displayThinkingContent(reasoningContent: string): void {
    const thinkingConfig = this.configManager.getThinkingConfig();
    const displayMode = thinkingConfig.displayMode || 'compact';

    const separator = icons.separator.repeat(Math.min(60, process.stdout.columns || 80));

    console.log('');
    console.log(colors.border(separator));

    switch (displayMode) {
      case 'full':
        // 完整显示，使用小字体和灰色
        console.log(colors.textDim(`${icons.brain} Thinking Process:`));
        console.log('');
        console.log(colors.textDim(reasoningContent));
        break;

      case 'compact':
        // 简洁显示，截断部分内容
        const maxLength = 500;
        const truncatedContent = reasoningContent.length > maxLength
          ? reasoningContent.substring(0, maxLength) + '... (truncated)'
          : reasoningContent;

        console.log(colors.textDim(`${icons.brain} Thinking Process:`));
        console.log('');
        console.log(colors.textDim(truncatedContent));
        console.log(colors.textDim(`[${reasoningContent.length} chars total]`));
        break;

      case 'indicator':
        // 只显示指示器
        console.log(colors.textDim(`${icons.brain} Thinking process completed`));
        console.log(colors.textDim(`[${reasoningContent.length} chars of reasoning]`));
        break;

      default:
        console.log(colors.textDim(`${icons.brain} Thinking:`));
        console.log('');
        console.log(colors.textDim(reasoningContent));
    }

    console.log(colors.border(separator));
    console.log('');
  }

  private async executeShellCommand(command: string): Promise<void> {
    console.log('');
    console.log(colors.textMuted(`${icons.code} Executing:`));
    console.log(colors.codeText(`  $ ${command}`));
    console.log(colors.border(icons.separator.repeat(Math.min(60, process.stdout.columns || 80))));
    console.log('');

    const toolRegistry = getToolRegistry();

    try {
      const result = await toolRegistry.execute('Bash', { command }, this.executionMode);

      if (result.stdout) {
        console.log(result.stdout);
      }

      if (result.stderr) {
        console.log(colors.warning(result.stderr));
      }

      const toolCall: ToolCall = {
        tool: 'Bash',
        params: { command },
        result,
        timestamp: Date.now()
      };

      this.toolCalls.push(toolCall);
    } catch (error: any) {
      console.log(colors.error(`Command execution failed: ${error.message}`));
    }
  }

  private async generateResponse(agent?: any, thinkingTokens: number = 0): Promise<void> {
    if (!this.aiClient) {
      console.log(colors.error('AI client not initialized'));
      return;
    }

    const spinner = ora({
      text: colors.textMuted(`${icons.brain} Thinking... (Press ESC to cancel)`),
      spinner: 'dots',
      color: 'cyan'
    }).start();

    try {
      const memory = await this.memoryManager.loadMemory();
      const toolRegistry = getToolRegistry();
      const availableTools = this.executionMode !== ExecutionMode.DEFAULT
        ? toolRegistry.getToolDefinitions()
        : [];

      const baseSystemPrompt = agent?.systemPrompt || 'You are a helpful AI assistant.';
      const systemPromptGenerator = new SystemPromptGenerator(toolRegistry, this.executionMode);
      const enhancedSystemPrompt = systemPromptGenerator.generateEnhancedSystemPrompt(baseSystemPrompt);

      const messages: Message[] = [
        { role: 'system', content: `${enhancedSystemPrompt}\n\n${memory}` },
        ...this.conversation.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];

      const operationId = `ai-response-${Date.now()}`;
      const responsePromise = this.aiClient.chatCompletion(messages, {
        tools: availableTools,
        toolChoice: availableTools.length > 0 ? 'auto' : 'none',
        thinkingTokens
      });

      const response = await this.cancellationManager.withCancellation(
        responsePromise,
        operationId
      );

      spinner.stop();

      const assistantMessage = response.choices[0].message;
      const content = typeof assistantMessage.content === 'string'
        ? assistantMessage.content
        : '';
      const reasoningContent = assistantMessage.reasoning_content || '';

      // Display reasoning content if available and thinking mode is enabled
      if (reasoningContent && this.configManager.getThinkingConfig().enabled) {
        this.displayThinkingContent(reasoningContent);
      }

      console.log('');
      console.log(colors.primaryBright(`${icons.robot} Assistant:`));
      console.log(colors.border(icons.separator.repeat(Math.min(60, process.stdout.columns || 80))));
      console.log('');
      console.log(content);
      console.log('');

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
      spinner.stop();

      if (error.message === 'Operation cancelled by user') {
        console.log('');
        console.log(colors.warning(`${icons.warning} Operation cancelled by user`));
        console.log('');
        return;
      }

      spinner.fail(colors.error(`Error: ${error.message}`));
      console.log(colors.error(error.message));
    }
  }

  private async handleToolCalls(toolCalls: any[]): Promise<void> {
    const toolRegistry = getToolRegistry();

    for (const toolCall of toolCalls) {
      console.log('');
      console.log(colors.warning(`${icons.tool} Raw Tool Call:`));
      console.log(colors.textDim(JSON.stringify(toolCall, null, 2)));

      const { name, arguments: params } = toolCall.function;

      console.log('');
      console.log(colors.warning(`${icons.tool} Extracted params:`));
      console.log(colors.textDim(`Type: ${typeof params}`));
      console.log(colors.textDim(`Value: ${params}`));

      // Parse arguments if it's a JSON string (OpenAI API format)
      let parsedParams: any;
      try {
        parsedParams = typeof params === 'string' ? JSON.parse(params) : params;
      } catch (e) {
        console.log(colors.error(`${icons.cross} Failed to parse tool arguments: ${e}`));
        parsedParams = params;
      }

      console.log('');
      console.log(colors.warning(`${icons.tool} Tool Call: ${name}`));
      console.log(colors.textDim(JSON.stringify(parsedParams, null, 2)));

      try {
        const operationId = `tool-${name}-${Date.now()}`;
        const toolPromise = toolRegistry.execute(name, parsedParams, this.executionMode);

        const result = await this.cancellationManager.withCancellation(
          toolPromise,
          operationId
        );

        console.log('');
        console.log(colors.success(`${icons.check} Tool Result:`));
        console.log(colors.textDim(JSON.stringify(result, null, 2)));

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
        if (error.message === 'Operation cancelled by user') {
          console.log('');
          console.log(colors.warning(`${icons.warning} Tool execution cancelled by user`));
          console.log('');
          return;
        }

        console.log('');
        console.log(colors.error(`${icons.cross} Tool Error: ${error.message}`));

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
    this.cancellationManager.cleanup();

    const separator = icons.separator.repeat(40);
    console.log('');
    console.log(colors.border(separator));
    console.log(colors.primaryBright(`${icons.sparkles} Goodbye!`));
    console.log(colors.border(separator));
    console.log('');
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
