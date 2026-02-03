#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@clack/prompts';
import { startInteractiveSession } from './session.js';
import { getConfigManager } from './config.js';
import { AuthService, selectAuthType } from './auth.js';
import { AuthType } from './types.js';
import { RemoteAIClient } from './remote-ai-client.js';
import { getAgentManager } from './agents.js';
import { getMCPManager } from './mcp.js';
import { getLogger, setConfigProvider } from './logger.js';
import { theme, icons, colors } from './theme.js';
import { getCancellationManager } from './cancellation.js';
import { readFileSync, promises as fs } from 'fs';
import path from 'path';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json
const packageJsonPath = join(__dirname, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

const logger = getLogger();

// Initialize CancellationManager early to set up ESC handler
getCancellationManager();

// Set up config provider for logger to read loggerLevel
setConfigProvider(() => {
  const configManager = getConfigManager();
  return {
    getLoggerLevel: () => configManager.getLoggerLevel()
  };
});

const program = new Command();

/**
 * Format error message for user-friendly display
 */
function formatError(error: unknown): { message: string; suggestion: string } {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Network errors
  if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
    return {
      message: 'Unable to connect to the server',
      suggestion: 'Please check your network connection and try again.'
    };
  }
  if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNRESET')) {
    return {
      message: 'Connection timed out',
      suggestion: 'The server may be busy. Please wait a moment and try again.'
    };
  }
  // Authentication errors
  if (errorMessage.includes('401') || errorMessage.includes('Unauthorized') || errorMessage.includes('invalid token')) {
    return {
      message: 'Authentication failed',
      suggestion: 'Please login again using: xagent auth'
    };
  }
  // Token expired
  if (errorMessage.includes('token') && errorMessage.includes('expired')) {
    return {
      message: 'Session expired',
      suggestion: 'Please login again using: xagent auth'
    };
  }
  // Permission errors
  if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
    return {
      message: 'Permission denied',
      suggestion: 'Please check your file permissions or run with appropriate privileges.'
    };
  }
  // File not found
  if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
    return {
      message: 'File or resource not found',
      suggestion: 'Please check the path and try again.'
    };
  }
  // Invalid JSON
  if (errorMessage.includes('JSON') || errorMessage.includes('parse')) {
    return {
      message: 'Invalid data format',
      suggestion: 'The configuration file may be corrupted. Please check the file content.'
    };
  }

  // Default friendly message
  return {
    message: 'An error occurred',
    suggestion: 'Please try again. If the problem persists, check your configuration.'
  };
}

program
  .name('xagent')
  .description('AI-powered command-line assistant')
  .version(packageJson.version)
  .option('-h, --help', 'Show help');

program
  .command('start')
  .description('Start the xAgent CLI interactive session')
  .option('--approval-mode <mode>', 'Set approval mode (yolo, accept_edits, plan, default, smart)')
  .action(async (options) => {
    if (options.approvalMode) {
      const { getConfigManager } = await import('./config.js');
      const { ExecutionMode } = await import('./types.js');
      const configManager = getConfigManager();

      const validModes = Object.values(ExecutionMode) as string[];
      if (!validModes.includes(options.approvalMode)) {
        console.log('');
        console.log(colors.error(`Invalid approval mode: ${options.approvalMode}`));
        console.log(colors.textMuted(`Valid modes: ${validModes.join(', ')}`));
        console.log('');
        process.exit(1);
      }

      configManager.setApprovalMode(options.approvalMode as any);
      configManager.save('global');
      console.log('');
      console.log(colors.success(`✅ Approval mode set to: ${options.approvalMode}`));
      console.log('');
    }
    await startInteractiveSession();
  });

