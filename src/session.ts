import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { ExecutionMode, ChatMessage, ToolCall, AuthType } from './types.js';
import { AIClient, Message, detectThinkingKeywords, getThinkingTokens } from './ai-client.js';
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
import { getContextCompressor, ContextCompressor, CompressionResult } from './context-compressor.js';
import { Logger, LogLevel } from './logger.js';

export class InteractiveSession {
  private conversationManager: ConversationManager;
  private sessionManager: SessionManager;
  private contextCompressor: ContextCompressor;
  rl: readline.Interface;
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
  private indentLevel: number;
  private indentString: string;

  constructor(indentLevel: number = 0) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.configManager = getConfigManager(process.cwd());
    this.agentManager = getAgentManager(process.cwd());
    this.memoryManager = getMemoryManager(process.cwd());
    this.mcpManager = getMCPManager();
    this.checkpointManager = getCheckpointManager(process.cwd());
    this.conversationManager = getConversationManager();
    this.sessionManager = getSessionManager(process.cwd());
    this.slashCommandHandler = new SlashCommandHandler();
    
    // 注册 /clear 回调，清除对话时同步清空本地 conversation
    this.slashCommandHandler.setClearCallback(() => {
      this.conversation = [];
    });
    
    this.executionMode = ExecutionMode.DEFAULT;
    this.cancellationManager = getCancellationManager();
    this.indentLevel = indentLevel;
    this.indentString = '  '.repeat(indentLevel);
    this.contextCompressor = getContextCompressor();
  }

  private getIndent(): string {
    return this.indentString;
  }

  setAIClient(aiClient: AIClient): void {
    this.aiClient = aiClient;
  }

  setExecutionMode(mode: ExecutionMode): void {
    this.executionMode = mode;
  }

  setAgent(agent: any): void {
    this.currentAgent = agent;
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
    try {
      const spinner = ora({
        text: colors.textMuted('Initializing XAGENT CLI...'),
        spinner: 'dots',
        color: 'cyan'
      }).start();

      await this.configManager.load();

      let authConfig = this.configManager.getAuthConfig();

      if (!authConfig.apiKey) {
        spinner.stop();
        await this.setupAuthentication();
        // Re-fetch authConfig after setup to get the newly saved credentials
        authConfig = this.configManager.getAuthConfig();
        // inquirer may close stdin, so need to recreate readline interface
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
      this.contextCompressor.setAIClient(this.aiClient);
      this.executionMode = this.configManager.getApprovalMode() || this.configManager.getExecutionMode();

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

      // 同步对话历史到 slashCommandHandler
      this.slashCommandHandler.setConversationHistory(this.conversation);

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

    // Configure VLM for GUI Agent
    console.log('');
    const { configureVLM } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'configureVLM',
        message: 'Do you want to configure VLM for GUI Agent (browser/desktop automation)?',
        default: true
      }
    ]);

    if (configureVLM) {
      const vlmConfig = await authService.configureAndValidateVLM();
      if (vlmConfig) {
        // Both LLM and VLM configured successfully - save all at once
        this.configManager.setAuthConfig(authConfig);
        this.configManager.set('guiSubagentModel', vlmConfig.model);
        this.configManager.set('guiSubagentBaseUrl', vlmConfig.baseUrl);
        this.configManager.set('guiSubagentApiKey', vlmConfig.apiKey);
        await this.configManager.save('global');
      } else {
        console.log('');
        console.log(colors.error('VLM configuration failed. Exiting...'));
        console.log('');
        process.exit(1);
      }
    } else {
      // Only LLM configured - save LLM config
      await this.configManager.setAuthConfig(authConfig);
    }
  }

  private showWelcomeMessage(): void {
    const language = this.configManager.getLanguage();
    const separator = icons.separator.repeat(40);

    console.log('');
    console.log(colors.border(separator));

    if (language === 'zh') {
      console.log(colors.primaryBright(`${icons.sparkles} Welcome to XAGENT CLI!`));
              console.log(colors.textMuted('Type /help to see available commands'));    } else {
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
      },
      [ExecutionMode.SMART]: {
        color: colors.primaryBright,
        icon: icons.sparkles,
        description: 'Smart approval with intelligent security checks'
      }
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

    // Recreate readline interface
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
      output: process.stdout
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
        this.executionMode = this.configManager.getApprovalMode() || this.configManager.getExecutionMode();
        // 同步对话历史到 slashCommandHandler
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

    // Record input to session manager
    const sessionInput = {
      type: 'text' as const,
      content: userContent,
      rawInput: message,
      timestamp: Date.now()
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
      timestamp: Date.now()
    };

    // Save last user message for recovery after compression
    const lastUserMessage = userMessage;

    this.conversation.push(userMessage);
    await this.conversationManager.addMessage(userMessage);

    // 检查是否需要压缩上下文
    await this.checkAndCompressContext(lastUserMessage);

    await this.generateResponse(thinkingTokens);
  }

  private displayThinkingContent(reasoningContent: string): void {
    const indent = this.getIndent();
    const thinkingConfig = this.configManager.getThinkingConfig();
    const displayMode = thinkingConfig.displayMode || 'compact';

    const separator = icons.separator.repeat(Math.min(60, process.stdout.columns || 80) - indent.length);

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
        const truncatedContent = reasoningContent.length > maxLength
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
        console.log(`${indent}${colors.textDim(`[${reasoningContent.length} chars of reasoning]`)}`);
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
   * 检查并压缩对话上下文
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
      console.log(`${indent}${colors.warning(`${icons.brain} Context compression triggered: ${reason}`)}`);

      const toolRegistry = getToolRegistry();
      const baseSystemPrompt = this.currentAgent?.systemPrompt || 'You are a helpful AI assistant.';
      const systemPromptGenerator = new SystemPromptGenerator(toolRegistry, this.executionMode);
      const enhancedSystemPrompt = await systemPromptGenerator.generateEnhancedSystemPrompt(baseSystemPrompt);

      const result: CompressionResult = await this.contextCompressor.compressContext(
        this.conversation,
        enhancedSystemPrompt,
        compressionConfig
      );

      if (result.wasCompressed) {
        this.conversation = result.compressedMessages;
        // console.log(`${indent}${colors.success(`✓ Compressed ${result.originalMessageCount} messages to ${result.compressedMessageCount} messages`)}`);
        console.log(`${indent}${colors.textMuted(`✓ Size: ${result.originalSize} → ${result.compressedSize} chars (${Math.round((1 - result.compressedSize / result.originalSize) * 100)}% reduction)`)}`);

        // 显示压缩后的摘要内容
        const summaryMessage = result.compressedMessages.find(m => m.role === 'assistant');
        if (summaryMessage && summaryMessage.content) {
          const maxPreviewLength = 800;
          let summaryContent = summaryMessage.content;
          const isTruncated = summaryContent.length > maxPreviewLength;

          if (isTruncated) {
            summaryContent = summaryContent.substring(0, maxPreviewLength) + '\n...';
          }

          console.log('');
          console.log(`${indent}${theme.predefinedStyles.title(`${icons.sparkles} Conversation Summary`)}`);
          const separator = icons.separator.repeat(Math.min(60, process.stdout.columns || 80) - indent.length * 2);
          console.log(`${indent}${colors.border(separator)}`);
          const renderedSummary = renderMarkdown(summaryContent, (process.stdout.columns || 80) - indent.length * 4);
          console.log(`${indent}${theme.predefinedStyles.dim(renderedSummary).replace(/^/gm, indent)}`);
          if (isTruncated) {
            console.log(`${indent}${colors.textMuted(`(... ${summaryMessage.content.length - maxPreviewLength} more chars hidden)`)}`);
          }
          console.log(`${indent}${colors.border(separator)}`);
        }

        // 压缩后恢复用户消息，确保 API 调用时有 user 消息
        if (lastUserMessage) {
          this.conversation.push(lastUserMessage);
        }

        // 同步压缩后的对话历史到 slashCommandHandler
        this.slashCommandHandler.setConversationHistory(this.conversation);
      }
    }
  }

  private async executeShellCommand(command: string): Promise<void> {
    const indent = this.getIndent();
    console.log('');
    console.log(`${indent}${colors.textMuted(`${icons.code} Executing:`)}`);
    console.log(`${indent}${colors.codeText(`  $ ${command}`)}`);
    console.log(`${indent}${colors.border(icons.separator.repeat(Math.min(60, process.stdout.columns || 80) - indent.length))}`);
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
        timestamp: Date.now()
      };

      this.toolCalls.push(toolCall);

      // Record command execution to session manager
      await this.sessionManager.addInput({
        type: 'command',
        content: command,
        rawInput: command,
        timestamp: Date.now()
      });

      await this.sessionManager.addOutput({
        role: 'tool',
        content: JSON.stringify(result),
        toolName: 'Bash',
        toolParams: { command },
        toolResult: result,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.log(`${indent}${colors.error(`Command execution failed: ${error.message}`)}`);
    }
  }

  private async generateResponse(thinkingTokens: number = 0): Promise<void> {
    if (!this.aiClient) {
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
      const allToolDefinitions = toolRegistry.getToolDefinitions();
      const availableTools = this.executionMode !== ExecutionMode.DEFAULT && allowedToolNames.length > 0
        ? allToolDefinitions.filter((tool: any) => allowedToolNames.includes(tool.function.name))
        : [];

      const baseSystemPrompt = this.currentAgent?.systemPrompt;
      const systemPromptGenerator = new SystemPromptGenerator(toolRegistry, this.executionMode);
      const enhancedSystemPrompt = await systemPromptGenerator.generateEnhancedSystemPrompt(baseSystemPrompt);

      const messages: Message[] = [
        { role: 'system', content: `${enhancedSystemPrompt}\n\n${memory}` },
        ...this.conversation.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];

      // Debug: 打印完整的 prompt 信息
      // const logger = new Logger({ minLevel: LogLevel.DEBUG });
      // logger.debug('[DEBUG] 即将发送给 AI 的完整 Prompt:');
      // console.log('\n' + '='.repeat(60));
      // console.log('【SYSTEM PROMPT】');
      // console.log('-'.repeat(60));
      // console.log(messages[0]?.content || '(无)');
      // console.log('='.repeat(60));
      // console.log('【CONVERSATION】');
      // console.log('-'.repeat(60));
      // messages.slice(1).forEach((msg, idx) => {
      //   const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      //   console.log(`[${idx + 1}] [${msg.role}]: ${contentStr.substring(0, 200)}${contentStr.length > 200 ? '...' : ''}`);
      // });
      // console.log('='.repeat(60));
      // console.log(`【AVAILABLE TOOLS】: ${availableTools.length} 个工具`);
      // availableTools.forEach((tool: any) => {
      //   console.log(`  - ${tool.function.name}`);
            // });      // console.log('='.repeat(60) + '\n');
      
            // Debug: 打印AI输入信息 (已移至 ai-client.ts)
            // if (this.configManager.get('showAIDebugInfo')) {
            //   this.displayAIDebugInfo('INPUT', messages, availableTools);
            // }
      
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

      clearInterval(spinnerInterval);
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r'); // Clear spinner line

      const assistantMessage = response.choices[0].message;

      // Debug: 打印AI输出信息 (已移至 ai-client.ts)
      // if (this.configManager.get('showAIDebugInfo')) {
      //   this.displayAIDebugInfo('OUTPUT', response, assistantMessage);
      // }

      const content = typeof assistantMessage.content === 'string'
        ? assistantMessage.content
        : '';
      const reasoningContent = assistantMessage.reasoning_content || '';

      // console.error('[SESSION DEBUG] assistantMessage:', JSON.stringify(assistantMessage).substring(0, 200));
      // console.error('[SESSION DEBUG] content:', content);

      // Display reasoning content if available and thinking mode is enabled
      if (reasoningContent && this.configManager.getThinkingConfig().enabled) {
        this.displayThinkingContent(reasoningContent);
      }

      console.log('');
      console.log(`${indent}${colors.primaryBright(`${icons.robot} Assistant:`)}`);
      console.log(`${indent}${colors.border(icons.separator.repeat(Math.min(60, process.stdout.columns || 80) - indent.length))}`);
      console.log('');
      const renderedContent = renderMarkdown(content, (process.stdout.columns || 80) - indent.length * 2);
      console.log(`${indent}${renderedContent.replace(/^/gm, indent)}`);
      console.log('');

      this.conversation.push({
        role: 'assistant',
        content,
        timestamp: Date.now(),
        reasoningContent,
        toolCalls: assistantMessage.tool_calls
      });

      // Record output to session manager
      await this.sessionManager.addOutput({
        role: 'assistant',
        content,
        timestamp: Date.now(),
        reasoningContent,
        toolCalls: assistantMessage.tool_calls
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
    } catch (error: any) {
      clearInterval(spinnerInterval);
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');

      // Clear the operation flag
      (this as any)._isOperationInProgress = false;

      if (error.message === 'Operation cancelled by user') {
        // Message is already logged by CancellationManager
        return;
      }

      console.log(colors.error(`Error: ${error.message}`));
    }
  }

  private async handleToolCalls(toolCalls: any[]): Promise<void> {
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

      return { name, params: parsedParams, index };
    });

    // Display all tool calls info
    for (const { name, params } of preparedToolCalls) {
      if (showToolDetails) {
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
      preparedToolCalls.map(tc => ({ name: tc.name, params: tc.params })),
      this.executionMode
    );

    // Process results and maintain order
    for (const { tool, result, error } of results) {
      const toolCall = preparedToolCalls.find(tc => tc.name === tool);
      if (!toolCall) continue;

      const { params } = toolCall;

      if (error) {
        // Clear the operation flag
        (this as any)._isOperationInProgress = false;

        if (error === 'Operation cancelled by user') {
          return;
        }

        console.log('');
        console.log(`${indent}${colors.error(`${icons.cross} Tool Error: ${error}`)}`);

        this.conversation.push({
          role: 'tool',
          content: JSON.stringify({ error }),
          timestamp: Date.now()
        });
      } else {
        // Use correct indent for gui-subagent tasks
        const isGuiSubagent = tool === 'task' && params?.subagent_type === 'gui-subagent';
        const displayIndent = isGuiSubagent ? indent + '  ' : indent;

        // Always show details for todo tools so users can see their task lists
        const isTodoTool = tool === 'todo_write' || tool === 'todo_read';
        if (isTodoTool) {
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
          console.log(`${displayIndent}${colors.error(`${icons.cross} ${result.message || 'Failed'}`)}`);
        } else {
          console.log(`${displayIndent}${colors.success(`${icons.check} Completed`)}`);
        }

        const toolCallRecord: ToolCall = {
          tool,
          params,
          result,
          timestamp: Date.now()
        };

        this.toolCalls.push(toolCallRecord);

        // Record tool output to session manager
        await this.sessionManager.addOutput({
          role: 'tool',
          content: JSON.stringify(result),
          toolName: tool,
          toolParams: params,
          toolResult: result,
          timestamp: Date.now()
        });

        this.conversation.push({
          role: 'tool',
          content: JSON.stringify(result),
          timestamp: Date.now()
        });
      }
    }

    // Logic: Only skip returning results to main agent when user explicitly cancelled (ESC)
    // For all other cases (success, failure, errors), always return results for further processing
    const guiSubagentFailed = preparedToolCalls.some(tc => tc.name === 'task' && tc.params?.subagent_type === 'gui-subagent');
    const guiSubagentCancelled = preparedToolCalls.some(tc => tc.name === 'task' && tc.params?.subagent_type === 'gui-subagent' && results.some(r => r.tool === 'task' && (r.result as any)?.cancelled === true));

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
    await this.generateResponse();
  }

  /**
   * Get user-friendly description for tool
   */
  private getToolDescription(toolName: string, params: any): string {
    const descriptions: Record<string, (params: any) => string> = {
      'Read': (p) => `Read file: ${this.truncatePath(p.filePath)}`,
      'Write': (p) => `Write file: ${this.truncatePath(p.filePath)}`,
      'Grep': (p) => `Search text: "${p.pattern}"`,
      'Bash': (p) => `Execute command: ${this.truncateCommand(p.command)}`,
      'ListDirectory': (p) => `List directory: ${this.truncatePath(p.path || '.')}`,
      'SearchCodebase': (p) => `Search files: ${p.pattern}`,
      'DeleteFile': (p) => `Delete file: ${this.truncatePath(p.filePath)}`,
      'CreateDirectory': (p) => `Create directory: ${this.truncatePath(p.dirPath)}`,
      'replace': (p) => `Replace text: ${this.truncatePath(p.file_path)}`,
      'web_search': (p) => `Web search: "${p.query}"`,
      'todo_write': () => `Update todo list`,
      'todo_read': () => `Read todo list`,
      'task': (p) => `Launch subtask: ${p.description}`,
      'ReadBashOutput': (p) => `Read task output: ${p.task_id}`,
      'web_fetch': () => `Fetch web content`,
      'ask_user_question': () => `Ask user`,
      'save_memory': () => `Save memory`,
      'exit_plan_mode': () => `Complete plan`,
      'xml_escape': (p) => `XML escape: ${this.truncatePath(p.file_path)}`,
      'image_read': (p) => `Read image: ${this.truncatePath(p.image_input)}`,
      'Skill': (p) => `Execute skill: ${p.skill}`,
      'ListSkills': () => `List available skills`,
      'GetSkillDetails': (p) => `Get skill details: ${p.skill}`,
      'InvokeSkill': (p) => `Invoke skill: ${p.skillId} - ${this.truncatePath(p.taskDescription || '', 40)}`
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

    const statusConfig: Record<string, { icon: string; color: (text: string) => string; label: string }> = {
      'pending': { icon: icons.circle, color: colors.textMuted, label: 'Pending' },
      'in_progress': { icon: icons.loading, color: colors.warning, label: 'In Progress' },
      'completed': { icon: icons.success, color: colors.success, label: 'Completed' },
      'failed': { icon: icons.error, color: colors.error, label: 'Failed' }
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
  // AI 调试信息已移至 ai-client.ts 实现
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
  //       colors.textMuted(systemMsg?.content?.toString().substring(0, 50) || '(无)') + ' '.repeat(3) + colors.border(boxChar.vertical));
  //
  //     // Messages count
  //     console.log(colors.border(`${boxChar.vertical}`) + ' 💬 MESSAGES: ' +
  //       colors.text(messages.length.toString()) + ' 条' + ' '.repeat(40) + colors.border(boxChar.vertical));
  //
  //     // Tools count
  //     console.log(colors.border(`${boxChar.vertical}`) + ' 🔧 TOOLS: ' +
  //       colors.text((tools?.length || 0).toString()) + ' 个' + ' '.repeat(43) + colors.border(boxChar.vertical));
  //
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
  //     console.log(colors.border(`${boxChar.vertical}`) + ' 🔧 TOOL_CALLS: ' +
  //       colors.text((message.tool_calls?.length || 0).toString()) + ' 个' + ' '.repeat(37) + colors.border(boxChar.vertical));
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
    this.mcpManager.disconnectAllServers();
    this.cancellationManager.cleanup();

    // End the current session
    this.sessionManager.completeCurrentSession();

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
