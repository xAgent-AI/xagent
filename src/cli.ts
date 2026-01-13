#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { startInteractiveSession } from './session.js';
import { getConfigManager } from './config.js';
import { AuthService, selectAuthType } from './auth.js';
import { getAgentManager } from './agents.js';
import { getMCPManager } from './mcp.js';
import { getLogger } from './logger.js';
import { theme, icons, colors } from './theme.js';
import { getCancellationManager } from './cancellation.js';

const logger = getLogger();

// Initialize CancellationManager early to set up ESC handler
getCancellationManager();

const program = new Command();

program
  .name('xagent')
  .description('AI-powered command-line assistant')
  .version('1.0.0')
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
      await configManager.save('global');
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

    const authService = new AuthService({
      type: authType,
      apiKey: '',
      baseUrl: '',
      modelName: ''
    });

    const success = await authService.authenticate();

    if (success) {
      const authConfig = authService.getAuthConfig();
      await configManager.setAuthConfig(authConfig);

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
        console.log('');
        console.log(colors.error(`Failed to remove agent: ${error.message}`));
        console.log(colors.textMuted('Check if the agent exists and try again'));
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
        await configManager.save(options.scope);
        console.log('');
        console.log(colors.success(`MCP server ${options.remove} removed successfully`));
        console.log('');
      } catch (error: any) {
        console.log('');
        console.log(colors.error(`Failed to remove MCP server: ${error.message}`));
        console.log(colors.textMuted('Check if the server exists and try again'));
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
      console.log(colors.error(`Initialization failed: ${error.message}`));
      console.log(colors.textMuted('Check if you have write permissions for this directory'));
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
        console.log('');
        console.log(colors.error(error.message));
        console.log(colors.textMuted('Check the workflow ID and try again'));
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
        console.log('');
        console.log(colors.error(error.message));
        console.log(colors.textMuted('Check if the workflow exists and try again'));
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
    console.log(`  ${icons.info}  ${colors.textMuted('Version:')} ${colors.primaryBright('1.0.0')}`);
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
      const { createGUISubAgent } = await import('./gui-subagent/index.js');

      const guiAgent = await createGUISubAgent({
        headless: options.headless ?? false,
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
      console.log('');
      console.log(colors.error(`Failed to start GUI Subagent: ${error.message}`));
      console.log('');
    }
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