program
  .command('auth')
  .description('Configure authentication for xAgent CLI')
  .action(async () => {
    const separator = icons.separator.repeat(40);
    console.log('');
    console.log(colors.primaryBright(`${icons.lock} Authentication Management`));
    console.log(colors.border(separator));
    console.log('');

    const authType = await selectAuthType();
    const configManager = getConfigManager();
    configManager.set('selectedAuthType', authType);

    // Get xagentApiBaseUrl from config (respects XAGENT_BASE_URL env var)
    const config = configManager.getAuthConfig();

    const authService = new AuthService({
      type: authType,
      apiKey: '',
      baseUrl: '',
      modelName: '',
      xagentApiBaseUrl: config.xagentApiBaseUrl
    });

    const success = await authService.authenticate();

    if (success) {
      const authConfig = authService.getAuthConfig();
      
      // Clear modelName for remote mode
      if (authType === AuthType.OAUTH_XAGENT) {
        authConfig.modelName = '';
      }
      
      configManager.setAuthConfig(authConfig);

      // Set default remote model settings if not already set
      if (authType === AuthType.OAUTH_XAGENT) {
        const webBaseUrl = authConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
        let defaultLlmName = '';
        let defaultVlmName = '';

        try {
          console.log(colors.textMuted('   Fetching default models from remote server...'));
          const defaults = await RemoteAIClient.fetchDefaultModels(authConfig.apiKey || '', webBaseUrl);

          if (defaults.llm?.name) {
            defaultLlmName = defaults.llm.name;
            console.log(colors.textMuted(`   Default LLM: ${defaults.llm.displayName || defaultLlmName}`));
          }
          if (defaults.vlm?.name) {
            defaultVlmName = defaults.vlm.name;
            console.log(colors.textMuted(`   Default VLM: ${defaults.vlm.displayName || defaultVlmName}`));
          }
        } catch (error: any) {
          console.log(colors.textMuted(`   ⚠️  Failed to fetch default models: ${error.message}`));
          console.log(colors.textMuted('   ⚠️  Use /model command to select models manually.'));
        }

        configManager.set('remote_llmModelName', defaultLlmName);
        configManager.set('remote_vlmModelName', defaultVlmName);
        configManager.save('global');
      }

      console.log('');
      console.log(colors.success('Authentication configured successfully!'));
      console.log(colors.textMuted('You can now run "xagent start" to begin'));
      console.log('');
    } else {
      console.log('');
      console.log(colors.error('Authentication failed. Please try again.'));
      console.log(colors.textMuted('Run "xagent auth" to retry'));
      console.log('');
      process.exit(1);
    }
  });

program
  .command('agent')
  .description('Add, list, or remove SubAgents')
  .option('-l, --list', 'List all agents')
  .option('-a, --add <name>', 'Add a new agent')
  .option('-r, --remove <name>', 'Remove an agent')
  .option('--scope <scope>', 'Scope (global or project)', 'global')
  .action(async (options) => {
    const agentManager = getAgentManager(process.cwd());
    await agentManager.loadAgents();

    if (options.list) {
      const agents = agentManager.getAllAgents();

      if (agents.length === 0) {
        console.log('');
        console.log(colors.warning('No agents configured'));
        console.log(colors.textMuted('Use /agents install in interactive mode to add agents'));
        console.log('');
      } else {
        const separator = icons.separator.repeat(40);
        console.log('');
        console.log(colors.primaryBright(`${icons.robot} Available Agents`));
        console.log(colors.border(separator));
        console.log('');

        agents.forEach((agent, index) => {
          console.log(`  ${colors.primaryBright(`${index + 1}. ${agent.agentType}`)}`);
          console.log(`    ${colors.textDim(`  ${agent.whenToUse}`)}`);
          console.log('');
        });
      }
    } else if (options.add) {
      console.log('');
      console.log(colors.warning('Agent creation wizard not implemented yet'));
      console.log(colors.textMuted('Use /agents install in interactive mode'));
      console.log('');
    } else if (options.remove) {
      try {
        await agentManager.removeAgent(options.remove, options.scope);
        console.log('');
        console.log(colors.success(`Agent ${options.remove} removed successfully`));
        console.log('');
      } catch (error: any) {
        const { message, suggestion } = formatError(error);
        console.log('');
        console.log(colors.error(`Failed to remove agent: ${message}`));
        console.log(colors.textMuted(suggestion));
        console.log('');
      }
    } else {
      console.log('');
      console.log(colors.warning('Please specify an action: --list, --add, or --remove'));
      console.log('');
    }
  });

