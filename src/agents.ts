import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AgentConfig, ExecutionMode } from './types.js';
import { getToolRegistry } from './tools.js';

export class AgentManager {
  private agents: Map<string, AgentConfig> = new Map();
  private globalAgentsPath: string;
  private projectAgentsPath: string;

  constructor(projectRoot?: string) {
    this.globalAgentsPath = path.join(os.homedir(), '.xagent', 'agents');
    this.projectAgentsPath = projectRoot 
      ? path.join(projectRoot, '.xagent', 'agents')
      : '';
  }

  async loadAgents(): Promise<void> {
    await this.loadAgentsFromDirectory(this.globalAgentsPath);
    if (this.projectAgentsPath) {
      await this.loadAgentsFromDirectory(this.projectAgentsPath);
    }
  }

  private async loadAgentsFromDirectory(dirPath: string): Promise<void> {
    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        if (file.endsWith('.md')) {
          const filePath = path.join(dirPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const agent = this.parseAgentConfig(content);
          
          if (agent) {
            this.agents.set(agent.agentType, agent);
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to load agents from ${dirPath}:`, error);
      }
    }
  }

  private parseAgentConfig(content: string): AgentConfig | null {
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    
    if (!frontMatterMatch) {
      return null;
    }

    try {
      const frontMatter = frontMatterMatch[1];
      const config: any = {};
      
      frontMatter.split('\n').forEach(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          
          if (key === 'allowedTools' || key === 'allowedMcps') {
            config[key] = value ? value.split(',').map(s => s.trim()) : [];
          } else if (key === 'isInheritTools' || key === 'isInheritMcps' || key === 'proactive') {
            config[key] = value === 'true';
          } else {
            config[key] = value;
          }
        }
      });

      return {
        agentType: config.agentType,
        systemPrompt: config.systemPrompt,
        whenToUse: config.whenToUse,
        model: config.model,
        allowedTools: config.allowedTools,
        allowedMcps: config.allowedMcps,
        isInheritTools: config.isInheritTools ?? true,
        isInheritMcps: config.isInheritMcps ?? true,
        proactive: config.proactive ?? false,
        color: config.color,
        name: config.name,
        description: config.description
      };
    } catch (error) {
      console.error('Failed to parse agent config:', error);
      return null;
    }
  }

  getAgent(agentType: string): AgentConfig | undefined {
    return this.agents.get(agentType);
  }

  getAllAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  async addAgent(agent: AgentConfig, scope: 'global' | 'project' = 'global'): Promise<void> {
    const agentsPath = scope === 'global' ? this.globalAgentsPath : this.projectAgentsPath;
    
    if (!agentsPath) {
      throw new Error('Project agents path not set');
    }

    await fs.mkdir(agentsPath, { recursive: true });
    
    const filePath = path.join(agentsPath, `${agent.agentType}.md`);
    const content = this.formatAgentConfig(agent);
    
    await fs.writeFile(filePath, content, 'utf-8');
    this.agents.set(agent.agentType, agent);
  }

  private formatAgentConfig(agent: AgentConfig): string {
    let content = '---\n';
    
    content += `agentType: "${agent.agentType}"\n`;
    content += `systemPrompt: "${agent.systemPrompt}"\n`;
    content += `whenToUse: "${agent.whenToUse}"\n`;
    
    if (agent.model) {
      content += `model: "${agent.model}"\n`;
    }
    
    if (agent.allowedTools && agent.allowedTools.length > 0) {
      content += `allowedTools: [${agent.allowedTools.map(t => `"${t}"`).join(', ')}]\n`;
    }
    
    if (agent.allowedMcps && agent.allowedMcps.length > 0) {
      content += `allowedMcps: [${agent.allowedMcps.map(m => `"${m}"`).join(', ')}]\n`;
    }
    
    if (agent.isInheritTools !== undefined) {
      content += `isInheritTools: ${agent.isInheritTools}\n`;
    }
    
    if (agent.isInheritMcps !== undefined) {
      content += `isInheritMcps: ${agent.isInheritMcps}\n`;
    }
    
    if (agent.proactive !== undefined) {
      content += `proactive: ${agent.proactive}\n`;
    }
    
    if (agent.color) {
      content += `color: "${agent.color}"\n`;
    }
    
    if (agent.name) {
      content += `name: "${agent.name}"\n`;
    }
    
    if (agent.description) {
      content += `description: "${agent.description}"\n`;
    }
    
    content += '---\n\n';
    content += `# ${agent.name || agent.agentType}\n\n`;
    content += agent.description || `Agent for ${agent.whenToUse}`;
    
    return content;
  }

  async removeAgent(agentType: string, scope: 'global' | 'project' = 'global'): Promise<void> {
    const agentsPath = scope === 'global' ? this.globalAgentsPath : this.projectAgentsPath;
    
    if (!agentsPath) {
      throw new Error('Project agents path not set');
    }

    const filePath = path.join(agentsPath, `${agentType}.md`);
    
    try {
      await fs.unlink(filePath);
      this.agents.delete(agentType);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  getAvailableToolsForAgent(agent: AgentConfig, executionMode: ExecutionMode): string[] {
    const toolRegistry = getToolRegistry();
    const allTools = toolRegistry.getAll();
    
    if (!agent.isInheritTools) {
      return agent.allowedTools || [];
    }

    const availableTools = allTools
      .filter(tool => tool.allowedModes.includes(executionMode))
      .map(tool => tool.name);

    if (agent.allowedTools && agent.allowedTools.length > 0) {
      return [...new Set([...availableTools, ...agent.allowedTools])];
    }

    return availableTools;
  }

  getAvailableMcpsForAgent(agent: AgentConfig): string[] {
    if (!agent.isInheritMcps) {
      return agent.allowedMcps || [];
    }

    return agent.allowedMcps || [];
  }
}

let agentManagerInstance: AgentManager | null = null;

export function getAgentManager(projectRoot?: string): AgentManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager(projectRoot);
  }
  return agentManagerInstance;
}

export const DEFAULT_AGENTS: AgentConfig[] = [
  {
    agentType: 'general-purpose',
    systemPrompt: 'You are a helpful AI assistant that can help with various tasks including coding, writing, analysis, and problem-solving.',
    whenToUse: 'Use for general-purpose tasks and complex multi-step operations',
    isInheritTools: true,
    isInheritMcps: true,
    proactive: false
  },
  {
    agentType: 'code-reviewer',
    systemPrompt: 'You are an expert code reviewer. Analyze code for quality, security, performance, and best practices.',
    whenToUse: 'Use when reviewing code, checking for bugs, or ensuring code quality',
    allowedTools: ['Read', 'Grep', 'SearchCodebase'],
    isInheritTools: false,
    isInheritMcps: true,
    proactive: true,
    color: '#FF6B6B'
  },
  {
    agentType: 'frontend-developer',
    systemPrompt: 'You are a frontend development expert specializing in React, TypeScript, and modern web technologies.',
    whenToUse: 'Use for frontend development tasks, UI components, and web application features',
    allowedTools: ['Read', 'Write', 'Grep', 'Bash', 'ListDirectory'],
    isInheritTools: false,
    isInheritMcps: true,
    proactive: true,
    color: '#4ECDC4'
  },
  {
    agentType: 'backend-developer',
    systemPrompt: 'You are a backend development expert specializing in Node.js, databases, APIs, and server-side architecture.',
    whenToUse: 'Use for backend development tasks, API design, and server-side logic',
    allowedTools: ['Read', 'Write', 'Grep', 'Bash', 'ListDirectory'],
    isInheritTools: false,
    isInheritMcps: true,
    proactive: true,
    color: '#45B7D1'
  }
];
