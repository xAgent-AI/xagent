#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { startInteractiveSession } from './session.js';
import { getConfigManager } from './config.js';
import { AuthService, selectAuthType } from './auth.js';
import { getAgentManager } from './agents.js';
import { getMCPManager } from './mcp.js';
import { getLogger } from './logger.js';

const logger = getLogger();

const program = new Command();

program
  .name('xagent')
  .description('AI-powered command-line assistant')
  .version('1.0.0')
  .option('-h, --help', 'Show help');

program
  .command('start')
  .description('Start the xAgent CLI interactive session')
  .action(async () => {
    await startInteractiveSession();
  });

program
  .command('auth')
  .description('Configure authentication for xAgent CLI')
  .action(async () => {
    logger.section('Authentication Management');

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
      logger.success('Authentication configured successfully!', 'You can now run "xagent start" to begin');
    } else {
      logger.error('Authentication failed. Please try again.', 'Run "xagent auth" to retry');
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
        logger.warn('No agents configured', 'Use /agents install in interactive mode to add agents');
      } else {
        logger.section('Available Agents');
        agents.forEach(agent => {
          logger.info(`  ${agent.agentType}`);
          logger.info(`    ${agent.whenToUse}`);
        });
      }
    } else if (options.add) {
      logger.warn('Agent creation wizard not implemented yet', 'Use /agents install in interactive mode');
    } else if (options.remove) {
      try {
        await agentManager.removeAgent(options.remove, options.scope);
        logger.success(`Agent ${options.remove} removed successfully`);
      } catch (error: any) {
        logger.error(`Failed to remove agent: ${error.message}`, 'Check if the agent exists and try again');
      }
    } else {
      logger.warn('Please specify an action: --list, --add, or --remove');
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
        logger.warn('No MCP servers configured', 'Use /mcp add in interactive mode to add servers');
      } else {
        logger.section('MCP Servers');
        servers.forEach(server => {
          const connected = server.isServerConnected() ? '✓' : '✗';
          const status = server.isServerConnected() ? chalk.green(connected) : chalk.red(connected);
          logger.info(`  ${status} ${server.getToolNames().join(', ')}`);
        });
      }
    } else if (options.add) {
      logger.warn('MCP server addition not implemented yet', 'Use /mcp add in interactive mode');
    } else if (options.remove) {
      try {
        mcpManager.disconnectServer(options.remove);
        const mcpServers = configManager.getMcpServers();
        delete mcpServers[options.remove];
        await configManager.save(options.scope);
        logger.success(`MCP server ${options.remove} removed successfully`);
      } catch (error: any) {
        logger.error(`Failed to remove MCP server: ${error.message}`, 'Check if the server exists and try again');
      }
    } else {
      logger.warn('Please specify an action: --list, --add, or --remove');
    }
  });

program
  .command('init')
  .description('Initialize XAGENT.md for the current project')
  .action(async () => {
    const { getMemoryManager } = await import('./memory.js');
    const memoryManager = getMemoryManager(process.cwd());

    logger.section('Initializing Project Context');

    try {
      await memoryManager.initializeProject(process.cwd());
      logger.success('Project initialized successfully!', 'You can now run "xagent start" to begin');
    } catch (error: any) {
      logger.error(`Initialization failed: ${error.message}`, 'Check if you have write permissions for this directory');
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
        logger.warn('No workflows installed', 'Use --add to install workflows from the marketplace');
      } else {
        logger.section('Installed Workflows');
        workflows.forEach(workflow => {
          logger.info(`  ${workflow.name} (${workflow.id})`);
          logger.info(`    ${workflow.description}`);
        });
      }
    } else if (options.add) {
      try {
        await workflowManager.addWorkflow(options.add, options.scope);
        logger.success(`Workflow ${options.add} added successfully!`);
      } catch (error: any) {
        logger.error(error.message, 'Check the workflow ID and try again');
        process.exit(1);
      }
    } else if (options.remove) {
      try {
        await workflowManager.removeWorkflow(options.remove, options.scope);
        logger.success(`Workflow ${options.remove} removed successfully!`);
      } catch (error: any) {
        logger.error(error.message, 'Check if the workflow exists and try again');
        process.exit(1);
      }
    } else {
      logger.warn('Please specify an action: --list, --add, or --remove');
    }
  });

program
  .command('version')
  .description('Display version and check for updates')
  .action(async () => {
    console.log(chalk.cyan('\nℹ️  xAgent CLI\n'));
    console.log(chalk.gray('Version: 1.0.0'));
    console.log(chalk.gray('Node.js: ' + process.version));
    console.log(chalk.gray('Platform: ' + process.platform + ' ' + process.arch));
    console.log(chalk.gray('\nDocumentation: https://platform.xagent.cn/cli/'));
    console.log(chalk.gray('GitHub: https://github.com/xagent-ai/xagent-cli\n'));
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
