import { ToolRegistry } from './tools.js';
import { ExecutionMode, AgentConfig } from './types.js';
import { getAgentManager } from './agents.js';
import { getSkillInvoker, SkillInfo } from './skill-invoker.js';
import { MCPManager } from './mcp.js';
import { getPowerShellVersion } from './shell.js';
import os from 'os';

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  usage: string;
  examples: string[];
  bestPractices: string[];
}

export class SystemPromptGenerator {
  private toolRegistry: ToolRegistry;
  private executionMode: ExecutionMode;
  private agentConfig?: AgentConfig;
  private mcpManager?: MCPManager;

  constructor(toolRegistry: ToolRegistry, executionMode: ExecutionMode, agentConfig?: AgentConfig, mcpManager?: MCPManager) {
    this.toolRegistry = toolRegistry;
    this.executionMode = executionMode;
    this.agentConfig = agentConfig;
    this.mcpManager = mcpManager;
  }

  /**
   * Generate system environment information for the LLM
   */
  private generateEnvironmentInfo(): string {
    const platform = os.platform();
    const arch = os.arch();
    const nodeVersion = process.version;
    const cwd = process.cwd();
    const homeDir = os.homedir();
    const username = os.userInfo().username;
    const currentDate = new Date().toISOString().split('T')[0];
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Map platform to human-readable OS name
    const osName: Record<string, string> = {
      'win32': 'Windows',
      'darwin': 'macOS',
      'linux': 'Linux'
    };

    // Get PowerShell version for Windows
    const psVersion = platform === 'win32' ? getPowerShellVersion() : 'N/A';
    const psMajorVersion = parseInt(psVersion.split('.')[0], 10);
    const psSupportsChaining = !isNaN(psMajorVersion) && psMajorVersion >= 7;

    // Generate PowerShell syntax rules
    let psSyntaxRules = '';
    if (platform === 'win32') {
      if (psSupportsChaining) {
        psSyntaxRules = `
**PowerShell Syntax** (v${psVersion}):
- Supports \`&&\` and \`||\` for command chaining
- Also supports \`;\` for sequential execution`;
      } else {
        psSyntaxRules = `
**PowerShell Syntax** (v${psVersion}):
- Does NOT support \`&&\` or \`||\` (use \`;\` instead)
- Use \`if ($?) { cmd2 }\` for conditional execution
- Common: \`ls\`→\`dir\`, \`cat\`→\`type\`, \`rm\`→\`Remove-Item\`, \`sleep\`→\`Start-Sleep\``;
      }
    }

    return `
## System Environment Information

- **Operating System**: ${osName[platform] || platform} (${platform}) ${os.arch()}
- **Node.js Version**: ${nodeVersion}
- **Current Working Directory**: ${cwd}
- **User Home Directory**: ${homeDir}
- **Current User**: ${username}
- **Current Date**: ${currentDate} (Timezone: ${timeZone})${psSyntaxRules}`;
  }