program
  .command('mcp')
  .description('Add, list, or remove MCP servers')
  .option('-l, --list', 'List all MCP servers')
  .option('-a, --add <name>', 'Add a new MCP server')
  .option('-r, --remove <name>', 'Remove an MCP server')
  .option('--scope <scope>', 'Scope (global or project)', 'global')
  .action(async (options) => {
    const configManager = getConfigManager(process.cwd());
    const mcpManager = getMCPManager();

    if (options.list) {
      const servers = mcpManager.getAllServers();

      if (servers.length === 0) {
        console.log('');
        console.log(colors.warning('No MCP servers configured'));
        console.log(colors.textMuted('Use /mcp add in interactive mode to add servers'));
        console.log('');
      } else {
        const separator = icons.separator.repeat(40);
        console.log('');
        console.log(colors.primaryBright(`${icons.tool} MCP Servers`));
        console.log(colors.border(separator));
        console.log('');

        servers.forEach((server, index) => {
          const connected = server.isServerConnected() ? icons.success : icons.error;
          const status = server.isServerConnected() ? colors.success(connected) : colors.error(connected);
          const toolNames = server.getToolNames().join(', ');

          console.log(`  ${status} ${colors.primaryBright(`Server ${index + 1}`)}`);
          console.log(`    ${colors.textDim(`  Tools: ${toolNames}`)}`);
          console.log('');
        });
      }
    } else if (options.add) {
      console.log('');
      console.log(colors.warning('MCP server addition not implemented yet'));
      console.log(colors.textMuted('Use /mcp add in interactive mode'));
      console.log('');
    } else if (options.remove) {
      try {
        mcpManager.disconnectServer(options.remove);
        const mcpServers = configManager.getMcpServers();
        delete mcpServers[options.remove];
        configManager.save(options.scope);
        console.log('');
        console.log(colors.success(`MCP server ${options.remove} removed successfully`));
        console.log('');
      } catch (error: any) {
        const { message, suggestion } = formatError(error);
        console.log('');
        console.log(colors.error(`Failed to remove MCP server: ${message}`));
        console.log(colors.textMuted(suggestion));
        console.log('');
      }
    } else {
      console.log('');
      console.log(colors.warning('Please specify an action: --list, --add, or --remove'));
      console.log('');
    }
  });

program
  .command('init')
  .description('Initialize XAGENT.md for the current project')
  .action(async () => {
    const { getMemoryManager } = await import('./memory.js');
    const memoryManager = getMemoryManager(process.cwd());

    const separator = icons.separator.repeat(40);
    console.log('');
    console.log(colors.primaryBright(`${icons.folder} Initializing Project Context`));
    console.log(colors.border(separator));
    console.log('');

    try {
      await memoryManager.initializeProject(process.cwd());
      console.log(colors.success('Project initialized successfully!'));
      console.log(colors.textMuted('You can now run "xagent start" to begin'));
      console.log('');
    } catch (error: any) {
      const { message, suggestion } = formatError(error);
      console.log(colors.error(`Initialization failed: ${message}`));
      console.log(colors.textMuted(suggestion));
      console.log('');
      process.exit(1);
    }
  });

