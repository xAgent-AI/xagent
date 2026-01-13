import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import axios from 'axios';
import inquirer from 'inquirer';
import { Tool, ExecutionMode, AuthType } from './types.js';
import type { Message, ToolDefinition } from './ai-client.js';
import { colors, icons, styleHelpers } from './theme.js';
import { getCancellationManager } from './cancellation.js';
import { getLogger } from './logger.js';
import { SystemPromptGenerator } from './system-prompt-generator.js';
import { InteractiveSession } from './session.js';

const execAsync = promisify(exec);

export class ReadTool implements Tool {
  name = 'Read';
  description = `Read the contents of a file. This is your PRIMARY tool for understanding existing code, configuration, and documentation.

# When to Use
- When you need to understand existing code before making changes
- When user asks you to "read", "show", "view", or "check" a file
- When debugging and need to inspect source files
- When analyzing project structure by reading key files
- When examining configuration files (package.json, tsconfig.json, etc.)
- When checking documentation or README files

# When NOT to Use
- For files you've already read in the same conversation (use memory instead)
- When you only need file metadata (use ListDirectory or Bash with ls instead)
- For binary files that cannot be read as text

# Parameters
- \`filePath\`: Absolute path or path relative to project root
- \`offset\`: (Optional) Line number to start reading from (0-based)
- \`limit\`: (Optional) Maximum number of lines to read

# Examples
- Read specific file: Read(filePath="/path/to/file.ts")
- Read with pagination: Read(filePath="src/app.ts", offset=0, limit=100)

# Best Practices
- Use absolute paths or paths relative to the project root
- Use offset and limit for large files to avoid loading entire content
- Combine with ListDirectory to explore project structure first
- Don't re-read files unnecessarily`;

  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: { filePath: string; offset?: number; limit?: number }): Promise<string> {
    const { filePath, offset = 0, limit } = params;
    
    try {
      const absolutePath = path.resolve(filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      
      const lines = content.split('\n');
      const startLine = Math.max(0, offset);
      const endLine = limit !== undefined ? Math.min(lines.length, startLine + limit) : lines.length;
      const selectedLines = lines.slice(startLine, endLine);
      
      return selectedLines.join('\n');
    } catch (error: any) {
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
  }
}

export class WriteTool implements Tool {
  name = 'Write';
  description = `Create a new file or completely overwrite an existing file with new content.

# When to Use
- Creating new files (source code, configuration, documentation)
- Completely replacing file content (not partial edits)
- Generating files from templates or scratch
- When user explicitly asks to "create", "write", or "generate" a file

# When NOT to Use
- For making small edits to existing files (use Replace instead)
- When you only need to append content (read file first, then write)
- For creating directories (use CreateDirectory instead)

# Parameters
- \`filePath\`: Absolute path or path relative to project root
- \`content\`: The complete content to write to the file

# Examples
- Create new file: Write(filePath="src/utils.ts", content="...")
- Create config file: Write(filePath=".env.example", content="API_KEY=...")

# Best Practices
- Parent directories are created automatically
- Use appropriate file extensions
- Ensure content is complete and syntactically correct
- For partial edits, use Replace tool instead`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

  async execute(params: { filePath: string; content: string }): Promise<{ success: boolean; message: string }> {
    const { filePath, content } = params;
    
    try {
      const absolutePath = path.resolve(filePath);
      const dir = path.dirname(absolutePath);
      
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      
      return {
        success: true,
        message: `Successfully wrote to ${filePath}`
      };
    } catch (error: any) {
      throw new Error(`Failed to write file ${filePath}: ${error.message}`);
    }
  }
}

export class GrepTool implements Tool {
  name = 'Grep';
  description = `Search for text patterns within files using regex or literal string matching. This is your PRIMARY tool for finding specific code, functions, or content.

# When to Use
- Finding specific function definitions or calls
- Searching for variable usages or imports
- Locating error messages or log statements
- Finding all occurrences of a pattern across the codebase
- When you need line-by-line results with context

# When NOT to Use
- When you only need to find files containing text (use SearchCodebase instead)
- When searching by file pattern rather than content (use SearchCodebase)
- For very large codebases where you only need file names (SearchCodebase is faster)

# Parameters
- \`pattern\`: Regex or literal string to search for
- \`path\`: (Optional) Directory to search in, default: "."
- \`include\`: (Optional) File glob pattern to include
- \`exclude\`: (Optional) File glob pattern to exclude
- \`case_sensitive\`: (Optional) Case-sensitive search, default: false
- \`fixed_strings\`: (Optional) Treat pattern as literal string, default: false
- \`context\`: (Optional) Lines of context before/after matches
- \`no_ignore\`: (Optional) Don't ignore node_modules/.git, default: false

# Examples
- Find function: Grep(pattern="function myFunction")
- Find with context: Grep(pattern="TODO", context=3)
- TypeScript only: Grep(pattern="interface", include="*.ts")

# Best Practices
- Use case_sensitive=true for short patterns to reduce false positives
- Use fixed_strings=true if your pattern has special regex characters
- Use context to see the surrounding code for each match
- Combine with include/exclude to narrow down file types`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: {
    pattern: string;
    path?: string;
    include?: string;
    exclude?: string;
    case_sensitive?: boolean;
    fixed_strings?: boolean;
    context?: number;
    after?: number;
    before?: number;
    no_ignore?: boolean;
  }): Promise<string[]> {
    const {
      pattern,
      path: searchPath = '.',
      include,
      exclude,
      case_sensitive = false,
      fixed_strings = false,
      context,
      after,
      before,
      no_ignore = false
    } = params;
    
    try {
      const ignorePatterns = no_ignore ? [] : ['node_modules/**', '.git/**', 'dist/**', 'build/**'];
      if (exclude) {
        ignorePatterns.push(exclude);
      }
      
      const absolutePath = path.resolve(searchPath);
      const files = await glob('**/*', {
        cwd: absolutePath,
        nodir: true,
        ignore: ignorePatterns
      });

      const results: string[] = [];
      
      for (const file of files) {
        const fullPath = path.join(absolutePath, file);
        if (include && !file.match(include)) {
          continue;
        }
        
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          
          lines.forEach((line, index) => {
            let matches = false;
            
            if (fixed_strings) {
              matches = case_sensitive 
                ? line.includes(pattern)
                : line.toLowerCase().includes(pattern.toLowerCase());
            } else {
              try {
                const flags = case_sensitive ? 'g' : 'gi';
                const regex = new RegExp(pattern, flags);
                matches = regex.test(line);
              } catch (e) {
                matches = case_sensitive 
                  ? line.includes(pattern)
                  : line.toLowerCase().includes(pattern.toLowerCase());
              }
            }
            
            if (matches) {
              const contextLines: string[] = [];
              
              if (before || context) {
                const beforeCount = before || context || 0;
                for (let i = Math.max(0, index - beforeCount); i < index; i++) {
                  contextLines.push(`${fullPath}:${i + 1}:${lines[i].trim()}`);
                }
              }
              
              contextLines.push(`${fullPath}:${index + 1}:${line.trim()}`);
              
              if (after || context) {
                const afterCount = after || context || 0;
                for (let i = index + 1; i < Math.min(lines.length, index + 1 + afterCount); i++) {
                  contextLines.push(`${fullPath}:${i + 1}:${lines[i].trim()}`);
                }
              }
              
              results.push(...contextLines);
            }
          });
        } catch (error) {
          continue;
        }
      }
      
      return results;
    } catch (error: any) {
      throw new Error(`Grep failed: ${error.message}`);
    }
  }
}

export class BashTool implements Tool {
  name = 'Bash';
  description = `Execute shell commands in the terminal. This is your PRIMARY tool for running commands, scripts, and system operations.

# When to Use
- Running build commands (npm run build, tsc, etc.)
- Installing dependencies (npm install, pip install, etc.)
- Running tests (npm test, pytest, etc.)
- Git operations (git commit, git push, etc.)
- Running linters or formatters
- Any command-line operations

# When NOT to Use
- For file operations (use Read/Write/Replace/CreateDirectory instead)
- For searching file content (use Grep instead)
- For finding files (use SearchCodebase or ListDirectory instead)
- For commands that require user interaction (non-interactive only)
- For dangerous commands without understanding the impact

# Parameters
- \`command\`: The shell command to execute
- \`cwd\`: (Optional) Working directory for the command
- \`description\`: (Optional) Description of what the command does
- \`timeout\`: (Optional) Timeout in seconds, default: 120
- \`run_in_bg\`: (Optional) Run in background, default: false

# Examples
- Install dependencies: Bash(command="npm install", description="Install npm dependencies")
- Run tests: Bash(command="npm test", description="Run unit tests")
- Build project: Bash(command="npm run build", description="Build the project")

# Best Practices
- Always provide a description for context
- Set appropriate timeout for long-running commands
- Use run_in_bg=true for commands that take a long time
- Check the command is safe before executing
- Use absolute paths or paths relative to project root`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

  async execute(params: {
    command: string;
    cwd?: string;
    description?: string;
    timeout?: number;
    run_in_bg?: boolean;
  }): Promise<{ stdout: string; stderr: string; exitCode: number; taskId?: string }> {
    const { command, cwd, description, timeout = 120, run_in_bg = false } = params;
    
    try {
      if (run_in_bg) {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const childProcess = spawn(command, {
          cwd: cwd || process.cwd(),
          shell: true,
          detached: true
        });
        
        const output: string[] = [];
        
        childProcess.stdout?.on('data', (data: Buffer) => {
          const text = data.toString();
          output.push(text);
        });
        
        childProcess.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          output.push(text);
        });
        
        childProcess.on('close', (code: number) => {
          console.log(`Background task ${taskId} exited with code ${code}`);
        });
        
        const toolRegistry = getToolRegistry();
        (toolRegistry as any).addBackgroundTask(taskId, {
          process: childProcess,
          startTime: Date.now(),
          output
        });
        
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          taskId
        };
      } else {
        const { stdout, stderr } = await execAsync(command, {
          cwd: cwd || process.cwd(),
          maxBuffer: 1024 * 1024 * 10,
          timeout: timeout * 1000
        });

        return {
          stdout,
          stderr,
          exitCode: 0
        };
      }
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1
      };
    }
  }
}