  async generateEnhancedSystemPrompt(baseSystemPrompt: string): Promise<string> {
    let localTools = this.toolRegistry.getAll().filter(
      tool => tool.allowedModes.includes(this.executionMode)
    );

    if (this.agentConfig) {
      const agentManager = getAgentManager();
      const allowedToolNames = agentManager.getAvailableToolsForAgent(this.agentConfig, this.executionMode);
      localTools = localTools.filter(tool => allowedToolNames.includes(tool.name));
    }

    // Get available local tools (includes MCP wrapper tools registered via registerMCPTools)
    let allAvailableTools = localTools;

    let enhancedPrompt = baseSystemPrompt;

    // Add system environment information
    enhancedPrompt += this.generateEnvironmentInfo();

    // Only add tool-related content if tools are available
    if (allAvailableTools.length > 0) {
      // Pre-load skills for dynamic generation
      const skillInvoker = getSkillInvoker();
      await skillInvoker.initialize();
      const availableSkills = await skillInvoker.listAvailableSkills();

      const toolSchemas = this.getToolSchemas(allAvailableTools, availableSkills);
      const toolUsageGuide = this.generateToolUsageGuide(toolSchemas);
      const decisionMakingGuide = this.generateDecisionMakingGuide(localTools, availableSkills);
      const executionStrategy = this.generateExecutionStrategy();


      enhancedPrompt += `

${toolUsageGuide}

${decisionMakingGuide}

${executionStrategy}



## Important Notes
- Always verify tool results before proceeding to next steps
- If a tool fails, analyze the error and try alternative approaches
- Use tools efficiently - avoid redundant calls
- When in doubt, ask the user for clarification
- Maintain context across tool calls to build a coherent solution`;
    } else {
      // No tools available - explicitly tell the AI not to use tools
      enhancedPrompt += `

## IMPORTANT: READ-ONLY MODE

You are in DEFAULT mode (read-only mode). You CANNOT use any tools or functions.

STRICT PROHIBITIONS:
- DO NOT attempt to call any functions, tools, or commands
- DO NOT output any tool call syntax, such as:
  - <function_calls>...</function_calls>
  - ToolName(params)
  - Function call format
  - Any similar syntax
- DO NOT simulate tool calls or pretend to use tools
- DO NOT output code that would execute tools

REQUIRED BEHAVIOR:
- Respond ONLY with plain text
- Answer questions based on your knowledge
- If you need to read files or perform actions, ask the user to switch modes
- Tell the user they can use "/mode yolo" or "/mode accept_edits" to enable tools

Remember: You are in a conversational mode, not a tool-execution mode. Just talk to the user!`;
    }

    return enhancedPrompt;
  }

  private getToolSchemas(tools: any[], skills: SkillInfo[] = []): ToolSchema[] {
    return tools.map(tool => this.createToolSchema(tool, skills));
  }