program
  .command('workflow')
  .description('Add, list, or remove workflows')
  .option('--add <workflow-id>', 'Add a workflow from the marketplace')
  .option('-l, --list', 'List all installed workflows')
  .option('-r, --remove <workflow-id>', 'Remove a workflow')
  .option('--scope <scope>', 'Scope (global or project)', 'project')
  .action(async (options) => {
    const { getWorkflowManager } = await import('./workflow.js');
    const workflowManager = getWorkflowManager(process.cwd());

    if (options.list) {
      const workflows = workflowManager.listWorkflows();

      if (workflows.length === 0) {
        console.log('');
        console.log(colors.warning('No workflows installed'));
        console.log(colors.textMuted('Use --add to install workflows from the marketplace'));
        console.log('');
      } else {
        const separator = icons.separator.repeat(40);
        console.log('');
        console.log(colors.primaryBright(`${icons.rocket} Installed Workflows`));
        console.log(colors.border(separator));
        console.log('');

        workflows.forEach((workflow, index) => {
          console.log(`  ${colors.primaryBright(`${index + 1}. ${workflow.name}`)}`);
          console.log(`    ${colors.textDim(`  ID: ${workflow.id}`)}`);
          console.log(`    ${colors.textDim(`  ${workflow.description}`)}`);
          console.log('');
        });
      }
    } else if (options.add) {
      try {
        await workflowManager.addWorkflow(options.add, options.scope);
        console.log('');
        console.log(colors.success(`Workflow ${options.add} added successfully!`));
        console.log('');
      } catch (error: any) {
        const { message, suggestion } = formatError(error);
        console.log('');
        console.log(colors.error(message));
        console.log(colors.textMuted(suggestion));
        console.log('');
        process.exit(1);
      }
    } else if (options.remove) {
      try {
        await workflowManager.removeWorkflow(options.remove, options.scope);
        console.log('');
        console.log(colors.success(`Workflow ${options.remove} removed successfully!`));
        console.log('');
      } catch (error: any) {
        const { message, suggestion } = formatError(error);
        console.log('');
        console.log(colors.error(message));
        console.log(colors.textMuted(suggestion));
        console.log('');
        process.exit(1);
      }
    } else {
      console.log('');
      console.log(colors.warning('Please specify an action: --list, --add, or --remove'));
      console.log('');
    }
  });

program
  .command('version')
  .description('Display version and check for updates')
  .action(async () => {
    const separator = icons.separator.repeat(40);

    console.log('');
    console.log(colors.gradient('╔════════════════════════════════════════════════════════════╗'));
    console.log(colors.gradient('║') + ' '.repeat(56) + colors.gradient('║'));
    console.log(' '.repeat(20) + colors.gradient('xAgent CLI') + ' '.repeat(29) + colors.gradient('║'));
    console.log(colors.gradient('║') + ' '.repeat(56) + colors.gradient('║'));
    console.log(colors.gradient('╚════════════════════════════════════════════════════════════╝'));
    console.log('');
    console.log(colors.border(separator));
    console.log('');
    console.log(`  ${icons.info}  ${colors.textMuted('Version:')} ${colors.primaryBright(packageJson.version)}`);
    console.log(`  ${icons.code} ${colors.textMuted('Node.js:')} ${colors.textMuted(process.version)}`);
    console.log(`  ${icons.bolt} ${colors.textMuted('Platform:')} ${colors.textMuted(process.platform + ' ' + process.arch)}`);
    console.log('');
    console.log(colors.border(separator));
    console.log('');
    console.log(`  ${colors.primaryBright('📚 Documentation:')} ${colors.primaryBright('https://platform.xagent.cn/cli/')}`);
    console.log(`  ${colors.primaryBright('💻 GitHub:')} ${colors.primaryBright('https://github.com/xagent-ai/xagent-cli')}`);
    console.log('');
  });