export class ListDirectoryTool implements Tool {
  name = 'ListDirectory';
  description = `List files and directories in a path. This is your PRIMARY tool for exploring project structure.

# When to Use
- Exploring project structure and organization
- Finding what files exist in a directory
- Getting an overview of the codebase layout
- When user asks to "list files" or "show directory contents"
- Navigating through project directories

# When NOT to Use
- When you need to read file contents (use Read instead)
- For recursive exploration of entire codebase (use recursive=true)
- When you need to search for specific files (use SearchCodebase instead)

# Parameters
- \`path\`: (Optional) Directory path, default: "."
- \`recursive\`: (Optional) List recursively, default: false

# Examples
- List current directory: ListDirectory(path=".")
- List src directory: ListDirectory(path="src")
- List all files recursively: ListDirectory(path=".", recursive=true)

# Best Practices
- Use recursive=true to see entire subtree
- Results are absolute paths
- Ignores node_modules and .git by default
- Combine with Read to examine file contents`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: { path?: string; recursive?: boolean }): Promise<string[]> {
    const { path: dirPath = '.', recursive = false } = params;
    
    try {
      const absolutePath = path.resolve(dirPath);
      
      const stats = await fs.stat(absolutePath).catch(() => null);
      if (!stats || !stats.isDirectory()) {
        throw new Error(`Directory does not exist: ${dirPath}`);
      }
      
      const pattern = recursive ? '**/*' : '*';
      const files = await glob(pattern, {
        cwd: absolutePath,
        nodir: false,
        ignore: ['node_modules/**', '.git/**']
      });

      return files.map(file => path.join(absolutePath, file));
    } catch (error: any) {
      throw new Error(`Failed to list directory: ${error.message}`);
    }
  }
}

export class SearchCodebaseTool implements Tool {
  name = 'SearchCodebase';
  description = `Search for files matching a glob pattern. This is your PRIMARY tool for finding files by name or extension.

# When to Use
- Finding all files of a certain type (*.ts, *.json, *.md)
- Locating files in specific directories or subdirectories
- Finding configuration files, test files, or source files
- When you need a list of file paths, not content

# When NOT to Use
- When you need to search file contents (use Grep instead)
- When you need to find specific text within files (use Grep instead)
- For searching non-file patterns (use Grep or Bash)

# Parameters
- \`pattern\`: Glob pattern (e.g., "**/*.ts", "src/**/*.test.ts")
- \`path\`: (Optional) Directory to search in, default: "."

# Examples
- Find all TypeScript files: SearchCodebase(pattern="**/*.ts")
- Find test files: SearchCodebase(pattern="**/*.test.ts")
- Find config files: SearchCodebase(pattern="**/config.*")

# Glob Patterns
- \`*\` matches any characters except /
- \`**\` matches any characters including /
- \`?\` matches single character
- Use brackets for character classes: [abc]

# Best Practices
- Use **/*.ts for recursive search in all directories
- Combine with path parameter to search specific directories
- Results are file paths, not content (use Grep on results if needed)`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: { pattern: string; path?: string }): Promise<string[]> {
    const { pattern, path: searchPath = '.' } = params;
    
    try {
      const files = await glob(pattern, {
        cwd: searchPath,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**']
      });

      return files;
    } catch (error: any) {
      throw new Error(`Search failed: ${error.message}`);
    }
  }
}

export class DeleteFileTool implements Tool {
  name = 'DeleteFile';
  description = `Delete a file from the filesystem.

# When to Use
- Removing temporary or debug files
- Cleaning up generated files
- Removing files as part of a refactoring task
- When user explicitly requests file deletion

# When NOT to Use
- For removing directories (use Bash with rm -rf instead)
- When uncertain if a file should be deleted (confirm with user first)
- For removing important source files without explicit user request

# Parameters
- \`filePath\`: Absolute path to the file to delete

# Examples
- Delete temporary file: DeleteFile(filePath="debug.log")
- Remove unused file: DeleteFile(filePath="src/old-component.tsx")

# Best Practices
- Ensure you have the correct file path
- Consider if the file might be needed later
- This action is irreversible - be certain before executing`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

  async execute(params: { filePath: string }): Promise<{ success: boolean; message: string }> {
    const { filePath } = params;
    
    try {
      const absolutePath = path.resolve(filePath);
      await fs.unlink(absolutePath);
      
      return {
        success: true,
        message: `Successfully deleted ${filePath}`
      };
    } catch (error: any) {
      throw new Error(`Failed to delete file ${filePath}: ${error.message}`);
    }
  }
}

export class CreateDirectoryTool implements Tool {
  name = 'CreateDirectory';
  description = `Create a new directory (folder) in the filesystem.

# When to Use
- Creating project structure (src/components, tests/unit, etc.)
- Setting up directories for new features or modules
- Organizing files into appropriate folders
- When user requests to create a folder structure

# When NOT to Use
- For creating parent directories while writing files (Write tool does this automatically)
- For creating multiple nested directories at once (create step by step or use Bash)

# Parameters
- \`dirPath\`: Path of the directory to create
- \`recursive\`: (Optional, default: true) Create parent directories if they don't exist

# Examples
- Create single directory: CreateDirectory(dirPath="src/utils")
- Create nested structure: CreateDirectory(dirPath="src/components/buttons", recursive=true)

# Best Practices
- recursive=true (default) creates all intermediate parent directories
- Use appropriate naming conventions (kebab-case for directories)
- Consider the overall project structure before creating`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

  async execute(params: { dirPath: string; recursive?: boolean }): Promise<{ success: boolean; message: string }> {
    const { dirPath, recursive = true } = params;
    
    try {
      const absolutePath = path.resolve(dirPath);
      await fs.mkdir(absolutePath, { recursive });
      
      return {
        success: true,
        message: `Successfully created directory ${dirPath}`
      };
    } catch (error: any) {
      throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
    }
  }
}

export class ReplaceTool implements Tool {
  name = 'replace';
  description = `Replace specific text within an existing file. This is your PRIMARY tool for making targeted edits to code.

# When to Use
- Modifying specific code sections without rewriting entire files
- Changing function implementations, variable values, or configurations
- Fixing bugs by editing specific lines
- Updating imports, exports, or references

# When NOT to Use
- When you need to create a completely new file (use Write instead)
- When you want to append content to a file (read first, then Write)
- When making changes across multiple files (use Grep to find, then Replace individually)

# Parameters
- \`file_path\`: Path to the file to edit
- \`instruction\`: Description of what to change (for your own tracking)
- \`old_string\`: The exact text to find and replace (must match exactly)
- \`new_string\`: The new text to replace with

# Critical Requirements
- \`old_string\` MUST be an EXACT match, including whitespace and indentation
- Include at least 3 lines of context before and after the target text
- Ensure unique matching to avoid unintended replacements

# Examples
replace(
  file_path="src/app.ts",
  instruction="Update API endpoint",
  old_string="const API_URL = 'https://api.old.com';",
  new_string="const API_URL = 'https://api.new.com';"
)

# Best Practices
- Read the file first to understand the exact content
- Include sufficient context in old_string to ensure unique match
- Be careful with special regex characters in old_string (they're escaped automatically)
- If multiple occurrences exist, all will be replaced`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

