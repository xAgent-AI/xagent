import { ToolRegistry } from './tools.js';
import { ExecutionMode } from './types.js';

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

  constructor(toolRegistry: ToolRegistry, executionMode: ExecutionMode) {
    this.toolRegistry = toolRegistry;
    this.executionMode = executionMode;
  }

  generateEnhancedSystemPrompt(baseSystemPrompt: string): string {
    const availableTools = this.toolRegistry.getAll().filter(
      tool => tool.allowedModes.includes(this.executionMode)
    );

    let enhancedPrompt = baseSystemPrompt;

    // Add execution mode information at the beginning
    enhancedPrompt += `

## Current Execution Mode: ${this.executionMode.toUpperCase()}

## Self Introduction

When users ask you to introduce yourself, ALWAYS respond with the following exact format (do not modify or add any additional text):

我是 xAgent CLI，一个专注于软件工程任务的交互式命令行助手。

核心能力：
 - 代码分析和理解
 - Bug 修复和功能实现
 - 代码重构和优化
 - 项目构建和测试
 - Git 操作和版本控制

主要特点：
 - 支持多模式执行（DEFAULT、YOLO、ACCEPT_EDITS、PLAN）
 - 2级思考模式（Off、On）
 - 丰富的工具集（文件操作、代码搜索、Web 搜索等）
 - 交互式对话和任务管理
 - 支持多 AI 模型（如 glm-4.7）

使用方式：
 npm start start

输入 /help 查看所有可用命令。

IMPORTANT: This is the ONLY self-introduction you should provide. Do not add any additional information or modify this text.

`;

    // Only add tool-related content if tools are available
    if (availableTools.length > 0) {
      const toolSchemas = this.getToolSchemas(availableTools);
      const toolUsageGuide = this.generateToolUsageGuide(toolSchemas);
      const decisionMakingGuide = this.generateDecisionMakingGuide();
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

  private getToolSchemas(tools: any[]): ToolSchema[] {
    return tools.map(tool => this.createToolSchema(tool));
  }

  private createToolSchema(tool: any): ToolSchema {
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
        description: 'Search for text patterns across multiple files',
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
          include: {
            type: 'string',
            description: 'File pattern to include (glob)',
            required: false
          },
          exclude: {
            type: 'string',
            description: 'File pattern to exclude (glob)',
            required: false
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Whether search is case-sensitive',
            required: false,
            default: false
          },
          fixed_strings: {
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
          before: {
            type: 'number',
            description: 'Number of context lines before match',
            required: false
          },
          after: {
            type: 'number',
            description: 'Number of context lines after match',
            required: false
          },
          no_ignore: {
            type: 'boolean',
            description: 'Ignore .gitignore patterns',
            required: false,
            default: false
          }
        },
        usage: 'Search for code patterns, function definitions, or text across the codebase',
        examples: [
          'Search for function: Grep(pattern="function.*\\(.*\\)")',
          'Find specific text: Grep(pattern="TODO", case_sensitive=true)',
          'Search in specific files: Grep(pattern="import", include="*.ts")'
        ],
        bestPractices: [
          'Use fixed_strings for simple text searches',
          'Use context to see surrounding code',
          'Narrow search with include/exclude patterns',
          'Use case_sensitive for exact matches'
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
      SearchCodebase: {
        name: 'SearchCodebase',
        description: 'Semantic search through the codebase using embeddings',
        parameters: {
          query: {
            type: 'string',
            description: 'Natural language query describing what to search for',
            required: true
          },
          target_directories: {
            type: 'array',
            description: 'Specific directories to search in',
            required: false
          }
        },
        usage: 'Find code by meaning rather than exact text matches',
        examples: [
          'Find authentication logic: SearchCodebase(query="how do we check authentication headers?")',
          'Find error handling: SearchCodebase(query="where do we do error handling in the file watcher?")'
        ],
        bestPractices: [
          'Use natural language queries',
          'Be specific about what you are looking for',
          'Combine with Read to examine found code'
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
      Replace: {
        name: 'Replace',
        description: 'Replace text in a file using search and replace',
        parameters: {
          filePath: {
            type: 'string',
            description: 'Path to the file to modify',
            required: true
          },
          old_str: {
            type: 'string',
            description: 'Text to search for',
            required: true
          },
          new_str: {
            type: 'string',
            description: 'Text to replace with',
            required: true
          }
        },
        usage: 'Make targeted edits to files without rewriting entire content',
        examples: [
          'Replace text: Replace(filePath="config.json", old_str="old value", new_str="new value")'
        ],
        bestPractices: [
          'Use unique old_str to avoid multiple replacements',
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
            description: 'Type of agent to use (search, code-reviewer, etc.)',
            required: true
          },
          response_language: {
            type: 'string',
            description: 'Language for the response',
            required: true
          }
        },
        usage: 'Delegate specialized tasks to expert agents',
        examples: [
          'Search task: Task(description="Find authentication code", query="where is authentication implemented?", subagent_type="search", response_language="en")'
        ],
        bestPractices: [
          'Choose appropriate agent type for the task',
          'Provide clear task descriptions',
          'Specify desired response language',
          'Review agent results carefully'
        ]
      }
    };

    return schemas[tool.name] || {
      name: tool.name,
      description: tool.description,
      parameters: {},
      usage: `Use ${tool.name} for related tasks`,
      examples: [],
      bestPractices: []
    };
  }

  private generateToolUsageGuide(toolSchemas: ToolSchema[]): string {
    let guide = '## Available Tools\n\n';
    guide += 'You have access to the following tools. Use them to accomplish user requests:\n\n';

    toolSchemas.forEach(schema => {
      guide += `### ${schema.name}\n\n`;
      guide += `**Description**: ${schema.description}\n\n`;
      guide += `**Usage**: ${schema.usage}\n\n`;
      guide += `**Parameters**:\n`;
      
      Object.entries(schema.parameters).forEach(([paramName, param]) => {
        const required = param.required ? ' (required)' : ' (optional)';
        const defaultValue = param.default !== undefined ? ` (default: ${param.default})` : '';
        guide += `- \`${paramName}\`${required}${defaultValue}: ${param.description}\n`;
      });

      if (schema.examples.length > 0) {
        guide += `\n**Examples**:\n`;
        schema.examples.forEach(example => {
          guide += `- ${example}\n`;
        });
      }

      if (schema.bestPractices.length > 0) {
        guide += `\n**Best Practices**:\n`;
        schema.bestPractices.forEach(practice => {
          guide += `- ${practice}\n`;
        });
      }

      guide += '\n---\n\n';
    });

    return guide;
  }

  private generateDecisionMakingGuide(): string {
    return `## Decision Making Guide

### When to Use Tools
- **Read**: When you need to understand existing code, configuration, or documentation
- **Write**: When creating new files or completely replacing existing content
- **Grep**: When searching for specific patterns, function names, or text across files
- **Bash**: When running tests, installing dependencies, building projects, or executing terminal commands
- **SearchCodebase**: When finding code by meaning rather than exact text matches
- **ListDirectory**: When exploring project structure or finding files
- **Replace**: When making targeted edits without rewriting entire files
- **WebSearch**: When you need current information from the internet
- **WebFetch**: When retrieving content from specific URLs
- **TodoWrite**: When planning and tracking complex multi-step tasks
- **Task**: When delegating specialized work to expert agents

### CRITICAL: IMMEDIATE TOOL EXECUTION
**YOU MUST CALL TOOLS IMMEDIATELY when needed - DO NOT say "let me..." or "I will..." first!**

When a user asks you to:
- Read files → IMMEDIATELY call Read tool with the file path
- List directory → IMMEDIATELY call ListDirectory tool
- Search code → IMMEDIATELY call Grep or SearchCodebase tool
- Run commands → IMMEDIATELY call Bash tool
- Introduce the codebase → IMMEDIATELY call ListDirectory and Read tools
- Analyze the project → IMMEDIATELY call ListDirectory and Read tools
- Explain the code → IMMEDIATELY call Read tools
- Any action requiring tools → IMMEDIATELY make the tool call

**ABSOLUTELY WRONG**: 
- "Let me explore the codebase structure first" (then do nothing)
- "I will read the file for you" (then do nothing)
- "我来帮你探索这个代码库" (then do nothing)
- "让我先了解一下" (then do nothing)

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
- **Code exploration**: ListDirectory → Read → Grep/SearchCodebase
- **Feature implementation**: Read (existing code) → Write (new files) → Bash (test)
- **Bug fixing**: Grep/SearchCodebase (find issue) → Read (understand) → Replace/Write (fix) → Bash (verify)
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

    return tools.map(tool => {
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
  }
}