program
  .command('gui')
  .description('Start GUI subagent for computer automation')
  .option('--headless', 'Run in headless mode (no visible window)', false)
  .action(async (options) => {
    const separator = icons.separator.repeat(40);
    console.log('');
    console.log(colors.primaryBright(`${icons.robot} GUI Subagent - Computer Automation`));
    console.log(colors.border(separator));
    console.log('');

    try {
      const configManager = getConfigManager();
      const authConfig = configManager.getAuthConfig();

      // Get GUI-specific VLM configuration
      const baseUrl = configManager.get('guiSubagentBaseUrl') || configManager.get('baseUrl') || '';
      const apiKey = configManager.get('guiSubagentApiKey') || configManager.get('apiKey') || '';
      const modelName = configManager.get('guiSubagentModel') || configManager.get('modelName') || '';

      // Determine mode: local (openai_compatible) or remote
      const isLocalMode = authConfig.type === 'openai_compatible';

      if (isLocalMode) {
        // Local mode: require baseUrl configuration
        if (!baseUrl) {
          console.log(colors.error('No VLM API URL configured for GUI subagent.'));
          console.log(colors.textMuted('Please run "xagent auth" and configure guiSubagentBaseUrl.'));
          console.log('');
          return;
        }
        console.log(colors.info(`${icons.brain} Using local VLM configuration`));
        console.log(colors.textMuted(`  Model: ${modelName}`));
        console.log(colors.textMuted(`  Base URL: ${baseUrl}`));
        console.log('');
      } else {
        // Remote mode
        console.log(colors.info(`${icons.brain} Using remote VLM service`));
        console.log(colors.textMuted(`  Auth Type: ${authConfig.type}`));
        console.log('');
      }

      const { createGUISubAgent } = await import('./gui-subagent/index.js');

      // Create ref for tracking first VLM call across loop iterations
      const isFirstVlmCallRef = { current: true };

      // Create remoteVlmCaller for remote mode (uses full messages for consistent behavior)
      let remoteVlmCaller: ((messages: any[], systemPrompt: string, taskId: string, isFirstVlmCallRef: { current: boolean }) => Promise<string>) | undefined;

      if (!isLocalMode && authConfig.baseUrl) {
        const remoteBaseUrl = `${authConfig.baseUrl}/api/agent/vlm`;
        remoteVlmCaller = async (messages: any[], _systemPrompt: string, _taskId: string, isFirstVlmCallRef: { current: boolean }): Promise<string> => {
          const status = isFirstVlmCallRef.current ? 'begin' : 'continue';
          const response = await fetch(remoteBaseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authConfig.apiKey || ''}`,
            },
            body: JSON.stringify({
              messages,
              taskId: _taskId,
              status
            }),
          });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Remote VLM error: ${response.status} - ${errorText}`);
          }
          const result = await response.json() as { response?: string; content?: string; message?: string };
          // Update ref after call so subsequent calls use 'continue'
          isFirstVlmCallRef.current = false;
          return result.response || result.content || result.message || '';
        };
      }

      const guiAgent = await createGUISubAgent({
        headless: options.headless ?? false,
        model: isLocalMode ? modelName : undefined,
        modelBaseUrl: isLocalMode ? baseUrl : undefined,
        modelApiKey: isLocalMode ? apiKey : undefined,
        isFirstVlmCallRef,
        remoteVlmCaller,
        isLocalMode,
      });

      console.log(colors.success('✅ GUI Subagent initialized successfully!'));
      console.log('');
      console.log(colors.textMuted('Available actions:'));
      console.log(colors.textDim('  - click: Click on an element'));
      console.log(colors.textDim('  - double_click: Double click'));
      console.log(colors.textDim('  - right_click: Right click'));
      console.log(colors.textDim('  - drag: Drag from one position to another'));
      console.log(colors.textDim('  - type: Type text'));
      console.log(colors.textDim('  - hotkey: Press keyboard shortcuts'));
      console.log(colors.textDim('  - scroll: Scroll up/down/left/right'));
      console.log(colors.textDim('  - wait: Wait for specified time'));
      console.log(colors.textDim('  - finished: Complete the task'));
      console.log('');
      console.log(colors.primaryBright('Use the GUI tools in the interactive session to control the computer.'));
      console.log('');
    } catch (error: any) {
      const { message, suggestion } = formatError(error);
      console.log('');
      console.log(colors.error(`Failed to start GUI Subagent: ${message}`));
      console.log(colors.textMuted(suggestion));
      console.log('');
    }
  });