  async execute(params: {
    file_path: string;
    instruction: string;
    old_string: string;
    new_string: string;
  }): Promise<{ success: boolean; message: string; changes: number }> {
    const { file_path, instruction, old_string, new_string } = params;
    
    try {
      const absolutePath = path.resolve(file_path);
      const content = await fs.readFile(absolutePath, 'utf-8');
      
      const occurrences = (content.match(new RegExp(this.escapeRegExp(old_string), 'g')) || []).length;
      
      if (occurrences === 0) {
        return {
          success: false,
          message: `No occurrences found to replace in ${file_path}`,
          changes: 0
        };
      }
      
      const newContent = content.replace(new RegExp(this.escapeRegExp(old_string), 'g'), new_string);
      await fs.writeFile(absolutePath, newContent, 'utf-8');
      
      return {
        success: true,
        message: `Successfully replaced ${occurrences} occurrence(s) in ${file_path}`,
        changes: occurrences
      };
    } catch (error: any) {
      throw new Error(`Failed to replace in file ${file_path}: ${error.message}`);
    }
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export class WebSearchTool implements Tool {
  name = 'web_search';
  description = `Search the web for information. This tool queries a search API to find relevant results.

# When to Use
- When you need current information not in your training data
- Finding documentation, tutorials, or guides
- Researching APIs, libraries, or tools
- Getting up-to-date information on technical topics
- When user asks for "latest", "recent", or "current" information

# When NOT to Use
- When information is likely in the codebase or project files
- For information that doesn't change frequently (check docs first)
- When you can use web_fetch with a known URL instead
- For purely conversational queries

# Parameters
- \`query\`: Search query string

# Examples
- Find React documentation: web_search(query="React useEffect documentation")
- Get latest Node.js version: web_search(query="Node.js latest LTS version 2024")

# Best Practices
- Be specific in your query for better results
- Combine with web_fetch to get full content from relevant URLs
- Use quotes for exact phrase matching
- Consider adding context like year or version in query`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: { query: string }): Promise<{ results: any[]; message: string }> {
    const { query } = params;
    
    try {
      const configManager = await import('./config.js');
      const { getConfigManager } = configManager;
      const config = getConfigManager();
      
      const searchApiKey = config.get('searchApiKey');
      const baseUrl = config.get('baseUrl') || 'https://apis.xagent.cn/v1';
      
      if (!searchApiKey) {
        throw new Error('Search API key not configured. Please set searchApiKey in settings.');
      }
      
      const response = await axios.post(
        `${baseUrl}/search`,
        { query },
        {
          headers: {
            'Authorization': `Bearer ${searchApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      
      return {
        results: response.data.results || [],
        message: `Found ${response.data.results?.length || 0} results for "${query}"`
      };
    } catch (error: any) {
      throw new Error(`Web search failed: ${error.message}`);
    }
  }
}

export class TodoWriteTool implements Tool {
  name = 'todo_write';
  description = `Create and manage structured task todo lists. Use this tool VERY frequently to track your progress and give users visibility into what needs to be done.

# When to Use
- Complex, multi-step tasks (3+ steps)
- User explicitly requests a todo list
- User provides multiple tasks to accomplish
- Immediately when starting work on a new feature
- After completing a task (update status immediately)
- Breaking down large features into smaller steps
- Tracking independent subtasks that can be worked on

# When NOT to Use
- Single, straightforward task
- Trivial operations in less than 3 steps
- Purely conversational or informational responses
- When you already have an up-to-date todo list

# Task States
- **pending** - Not started, waiting to be worked on
- **in_progress** - Currently working on (limit ONE at a time)
- **completed** - Finished successfully
- **failed** - Could not complete due to errors

# Task Descriptions
Each task needs:
- \`id\`: Unique identifier
- \`task\`: Clear, actionable description in imperative form (e.g., "Run tests")
- \`status\`: Current state
- \`priority\`: high/medium/low

# Examples
\`\`\`json
{
  "todos": [
    { "id": "1", "task": "Run the build and check for errors", "status": "in_progress", "priority": "high" },
    { "id": "2", "task": "Fix any type errors found", "status": "pending", "priority": "high" },
    { "id": "3", "task": "Write unit tests for new feature", "status": "pending", "priority": "medium" }
  ]
}
\`\`\`

# Best Practices
- Mark tasks as completed IMMEDIATELY after finishing
- Don't batch multiple completions - update as you go
- Keep task descriptions clear and actionable
- Use appropriate priority levels to indicate urgency`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  private todoList: Array<{ id: string; task: string; status: 'pending' | 'in_progress' | 'completed' | 'failed'; priority: 'high' | 'medium' | 'low' }> = [];

  async execute(params: {
    todos: Array<{ id: string; task: string; status: 'pending' | 'in_progress' | 'completed' | 'failed'; priority: 'high' | 'medium' | 'low' }>;
  }): Promise<{ success: boolean; message: string; todos: any[] }> {
    const { todos } = params;
    
    try {
      this.todoList = todos;
      
      const summary = {
        pending: todos.filter(t => t.status === 'pending').length,
        in_progress: todos.filter(t => t.status === 'in_progress').length,
        completed: todos.filter(t => t.status === 'completed').length,
        failed: todos.filter(t => t.status === 'failed').length
      };
      
      return {
        success: true,
        message: `Updated todo list: ${summary.pending} pending, ${summary.in_progress} in progress, ${summary.completed} completed, ${summary.failed} failed`,
        todos: this.todoList
      };
    } catch (error: any) {
      throw new Error(`Failed to update todo list: ${error.message}`);
    }
  }

  getTodos(): any[] {
    return this.todoList;
  }
}

export class TodoReadTool implements Tool {
  name = 'todo_read';
  description = `Read the current session's todo list and get a summary of all tasks. Use this to check what tasks remain and their current status.

# When to Use
- Before starting work to understand what needs to be done
- After completing a task to verify the todo list is updated
- When user asks about progress or remaining tasks
- To get an overview of task distribution (pending, in_progress, completed)

# What It Returns
- Full list of all todos with their IDs, tasks, statuses, and priorities
- Summary counts: total, pending, in_progress, completed, failed

# Examples
- User asks: "What are we working on right now?" → Use todo_read to show current state
- After a task completes → Check todo_read to confirm the list is accurate

# Best Practices
- Use todo_write to modify the list, not todo_read
- Check todo_read after todo_write to verify updates`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  private todoWriteTool: TodoWriteTool;

  constructor(todoWriteTool: TodoWriteTool) {
    this.todoWriteTool = todoWriteTool;
  }

  async execute(): Promise<{ todos: any[]; summary: any }> {
    try {
      const todos = this.todoWriteTool.getTodos();
      
      const summary = {
        total: todos.length,
        pending: todos.filter(t => t.status === 'pending').length,
        in_progress: todos.filter(t => t.status === 'in_progress').length,
        completed: todos.filter(t => t.status === 'completed').length,
        failed: todos.filter(t => t.status === 'failed').length
      };
      
      return {
        todos,
        summary
      };
    } catch (error: any) {
      throw new Error(`Failed to read todo list: ${error.message}`);
    }
  }
}

export interface SubAgentTask {
  description: string;
  prompt: string;
  subagent_type: 'general-purpose' | 'plan-agent' | 'explore-agent' | 'frontend-tester' | 'code-reviewer' | 'frontend-developer' | 'backend-developer' | 'gui-subagent';
  useContext?: boolean;
  outputFormat?: string;
  constraints?: string[];
}

export interface ToolCallOptions {
  indentLevel?: number;
  agentName?: string;
}

export class TaskTool implements Tool {
  name = 'task';
  description = `Launch specialized AI subagents to handle complex, multi-step tasks. Subagents are expert agents designed for specific domains like planning, code exploration, frontend testing, and more.

# When to Use
- Complex tasks requiring specialized expertise (planning, analysis, testing)
- Multi-step workflows that benefit from dedicated focus
- When you need to delegate work to avoid context overload
- Parallel execution of independent tasks across different domains
- User explicitly requests a specific type of agent (e.g., "use the frontend tester")

# Available SubAgents
1. **plan-agent** - Task planning and breakdown, risk analysis, implementation roadmaps
2. **explore-agent** - Codebase exploration, architecture analysis, finding specific code
3. **frontend-tester** - Writing and running frontend tests, UI validation
4. **code-reviewer** - Code review, security checks, bug detection
5. **frontend-developer** - Frontend development (React, TypeScript, modern web)
6. **backend-developer** - Backend development (Node.js, APIs, databases)
7. **gui-subagent** - Browser automation, visual web interactions, desktop application automation

# When NOT to Use
- Simple, straightforward tasks you can handle directly
- Tasks that don't require specialized expertise
- Single-step operations (use other tools instead)

# Examples
- "Analyze the authentication module and create a security report" → explore-agent
- "Create a detailed implementation plan for feature X" → plan-agent
- "Write unit tests for this React component" → frontend-tester
- "Review my changes for potential bugs" → code-reviewer
- "Automatically fill out this form and navigate the website" → gui-subagent
- "Test the login process on the desktop application" → gui-subagent
- "send a message to the my mom on the desktop application wechat" → gui-subagent

# Best Practices
- Provide clear, specific prompts to subagents
- Include relevant context (file paths, requirements, constraints)
- Set appropriate executionMode if needed
- For parallel execution, ensure tasks are truly independent`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: {
    description: string;
    prompt?: string;
    subagent_type?: 'general-purpose' | 'plan-agent' | 'explore-agent' | 'frontend-tester' | 'code-reviewer' | 'frontend-developer' | 'backend-developer' | 'gui-subagent';
    agents?: SubAgentTask[];
    useContext?: boolean;
    outputFormat?: string;
    constraints?: string[];
    executionMode?: ExecutionMode;
    parallel?: boolean;
  }, _executionMode?: ExecutionMode): Promise<{ success: boolean; message: string; result?: any }> {
    const mode = params.executionMode || _executionMode || ExecutionMode.YOLO;
    
    try {
      const { getAgentManager } = await import('./agents.js');
      const agentManager = getAgentManager(process.cwd());
      
      const { getConfigManager } = await import('./config.js');
      const config = getConfigManager();
      
      const { AIClient } = await import('./ai-client.js');
      const aiClient = new AIClient({
        type: AuthType.API_KEY,
        apiKey: config.get('apiKey'),
        baseUrl: config.get('baseUrl'),
        modelName: config.get('modelName') || 'Qwen3-Coder'
      });
      
      const toolRegistry = getToolRegistry();
      
      if (params.agents && params.agents.length > 0) {
        return await this.executeParallelAgents(
          params.agents,
          params.description,
          mode,
          agentManager,
          toolRegistry,
          aiClient
        );
      }
      
      if (!params.subagent_type || !params.prompt) {
        throw new Error('Either subagent_type and prompt, or agents array must be provided');
      }
      
      const result = await this.executeSingleAgent(
        params.subagent_type,
        params.prompt,
        params.description,
        params.useContext ?? true,
        params.constraints || [],
        mode,
        agentManager,
        toolRegistry,
        aiClient,
        config
      );
      
      return result;
    } catch (error: any) {
      throw new Error(`Task execution failed: ${error.message}`);
    }
  }

  /**
   * Execute GUI subagent by directly calling GUIAgent.run()
   * This bypasses the normal subagent message loop for better GUI control
   */
  private async executeGUIAgent(
    prompt: string,
    description: string,
    agent: any,
    mode: ExecutionMode,
    config: any,
    indentLevel: number = 1
  ): Promise<{ success: boolean; message: string; result?: any }> {
    const indent = '  '.repeat(indentLevel);
    const cancellationManager = getCancellationManager();
    const logger = getLogger();

    console.log(`${indent}${colors.primaryBright(`${icons.robot} GUI Agent`)}: ${description}`);
    console.log(`${indent}${colors.border(icons.separator.repeat(Math.min(60, process.stdout.columns || 80) - indent.length))}`);
    console.log('');

    // Get model config for GUI agent
    // Priority: guiSubagentBaseUrl (test first) -> baseUrl (fallback)
    // When falling back to baseUrl, also use the corresponding modelName and apiKey
    const primaryBaseUrl = config.get('guiSubagentBaseUrl') || '';
    const fallbackBaseUrl = config.get('baseUrl') || '';
    const primaryApiKey = config.get('guiSubagentApiKey') || '';
    const fallbackApiKey = config.get('apiKey') || '';
    const primaryModelName = config.get('guiSubagentModel') || '';
    const fallbackModelName = config.get('modelName') || '';

    let baseUrl = primaryBaseUrl;
    let modelName = primaryModelName;
    let apiKey = primaryApiKey;

    // Test API availability (like curl) and choose the right baseUrl
    if (primaryBaseUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${primaryBaseUrl.replace(/\/v1\/?$/, '')}/models`, {
          method: 'GET',
          headers: primaryApiKey ? { 'Authorization': `Bearer ${primaryApiKey}` } : {},
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          // Fallback to baseUrl with its corresponding model and API key
          baseUrl = fallbackBaseUrl;
          modelName = fallbackModelName;
          apiKey = fallbackApiKey;
        }
      } catch {
        // Fallback to baseUrl with its corresponding model and API key
        baseUrl = fallbackBaseUrl;
        modelName = fallbackModelName;
        apiKey = fallbackApiKey;
      }
    } else {
      baseUrl = fallbackBaseUrl;
      modelName = fallbackModelName;
      apiKey = fallbackApiKey;
    }

    if (!baseUrl) {
      return {
        success: false,
        message: `GUI task "${description}" failed: No valid API URL configured`
      };
    }

    // Set up stdin polling for ESC cancellation
    let rawModeEnabled = false;
    let stdinPollingInterval: NodeJS.Timeout | null = null;

    const setupStdinPolling = () => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
          rawModeEnabled = true;
          process.stdin.resume();
          readline.emitKeypressEvents(process.stdin);
        } catch (e) {
          logger.debug(`[GUIAgent] Could not set raw mode: ${e}`);
        }

        stdinPollingInterval = setInterval(() => {
          try {
            if (rawModeEnabled) {
              const chunk = process.stdin.read(1);
              if (chunk && chunk.length > 0) {
                const code = chunk[0];
                if (code === 0x1B) { // ESC
                  logger.debug('[GUIAgent] ESC detected!');
                  cancellationManager.cancel();
                }
              }
            }
          } catch (e) {
            // Ignore polling errors
          }
        }, 10);
      }
    };

    const cleanupStdinPolling = () => {
      if (stdinPollingInterval) {
        clearInterval(stdinPollingInterval);
        stdinPollingInterval = null;
      }
    };

    // Set up cancellation
    let cancelled = false;
    const cancelHandler = () => {
      cancelled = true;
    };
    cancellationManager.on('cancelled', cancelHandler);

    // Start polling for ESC
    setupStdinPolling();

    try {
      // Import and create GUIAgent
      const { createGUISubAgent } = await import('./gui-subagent/index.js');

      const guiAgent = await createGUISubAgent({
        model: modelName,
        modelBaseUrl: baseUrl || undefined,
        modelApiKey: apiKey || undefined,
        maxLoopCount: 25,
        loopIntervalInMs: 500,
        showAIDebugInfo: config.get('showAIDebugInfo') || false,
      });

      // Add constraints to prompt if any
      const fullPrompt = prompt;

      // Execute GUI task - this will run autonomously until completion
      const result = await guiAgent.run(fullPrompt);

      // Cleanup
      await guiAgent.cleanup();

      // Check cancellation
      if (cancelled || cancellationManager.isOperationCancelled()) {
        cleanupStdinPolling();
        cancellationManager.off('cancelled', cancelHandler);
        return {
          success: true,
          message: `GUI task "${description}" cancelled by user`,
          result: 'Task cancelled'
        };
      }

      cleanupStdinPolling();
      cancellationManager.off('cancelled', cancelHandler);

      // Return result based on GUIAgent status
      if (result.status === 'end') {
        const iterations = result.conversations.filter(c => c.from === 'human' && c.screenshotBase64).length;
        console.log(`${indent}${colors.success(`${icons.check} GUI task completed in ${iterations} iterations`)}`);
        return {
          success: true,
          message: `GUI task "${description}" completed`,
          result: `Completed in ${iterations} iterations`
        };
      } else if (result.status === 'user_stopped') {
        return {
          success: true,
          message: `GUI task "${description}" stopped by user`,
          result: 'User stopped'
        };
      } else {
        return {
          success: false,
          message: `GUI task "${description}" failed: ${result.status} - ${result.error || 'Unknown error'}`
        };
      }
    } catch (error: any) {
      cleanupStdinPolling();
      cancellationManager.off('cancelled', cancelHandler);

      if (error.message === 'Operation cancelled by user') {
        return {
          success: true,
          message: `GUI task "${description}" cancelled by user`,
          result: 'Task cancelled'
        };
      }

      // Return failure without throwing - let the main agent handle it
      return {
        success: false,
        message: `GUI task "${description}" failed: ${error.message}`
      };
    }
  }

  private async executeSingleAgent(
    subagent_type: string,
    prompt: string,
    description: string,
    useContext: boolean,
    constraints: string[],
    mode: ExecutionMode,
    agentManager: any,
    toolRegistry: any,
    aiClient: any,
    config: any,
    indentLevel: number = 1
  ): Promise<{ success: boolean; message: string; result?: any }> {
    const agent = agentManager.getAgent(subagent_type);

    if (!agent) {
      throw new Error(`Agent ${subagent_type} not found`);
    }

    // Special handling for gui-subagent: directly call GUIAgent.run() instead of subagent message loop
    if (subagent_type === 'gui-subagent') {
      return this.executeGUIAgent(
        prompt,
        description,
        agent,
        mode,
        config,
        indentLevel
      );
    }

    // Determine the model to use for this subagent
    let modelName = config.get('modelName') || 'Qwen3-Coder';
    let baseUrl = config.get('baseUrl') || 'https://apis.xagent.cn/v1';
    let apiKey = config.get('apiKey') || '';
    
    if (agent.model) {
      // If agent has a model field, it can be a model name or a config reference like 'guiSubagentModel'
      if (typeof agent.model === 'string' && agent.model.endsWith('Model')) {
        // It's a config reference, use corresponding config values
        modelName = config.get(agent.model) || modelName;
        const baseUrlKey = agent.model.replace('Model', 'BaseUrl');
        const apiKeyKey = agent.model.replace('Model', 'ApiKey');
        if (config.get(baseUrlKey)) {
          baseUrl = config.get(baseUrlKey);
        }
        if (config.get(apiKeyKey)) {
          apiKey = config.get(apiKeyKey);
        }
      } else if (typeof agent.model === 'string') {
        // It's an explicit model name
        modelName = agent.model;
      }
    }

    // Create a new AIClient for this subagent with its specific model
    const { AIClient: SubAgentAIClient } = await import('./ai-client.js');
    const subAgentClient = new SubAgentAIClient({
      type: AuthType.API_KEY,
      apiKey: apiKey,
      baseUrl: baseUrl,
      modelName: modelName,
      showAIDebugInfo: config.get('showAIDebugInfo') || false
    });
    
    const indent = '  '.repeat(indentLevel);
    const indentNext = '  '.repeat(indentLevel + 1);
    const agentName = agent.name || subagent_type;
    const cancellationManager = getCancellationManager();
    const logger = getLogger();
    let cancelled = false;

    // Set up raw mode and stdin polling for ESC detection
    let rawModeEnabled = false;
    let stdinPollingInterval: NodeJS.Timeout | null = null;

    const setupStdinPolling = () => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
          rawModeEnabled = true;
          process.stdin.resume();
          readline.emitKeypressEvents(process.stdin);
        } catch (e) {
          logger.debug(`[TaskTool] Could not set raw mode: ${e}`);
        }

        // Start polling for ESC key (10ms interval for faster response)
        stdinPollingInterval = setInterval(() => {
          try {
            if (rawModeEnabled) {
              const chunk = process.stdin.read(1);
              if (chunk && chunk.length > 0) {
                const code = chunk[0];
                if (code === 0x1B) { // ESC
                  logger.debug('[TaskTool] ESC detected via polling!');
                  cancellationManager.cancel();
                }
              }
            }
          } catch (e) {
            // Ignore polling errors
          }
        }, 10);
      }
    };

    const cleanupStdinPolling = () => {
      if (stdinPollingInterval) {
        clearInterval(stdinPollingInterval);
        stdinPollingInterval = null;
      }
    };

    // Start polling for ESC
    setupStdinPolling();

    // Listen for cancellation
    const cancelHandler = () => {
      cancelled = true;
    };
    cancellationManager.on('cancelled', cancelHandler);

    // Helper function to indent multi-line content
    const indentMultiline = (content: string, baseIndent: string): string => {
      return content.split('\n').map(line => `${baseIndent}  ${line}`).join('\n');
    };

    // Check if operation is cancelled
    const checkCancellation = () => {
      if (cancelled || cancellationManager.isOperationCancelled()) {
        cancellationManager.off('cancelled', cancelHandler);
        cleanupStdinPolling();
        throw new Error('Operation cancelled by user');
      }
    };
    
    const systemPromptGenerator = new SystemPromptGenerator(toolRegistry, mode, agent);
    const enhancedSystemPrompt = systemPromptGenerator.generateEnhancedSystemPrompt(agent.systemPrompt);
    
    const fullPrompt = constraints.length > 0
      ? `${prompt}\n\nConstraints:\n${constraints.map(c => `- ${c}`).join('\n')}`
      : prompt;
    
    let messages: Message[] = [
      { role: 'system', content: enhancedSystemPrompt },
      { role: 'user', content: fullPrompt }
    ];
    
    const availableTools = agentManager.getAvailableToolsForAgent(agent, mode);
    const allToolDefinitions = toolRegistry.getToolDefinitions();
    
    const toolDefinitions: ToolDefinition[] = availableTools.map((toolName: string) => {
      const fullDef = allToolDefinitions.find((def: any) => def.function.name === toolName);
      if (fullDef) {
        return fullDef;
      }
      return {
        type: 'function' as const,
        function: {
          name: toolName,
          description: `Tool: ${toolName}`,
          parameters: { type: 'object', properties: {}, required: [] }
        }
      };
    });

    let iteration = 0;
    const maxIterations = 10;

    while (iteration < maxIterations) {
      iteration++;
      
      // Check for cancellation before each iteration
      checkCancellation();
      
      // Use withCancellation to make API call cancellable
      const result = await cancellationManager.withCancellation(
        subAgentClient.chatCompletion(messages, {
          tools: toolDefinitions,
          temperature: 0.7
        }),
        `api-${subagent_type}-${iteration}`
      ) as any;

      // Check for cancellation after API call
      checkCancellation();

      if (!result || !result.choices || result.choices.length === 0) {
        throw new Error(`Sub-agent ${subagent_type} returned empty response`);
      }

      const choice = result.choices[0];
      const messageContent = choice.message?.content;
      const toolCalls = choice.message.tool_calls;

      let contentStr: string;
      let hasValidContent = false;

      if (typeof messageContent === 'string') {
        contentStr = messageContent;
        hasValidContent = messageContent.trim() !== '';
      } else if (Array.isArray(messageContent)) {
        const textParts = messageContent
          .filter(item => typeof item?.text === 'string' && item.text.trim() !== '')
          .map(item => item.text);
        contentStr = textParts.join('');
        hasValidContent = textParts.length > 0;
      } else {
        contentStr = '';
        hasValidContent = false;
      }

      // Only throw empty content error if there's no text content AND no tool calls
      // When AI model returns tool_calls, message.content can be null/empty, which is valid
      if (!hasValidContent && (!toolCalls || toolCalls.length === 0)) {
        throw new Error(`Sub-agent ${subagent_type} returned empty content`);
      }

      if (choice.finish_reason === 'length') {
        throw new Error(`Sub-agent ${subagent_type} response truncated due to length limits`);
      }

      // Add assistant message to conversation
      messages.push({ role: 'assistant', content: contentStr });

      // Display assistant response (if there's any text content) with proper indentation
      if (contentStr) {
        console.log(`\n${indent}${colors.primaryBright(agentName)}: ${description}`);
        const truncatedContent = contentStr.length > 500 ? contentStr.substring(0, 500) + '...' : contentStr;
        const indentedContent = indentMultiline(truncatedContent, indent);
        console.log(`${indentedContent}\n`);
      }

      // Process tool calls with proper indentation
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          const { name, arguments: params } = toolCall.function;

          let parsedParams: any;
          try {
            parsedParams = typeof params === 'string' ? JSON.parse(params) : params;
          } catch (e) {
            parsedParams = params;
          }

          console.log(`${indent}${colors.textMuted(`${icons.loading} Tool: ${name}`)}`);

          try {
            // Check cancellation before tool execution
            checkCancellation();
            
            const toolResult = await cancellationManager.withCancellation(
              toolRegistry.execute(name, parsedParams, mode, indent),
              `subagent-${subagent_type}-${name}-${iteration}`
            );

            // Display tool result with proper indentation for multi-line content
            const resultPreview = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2);
            const truncatedPreview = resultPreview.length > 200 ? resultPreview.substring(0, 200) + '...' : resultPreview;
            const indentedPreview = indentMultiline(truncatedPreview, indent);
            console.log(`${indent}${colors.success(`${icons.check} Completed`)}\n${indentedPreview}\n`);

            messages.push({
              role: 'tool',
              content: JSON.stringify(toolResult),
              tool_call_id: toolCall.id
            });
          } catch (error: any) {
            if (error.message === 'Operation cancelled by user') {
              console.log(`${indent}${colors.warning(`⚠️  Operation cancelled`)}\n`);
              cancellationManager.off('cancelled', cancelHandler);
              cleanupStdinPolling();
              return {
                success: false,
                message: `Task "${description}" cancelled by user`,
                result: contentStr
              };
            }
            console.log(`${indent}${colors.error(`${icons.cross} Error:`)} ${error.message}\n`);

            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: error.message }),
              tool_call_id: toolCall.id
            });
          }
        }
        console.log('');
        continue; // Continue to next iteration to get final response
      }

      // No more tool calls, return the result
      cancellationManager.off('cancelled', cancelHandler);
      cleanupStdinPolling();
      return {
        success: true,
        message: `Task "${description}" completed by ${subagent_type}`,
        result: contentStr
      };
    }

    // Max iterations reached - return accumulated results instead of throwing error
    cancellationManager.off('cancelled', cancelHandler);
    cleanupStdinPolling();
    // Get the last assistant message content
    const lastAssistantMsg = messages.filter(m => m.role === 'assistant').pop();
    const lastContent = lastAssistantMsg?.content || '';

    return {
      success: true,
      message: `Task "${description}" completed (max iterations reached) by ${subagent_type}`,
      result: lastContent
    };
  }
  
  private async executeParallelAgents(
    agents: SubAgentTask[],
    description: string,
    mode: ExecutionMode,
    agentManager: any,
    toolRegistry: any,
    aiClient: any,
    indentLevel: number = 1
  ): Promise<{ success: boolean; message: string; results: any[]; errors: any[] }> {
    const indent = '  '.repeat(indentLevel);
    const indentNext = '  '.repeat(indentLevel + 1);
    const cancellationManager = getCancellationManager();
    const logger = getLogger();

    // Set up raw mode and stdin polling for ESC detection
    let rawModeEnabled = false;
    let stdinPollingInterval: NodeJS.Timeout | null = null;

    const setupStdinPolling = () => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
          rawModeEnabled = true;
          process.stdin.resume();
          readline.emitKeypressEvents(process.stdin);
        } catch (e) {
          logger.debug(`[ParallelAgents] Could not set raw mode: ${e}`);
        }

        stdinPollingInterval = setInterval(() => {
          try {
            if (rawModeEnabled) {
              const chunk = process.stdin.read(1);
              if (chunk && chunk.length > 0) {
                const code = chunk[0];
                if (code === 0x1B) { // ESC
                  logger.debug('[ParallelAgents] ESC detected via polling!');
                  cancellationManager.cancel();
                }
              }
            }
          } catch (e) {
            // Ignore polling errors
          }
        }, 10);
      }
    };

    const cleanupStdinPolling = () => {
      if (stdinPollingInterval) {
        clearInterval(stdinPollingInterval);
        stdinPollingInterval = null;
      }
    };

    // Start polling for ESC
    setupStdinPolling();

    // Listen for cancellation to stop parallel execution
    let cancelled = false;
    const cancelHandler = () => {
      cancelled = true;
    };
    cancellationManager.on('cancelled', cancelHandler);

    console.log(`\n${indent}${colors.accent('◆')} ${colors.primaryBright('Parallel Agents')}: ${agents.length} running...`);

    const startTime = Date.now();

    const agentPromises = agents.map(async (agentTask, index) => {
      // Check if cancelled
      if (cancelled || cancellationManager.isOperationCancelled()) {
        return {
          success: false,
          agent: agentTask.subagent_type,
          description: agentTask.description,
          error: 'Operation cancelled by user'
        };
      }

      try {
        const result = await this.executeSingleAgent(
          agentTask.subagent_type,
          agentTask.prompt,
          agentTask.description,
          agentTask.useContext ?? true,
          agentTask.constraints || [],
          mode,
          agentManager,
          toolRegistry,
          aiClient,
          indentLevel + 1
        );
        
        return {
          success: true,
          agent: agentTask.subagent_type,
          description: agentTask.description,
          result: result.result
        };
      } catch (error: any) {
        return {
          success: false,
          agent: agentTask.subagent_type,
          description: agentTask.description,
          error: error.message
        };
      }
    });
    
    const results = await Promise.all(agentPromises);
    
    const duration = Date.now() - startTime;
    
    const successfulAgents = results.filter(r => r.success);
    const failedAgents = results.filter(r => !r.success);
    
    console.log(`${indent}${colors.success('✔')} Parallel task completed in ${colors.textMuted(duration + 'ms')}`);
    console.log(`${indent}${colors.info('ℹ')} Success: ${successfulAgents.length}/${agents.length} agents\n`);

    if (failedAgents.length > 0) {
      console.log(`${indent}${colors.error('✖')} Failed agents:`);
      for (const failed of failedAgents) {
        console.log(`${indentNext}  ${colors.error('•')} ${failed.agent}: ${failed.error}`);
      }
      console.log('');
    }

    // Cleanup
    cancellationManager.off('cancelled', cancelHandler);
    cleanupStdinPolling();

    return {
      success: failedAgents.length === 0,
      message: `Parallel task "${description}" completed: ${successfulAgents.length}/${agents.length} successful`,
      results: successfulAgents.map(r => ({
        agent: r.agent,
        description: r.description,
        result: r.result
      })),
      errors: failedAgents.map(r => ({
        agent: r.agent,
        description: r.description,
        error: r.error
      }))
    };
  }
}

export class ReadBashOutputTool implements Tool {
  name = 'ReadBashOutput';
  description = `Retrieve output from a background task that was started with Bash(run_in_bg=true).

# When to Use
- Checking the output of a long-running background process
- Monitoring progress of builds, tests, or servers
- Retrieving logs from background tasks
- When you started a task with run_in_bg=true and need results

# When NOT to Use
- For synchronous commands (they return output directly)
- When the background task hasn't been started yet
- For tasks that have already completed (use Bash directly)

# Parameters
- \`task_id\`: The ID returned from the background Bash command
- \`poll_interval\`: (Optional) Seconds to wait before checking, default: 10

# Examples
- Check build output: ReadBashOutput(task_id="task_1234567890")
- Wait and check: ReadBashOutput(task_id="task_123", poll_interval=5)

# Best Practices
- Save the task_id from Bash response for later use
- Use appropriate poll_interval based on expected task duration
- Check status to see if task is still running or completed
- Combine with todo_write to track background task progress`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: {
    task_id: string;
    poll_interval?: number;
  }): Promise<{ taskId: string; output: string; status: string; duration: number }> {
    const { task_id, poll_interval = 10 } = params;
    
    try {
      const toolRegistry = getToolRegistry();
      const task = (toolRegistry as any).getBackgroundTask(task_id);
      
      if (!task) {
        throw new Error(`Task ${task_id} not found`);
      }
      
      const interval = Math.min(Math.max(poll_interval, 1), 120);
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
      
      const duration = Date.now() - task.startTime;
      const output = task.output.join('');
      const status = task.process.exitCode === null ? 'running' : 'completed';
      
      return {
        taskId: task_id,
        output,
        status,
        duration: Math.floor(duration / 1000)
      };
    } catch (error: any) {
      throw new Error(`Failed to read bash output: ${error.message}`);
    }
  }
}

export class WebFetchTool implements Tool {
  name = 'web_fetch';
  description = `Fetch and extract content from a specific URL. This tool retrieves the full content of a webpage.

# When to Use
- When you have a specific URL and need its content
- Extracting documentation from web pages
- Fetching API documentation or guides
- Getting content from known URLs (not for searching)

# When NOT to Use
- When you need to search but don't have a specific URL (use web_search first)
- For pages requiring authentication or login
- For very large files or pages (may timeout)
- When the URL format is unknown (use web_search first)

# Parameters
- \`prompt\`: A prompt containing the URL to fetch (e.g., "Summarize https://example.com/docs")

# Examples
- Fetch documentation: web_fetch(prompt="Extract key points from https://react.dev/docs")
- Get API spec: web_fetch(prompt="Fetch the OpenAPI spec from https://api.example.com/openapi.json")

# Best Practices
- Ensure the URL is accessible and doesn't require authentication
- Use specific prompts to extract relevant information
- Check if the page is accessible if you get errors
- Large pages may be truncated due to size limits`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: { prompt: string }): Promise<{ content: string; url: string; status: number }> {
    const { prompt } = params;
    
    try {
      const urlMatch = prompt.match(/https?:\/\/[^\s]+/i);
      
      if (!urlMatch) {
        throw new Error('No URL found in prompt');
      }
      
      const url = urlMatch[0];
      
      const response = await axios.get(url, {
        timeout: 30000,
        maxContentLength: 10 * 1024 * 1024,
        validateStatus: () => true
      });
      
      let content = response.data;
      
      if (typeof content === 'object') {
        content = JSON.stringify(content, null, 2);
      }
      
      return {
        content,
        url,
        status: response.status
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch URL: ${error.message}`);
    }
  }
}

export class AskUserQuestionTool implements Tool {
  name = 'ask_user_question';
  description = `Ask the user questions during execution to gather input, preferences, or clarifications.

# When to Use
- When you need user input or preferences to proceed
- When a task has multiple options and user should choose
- When clarification is needed for ambiguous requests
- When user explicitly asks to be prompted

# When NOT to Use
- When you can make reasonable assumptions
- For simple confirmations (just proceed with reasonable default)
- When the information is already available in context
- For information you should know or can infer

# Parameters
- \`questions\`: Array of questions with:
  - \`question\`: The question text
  - \`header\`: (Optional) Short label for the question
  - \`options\`: (Optional) Multiple choice options
  - \`multiSelect\`: (Optional) Allow multiple selections

# Examples
- Simple input: Ask user their preferred name
- Multiple choice: Ask which framework to use (React, Vue, Angular)
- Multi-select: Ask which features to include (with checkboxes)

# Best Practices
- Limit to 1-4 questions at a time
- Provide options when possible for faster response
- Use multiSelect=true when multiple answers are valid
- Be clear and concise in question wording`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: {
    questions: Array<{
      question: string;
      header?: string;
      options?: string[];
      multiSelect?: boolean;
    }>;
  }): Promise<{ answers: string[] }> {
    const { questions } = params;
    
    try {
      if (questions.length === 0 || questions.length > 4) {
        throw new Error('Must provide 1-4 questions');
      }
      
      const answers: string[] = [];
      
      for (const q of questions) {
        if (q.options && q.options.length > 0) {
          const result = await inquirer.prompt([
            {
              type: q.multiSelect ? 'checkbox' : 'list',
              name: 'answer',
              message: q.question,
              choices: q.options,
              default: q.multiSelect ? [] : q.options[0]
            }
          ]);
          
          answers.push(Array.isArray(result.answer) ? result.answer.join(', ') : result.answer);
        } else {
          const result = await inquirer.prompt([
            {
              type: 'input',
              name: 'answer',
              message: q.question
            }
          ]);
          
          answers.push(result.answer);
        }
      }
      
      return { answers };
    } catch (error: any) {
      throw new Error(`Failed to ask user questions: ${error.message}`);
    }
  }
}

export class SaveMemoryTool implements Tool {
  name = 'save_memory';
  description = `Save specific information to long-term memory for future sessions. Useful for remembering user preferences, project conventions, or important facts.

# When to Use
- User explicitly asks to "remember" something
- User provides preferences or configuration details
- Important project conventions or patterns to remember
- Information that should persist across sessions

# When NOT to Use
- For temporary information only needed in current session
- For information already in project files or configuration
- For obvious or trivial facts
- When user doesn't explicitly want information saved

# Parameters
- \`fact\`: The specific fact or information to remember

# Examples
- Remember user preference: save_memory(fact="User prefers TypeScript over JavaScript")
- Remember project convention: save_memory(fact="Project uses kebab-case for component files")
- Remember important context: save_memory(fact="API endpoint is https://api.example.com/v2")

# Best Practices
- Save only when user explicitly requests or provides clear preference
- Keep facts concise and specific
- Remember project-specific conventions for consistency
- This persists across sessions (global memory)`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: { fact: string }): Promise<{ success: boolean; message: string }> {
    const { fact } = params;
    
    try {
      const { getMemoryManager } = await import('./memory.js');
      const memoryManager = getMemoryManager(process.cwd());
      
      await memoryManager.saveMemory(fact, 'global');
      
      return {
        success: true,
        message: `Successfully saved fact to memory`
      };
    } catch (error: any) {
      throw new Error(`Failed to save memory: ${error.message}`);
    }
  }
}

export class ExitPlanModeTool implements Tool {
  name = 'exit_plan_mode';
  description = `Complete plan presentation in plan mode and transition to execution. This tool is used when you have finished planning and are ready to implement.

# When to Use
- When you have completed creating a plan or design document
- When the plan is ready for review and execution
- After presenting the full implementation plan to the user
- When ready to transition from planning to coding

# When NOT to Use
- When still in the middle of planning (continue planning first)
- When the plan needs revision based on feedback
- When user hasn't reviewed the plan yet
- In non-plan execution modes

# Parameters
- \`plan\`: The complete plan text to be saved and executed

# Examples
- Exit after creating implementation plan
- Present final design and exit to implementation

# Best Practices
- Ensure the plan is complete and comprehensive
- Include all necessary steps and considerations
- The plan will be saved for reference during execution
- Use this only when truly ready to start coding`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: { plan: string }): Promise<{ success: boolean; message: string; plan: string }> {
    const { plan } = params;
    
    try {
      return {
        success: true,
        message: 'Plan completed and ready for execution',
        plan
      };
    } catch (error: any) {
      throw new Error(`Failed to exit plan mode: ${error.message}`);
    }
  }
}

export class XmlEscapeTool implements Tool {
  name = 'xml_escape';
  description = `Automatically escape special characters in XML/HTML files to make them valid.

# When to Use
- When content contains special XML characters (<, >, &, ", ')
- When generating XML/HTML from raw content
- When fixing encoding issues in markup files

# When NOT to Use
- For files that should contain raw XML/HTML
- For JavaScript, CSS, or other non-XML files
- When escaping should be done manually

# Parameters
- \`file_path\`: Path to the file to escape
- \`escape_all\`: (Optional) Also escape additional entities (©, ®, €)

# Examples
- Escape XML content in HTML file
- Fix special characters in generated markup

# Best Practices
- Backup files before escaping if unsure
- escape_all=true adds common HTML entities`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

  async execute(params: {
    file_path: string;
    escape_all?: boolean;
  }): Promise<{ success: boolean; message: string; changes: number }> {
    const { file_path, escape_all = false } = params;
    
    try {
      const absolutePath = path.resolve(file_path);
      let content = await fs.readFile(absolutePath, 'utf-8');
      
      const specialChars = [
        { char: '&', replacement: '&amp;' },
        { char: '<', replacement: '&lt;' },
        { char: '>', replacement: '&gt;' },
        { char: '"', replacement: '&quot;' },
        { char: "'", replacement: '&apos;' }
      ];
      
      let changes = 0;
      
      for (const { char, replacement } of specialChars) {
        const regex = new RegExp(this.escapeRegExp(char), 'g');
        const matches = content.match(regex);
        if (matches) {
          changes += matches.length;
          content = content.replace(regex, replacement);
        }
      }
      
      if (escape_all) {
        const additionalChars = [
          { char: '©', replacement: '&copy;' },
          { char: '®', replacement: '&reg;' },
          { char: '€', replacement: '&euro;' }
        ];
        
        for (const { char, replacement } of additionalChars) {
          const regex = new RegExp(this.escapeRegExp(char), 'g');
          const matches = content.match(regex);
          if (matches) {
            changes += matches.length;
            content = content.replace(regex, replacement);
          }
        }
      }
      
      await fs.writeFile(absolutePath, content, 'utf-8');
      
      return {
        success: true,
        message: `Successfully escaped ${changes} character(s) in ${file_path}`,
        changes
      };
    } catch (error: any) {
      throw new Error(`Failed to escape XML/HTML in file ${file_path}: ${error.message}`);
    }
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export class ImageReadTool implements Tool {
  name = 'image_read';
  description = `Read image files and generate detailed analysis using a vision-language model.

# When to Use
- Analyzing UI designs or mockups
- Examining screenshots or diagrams
- Extracting information from images
- Validating visual content or assets

# When NOT to Use
- For text-based file analysis (use Read instead)
- When the image is not relevant to the task
- For very large images (may have size limits)

# Parameters
- \`image_input\`: Path to image or base64 data
- \`prompt\`: Instructions for what to analyze
- \`input_type\`: (Optional) 'file_path' or 'base64'
- \`task_brief\`: (Optional) Brief task description

# Examples
- Analyze UI mockup: image_read(image_input="design.png", prompt="Describe the UI components")
- Validate screenshot: image_read(image_input="screenshot.jpg", prompt="Check if login form is visible")

# Best Practices
- Provide clear prompts for what to look for
- Use task_brief for context
- Supports PNG, JPG, GIF, WEBP, SVG, BMP`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: {
    image_input: string;
    prompt: string;
    task_brief?: string;
    input_type?: 'file_path' | 'base64';
    mime_type?: string;
  }): Promise<{ analysis: string; image_info: any }> {
    const { image_input, prompt, task_brief, input_type = 'file_path', mime_type } = params;
    
    try {
      let imageData: string;
      
      if (input_type === 'file_path') {
        const absolutePath = path.resolve(image_input);
        const imageBuffer = await fs.readFile(absolutePath);
        imageData = imageBuffer.toString('base64');
      } else {
        imageData = image_input;
      }
      
      const { AIClient } = await import('./ai-client.js');
      const configManager = await import('./config.js');
      const { getConfigManager } = configManager;
      const config = getConfigManager();
      
      const aiClient = new AIClient({
        type: AuthType.API_KEY,
        apiKey: config.get('apiKey'),
        baseUrl: config.get('baseUrl'),
        modelName: config.get('modelName') || 'Qwen3-Coder'
      });
      
      const textContent = task_brief ? `${task_brief}\n\n${prompt}` : prompt;
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: textContent
            },
            {
              type: 'image_url' as const,
              image_url: {
                url: `data:${mime_type || 'image/jpeg'};base64,${imageData}`
              }
            }
          ]
        }
      ];
      
      const result = await aiClient.chatCompletion(messages, {
        temperature: 0.7
      });
      
      const messageContent = result.choices[0]?.message?.content;
      const analysis = typeof messageContent === 'string' ? messageContent : '';
      
      return {
        analysis,
        image_info: {
          input_type,
          prompt,
          task_brief
        }
      };
    } catch (error: any) {
      throw new Error(`Failed to read image: ${error.message}`);
    }
  }
}

export class SkillTool implements Tool {
  name = 'Skill';
  description = `Execute pre-defined workflows (skills) from the xAgent marketplace. Skills are reusable workflows that automate common tasks.

# When to Use
- When a skill exists for the requested task
- When you need to run a multi-step workflow
- When the task matches a marketplace workflow

# When NOT to Use
- When a simple tool can accomplish the task
- When creating new functionality from scratch
- When skill doesn't exist for the specific task

# Parameters
- \`skill\`: The skill/workflow name to execute

# Examples
- Execute a PDF processing skill
- Run a data analysis workflow

# Best Practices
- Skills are pre-configured workflows from the marketplace
- Check if a relevant skill exists first`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: { skill: string }): Promise<{ success: boolean; message: string; result?: any }> {
    const { skill } = params;

    try {
      const { getWorkflowManager } = await import('./workflow.js');
      const workflowManager = getWorkflowManager(process.cwd());

      const workflow = workflowManager.getWorkflow(skill);

      if (!workflow) {
        throw new Error(`Skill ${skill} not found`);
      }

      await workflowManager.executeWorkflow(skill, 'Execute skill');

      return {
        success: true,
        message: `Successfully executed skill: ${skill}`,
        result: workflow
      };
    } catch (error: any) {
      throw new Error(`Failed to execute skill: ${error.message}`);
    }
  }
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private todoWriteTool: TodoWriteTool;
  private backgroundTasks: Map<string, { process: any; startTime: number; output: string[] }> = new Map();

  constructor() {
    this.todoWriteTool = new TodoWriteTool();
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    this.register(new ReadTool());
    this.register(new WriteTool());
    this.register(new GrepTool());
    this.register(new BashTool());
    this.register(new ListDirectoryTool());
    this.register(new SearchCodebaseTool());
    this.register(new DeleteFileTool());
    this.register(new CreateDirectoryTool());
    this.register(new ReplaceTool());
    this.register(new WebSearchTool());
    this.register(this.todoWriteTool);
    this.register(new TodoReadTool(this.todoWriteTool));
    this.register(new TaskTool());
    this.register(new ReadBashOutputTool());
    this.register(new WebFetchTool());
    this.register(new AskUserQuestionTool());
    this.register(new SaveMemoryTool());
    this.register(new ExitPlanModeTool());
    this.register(new XmlEscapeTool());
    this.register(new ImageReadTool());
    this.register(new SkillTool());
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(toolName: string): void {
    this.tools.delete(toolName);
  }

  get(toolName: string): Tool | undefined {
    return this.tools.get(toolName);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  addBackgroundTask(taskId: string, task: { process: any; startTime: number; output: string[] }): void {
    this.backgroundTasks.set(taskId, task);
  }

  getBackgroundTask(taskId: string): { process: any; startTime: number; output: string[] } | undefined {
    return this.backgroundTasks.get(taskId);
  }

  removeBackgroundTask(taskId: string): void {
    this.backgroundTasks.delete(taskId);
  }

  getToolDefinitions(): any[] {
    return Array.from(this.tools.values()).map(tool => {
      let parameters: any = {
        type: 'object',
        properties: {},
        required: []
      };

      // Define specific parameters for each tool
      switch (tool.name) {
        case 'Read':
          parameters = {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The absolute path to the file to read'
              },
              offset: {
                type: 'number',
                description: 'Optional: Line number to start reading from (0-based)'
              },
              limit: {
                type: 'number',
                description: 'Optional: Maximum number of lines to read'
              }
            },
            required: ['filePath']
          };
          break;

        case 'Write':
          parameters = {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The absolute path to the file to write'
              },
              content: {
                type: 'string',
                description: 'The content to write to the file'
              }
            },
            required: ['filePath', 'content']
          };
          break;

        case 'Grep':
          parameters = {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'The regex pattern to search for'
              },
              path: {
                type: 'string',
                description: 'Optional: The path to search in (default: current directory)'
              },
              include: {
                type: 'string',
                description: 'Optional: Glob pattern to filter files'
              },
              case_sensitive: {
                type: 'boolean',
                description: 'Optional: Case-sensitive search (default: false)'
              },
              context: {
                type: 'number',
                description: 'Optional: Number of context lines to show'
              }
            },
            required: ['pattern']
          };
          break;

        case 'Bash':
          parameters = {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The shell command to execute'
              },
              cwd: {
                type: 'string',
                description: 'Optional: Working directory'
              },
              description: {
                type: 'string',
                description: 'Optional: Brief description of the command'
              },
              timeout: {
                type: 'number',
                description: 'Optional: Timeout in seconds (default: 120)'
              },
              run_in_bg: {
                type: 'boolean',
                description: 'Optional: Run in background (default: false)'
              }
            },
            required: ['command']
          };
          break;

        case 'ListDirectory':
          parameters = {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Optional: The directory path to list (default: current directory)'
              },
              recursive: {
                type: 'boolean',
                description: 'Optional: List recursively (default: false)'
              }
            },
            required: []
          };
          break;

        case 'SearchCodebase':
          parameters = {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'The glob pattern to match files'
              },
              path: {
                type: 'string',
                description: 'Optional: The path to search in (default: current directory)'
              }
            },
            required: ['pattern']
          };
          break;

        case 'DeleteFile':
          parameters = {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The path to the file to delete'
              }
            },
            required: ['filePath']
          };
          break;

        case 'CreateDirectory':
          parameters = {
            type: 'object',
            properties: {
              dirPath: {
                type: 'string',
                description: 'The directory path to create'
              },
              recursive: {
                type: 'boolean',
                description: 'Optional: Create parent directories (default: true)'
              }
            },
            required: ['dirPath']
          };
          break;

        case 'replace':
          parameters = {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'The absolute path to the file'
              },
              instruction: {
                type: 'string',
                description: 'Description of what needs to be changed'
              },
              old_string: {
                type: 'string',
                description: 'The exact text to replace'
              },
              new_string: {
                type: 'string',
                description: 'The exact text to replace with'
              }
            },
            required: ['file_path', 'instruction', 'old_string', 'new_string']
          };
          break;

        case 'web_search':
          parameters = {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query'
              }
            },
            required: ['query']
          };
          break;

        case 'todo_write':
          parameters = {
            type: 'object',
            properties: {
              todos: {
                type: 'array',
                description: 'Array of todo items',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    task: { type: 'string' },
                    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] },
                    priority: { type: 'string', enum: ['high', 'medium', 'low'] }
                  },
                  required: ['id', 'task', 'status']
                }
              }
            },
            required: ['todos']
          };
          break;

        case 'todo_read':
          parameters = {
            type: 'object',
            properties: {},
            required: []
          };
          break;

        case 'task':
          parameters = {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Brief description of the task (3-5 words)'
              },
              agents: {
                type: 'array',
                description: 'Optional: Array of agents to run in parallel for comprehensive analysis',
                items: {
                  type: 'object',
                  properties: {
                    description: {
                      type: 'string',
                      description: 'Brief description of the sub-agent task'
                    },
                    prompt: {
                      type: 'string',
                      description: 'The task for the sub-agent to perform'
                    },
                    subagent_type: {
                      type: 'string',
                      enum: ['general-purpose', 'plan-agent', 'explore-agent', 'frontend-tester', 'code-reviewer', 'frontend-developer', 'backend-developer'],
                      description: 'The type of specialized agent'
                    },
                    constraints: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Optional: Constraints or limitations'
                    }
                  },
                  required: ['description', 'prompt', 'subagent_type']
                }
              },
              prompt: {
                type: 'string',
                description: 'Optional: The task for the agent to perform (use agents for parallel execution)'
              },
              subagent_type: {
                type: 'string',
                enum: ['general-purpose', 'plan-agent', 'explore-agent', 'frontend-tester', 'code-reviewer', 'frontend-developer', 'backend-developer'],
                description: 'Optional: The type of specialized agent (use agents for parallel execution)'
              },
              useContext: {
                type: 'boolean',
                description: 'Optional: Include main agent context'
              },
              outputFormat: {
                type: 'string',
                description: 'Optional: Output format template'
              },
              constraints: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional: Constraints or limitations'
              }
            },
            required: ['description']
          };
          break;

        case 'ReadBashOutput':
          parameters = {
            type: 'object',
            properties: {
              task_id: {
                type: 'string',
                description: 'The ID of the task'
              },
              poll_interval: {
                type: 'number',
                description: 'Optional: Polling interval in seconds (default: 10)'
              }
            },
            required: ['task_id']
          };
          break;

        case 'web_fetch':
          parameters = {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'Prompt containing URL(s) and processing instructions'
              }
            },
            required: ['prompt']
          };
          break;

        case 'ask_user_question':
          parameters = {
            type: 'object',
            properties: {
              questions: {
                type: 'array',
                description: 'Array of questions to ask',
                items: {
                  type: 'object',
                  properties: {
                    question: { type: 'string' },
                    header: { type: 'string', description: 'Short label (max 12 chars)' },
                    options: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Available choices (2-4 options)'
                    },
                    multiSelect: { type: 'boolean' }
                  },
                  required: ['question', 'header', 'options', 'multiSelect']
                }
              }
            },
            required: ['questions']
          };
          break;

        case 'save_memory':
          parameters = {
            type: 'object',
            properties: {
              fact: {
                type: 'string',
                description: 'The specific fact to remember'
              }
            },
            required: ['fact']
          };
          break;

        case 'exit_plan_mode':
          parameters = {
            type: 'object',
            properties: {
              plan: {
                type: 'string',
                description: 'The plan to present'
              }
            },
            required: ['plan']
          };
          break;

        case 'xml_escape':
          parameters = {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'The absolute path to the XML/HTML file'
              },
              escape_all: {
                type: 'boolean',
                description: 'Optional: Escape all special characters (default: false)'
              }
            },
            required: ['file_path']
          };
          break;

        case 'image_read':
          parameters = {
            type: 'object',
            properties: {
              image_input: {
                type: 'string',
                description: 'Image file path or base64 data'
              },
              prompt: {
                type: 'string',
                description: 'Comprehensive VLM instruction'
              },
              task_brief: {
                type: 'string',
                description: 'Brief task description (max 15 words)'
              },
              input_type: {
                type: 'string',
                enum: ['file_path', 'base64'],
                description: 'Input type (default: file_path)'
              },
              mime_type: {
                type: 'string',
                description: 'Optional: MIME type for base64 input'
              }
            },
            required: ['image_input', 'prompt']
          };
          break;

        case 'Skill':
          parameters = {
            type: 'object',
            properties: {
              skill: {
                type: 'string',
                description: 'The skill name to execute'
              }
            },
            required: ['skill']
          };
          break;

        default:
          // For any unknown tools, keep the empty schema
          parameters = {
            type: 'object',
            properties: {},
            required: []
          };
      }

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters
        }
      };
    });
  }

  async execute(toolName: string, params: any, executionMode: ExecutionMode, indent: string = ''): Promise<any> {
    const tool = this.get(toolName);

    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    if (!tool.allowedModes.includes(executionMode)) {
      throw new Error(
        `Tool ${toolName} is not allowed in ${executionMode} mode`
      );
    }

    // Smart approval mode
    if (executionMode === ExecutionMode.SMART) {
      const debugMode = process.env.DEBUG === 'smart-approval';
      const cancellationManager = getCancellationManager();

      // task tool bypasses smart approval entirely
      if (toolName === 'task') {
        if (debugMode) {
          const { getLogger } = await import('./logger.js');
          const logger = getLogger();
          logger.debug(`[SmartApprovalEngine] Tool '${toolName}' bypassed smart approval completely`);
        }
        return await cancellationManager.withCancellation(
          tool.execute(params, executionMode),
          `tool-${toolName}`
        );
      }

      const { getSmartApprovalEngine } = await import('./smart-approval.js');
      const { getConfigManager } = await import('./config.js');
      const configManager = getConfigManager();

      const approvalEngine = getSmartApprovalEngine(debugMode);

      // Evaluate tool call
      const result = await approvalEngine.evaluate({
        toolName,
        params,
        timestamp: Date.now()
      });

      // Decide whether to execute based on approval result
      if (result.decision === 'approved') {
        // Whitelist or AI approval passed, execute directly
        console.log('');
        console.log(`${indent}${colors.success(`✅ [Smart Mode] Tool '${toolName}' passed approval, executing directly`)}`);
        console.log(`${indent}${colors.textDim(`  Detection method: ${result.detectionMethod === 'whitelist' ? 'Whitelist' : 'AI Review'}`)}`);
        console.log(`${indent}${colors.textDim(`  Latency: ${result.latency}ms`)}`);
        console.log('');
        return await cancellationManager.withCancellation(
          tool.execute(params, executionMode),
          `tool-${toolName}`
        );
      } else if (result.decision === 'requires_confirmation') {
        // Requires user confirmation
        const confirmed = await approvalEngine.requestConfirmation(result);

        if (confirmed) {
          console.log('');
          console.log(`${indent}${colors.success(`✅ [Smart Mode] User confirmed execution of tool '${toolName}'`)}`);
          console.log('');
          return await cancellationManager.withCancellation(
            tool.execute(params, executionMode),
            `tool-${toolName}`
          );
        } else {
          console.log('');
          console.log(`${indent}${colors.warning(`⚠️  [Smart Mode] User cancelled execution of tool '${toolName}'`)}`);
          console.log('');
          throw new Error(`Tool execution cancelled by user: ${toolName}`);
        }
      } else {
        // Rejected execution
        console.log('');
        console.log(`${indent}${colors.error(`❌ [Smart Mode] Tool '${toolName}' execution rejected`)}`);
        console.log(`${indent}${colors.textDim(`  Reason: ${result.description}`)}`);
        console.log('');
        throw new Error(`Tool execution rejected: ${toolName}`);
      }
    }

    // Other modes execute directly
    return await tool.execute(params, executionMode);
  }

  async executeAll(
    toolCalls: Array<{ name: string; params: any }>,
    executionMode: ExecutionMode
  ): Promise<Array<{ tool: string; result: any; error?: string }>> {
    const results: Array<{ tool: string; result: any; error?: string }> = [];
    const cancellationManager = getCancellationManager();
    let cancelled = false;

    // Listen for cancellation
    const cancelHandler = () => {
      cancelled = true;
    };
    cancellationManager.on('cancelled', cancelHandler);

    const executePromises = toolCalls.map(async (toolCall, index) => {
      const { name, params } = toolCall;
      const operationId = `tool-${name}-${index}-${Date.now()}`;

      try {
        const result = await cancellationManager.withCancellation(
          this.execute(name, params, executionMode),
          operationId
        );
        return { tool: name, result, error: undefined };
      } catch (error: any) {
        if (error.message === 'Operation cancelled by user') {
          return { tool: name, result: undefined, error: 'Cancelled' };
        }
        return { tool: name, result: undefined, error: error.message };
      }
    });

    const settledResults = await Promise.all(executePromises);
    cancellationManager.off('cancelled', cancelHandler);

    // Filter out cancelled tools and mark them appropriately
    for (const result of settledResults) {
      if (result.error === 'Cancelled' && cancelled) {
        // Don't add cancelled results to the final output
        continue;
      }
      results.push(result);
    }

    return results;
  }
}

let toolRegistryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!toolRegistryInstance) {
    toolRegistryInstance = new ToolRegistry();
  }
  return toolRegistryInstance;
}
