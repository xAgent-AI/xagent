#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { startInteractiveSession } from './session.js';
import { getConfigManager } from './config.js';
import { AuthService, selectAuthType } from './auth.js';
import { getAgentManager } from './agents.js';
import { getMCPManager } from './mcp.js';

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
    console.log(chalk.cyan('\n🔐 Authentication Management\n'));

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
      console.log(chalk.green('\n✅ Authentication configured successfully!'));
      console.log(chalk.gray('You can now run "xagent start" to begin.\n'));
    } else {
      console.log(chalk.red('\n❌ Authentication failed. Please try again.\n'));
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
        console.log(chalk.yellow('No agents configured'));
      } else {
        console.log(chalk.cyan('\n🤖 Available Agents:\n'));
        agents.forEach(agent => {
          console.log(`  ${chalk.green(agent.agentType)}`);
          console.log(`    ${chalk.gray(agent.whenToUse)}\n`);
        });
      }
    } else if (options.add) {
      console.log(chalk.yellow('Agent creation wizard not implemented yet'));
      console.log(chalk.gray('Use /agents install in interactive mode\n'));
    } else if (options.remove) {
      try {
        await agentManager.removeAgent(options.remove, options.scope);
        console.log(chalk.green(`✅ Agent ${options.remove} removed successfully\n`));
      } catch (error: any) {
        console.log(chalk.red(`❌ Failed to remove agent: ${error.message}\n`));
      }
    } else {
      console.log(chalk.yellow('Please specify an action: --list, --add, or --remove'));
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
        console.log(chalk.yellow('No MCP servers configured'));
      } else {
        console.log(chalk.cyan('\n🔌 MCP Servers:\n'));
        servers.forEach(server => {
          const connected = server.isServerConnected() ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${connected} ${chalk.white(server.getToolNames().join(', '))}\n`);
        });
      }
    } else if (options.add) {
      console.log(chalk.yellow('MCP server addition not implemented yet'));
      console.log(chalk.gray('Use /mcp add in interactive mode\n'));
    } else if (options.remove) {
      try {
        mcpManager.disconnectServer(options.remove);
        const mcpServers = configManager.getMcpServers();
        delete mcpServers[options.remove];
        await configManager.save(options.scope);
        console.log(chalk.green(`✅ MCP server ${options.remove} removed successfully\n`));
      } catch (error: any) {
        console.log(chalk.red(`❌ Failed to remove MCP server: ${error.message}\n`));
      }
    } else {
      console.log(chalk.yellow('Please specify an action: --list, --add, or --remove'));
    }
  });

program
  .command('init')
  .description('Initialize IFLOW.md for the current project')
  .action(async () => {
    const { getMemoryManager } = await import('./memory.js');
    const memoryManager = getMemoryManager(process.cwd());

    console.log(chalk.cyan('\n📝 Initializing Project Context\n'));

    try {
      await memoryManager.initializeProject(process.cwd());
      console.log(chalk.green('\n✅ Project initialized successfully!'));
      console.log(chalk.gray('You can now run "iflow start" to begin.\n'));
    } catch (error: any) {
      console.log(chalk.red(`\n❌ Initialization failed: ${error.message}\n`));
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
        console.log(chalk.yellow('No workflows installed'));
      } else {
        console.log(chalk.cyan('\n📦 Installed Workflows:\n'));
        workflows.forEach(workflow => {
          console.log(`  ${chalk.green(workflow.name)} (${workflow.id})`);
          console.log(`    ${chalk.gray(workflow.description)}\n`);
        });
      }
    } else if (options.add) {
      try {
        await workflowManager.addWorkflow(options.add, options.scope);
      } catch (error: any) {
        console.log(chalk.red(`\n❌ ${error.message}\n`));
        process.exit(1);
      }
    } else if (options.remove) {
      try {
        await workflowManager.removeWorkflow(options.remove, options.scope);
      } catch (error: any) {
        console.log(chalk.red(`\n❌ ${error.message}\n`));
        process.exit(1);
      }
    } else {
      console.log(chalk.yellow('Please specify an action: --list, --add, or --remove'));
    }
  });

program
  .command('version')
  .description('Display version and check for updates')
  .action(async () => {
    console.log(chalk.cyan('\nℹ️  iFlow CLI\n'));
    console.log(chalk.gray('Version: 1.0.0'));
    console.log(chalk.gray('Node.js: ' + process.version));
    console.log(chalk.gray('Platform: ' + process.platform + ' ' + process.arch));
    console.log(chalk.gray('\nDocumentation: https://platform.iflow.cn/cli/'));
    console.log(chalk.gray('GitHub: https://github.com/iflow-ai/iflow-cli\n'));
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