program
  .command('memory')
  .description('Manage memory files (list or clean)')
  .option('-l, --list', 'List all memory files')
  .option('--clean', 'Clean all project memories (keep global memory)')
  .option('--clean-project', 'Clean the current project\'s memory only')
  .option('--clean-all', 'Clean all memories (including global memory)')
  .action(async (options) => {
    const separator = icons.separator.repeat(40);
    console.log('');
    console.log(colors.primaryBright(`${icons.folder} Memory Management`));
    console.log(colors.border(separator));
    console.log('');

    const { getMemoryManager } = await import('./memory.js');
    const memoryManager = getMemoryManager(process.cwd());
    const memoriesDir = memoryManager.getMemoriesDir();

    // Helper to get memory info
    const getMemoryInfo = (fileName: string) => {
      if (fileName === 'global.md') {
        return { type: 'global', description: 'Global memory (shared across all projects)' };
      }
      const match = fileName.match(/^project_(.+)_\w{16}\.md$/);
      if (match) {
        return { type: 'project', description: `Project: ${match[1]}` };
      }
      return { type: 'unknown', description: fileName };
    };

    if (options.list) {
      // List all memory files
      console.log(colors.textMuted(`Memory directory: ${memoriesDir}`));
      console.log('');

      try {
        const files = await fs.readdir(memoriesDir).catch(() => []);
        if (files.length === 0) {
          console.log(colors.textMuted('No memory files found.'));
          console.log('');
          return;
        }

        const globalFile = files.find(f => f === 'global.md');
        const projectFiles = files.filter(f => f.startsWith('project_'));

        if (globalFile) {
          const info = getMemoryInfo(globalFile);
          console.log(`  ${colors.success(icons.success)} ${colors.primaryBright('global.md')}`);
          console.log(`    ${colors.textDim(`  ${info.description}`)}`);
          console.log('');
        }

        if (projectFiles.length > 0) {
          console.log(colors.primaryBright(`  Project Memories (${projectFiles.length})`));
          console.log('');

          for (const file of projectFiles) {
            const info = getMemoryInfo(file);
            const filePath = join(memoriesDir, file);
            try {
              const stat = await fs.stat(filePath);
              const size = stat.size;
              const sizeStr = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
              console.log(`  ${colors.success(icons.success)} ${colors.primaryBright(file)}`);
              console.log(`    ${colors.textDim(`  ${info.description} | Size: ${sizeStr}`)}`);
            } catch {
              console.log(`  ${colors.success(icons.success)} ${colors.primaryBright(file)}`);
              console.log(`    ${colors.textDim(`  ${info.description}`)}`);
            }
            console.log('');
          }
        }

        console.log(colors.textMuted(`Total: ${files.length} memory file(s)`));
        console.log('');
      } catch (error) {
        console.log(colors.textMuted('No memory files found.'));
        console.log('');
      }
    } else if (options.clean) {
      // Clean all project memories (keep global.md)
      console.log(colors.textMuted('Cleaning all project memories...'));
      console.log(colors.textMuted(`Keeping: ${colors.primaryBright('global.md')}`));
      console.log('');

      try {
        const files = await fs.readdir(memoriesDir).catch(() => []);
        const projectFiles = files.filter(f => f.startsWith('project_'));

        if (projectFiles.length === 0) {
          console.log(colors.textMuted('No project memories to clean.'));
          console.log('');
          return;
        }

        let cleaned = 0;
        for (const file of projectFiles) {
          await fs.unlink(join(memoriesDir, file));
          cleaned++;
        }

        console.log(colors.success(`✅ Cleaned ${cleaned} project memory file(s)`));
        // TODO: 如果需要自动重建 project memory，取消下面注释
        // await memoryManager.saveMemory('# Project Context\n\nProject-specific context will be added here.', 'project');
        // console.log(colors.textMuted('  Recreated current project memory'));
        console.log(colors.textMuted('  Use /init to initialize if needed'));
        console.log('');
      } catch (error: any) {
        const { message, suggestion } = formatError(error);
        console.log(colors.error(`Failed to clean project memories: ${message}`));
        console.log(colors.textMuted(suggestion));
        console.log('');
      }
    } else if (options.cleanProject) {
      // Clean only the current project's memory
      console.log(colors.textMuted(`Cleaning current project memory...`));
      console.log(colors.textMuted(`Project: ${colors.primaryBright(process.cwd())}`));
      console.log('');

      try {
        // Find and delete the current project's memory file
        const memoryFiles = memoryManager.getMemoryFiles();
        const currentProjectMemory = memoryFiles.find(m => m.level === 'project');

        if (currentProjectMemory) {
          await fs.unlink(currentProjectMemory.path);
          console.log(colors.success(`✅ Cleaned current project memory`));
          console.log(colors.textMuted(`  File: ${path.basename(currentProjectMemory.path)}`));
        } else {
          console.log(colors.textMuted('No memory found for the current project.'));
        }
        // TODO: 如果需要自动重建 project memory，取消下面注释
        // await memoryManager.saveMemory('# Project Context\n\nProject-specific context will be added here.', 'project');
        // console.log(colors.textMuted('  Recreated current project memory'));
        console.log(colors.textMuted('  Use /init to initialize if needed'));
        console.log('');
      } catch (error: any) {
        const { message, suggestion } = formatError(error);
        console.log(colors.error(`Failed to clean project memory: ${message}`));
        console.log(colors.textMuted(suggestion));
        console.log('');
      }
    } else if (options.cleanAll) {
      // Clean all memories including global
      console.log(colors.warning(`${icons.warning} This will delete ALL memory files including global memory.`));
      console.log('');
      console.log(colors.textMuted('Files to be deleted:'));
      console.log(colors.textMuted(`  - global.md (global memory)`));
      console.log(colors.textMuted(`  - all project memories`));
      console.log('');

      try {
        const files = await fs.readdir(memoriesDir).catch(() => []);
        if (files.length === 0) {
          console.log(colors.textMuted('No memory files to clean.'));
          console.log('');
          return;
        }

        let cleaned = 0;
        for (const file of files) {
          await fs.unlink(join(memoriesDir, file));
          cleaned++;
        }

        // Recreate global memory (always keep global memory available)
        await memoryManager.saveMemory('# Global Context\n\nGlobal preferences and settings will be added here.', 'global');
        // TODO: 如果需要同时重建 project memory，取消下面注释
        // await memoryManager.saveMemory('# Project Context\n\nProject-specific context will be added here.', 'project');

        console.log(colors.success(`✅ Cleaned ${cleaned} memory file(s)`));
        console.log(colors.textMuted('  Recreated global memory'));
        console.log(colors.textMuted('  Use /init to initialize project memory if needed'));
        console.log('');
      } catch (error: any) {
        const { message, suggestion } = formatError(error);
        console.log(colors.error(`Failed to clean memories: ${message}`));
        console.log(colors.textMuted(suggestion));
        console.log('');
      }
    } else {
      // No option specified, show help
      console.log(colors.textMuted('Usage:'));
      console.log(`  ${colors.primaryBright('xagent memory -l')}               ${colors.textDim('| List all memory files')}`);
      console.log(`  ${colors.primaryBright('xagent memory --clean')}          ${colors.textDim('| Clean all project memories (keep global)')}`);
      console.log(`  ${colors.primaryBright('xagent memory --clean-project')}  ${colors.textDim('| Clean current project memory only')}`);
      console.log(`  ${colors.primaryBright('xagent memory --clean-all')}      ${colors.textDim('| Clean ALL memories (including global)')}`);
      console.log('');
    }
  });

program
  .command('update')
  .description('Check for updates and update xAgent CLI')
  .action(async () => {
    const separator = icons.separator.repeat(40);
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
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

// ============================================================
// Global error handling - prevent crashes from uncaught errors
// ============================================================

// Handle uncaught promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('\n❌ An unexpected error occurred');
  if (reason instanceof Error) {
    console.error(`   ${reason.message}`);
  } else if (reason) {
    console.error(`   ${String(reason)}`);
  }
  console.error('\n   If this problem persists, please report this issue.');
  console.error('');
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('\n❌ Critical error - application will exit');
  console.error(`   ${error.message}`);
  console.error('');
  process.exit(1);
});