  //
  // createToolSchema
  //
  // This method defines custom schemas for each tool, which OVERRIDES the description
  // property defined in tools.ts (e.g., ReadTool.description, WriteTool.description).
  //
  // The tool.description from tools.ts is read but NOT directly used - instead, we use
  // the schemas defined here. This allows for:
  // 1. Dynamic content (like skills list in InvokeSkill)
  // 2. Customized descriptions for better LLM understanding
  // 3. Consistent formatting across all tools
  //
  // Only tools NOT in the schemas object will fall back to using tool.description.
  //
  private createToolSchema(tool: any, skills: SkillInfo[] = []): ToolSchema {
    const schemas: Record<string, ToolSchema> = {
      Read: {
        name: 'Read',
        description: 'Read the contents of a file from the filesystem',
        parameters: {
          filePath: {
            type: 'string',
            description: 'Path to the file to read (relative or absolute)',
            required: true
          },
          offset: {
            type: 'number',
            description: 'Starting line number (0-indexed)',
            required: false,
            default: 0
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read',
            required: false
          }
        },
        usage: 'Use this tool when you need to examine file contents, understand code structure, or read configuration files',
        examples: [
          'Read a specific file: Read(filePath="package.json")',
          'Read with line range: Read(filePath="src/index.ts", offset=100, limit=50)'
        ],
        bestPractices: [
          'Always check if file exists before reading',
          'Use offset and limit for large files to avoid excessive output',
          'Read configuration files first to understand project structure'
        ]
      },
      Write: {
        name: 'Write',
        description: 'Write content to a file, creating directories if needed',
        parameters: {
          filePath: {
            type: 'string',
            description: 'Path where the file should be written',
            required: true
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
            required: true
          }
        },
        usage: 'Use this tool to create new files or completely overwrite existing files',
        examples: [
          'Create a new file: Write(filePath="src/utils.ts", content="export function helper() {}")',
          'Write configuration: Write(filePath=".env", content="API_KEY=secret")'
        ],
        bestPractices: [
          'Always read existing file before overwriting',
          'Use proper file extensions',
          'Create necessary directory structures',
          'Include appropriate comments and documentation'
        ]
      },
      Grep: {
        name: 'Grep',
        description: 'Search for text patterns across multiple files using ripgrep',
        parameters: {
          pattern: {
            type: 'string',
            description: 'Text pattern or regex to search for',
            required: true
          },
          path: {
            type: 'string',
            description: 'Directory path to search in',
            required: false,
            default: '.'
          },
          glob: {
            type: 'string',
            description: 'File pattern to include (glob)',
            required: false
          },
          ignoreCase: {
            type: 'boolean',
            description: 'Case-insensitive search',
            required: false,
            default: false
          },
          literal: {
            type: 'boolean',
            description: 'Treat pattern as literal string, not regex',
            required: false,
            default: false
          },
          context: {
            type: 'number',
            description: 'Number of context lines before and after match',
            required: false
          },
          limit: {
            type: 'number',
            description: 'Maximum number of matches to return',
            required: false
          }
        },
        usage: 'Search for code patterns, function definitions, or text across the codebase',
        examples: [
          'Search for function: Grep(pattern="function.*\\(.*\\)")',
          'Find specific text: Grep(pattern="TODO", ignoreCase=true)',
          'Search in specific files: Grep(pattern="import", glob="*.ts")',
          'Literal search: Grep(pattern="*.ts", literal=true)'
        ],
        bestPractices: [
          'Use literal=true for simple text searches',
          'Use context to see surrounding code',
          'Narrow search with glob pattern',
          'Use ignoreCase=true for case-insensitive matching'
        ]
      },
      Bash: {
        name: 'Bash',
        description: 'Execute shell commands in the terminal',
        parameters: {
          command: {
            type: 'string',
            description: 'Shell command to execute',
            required: true
          },
          cwd: {
            type: 'string',
            description: 'Working directory for command execution',
            required: false
          },
          description: {
            type: 'string',
            description: 'Human-readable description of what the command does',
            required: false
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds (default: 120)',
            required: false,
            default: 120
          },
          run_in_bg: {
            type: 'boolean',
            description: 'Run command in background',
            required: false,
            default: false
          }
        },
        usage: 'Execute terminal commands, run tests, install dependencies, or perform system operations',
        examples: [
          'Install dependencies: Bash(command="npm install")',
          'Run tests: Bash(command="npm test", description="Run unit tests")',
          'Build project: Bash(command="npm run build")'
        ],
        bestPractices: [
          'Always provide clear descriptions',
          'Use appropriate timeout values',
          'Check command exit codes',
          'Handle errors gracefully',
          'Use run_in_bg for long-running processes'
        ]
      },
      ListDirectory: {
        name: 'ListDirectory',
        description: 'List files and directories in a given path',
        parameters: {
          path: {
            type: 'string',
            description: 'Directory path to list',
            required: true
          },
          recursive: {
            type: 'boolean',
            description: 'List recursively',
            required: false,
            default: false
          }
        },
        usage: 'Explore directory structure, find files, or understand project layout',
        examples: [
          'List current directory: ListDirectory(path=".")',
          'List recursively: ListDirectory(path="src", recursive=true)'
        ],
        bestPractices: [
          'Use recursive for deep exploration',
          'Combine with Read to examine files',
          'Check directory existence first'
        ]
      },
      SearchFiles: {
        name: 'SearchFiles',
        description: 'Search for files matching a glob pattern using fd (fast find)',
        parameters: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files (e.g., "**/*.ts")',
            required: true
          },
          path: {
            type: 'string',
            description: 'Directory to search in',
            required: false
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
            required: false
          }
        },
        usage: 'Find files by name or extension pattern using fast fd tool',
        examples: [
          'Find all TypeScript files: SearchFiles(pattern="**/*.ts")',
          'Find config files: SearchFiles(pattern="**/config.*")'
        ],
        bestPractices: [
          'Use **/*.ts for recursive search',
          'Combine with Read to examine found files',
          'fd automatically respects .gitignore'
        ]
      },
      DeleteFile: {
        name: 'DeleteFile',
        description: 'Delete a file from the filesystem',
        parameters: {
          filePath: {
            type: 'string',
            description: 'Path to the file to delete',
            required: true
          }
        },
        usage: 'Remove files that are no longer needed',
        examples: [
          'Delete file: DeleteFile(filePath="old-file.txt")'
        ],
        bestPractices: [
          'Verify file is not needed before deletion',
          'Use with caution - deletion is permanent',
          'Consider backing up important files'
        ]
      },
      CreateDirectory: {
        name: 'CreateDirectory',
        description: 'Create a directory and any necessary parent directories',
        parameters: {
          path: {
            type: 'string',
            description: 'Directory path to create',
            required: true
          }
        },
        usage: 'Create directory structures for organizing files',
        examples: [
          'Create directory: CreateDirectory(path="src/components")'
        ],
        bestPractices: [
          'Use descriptive directory names',
          'Follow project conventions',
          'Create necessary parent directories automatically'
        ]
      },
      edit: {
        name: 'Edit',
        description: 'Edit a file by replacing exact text',
        parameters: {
          file_path: {
            type: 'string',
            description: 'Path to the file to modify',
            required: true
          },
          instruction: {
            type: 'string',
            description: 'Description of what to change',
            required: true
          },
          old_string: {
            type: 'string',
            description: 'The exact text to find and replace',
            required: true
          },
          new_string: {
            type: 'string',
            description: 'Text to replace with',
            required: true
          }
        },
        usage: 'Make targeted edits to files without rewriting entire content',
        examples: [
          'Edit text: Edit(file_path="config.json", instruction="Update API endpoint", old_string="old value", new_string="new value")'
        ],
        bestPractices: [
          'Use unique old_string to avoid multiple replacements',
          'Read file first to verify content',
          'Use Write for large changes'
        ]
      },
      WebSearch: {
        name: 'WebSearch',
        description: 'Search the web for information',
        parameters: {
          query: {
            type: 'string',
            description: 'Search query',
            required: true
          },
          num: {
            type: 'number',
            description: 'Number of results to return',
            required: false,
            default: 5
          }
        },
        usage: 'Find information online, research topics, or get current data',
        examples: [
          'Search web: WebSearch(query="latest Node.js version")',
          'Multiple results: WebSearch(query="React best practices", num=10)'
        ],
        bestPractices: [
          'Use specific search queries',
          'Limit results for focused answers',
          'Verify information from multiple sources'
        ]
      },
      WebFetch: {
        name: 'WebFetch',
        description: 'Fetch and process URL content',
        parameters: {
          prompt: {
            type: 'string',
            description: 'Prompt containing URL to fetch',
            required: true
          }
        },
        usage: 'Retrieve content from web pages, APIs, or online resources',
        examples: [
          'Fetch URL: WebFetch(prompt="https://api.example.com/data")'
        ],
        bestPractices: [
          'Handle network errors gracefully',
          'Validate URL format',
          'Consider rate limiting'
        ]
      },
      TodoWrite: {
        name: 'TodoWrite',
        description: 'Create and manage structured task lists',
        parameters: {
          todos: {
            type: 'array',
            description: 'Array of todo items with id, task, status, and priority',
            required: true
          }
        },
        usage: 'Plan and track complex multi-step tasks',
        examples: [
          'Create todos: TodoWrite(todos=[{"id":"1","task":"Install dependencies","status":"pending","priority":"high"}])'
        ],
        bestPractices: [
          'Use descriptive task names',
          'Set appropriate priorities',
          'Update status as tasks progress',
          'Break down complex tasks into smaller steps'
        ]
      },
      Task: {
        name: 'Task',
        description: 'Launch a specialized agent to handle specific tasks',
        parameters: {
          description: {
            type: 'string',
            description: 'Brief description of the task',
            required: true
          },
          query: {
            type: 'string',
            description: 'Detailed task instructions',
            required: true
          },
          subagent_type: {
            type: 'string',
            description: 'Type of agent to use (plan-agent, explore-agent, frontend-tester, code-reviewer, frontend-developer, backend-developer)',
            required: true
          },
          response_language: {
            type: 'string',
            description: 'Language for the response',
            required: false
          }
        },
        usage: 'Delegate specialized tasks to expert agents',
        examples: [
          'Plan task: Task(description="Create implementation plan", query="Create a detailed plan for implementing user authentication system", subagent_type="plan-agent")',
          'Explore codebase: Task(description="Explore auth module", query="Find and analyze all authentication-related code in the codebase", subagent_type="explore-agent")',
          'Run tests: Task(description="Create component tests", query="Write unit tests for the Button component including edge cases", subagent_type="frontend-tester")'
        ],
        bestPractices: [
          'Choose appropriate agent type for the task',
          'Provide clear task descriptions',
          'Specify desired response language if needed',
          'Review agent results carefully'
        ]
      },
      InvokeSkill: (() => {
        // Build skills list string from the provided skills, including description
        const skillsList = skills && skills.length > 0
          ? skills.map(skill => `- ${skill.name}: ${skill.description}`).join('\n')
          : 'No skills available';

        return {
          name: 'InvokeSkill',
          description: 'Invoke a specialized skill to get execution guidance for complex tasks. The skill will analyze your request and provide a step-by-step execution plan - you must follow these steps to complete the task.\n\n**Workflow**: Invoke skill → Receive guidance with nextSteps → Execute each step using appropriate tools → Complete the task.\n\n**Available Skills**:\n' + skillsList,
          parameters: {
            skillId: {
              type: 'string',
              description: 'The skill identifier (e.g., "docx", "pdf", "pptx", "frontend-design")',
              required: true
            },
            taskDescription: {
              type: 'string',
              description: 'Detailed description of what to accomplish',
              required: true
            }
          },
          usage: 'Use when facing complex domain-specific tasks. The skill provides guidance - you must execute the steps yourself.',
          examples: skills && skills.length > 0
            ? skills.slice(0, 3).map(skill =>
                `InvokeSkill(skillId="${skill.id}", taskDescription="...")`
              )
            : [],
          bestPractices: [
            'Invoke skill to get step-by-step execution guidance',
            'Follow the nextSteps provided by the skill in order',
            'Use appropriate tools (Read/Write/Run) to execute each step'
          ]
        };
      })()
    };

    // Fallback for unknown tools (including MCP tools)
    // Get the tool name - for MCP tools it's in function.name, for local tools it's in name
    const actualToolName = tool.function?.name || tool.name;
    // Get the description - for MCP tools it's in function.description, for local tools it's in description
    const actualDescription = tool.function?.description || tool.description;
    
    if (schemas[actualToolName]) {
      return schemas[actualToolName];
    }

    // Convert MCP inputSchema to parameters format
    const parameters: Record<string, ToolParameter> = {};
    if (tool.inputSchema?.properties) {
      for (const [paramName, paramDef] of Object.entries<any>(tool.inputSchema.properties)) {
        parameters[paramName] = {
          type: paramDef.type || 'any',
          description: paramDef.description || '',
          required: tool.inputSchema.required?.includes(paramName) || false,
          enum: paramDef.enum
        };
      }
    }

    return {
      name: actualToolName,
      description: actualDescription,
      parameters,
      usage: `Use ${actualToolName} for related tasks`,
      examples: [],
      bestPractices: []
    };
  }

  private generateToolUsageGuide(toolSchemas: ToolSchema[], skillInstructions: string = ''): string {
    let guide = '## Available Tools\n\n';
    guide += 'You have access to the following tools. Use them to accomplish user requests:\n\n';

    // Separate tools: regular tools first, then InvokeSkill (to be followed by Available Skills), then MCP tools
    const invokeSkillSchema = toolSchemas.find(s => s.name === 'InvokeSkill');
    // MCP tools are registered with _mcp{N} suffix to avoid name conflicts
    const mcpSchemas = toolSchemas.filter(s => s.name !== 'InvokeSkill' && /_mcp\d*$/.test(s.name));
    const regularSchemas = toolSchemas.filter(s => s.name !== 'InvokeSkill' && !mcpSchemas.includes(s));

    // Generate guide for regular tools
    regularSchemas.forEach((schema, index) => {
      guide += this.formatToolSchema(schema);
      if (index < regularSchemas.length - 1 || invokeSkillSchema || mcpSchemas.length > 0) {
        guide += '\n---\n\n';
      }
    });

    // Generate guide for InvokeSkill (put it before Available Skills)
    if (invokeSkillSchema) {
      guide += this.formatToolSchema(invokeSkillSchema);
      // Add Available Skills immediately after InvokeSkill (no separator)
      if (skillInstructions) {
        guide += `\n${skillInstructions}\n`;
      }
      // Add separator after Available Skills if there are MCP tools
      if (mcpSchemas.length > 0) {
        guide += '\n---\n\n';
      }
    }

    // Generate guide for MCP tools
    mcpSchemas.forEach((schema, index) => {
      guide += this.formatToolSchema(schema);
      if (index < mcpSchemas.length - 1) {
        guide += '\n---\n\n';
      }
    });

    return guide;
  }

  private formatToolSchema(schema: ToolSchema): string {
    let output = `### ${schema.name}\n\n`;
    output += `**Description**: ${schema.description}\n\n`;
    output += `**Usage**: ${schema.usage}\n\n`;
    output += `**Parameters**:\n`;

    Object.entries(schema.parameters).forEach(([paramName, param]) => {
      const required = param.required ? ' (required)' : ' (optional)';
      const defaultValue = param.default !== undefined ? ` (default: ${param.default})` : '';
      output += `- \`${paramName}\`${required}${defaultValue}: ${param.description}\n`;
    });

    if (schema.examples.length > 0) {
      output += `\n**Examples**:\n`;
      schema.examples.forEach(example => {
        output += `- ${example}\n`;
      });
    }

    if (schema.bestPractices.length > 0) {
      output += `\n**Best Practices**:\n`;
      schema.bestPractices.forEach(practice => {
        output += `- ${practice}\n`;
      });
    }

    return output;
  }

  private generateDecisionMakingGuide(availableTools: any[], skills: SkillInfo[] = []): string {
    // Tool name to short description mapping
    const toolDescriptions: Record<string, string> = {
      'Read': 'When you need to understand existing code, configuration, or documentation',
      'Write': 'When creating new files or completely replacing existing content',
      'Grep': 'When searching for specific patterns, function names, or text across files',
      'Bash': 'When running tests, installing dependencies, building projects, or executing terminal commands',
      'SearchFiles': 'When finding files by name or extension pattern',
      'ListDirectory': 'When exploring project structure or finding files',
      'Edit': 'When making targeted edits without rewriting entire files',
      'web_search': 'When you need current information from the internet',
      'web_fetch': 'When retrieving content from specific URLs',
      'todo_write': 'When planning and tracking complex multi-step tasks',
      'task': 'When delegating specialized work to expert agents',
      'DeleteFile': 'When you need to remove a file from the filesystem',
      'CreateDirectory': 'When you need to create a new directory or folder structure',
      'ReadBashOutput': 'When you need to read the output of a background task',
      'ask_user_question': 'When you need to ask the user for clarification or decisions',
      'save_memory': 'When you need to remember important information for future sessions',
      'exit_plan_mode': 'When you have completed planning and are ready to execute',
      'xml_escape': 'When you need to escape special characters in XML/HTML files',
      'image_read': 'When you need to analyze or read image files',
      'InvokeSkill': 'When you need to use specialized skills for domain tasks (see InvokeSkill tool description for available skills)'
    };

    // Generate based on available tools "When to Use Tools" 部分
    let toolsSection = '### When to Use Tools\n';
    if (availableTools.length > 0) {
      for (const tool of availableTools) {
        const description = toolDescriptions[tool.name] || `When you need to use ${tool.name}`;
        toolsSection += `- **${tool.name}**: ${description}\n`;
      }
    } else {
      toolsSection += '- (No tools available in current mode)\n';
    }

    return `## Decision Making Guide

${toolsSection}

### CRITICAL: IMMEDIATE TOOL EXECUTION
**YOU MUST CALL TOOLS IMMEDIATELY when needed - DO NOT say "let me..." or "I will..." first!**

When a user asks you to:
- Read files → IMMEDIATELY call Read tool with the file path
- List directory → IMMEDIATELY call ListDirectory tool
- Search files → IMMEDIATELY call SearchFiles tool
- Search code → IMMEDIATELY call Grep tool
- Run commands → IMMEDIATELY call Bash tool
- Introduce the codebase → IMMEDIATELY call ListDirectory and Read tools
- Analyze the project → IMMEDIATELY call ListDirectory and Read tools
- Explain the code → IMMEDIATELY call Read tools
- Any action requiring tools → IMMEDIATELY make the tool call

**ABSOLUTELY WRONG**:
- "Let me explore the codebase structure first" (then do nothing)
- "I will read the file for you" (then do nothing)
- "Let me help you explore this codebase" (then do nothing)
- "Let me understand this first" (then do nothing)

**ABSOLUTELY CORRECT**: 
- Call ListDirectory(path=".") immediately to explore the structure
- Call Read(filePath="path/to/file") immediately to read the file
- Call ListDirectory(path=".") immediately when asked to introduce the codebase

**ZERO DELAY POLICY**: 
- Do NOT add any conversational filler before tool calls
- Do NOT say "I'm going to" or "Let me" - just CALL THE TOOL
- Your response should START with the tool call, not with a statement about what you'll do

### Tool Selection Strategy
1. **Analyze the user's request** - Understand what they want to accomplish
2. **Identify the core task** - Determine the primary action needed
3. **Choose the most appropriate tool** - Select the tool that best matches the task
4. **Consider dependencies** - Some tasks require multiple tools in sequence
5. **Plan the execution order** - Determine the logical sequence of tool calls
6. **EXECUTE IMMEDIATELY** - Make the tool call right away without delay

### Common Patterns
- **Code exploration**: ListDirectory → Read → Grep/SearchFiles
- **Feature implementation**: Read (existing code) → Write (new files) → Bash (test)
- **Bug fixing**: Grep (find issue) → Read (understand) → Edit/Write (fix) → Bash (verify)
- **Project setup**: WebSearch (research) → Write (create files) → Bash (install/build)
- **Documentation**: Read (code) → Write (docs)

### Error Handling
- If a tool fails, analyze the error message
- Try alternative approaches or parameters
- Ask the user for clarification if needed
- Report errors clearly with context`;
  }

  private generateExecutionStrategy(): string {
    return `## Execution Strategy

### Step-by-Step Approach
1. **Understand the goal**: Clarify what the user wants to achieve
2. **Plan the approach**: Break down complex tasks into smaller steps
3. **Execute systematically**: Use tools in the right order
4. **Verify results**: Check each step before proceeding
5. **Report progress**: Keep the user informed of your actions

### Efficiency Tips
- **Batch similar operations**: Group related tool calls together
- **Avoid redundant calls**: Don't read the same file multiple times
- **Use context wisely**: Leverage information from previous tool results
- **Be precise**: Use specific parameters to get exactly what you need

### Quality Assurance
- Always verify tool outputs match expectations
- Test code changes before declaring success
- Check for edge cases and error conditions
- Ensure changes don't break existing functionality

### Communication
- Explain your reasoning before taking action
- Provide clear summaries of what you've done
- Highlight any assumptions you've made
- Ask for confirmation on destructive operations`;
  }

  getToolDefinitions(): any[] {
    const tools = this.toolRegistry.getAll().filter(
      tool => tool.allowedModes.includes(this.executionMode)
    );

    const localTools = tools.map(tool => {
      const schema = this.createToolSchema(tool);
      const properties: Record<string, any> = {};
      const required: string[] = [];

      Object.entries(schema.parameters).forEach(([paramName, param]) => {
        properties[paramName] = {
          type: param.type,
          description: param.description
        };

        if (param.enum) {
          properties[paramName].enum = param.enum;
        }

        if (param.default !== undefined) {
          properties[paramName].default = param.default;
        }

        if (param.required) {
          required.push(paramName);
        }
      });

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: schema.description + '. ' + schema.usage,
          parameters: {
            type: 'object',
            properties,
            required
          }
        }
      };
    });

    return localTools;
  }
}
