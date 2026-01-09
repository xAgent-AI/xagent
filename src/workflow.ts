import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { AgentConfig, MCPServerConfig } from './types.js';
import { SkillLoader, getSkillLoader } from './skill-loader.js';

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  agents: AgentConfig[];
  commands: Record<string, string>;
  mcpServers: Record<string, MCPServerConfig>;
  xagentMd: string;
  files: Record<string, string>;
}

export class WorkflowManager {
  private globalWorkflowsPath: string;
  private projectWorkflowsPath: string;
  private installedWorkflows: Map<string, WorkflowConfig> = new Map();

  constructor(projectRoot?: string) {
    this.globalWorkflowsPath = path.join(os.homedir(), '.xagent', 'workflows');
    this.projectWorkflowsPath = projectRoot 
      ? path.join(projectRoot, '.xagent', 'workflows')
      : '';
  }

  async loadWorkflows(): Promise<void> {
    await this.loadWorkflowsFromDirectory(this.globalWorkflowsPath, 'global');
    
    if (this.projectWorkflowsPath) {
      await this.loadWorkflowsFromDirectory(this.projectWorkflowsPath, 'project');
    }

    // Load skills from the skills folder
    await this.loadSkills();
  }

  private async findSkillsPath(): Promise<string | null> {
    const possiblePaths = [
      // Skills submodule: skills/skills/ (anthropics/skills repo structure)
      path.join(process.cwd(), 'skills', 'skills'),
      // Alternative: skills/ directly (if repo structure changes)
      path.join(process.cwd(), 'skills'),
      // Parent xagent path
      path.join(process.cwd(), '..', 'xagent', 'skills', 'skills'),
      // External skills folder (backward compatibility)
      path.join(process.cwd(), '..', 'skills', 'skills')
    ];

    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        return p;
      } catch {
        continue;
      }
    }
    return null;
  }

  async loadSkills(): Promise<void> {
    try {
      const skillsPath = await this.findSkillsPath();
      if (!skillsPath) return;

      const skillLoader = getSkillLoader({ skillsRootPath: skillsPath });
      await skillLoader.loadAllSkills();

      const workflows = await skillLoader.convertAllToWorkflows();
      for (const workflow of workflows) {
        this.installedWorkflows.set(workflow.id, workflow);
      }

      if (workflows.length > 0) {
        console.log(`✅ Loaded ${workflows.length} skills from skills folder`);
      }
    } catch (error) {
      // Skills folder is optional, so we silently ignore errors
    }
  }

  private async loadWorkflowsFromDirectory(dirPath: string, scope: 'global' | 'project'): Promise<void> {
    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(dirPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const workflow: WorkflowConfig = JSON.parse(content);
          workflow.id = file.replace('.json', '');
          this.installedWorkflows.set(workflow.id, workflow);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to load workflows from ${dirPath}:`, error);
      }
    }
  }

  async addWorkflow(workflowId: string, scope: 'global' | 'project' = 'project'): Promise<void> {
    const workflowsPath = scope === 'global' ? this.globalWorkflowsPath : this.projectWorkflowsPath;
    
    if (!workflowsPath) {
      throw new Error('Project workflows path not set');
    }

    console.log(`Downloading workflow: ${workflowId}`);

    try {
      const workflowData = await this.downloadWorkflow(workflowId);
      
      await fs.mkdir(workflowsPath, { recursive: true });
      
      const workflowPath = path.join(workflowsPath, `${workflowId}.json`);
      await fs.writeFile(workflowPath, JSON.stringify(workflowData, null, 2), 'utf-8');
      
      await this.installWorkflowFiles(workflowData, scope);
      await this.installWorkflowAgents(workflowData, scope);
      await this.installWorkflowMcpServers(workflowData, scope);
      
      this.installedWorkflows.set(workflowId, workflowData);
      
      console.log(`✅ Workflow ${workflowData.name} installed successfully!`);
    } catch (error: any) {
      console.error(`❌ Failed to install workflow: ${error.message}`);
      throw error;
    }
  }

  private async downloadWorkflow(workflowId: string): Promise<WorkflowConfig> {
    const marketplaceUrl = `https://platform.xagent.cn/api/workflows/${workflowId}`;
    
    try {
      const response = await axios.get(marketplaceUrl, {
        timeout: 30000
      });
      
      return response.data;
    } catch (error) {
      console.error('Failed to download workflow from marketplace');
      throw new Error('Workflow download failed. Please check your network connection.');
    }
  }

  private async installWorkflowFiles(workflow: WorkflowConfig, scope: 'global' | 'project'): Promise<void> {
    if (!workflow.files || Object.keys(workflow.files).length === 0) {
      return;
    }

    const baseDir = scope === 'global' 
      ? this.globalWorkflowsPath 
      : path.dirname(this.projectWorkflowsPath);

    for (const [filePath, content] of Object.entries(workflow.files)) {
      const fullPath = path.join(baseDir, filePath);
      const dir = path.dirname(fullPath);
      
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
    }

    console.log(`✅ Installed ${Object.keys(workflow.files).length} workflow files`);
  }

  private async installWorkflowAgents(workflow: WorkflowConfig, scope: 'global' | 'project'): Promise<void> {
    if (!workflow.agents || workflow.agents.length === 0) {
      return;
    }

    const { getAgentManager } = await import('./agents.js');
    const agentManager = getAgentManager(
      scope === 'project' ? path.dirname(this.projectWorkflowsPath) : undefined
    );

    for (const agent of workflow.agents) {
      try {
        await agentManager.addAgent(agent, scope);
      } catch (error: any) {
        console.warn(`Failed to install agent ${agent.agentType}: ${error.message}`);
      }
    }

    console.log(`✅ Installed ${workflow.agents.length} agents`);
  }

  private async installWorkflowMcpServers(workflow: WorkflowConfig, scope: 'global' | 'project'): Promise<void> {
    if (!workflow.mcpServers || Object.keys(workflow.mcpServers).length === 0) {
      return;
    }

    const { getConfigManager } = await import('./config.js');
    const configManager = getConfigManager(
      scope === 'project' ? path.dirname(this.projectWorkflowsPath) : undefined
    );

    for (const [name, config] of Object.entries(workflow.mcpServers)) {
      try {
        configManager.addMcpServer(name, config);
      } catch (error: any) {
        console.warn(`Failed to install MCP server ${name}: ${error.message}`);
      }
    }

    await configManager.save(scope);
    console.log(`✅ Installed ${Object.keys(workflow.mcpServers).length} MCP servers`);
  }

  async removeWorkflow(workflowId: string, scope: 'global' | 'project' = 'project'): Promise<void> {
    const workflowsPath = scope === 'global' ? this.globalWorkflowsPath : this.projectWorkflowsPath;
    
    if (!workflowsPath) {
      throw new Error('Project workflows path not set');
    }

    const workflow = this.installedWorkflows.get(workflowId);
    
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    try {
      const workflowPath = path.join(workflowsPath, `${workflowId}.json`);
      await fs.unlink(workflowPath);

      await this.removeWorkflowFiles(workflow, scope);
      await this.removeWorkflowAgents(workflow, scope);
      await this.removeWorkflowMcpServers(workflow, scope);

      this.installedWorkflows.delete(workflowId);
      
      console.log(`✅ Workflow ${workflow.name} removed successfully!`);
    } catch (error: any) {
      console.error(`❌ Failed to remove workflow: ${error.message}`);
      throw error;
    }
  }

  private async removeWorkflowFiles(workflow: WorkflowConfig, scope: 'global' | 'project'): Promise<void> {
    if (!workflow.files || Object.keys(workflow.files).length === 0) {
      return;
    }

    const baseDir = scope === 'global' 
      ? this.globalWorkflowsPath 
      : path.dirname(this.projectWorkflowsPath);

    for (const filePath of Object.keys(workflow.files)) {
      const fullPath = path.join(baseDir, filePath);
      
      try {
        await fs.unlink(fullPath);
      } catch (error) {
        console.warn(`Failed to remove file ${filePath}: ${error}`);
      }
    }
  }

  private async removeWorkflowAgents(workflow: WorkflowConfig, scope: 'global' | 'project'): Promise<void> {
    if (!workflow.agents || workflow.agents.length === 0) {
      return;
    }

    const { getAgentManager } = await import('./agents.js');
    const agentManager = getAgentManager(
      scope === 'project' ? path.dirname(this.projectWorkflowsPath) : undefined
    );

    for (const agent of workflow.agents) {
      try {
        await agentManager.removeAgent(agent.agentType, scope);
      } catch (error: any) {
        console.warn(`Failed to remove agent ${agent.agentType}: ${error.message}`);
      }
    }
  }

  private async removeWorkflowMcpServers(workflow: WorkflowConfig, scope: 'global' | 'project'): Promise<void> {
    if (!workflow.mcpServers || Object.keys(workflow.mcpServers).length === 0) {
      return;
    }

    const { getConfigManager } = await import('./config.js');
    const configManager = getConfigManager(
      scope === 'project' ? path.dirname(this.projectWorkflowsPath) : undefined
    );

    for (const name of Object.keys(workflow.mcpServers)) {
      try {
        configManager.removeMcpServer(name);
      } catch (error: any) {
        console.warn(`Failed to remove MCP server ${name}: ${error.message}`);
      }
    }

    await configManager.save(scope);
  }

  listWorkflows(): WorkflowConfig[] {
    return Array.from(this.installedWorkflows.values());
  }

  async listSkills(): Promise<{ id: string; name: string; description: string; category: string }[]> {
    try {
      const skillsPath = await this.findSkillsPath();
      if (!skillsPath) return [];

      const skillLoader = getSkillLoader({ skillsRootPath: skillsPath });
      const skills = await skillLoader.loadAllSkills();
      
      return skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category
      }));
    } catch (error) {
      console.error('Failed to list skills:', error);
      return [];
    }
  }

  getWorkflow(workflowId: string): WorkflowConfig | undefined {
    return this.installedWorkflows.get(workflowId);
  }

  async getSkillDetails(skillId: string): Promise<{ id: string; name: string; description: string; content: string; category: string } | null> {
    try {
      const skillsPath = await this.findSkillsPath();
      if (!skillsPath) return null;

      const skillLoader = getSkillLoader({ skillsRootPath: skillsPath });
      
      // Reload skills to ensure we have the latest
      await skillLoader.loadAllSkills();
      
      const skill = skillLoader.getSkill(skillId);
      if (!skill) return null;

      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: skill.markdown,
        category: skill.category
      };
    } catch (error) {
      console.error(`Failed to get skill details for ${skillId}:`, error);
      return null;
    }
  }

  async listOnlineWorkflows(): Promise<WorkflowConfig[]> {
    try {
      const marketplaceUrl = 'https://platform.xagent.cn/api/workflows';
      const response = await axios.get(marketplaceUrl, {
        timeout: 30000
      });
      
      return response.data.workflows || [];
    } catch (error) {
      console.error('Failed to fetch online workflows');
      return [];
    }
  }

  async searchWorkflows(query: string): Promise<WorkflowConfig[]> {
    const onlineWorkflows = await this.listOnlineWorkflows();
    
    const lowerQuery = query.toLowerCase();
    
    return onlineWorkflows.filter(workflow => 
      workflow.name.toLowerCase().includes(lowerQuery) ||
      workflow.description.toLowerCase().includes(lowerQuery) ||
      workflow.id.toLowerCase().includes(lowerQuery)
    );
  }

  async executeWorkflow(workflowId: string, input: string): Promise<void> {
    const workflow = this.getWorkflow(workflowId);
    
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    console.log(`Executing workflow: ${workflow.name}`);
    console.log(`Description: ${workflow.description}\n`);

    if (workflow.commands && Object.keys(workflow.commands).length > 0) {
      console.log('Available commands:');
      Object.entries(workflow.commands).forEach(([name, description]) => {
        console.log(`  /${name} - ${description}`);
      });
      console.log();
    }

    const { SlashCommandHandler } = await import('./slash-commands.js');
    const slashHandler = new SlashCommandHandler();

    const commandMatch = input.match(/^\/(\w+)(?:\s+(.*))?$/);
    
    if (commandMatch) {
      const [, command, args] = commandMatch;
      
      if (workflow.commands[command]) {
        await slashHandler.handleCommand(`/${command} ${args || ''}`);
      } else {
        console.log(`Unknown workflow command: /${command}`);
      }
    } else {
      const { InteractiveSession } = await import('./session.js');
      const session = new InteractiveSession();
      await session.processUserMessage(input);
    }
  }

  async createWorkflowPackage(projectRoot: string): Promise<Buffer> {
    const workflowId = path.basename(projectRoot);
    const workflowConfigPath = path.join(projectRoot, '.xagent', 'workflow.json');
    
    let workflowConfig: WorkflowConfig;
    
    try {
      const content = await fs.readFile(workflowConfigPath, 'utf-8');
      workflowConfig = JSON.parse(content);
    } catch (error) {
      throw new Error('workflow.json not found. Please create it first.');
    }

    const { getAgentManager } = await import('./agents.js');
    const agentManager = getAgentManager(projectRoot);
    await agentManager.loadAgents();
    
    const agents = agentManager.getAllAgents();
    workflowConfig.agents = agents;

    const { getConfigManager } = await import('./config.js');
    const configManager = getConfigManager(projectRoot);
    workflowConfig.mcpServers = configManager.getMcpServers();

    const { getMemoryManager } = await import('./memory.js');
    const memoryManager = getMemoryManager(projectRoot);
    const xagentMd = await memoryManager.loadMemory();
    workflowConfig.xagentMd = xagentMd;

    const archiverModule = await import('archiver');
    const archiver = archiverModule.default;
    const streamModule = await import('stream');
    const globModule = await import('glob');
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    const glob = globModule.glob;
    const files = await glob('**/*', {
      cwd: projectRoot,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.xagent/**']
    });

    return new Promise((resolve, reject) => {
      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      const readable = streamModule.Readable.from([]);
      archive.pipe(readable as any);
      
      archive.append(JSON.stringify(workflowConfig, null, 2), { name: 'workflow.json' });
      
      for (const file of files) {
        const filePath = path.join(projectRoot, file);
        archive.file(filePath, { name: file });
      }

      archive.finalize();
    });
  }
}

let workflowManagerInstance: WorkflowManager | null = null;

export function getWorkflowManager(projectRoot?: string): WorkflowManager {
  if (!workflowManagerInstance || projectRoot) {
    workflowManagerInstance = new WorkflowManager(projectRoot);
    workflowManagerInstance.loadWorkflows();
  }
  return workflowManagerInstance;
}
