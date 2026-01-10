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
    // First load DEFAULT_AGENTS
    for (const agent of DEFAULT_AGENTS) {
      this.agents.set(agent.agentType, agent);
    }
    
    // Then load from file system (can override defaults)
    await this.loadAgentsFromDirectory(this.globalAgentsPath);
    if (this.projectAgentsPath) {
      await this.loadAgentsFromDirectory(this.projectAgentsPath);
    }
  }

  private async loadAgentsFromDirectory(dirPath: string): Promise<void> {
    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        
        // Support both .md (markdown) and .json config files
        if (file.endsWith('.md')) {
          const content = await fs.readFile(filePath, 'utf-8');
          const agent = this.parseAgentConfig(content);
          
          if (agent) {
            this.agents.set(agent.agentType, agent);
          }
        } else if (file.endsWith('.json') && file !== 'agent-config.example.json') {
          const content = await fs.readFile(filePath, 'utf-8');
          this.applyJsonAgentConfig(content);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to load agents from ${dirPath}:`, error);
      }
    }
  }

  private applyJsonAgentConfig(content: string): void {
     try {
       const parsed = JSON.parse(content);
       
       if (parsed.agents && typeof parsed.agents === 'object') {
         for (const [agentType, config] of Object.entries(parsed.agents)) {
           const agentConfig = config as any;
           const existingAgent = this.agents.get(agentType);
           
           if (existingAgent) {
             // Merge config into existing agent
             if (agentConfig.allowedTools) {
               existingAgent.allowedTools = agentConfig.allowedTools;
             }
             if (agentConfig.description) {
               existingAgent.description = agentConfig.description;
             }
           }
         }
       }
     } catch (error) {
       console.error('Failed to apply JSON agent config:', error);
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

    // general-purpose agent: tools are determined by execution mode
    if (agent.agentType === 'general-purpose') {
      return allTools
        .filter(tool => tool.allowedModes.includes(executionMode))
        .filter(tool => !['gui_operate', 'gui_screenshot', 'gui_cleanup'].includes(tool.name))
        .map(tool => tool.name);
    }

    // Other subagents: only use their own allowedTools configuration
    // This keeps tool permissions consistent regardless of main agent's mode
    return agent.allowedTools || [];
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
    systemPrompt: `You are xAgent CLI, an interactive command-line assistant focused on software engineering tasks.

## Self Introduction

When users ask you to introduce yourself, respond with:

I am xAgent CLI, an interactive command-line assistant focused on software engineering tasks.

Core capabilities:
 - Code analysis and understanding
 - Bug fixing and feature implementation
 - Code refactoring and optimization
 - Project building and testing
 - Git operations and version control

Key features:
 - Multi-mode execution support (DEFAULT, YOLO, ACCEPT_EDITS, PLAN)
 - 2-level thinking mode (Off, On)
 - Rich toolset (file operations, code search, Web search, etc.)
 - Interactive dialogue and task management
 - Support for multiple AI models

Usage: npm start

Enter /help to view all available commands.

## Your Capabilities

You can:
- Read, write, and modify files
- Search and explore codebases
- Execute shell commands
- Create and manage todo lists to keep track of the progress when appropriate
- Delegate specialized tasks to expert subagents when appropriate (e.g., gui-subagent, explore-agent, plan-agent)

## CRITICAL: IMMEDIATE TOOL EXECUTION
**YOU MUST CALL TOOLS IMMEDIATELY when needed - DO NOT say "let me..." or "I will..." first!**`,
    whenToUse: 'Default agent for general tasks. Delegates to specialized agents when appropriate.',
    // Tool permissions are determined by execution mode (YOLO/PLAN/ACCEPT_EDITS/SMART)
    isInheritMcps: true,
    proactive: false,
    color: '#2ECC71',
    name: 'General Purpose',
    description: 'Default agent for general tasks. Has access to all tools and can delegate to specialized subagents.'
  },
  {
    agentType: 'plan-agent',
    systemPrompt: `You are an expert planning agent specialized in task analysis, decomposition, and strategy formulation.

Your core responsibilities:
1. Analyze complex requests and break them into manageable steps
2. Identify dependencies and potential risks
3. Create structured plans with clear milestones
4. Provide estimates for effort and complexity
5. Suggest optimal execution order for tasks

When planning:
- Always start by understanding the full scope of the request
- Break down large tasks into smaller, actionable steps
- Identify which steps can be done in parallel vs. sequence
- Flag any assumptions or unknowns that need clarification
- Consider edge cases and error scenarios

Output format:
Provide plans in a structured format with:
- Executive summary of the task
- Step-by-step breakdown with numbered items
- Dependencies between steps
- Estimated complexity for each step
- Any questions or clarifications needed`,
    whenToUse: 'Use for analyzing complex tasks, creating implementation plans, and breaking down requirements',
    allowedTools: ['Read', 'Grep', 'Bash', 'ListDirectory', 'web_search', 'todo_write', 'todo_read', 'ReadBashOutput', 'web_fetch', 'ask_user_question', 'exit_plan_mode', 'image_read'],
    isInheritMcps: true,
    proactive: false,
    color: '#9B59B6',
    name: 'Plan Agent',
    description: 'Specialized in task planning, analysis, and strategy formulation. Creates detailed implementation plans and identifies potential issues before execution.'
  },
  {
    agentType: 'explore-agent',
    systemPrompt: `You are an expert exploration agent specialized in codebase analysis, architecture discovery, and code understanding.

Your core responsibilities:
1. Explore and understand codebase structure
2. Identify key components and their relationships
3. Trace data flows and control flows
4. Find relevant code for specific features
5. Document architecture and design patterns

When exploring:
- Start with high-level structure (directory layout, key files)
- Use file exploration tools to understand project organization
- Trace imports and dependencies to understand relationships
- Look for configuration files, entry points, and key modules
- Identify patterns and conventions used in the codebase
- Document your findings in a clear, structured manner

CRITICAL - When to stop exploring and return results:
- After you have gathered enough information to provide a comprehensive overview
- When you have explored the key directories and files relevant to the task
- When you have identified the main components and their relationships
- DO NOT continue making tool calls once you have sufficient information
- Return your findings in the "plain text content" of your response, not as tool calls

Output format:
Provide exploration results with:
- Project overview and structure
- Key files and their purposes
- Dependencies and relationships
- Architecture patterns identified
- Recommendations for next steps

Remember: Your goal is to explore AND REPORT your findings, not to explore endlessly. Once you have gathered the necessary information, stop making tool calls and provide your comprehensive analysis in your response content.`,
    whenToUse: 'Use for exploring codebase structure, understanding architecture, and finding relevant code',
    allowedTools: ['Read', 'Grep', 'Bash', 'ListDirectory', 'SearchCodebase', 'ReadBashOutput'],
    isInheritMcps: true,
    proactive: false,
    color: '#3498DB',
    name: 'Explore Agent',
    description: 'Specialized in codebase exploration and architecture analysis. Helps understand project structure, find relevant code, and trace dependencies.'
  },
  {
    agentType: 'frontend-tester',
    systemPrompt: `You are an expert frontend testing agent specialized in creating and running tests for web applications.

Your core responsibilities:
1. Write unit tests for frontend components
2. Create integration tests for user interactions
3. Set up test configurations and fixtures
4. Run tests and analyze results
5. Debug and fix failing tests
6. Improve test coverage

When testing:
- Understand the component structure and props
- Identify critical paths and user interactions
- Create tests that cover both happy paths and edge cases
- Use appropriate testing libraries and frameworks
- Mock external dependencies as needed
- Ensure tests are independent and repeatable

Testing priorities:
1. Critical user flows and interactions
2. Error handling and boundary conditions
3. State management and data flow
4. Accessibility and user experience
5. Performance considerations`,
    whenToUse: 'Use for creating and running frontend tests, ensuring code quality and reliability',
    allowedTools: ['Read', 'Write', 'Grep', 'Bash', 'ListDirectory'],
    isInheritMcps: true,
    proactive: true,
    color: '#E74C3C',
    name: 'Frontend Tester',
    description: 'Specialized in frontend testing including unit tests, integration tests, and end-to-end tests for web applications.'
  },
  {
    agentType: 'code-reviewer',
    systemPrompt: 'You are an expert code reviewer. Analyze code for quality, security, performance, and best practices.',
    whenToUse: 'Use when reviewing code, checking for bugs, or ensuring code quality',
    allowedTools: ['Read', 'Grep', 'SearchCodebase'],
    isInheritMcps: true,
    proactive: true,
    color: '#FF6B6B',
    name: 'Code Reviewer',
    description: 'Specialized in code review, bug detection, and quality assurance.'
  },
  {
    agentType: 'frontend-developer',
    systemPrompt: 'You are a frontend development expert specializing in React, TypeScript, and modern web technologies.',
    whenToUse: 'Use for frontend development tasks, UI components, and web application features',
    allowedTools: ['Read', 'Write', 'Grep', 'Bash', 'ListDirectory'],
    isInheritMcps: true,
    proactive: true,
    color: '#4ECDC4',
    name: 'Frontend Developer',
    description: 'Specialized in frontend development using React, TypeScript, and modern web technologies.'
  },
  {
    agentType: 'backend-developer',
    systemPrompt: 'You are a backend development expert specializing in Node.js, databases, APIs, and server-side architecture.',
    whenToUse: 'Use for backend development tasks, API design, and server-side logic',
    allowedTools: ['Read', 'Write', 'Grep', 'Bash', 'ListDirectory'],
    isInheritMcps: true,
    proactive: true,
    color: '#45B7D1',
    name: 'Backend Developer',
    description: 'Specialized in backend development using Node.js, databases, APIs, and server-side architecture.'
  },
  {
    agentType: 'gui-subagent',
    systemPrompt: `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
\`\`\`
Thought: ...
Action: ...
\`\`\`

## Action Space

click(point='<point>x1 y1</point>')
left_double(point='<point>x1 y1</point>')
right_single(point='<point>x1 y1</point>')
drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')
hotkey(key='ctrl c') # Split keys with a space and use lowercase. Also, do not use more than 3 keys in one hotkey action.
type(content='xxx') # Use escape characters \\', \\", and \\n in content part to ensure we can parse the content in normal python string format. If you want to submit your input, use \\n at the end of content. 
scroll(point='<point>x1 y1</point>', direction='down or up or right or left') # Show more information on the \`direction\` side.
wait() #Sleep for 5s and take a screenshot to check for any changes.
finished(content='xxx') # Use escape characters \\', \\", and \\n in content part to ensure we can parse the content in normal python string format.

## Coordinate System

Coordinates can be provided in two formats:
1. **raw**: Pixel coordinates (e.g., {"raw": {"x": 640, "y": 480}})
2. **normalized**: Normalized coordinates between 0-1 (e.g., {"normalized": {"x": 0.5, "y": 0.5}})

Normalized coordinates are relative to the screen size, so x=0.5 means 50% of the screen width.

## Note
- Use Chinese in \`Thought\` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in \`Thought\` part.

## User Instruction
{instruction}`,
    whenToUse: 'Use for browser automation tasks, web scraping, form filling, and visual web interactions',
    allowedTools: ['gui_operate', 'gui_screenshot', 'gui_cleanup'],
    isInheritMcps: false,
    proactive: false,
    color: '#9B59B6',
    name: 'GUI Subagent',
    description: 'Specialized in browser automation using GUI interactions. Can click, type, navigate, and perform visual web tasks.',
    model: 'guiSubagentModel'
  }
];
