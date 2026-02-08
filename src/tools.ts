import fs from 'fs/promises';
import { select, text } from '@clack/prompts';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { spawn } from 'child_process';
import { glob } from 'glob';
import axios from 'axios';
import { Tool, ExecutionMode, AuthType } from './types.js';
import type { Message, ToolDefinition } from './ai-client/types.js';
import { colors, icons } from './theme.js';
import { getLogger } from './logger.js';
import { getCancellationManager } from './cancellation.js';
import { SystemPromptGenerator } from './system-prompt-generator.js';
import { getSingletonSession } from './session.js';
import { ripgrep, fdFind } from './ripgrep.js';
import { getShellConfig, killProcessTree, quoteShellCommand } from './shell.js';
import { truncateTail, buildTruncationNotice } from './truncate.js';
import { createAIClient } from './ai-client-factory.js';

//
// Tool Description Pattern
//
// Each tool class in this file defines a `description` property with detailed usage
// instructions for the LLM. However, these descriptions are NOT directly used by
// SystemPromptGenerator.createToolSchema(). Instead, SystemPromptGenerator defines
// its own custom schemas that OVERRIDE these descriptions.
//
// This design allows:
// 1. Customized descriptions optimized for system prompts
// 2. Dynamic content (e.g., skills list) in InvokeSkill description
// 3. Consistent formatting and structure across all tool descriptions
//
// The description properties here are kept for:
// - Documentation purposes
// - Fallback if SystemPromptGenerator schema lookup fails
// - Potential future architecture changes
//
// See system-prompt-generator.ts::createToolSchema() for the override logic.
//

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

  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

  async execute(params: { filePath: string; offset?: number; limit?: number }): Promise<string> {
    if (!params || typeof params.filePath !== 'string') {
      throw new Error('filePath is required and must be a string');
    }
    const { filePath, offset = 0, limit } = params;

    try {
      // Handle ~ (user home directory) in file paths
      let resolvedPath = filePath;
      if (filePath.startsWith('~')) {
        // On Windows, prefer USERPROFILE over HOME to avoid POSIX path issues
        // Some tools like Git Bash may set HOME to a POSIX path on Windows
        let homeDir = process.env.USERPROFILE || '';
        if (!homeDir || homeDir.startsWith('/')) {
          homeDir = process.env.HOME || process.env.USERPROFILE || '';
        }
        resolvedPath = path.join(homeDir, filePath.slice(1));
      }
      const absolutePath = path.resolve(resolvedPath);
      const content = await fs.readFile(absolutePath, 'utf-8');

      const lines = content.split('\n');
      const totalLines = lines.length;
      const startLine = Math.max(0, offset);
      const endLine = limit !== undefined ? Math.min(totalLines, startLine + limit) : totalLines;
      const selectedLines = lines.slice(startLine, endLine);
      const result = selectedLines.join('\n');

      // Add truncation notice if content is limited
      if (limit !== undefined && endLine < totalLines) {
        const remaining = totalLines - endLine;
        const nextOffset = endLine;
        return (
          result + `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue]`
        );
      }

      return result;
    } catch (error: any) {
      // Show user-friendly path in error message
      let displayPath = filePath;
      if (filePath.startsWith('~')) {
        // On Windows, prefer USERPROFILE over HOME to avoid POSIX path issues
        let homeDir = process.env.USERPROFILE || '';
        if (!homeDir || homeDir.startsWith('/')) {
          homeDir = process.env.HOME || process.env.USERPROFILE || '';
        }
        displayPath = path.join(homeDir, filePath.slice(1));
      }
      throw new Error(`Failed to read file ${displayPath}: ${error.message}`);
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
- For making small edits to existing files (use edit instead)
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
- For partial edits, use Edit tool instead`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

  async execute(params: {
    filePath: string;
    content: string;
  }): Promise<{
    success: boolean;
    message: string;
    filePath: string;
    lineCount: number;
    preview?: string;
  }> {
    const { filePath, content } = params;

    try {
      const absolutePath = path.resolve(filePath);
      const dir = path.dirname(absolutePath);

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');

      const lineCount = content.split('\n').length;
      const preview = content.split('\n').slice(0, 10).join('\n');
      const isTruncated = lineCount > 10;

      return {
        success: true,
        message: `Successfully wrote to ${filePath}`,
        filePath,
        lineCount,
        preview: isTruncated ? preview + '\n...' : preview,
      };
    } catch (error: any) {
      throw new Error(`Failed to write file ${filePath}: ${error.message}`);
    }
  }
}

export class GrepTool implements Tool {
  name = 'Grep';
  description = `Search for text patterns within files using ripgrep. This is your PRIMARY tool for finding specific code, functions, or content.

# When to Use
- Finding specific function definitions or calls
- Searching for variable usages or imports
- Locating error messages or log statements
- Finding all occurrences of a pattern across the codebase
- When you need line-by-line results with context

# When NOT to Use
- When you only need to find files containing text (use SearchFiles instead)
- When searching by file pattern rather than content (use SearchFiles)
- For very large codebases where you only need file names (SearchFiles is faster)

# Parameters
- \`pattern\`: Regex or literal string to search for
- \`path\`: (Optional) Directory to search in, default: "."
- \`glob\`: (Optional) File glob pattern to include (e.g., "*.ts", "**/*.js")
- \`ignoreCase\`: (Optional) Case-insensitive search, default: false
- \`literal\`: (Optional) Treat pattern as literal string, default: false
- \`context\`: (Optional) Lines of context before/after matches

# Examples
- Find function: Grep(pattern="function myFunction")
- Find with context: Grep(pattern="TODO", context=3)
- TypeScript only: Grep(pattern="interface", glob="*.ts")
- Case-insensitive: Grep(pattern="error", ignoreCase=true)

# Best Practices
- Use ignoreCase=true for short patterns to reduce false positives
- Use literal=true if your pattern has special regex characters
- Use context to see the surrounding code for each match
- Combine with glob to narrow down file types`;
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

  async execute(params: {
    pattern: string;
    path?: string;
    glob?: string;
    ignoreCase?: boolean;
    literal?: boolean;
    context?: number;
    limit?: number;
  }): Promise<string[]> {
    const {
      pattern,
      path: searchPath = '.',
      glob: includeGlob,
      ignoreCase = false,
      literal = false,
      context,
      limit,
    } = params;

    try {
      const result = await ripgrep({
        pattern,
        path: searchPath,
        glob: includeGlob,
        ignoreCase,
        literal,
        context,
        limit,
      });

      return result.split('\n').filter((line) => line.trim());
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
- For file operations (use Read/Write/Edit/CreateDirectory instead)
- For searching file content (use Grep instead)
- For finding files (use SearchFiles or ListDirectory instead)
- For commands that require user interaction (non-interactive only)
- For dangerous commands without understanding the impact

# Parameters
- \`command\`: The shell command to execute
- \`cwd\`: (Optional) Working directory for the command
- \`description\`: (Optional) Description of what the command does
- \`timeout\`: (Optional) Timeout in seconds, default: 120
- \`run_in_bg\`: (Optional) Run in background, default: false
- \`skillPath\`: (Optional) Skill directory path - when provided, NODE_PATH will include the skill's node_modules for dependency resolution

# Examples
- Install dependencies: Bash(command="npm install", description="Install npm dependencies")
- Run in skill directory with local deps: Bash(command="npm install docx", skillPath="~/.xagent/skills/docx")

# NODE_PATH Resolution
When \`skillPath\` is provided, the command will have access to:
- \`<skillPath>/node_modules\` (skill's local dependencies)
- xAgent's global node_modules

This is useful when working with skills that have local dependencies.
- Run tests: Bash(command="npm test", description="Run unit tests")
- Build project: Bash(command="npm run build", description="Build the project")

# Best Practices
- To install npm packages that persist across sessions, use: \`XAGENT_USER_NPM=1 npm install <package>\`
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
    skillPath?: string;  // Skill directory path for NODE_PATH resolution
  }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    taskId?: string;
    truncated?: boolean;
    truncationNotice?: string;
    skillPath?: string;
  }> {
    const { command, cwd, description, timeout = 120, run_in_bg = false, skillPath } = params;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void description;

    // Determine effective working directory
    // Only use cwd if the command doesn't contain 'cd' (let LLM control directory)
    let effectiveCwd: string | undefined;
    const hasCdCommand = /cd\s+["']?[^"&|;]+["']?/.test(command);

    if (cwd && !hasCdCommand) {
      // Command doesn't control its own directory, use provided cwd
      effectiveCwd = cwd;
    } else if (cwd && hasCdCommand) {
      // Command uses cd, ignore cwd to let cd take effect
      effectiveCwd = undefined;
    } else {
      // No cwd provided, use default
      effectiveCwd = undefined;
    }

    // Resolve actual working directory
    const actualCwd = effectiveCwd || process.cwd();

    // Set up environment with NODE_PATH for node commands
    const builtinNodeModulesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');

    // Get user skills path from config (unified path: ~/.xagent/skills)
    const { getConfigManager } = await import('./config.js');
    const configManager = getConfigManager();
    const userSkillsPath = configManager.getUserSkillsPath();

    // Skill deps path: ~/.xagent/skills/{skillName}/node_modules
    const builtinDepsPath = userSkillsPath ? path.join(userSkillsPath, 'builtin-deps') : null;

    // Determine which node_modules to use
    let skillNodeModulesPath: string | null = null;

    // Priority 1: skillPath parameter (workspace scenario - LLM works in workspace, not skill dir)
    if (skillPath) {
      if (skillPath.includes('/builtin-deps/')) {
        // Skill with deps in builtin-deps directory
        const match = skillPath.match(/\/builtin-deps\/([^/]+)/);
        if (match) {
          skillNodeModulesPath = path.join(builtinDepsPath!, match[1], 'node_modules');
        }
      } else {
        // Regular skill
        skillNodeModulesPath = path.join(skillPath, 'node_modules');
      }
    }
    // Priority 2: Check if we're inside a skill directory
    else if (userSkillsPath && userSkillsPath.trim() && actualCwd.startsWith(userSkillsPath)) {
      const relativePath = actualCwd.substring(userSkillsPath.length);
      const pathParts = relativePath.split(path.sep).filter(Boolean);

      if (pathParts.length > 0) {
        if (pathParts[0] === 'builtin-deps' && pathParts.length > 1) {
          // Skill with local deps in builtin-deps
          const skillName = pathParts[1];
          skillNodeModulesPath = path.join(builtinDepsPath!, skillName, 'node_modules');
        } else {
          // Regular skill
          const skillName = pathParts[0];
          const skillRoot = path.join(userSkillsPath, skillName);
          try {
            const skillMdPath = path.join(skillRoot, 'SKILL.md');
            await fs.access(skillMdPath);
            skillNodeModulesPath = path.join(skillRoot, 'node_modules');
          } catch {
            // Not a skill directory, skip
          }
        }
      }
    }

    // Build NODE_PATH - skill's node_modules takes precedence (last-wins)
    let nodePath: string;
    if (skillNodeModulesPath) {
      nodePath = `${skillNodeModulesPath}${path.delimiter}${builtinNodeModulesPath}`;
    } else {
      nodePath = builtinNodeModulesPath;
    }

    const env: Record<string, string> = {
      ...process.env,
      NODE_PATH: nodePath
    };

    // Handle npm install commands
    const isNpmInstall = /\bnpm\s+install\b/i.test(command);
    let finalCommand = command;

    if (isNpmInstall && skillNodeModulesPath) {
      // Install to skill's own node_modules
      await fs.mkdir(skillNodeModulesPath, { recursive: true }).catch(() => {});
      finalCommand = command.replace(/\bnpm\s+install\b/i, `npm install --prefix "${skillNodeModulesPath}"`);
    }

    // Get shell configuration (Windows Git Bash detection, etc.)
    const { shell, args } = getShellConfig();

    // Set up cross-platform encoding environment for command execution
    if (process.platform === 'win32') {
      // Windows: set code page to UTF-8 and ensure console output encoding
      // chcp 65001 sets the console code page to UTF-8
      // Use *>$null to suppress output (PowerShell-style, not CMD-style)
      finalCommand = `chcp 65001 *>$null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${finalCommand}`;
    } else {
      // Unix/macOS: set locale to UTF-8 for proper encoding handling
      finalCommand = `export LC_ALL=C.UTF-8; export LANG=C.UTF-8; export PYTHONIOENCODING=utf-8; ${finalCommand}`;
    }

    const shellArgs = [...args, quoteShellCommand(finalCommand)];

    try {
      if (run_in_bg) {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const spawnOptions: any = {
          cwd: effectiveCwd || process.cwd(),
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        };

        // On Windows, don't use detached mode for PowerShell as it breaks output piping
        if (process.platform !== 'win32') {
          spawnOptions.detached = true;
        }

        const childProcess = spawn(shell, shellArgs, spawnOptions);

        const output: string[] = [];

        childProcess.stdout?.on('data', (data: Buffer) => {
          const text = data.toString();
          output.push(text);
        });

        childProcess.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          output.push(text);
        });

        childProcess.on('close', (_code: number) => {
          // Silent cleanup - don't log to avoid noise during normal operation
          // Note: On Windows with PowerShell, the shell process exits after
          // the command completes
        });

        const toolRegistry = getToolRegistry();
        (toolRegistry as any).addBackgroundTask(taskId, {
          process: childProcess,
          startTime: Date.now(),
          output,
        });

        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          taskId,
        };
      } else {
        // Execute command with spawn for better control
        const result = await this.spawnWithTimeout(shell, shellArgs, {
          cwd: effectiveCwd || process.cwd(),
          env,
          timeout,
        });

        // Apply truncation to stdout and stderr separately
        const stdoutResult = truncateTail(result.stdout);
        const stderrResult = truncateTail(result.stderr);

        const stdout = stdoutResult.content;
        const stderr = stderrResult.content;
        let truncationNotice = '';

        if (stdoutResult.truncated) {
          truncationNotice += buildTruncationNotice(stdoutResult) + '\n';
        }
        if (stderrResult.truncated) {
          truncationNotice += buildTruncationNotice(stderrResult) + '\n';
        }

        return {
          stdout,
          stderr,
          exitCode: result.exitCode,
          truncated: stdoutResult.truncated || stderrResult.truncated,
          truncationNotice: truncationNotice || undefined,
        };
      }
    } catch (error: any) {
      // Check if this was a timeout
      if (error.message === 'timeout') {
        return {
          stdout: '',
          stderr: 'Command timed out',
          exitCode: -1,
          truncated: false,
        };
      }
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
      };
    }
  }

  /**
   * Execute a command with timeout support and proper process termination.
   */
  private spawnWithTimeout(
    shell: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const { cwd, env, timeout } = options;
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const spawnOptions: any = {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      };

      // On Windows, don't use detached mode for PowerShell as it breaks output piping
      if (process.platform !== 'win32') {
        spawnOptions.detached = true;
      }

      const child = spawn(shell, args, spawnOptions);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      // Set timeout if provided
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          if (child.pid) {
            killProcessTree(child.pid);
          }
        }, timeout * 1000);
      }

      // Stream stdout
      child.stdout?.on('data', (data: Buffer) => {
        stdoutChunks.push(data);
      });

      // Stream stderr
      child.stderr?.on('data', (data: Buffer) => {
        stderrChunks.push(data);
      });

      // Handle process exit
      child.on('close', (code: number) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (timedOut) {
          reject(new Error('timeout'));
          return;
        }

        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          exitCode: code ?? -1,
        });
      });

      // Handle spawn errors
      child.on('error', (err) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(err);
      });
    });
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
- When you need to search for specific files (use SearchFiles instead)

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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

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
        ignore: ['node_modules/**', '.git/**'],
      });

      return files.map((file) => path.join(absolutePath, file));
    } catch (error: any) {
      throw new Error(`Failed to list directory: ${error.message}`);
    }
  }
}

export interface SearchFilesResult {
  /** Matching file paths relative to search directory */
  files: string[];
  /** Total number of matches found (before limiting) */
  total: number;
  /** Whether results were truncated due to limit */
  truncated: boolean;
}

export class SearchFilesTool implements Tool {
  name = 'SearchFiles';
  description = `Search for files matching a glob pattern using fd. This is your PRIMARY tool for finding files by name or extension.

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
- \`limit\`: (Optional) Maximum number of results to return, default: 1000

# Examples
- Find all TypeScript files: SearchFiles(pattern="**/*.ts")
- Find test files: SearchFiles(pattern="**/*.test.ts")
- Find config files: SearchFiles(pattern="**/config.*")
- Limit results: SearchFiles(pattern="**/*.ts", limit=100)

# Glob Patterns
- \`*\` matches any characters except /
- \`**\` matches any characters including /
- \`?\` matches single character
- Use brackets for character classes: [abc]

# Best Practices
- Use **/*.ts for recursive search in all directories
- Combine with path parameter to search specific directories
- Use limit parameter to avoid huge result sets
- Results are file paths, not content (use Grep on results if needed)`;
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

  async execute(params: {
    pattern: string;
    path?: string;
    limit?: number;
  }): Promise<SearchFilesResult> {
    const { pattern, path: searchPath = '.', limit = 1000 } = params;

    try {
      const output = await fdFind({
        pattern,
        path: searchPath,
        limit,
      });

      if (output === 'No files found') {
        return {
          files: [],
          total: 0,
          truncated: false,
        };
      }

      const files = output.split('\n').filter((line) => line.trim());

      const total = files.length;
      const truncated = total > limit;
      const result = truncated ? files.slice(0, limit) : files;

      return {
        files: result,
        total,
        truncated,
      };
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

  async execute(params: {
    filePath: string;
  }): Promise<{ success: boolean; message: string; filePath: string }> {
    const { filePath } = params;

    try {
      const absolutePath = path.resolve(filePath);
      await fs.unlink(absolutePath);

      return {
        success: true,
        message: `Successfully deleted ${filePath}`,
        filePath,
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

  async execute(params: {
    dirPath: string;
    recursive?: boolean;
  }): Promise<{ success: boolean; message: string }> {
    const { dirPath, recursive = true } = params;

    try {
      const absolutePath = path.resolve(dirPath);
      await fs.mkdir(absolutePath, { recursive });

      return {
        success: true,
        message: `Successfully created directory ${dirPath}`,
      };
    } catch (error: any) {
      throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
    }
  }
}

// 编辑工具辅助函数
function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIdx = content.indexOf('\r\n');
  const lfIdx = content.indexOf('\n');
  if (lfIdx === -1) return '\n';
  if (crlfIdx === -1) return '\n';
  return crlfIdx < lfIdx ? '\r\n' : '\n';
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function restoreLineEndings(text: string, ending: '\r\n' | '\n'): string {
  return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

function normalizeForFuzzyMatch(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/['‘’""]/g, "'")
    .replace(/["""]/g, '"')
    .replace(/[—–‑−]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');
}

interface FuzzyMatchResult {
  found: boolean;
  index: number;
  matchLength: number;
  usedFuzzyMatch: boolean;
  contentForReplacement: string;
}

function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

  if (fuzzyIndex === -1) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent,
  };
}

function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith('\uFEFF')
    ? { bom: '\uFEFF', text: content.slice(1) }
    : { bom: '', text: content };
}

async function generateDiffString(
  oldContent: string,
  newContent: string,
  contextLines = 4
): Promise<{ diff: string; firstChangedLine: number | undefined }> {
  const diffModule = await import('diff');
  const parts = diffModule.diffLines(oldContent, newContent);
  const output: string[] = [];

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;

  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;
  let firstChangedLine: number | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const raw = part.value.split('\n');
    if (raw[raw.length - 1] === '') {
      raw.pop();
    }

    if (part.added || part.removed) {
      if (firstChangedLine === undefined) {
        firstChangedLine = newLineNum;
      }

      for (const line of raw) {
        if (part.added) {
          const lineNum = String(newLineNum).padStart(lineNumWidth, ' ');
          output.push(`+${lineNum} ${line}`);
          newLineNum++;
        } else {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, ' ');
          output.push(`-${lineNum} ${line}`);
          oldLineNum++;
        }
      }
      lastWasChange = true;
    } else {
      const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);

      if (lastWasChange || nextPartIsChange) {
        let linesToShow = raw;
        let skipStart = 0;
        let skipEnd = 0;

        if (!lastWasChange) {
          skipStart = Math.max(0, raw.length - contextLines);
          linesToShow = raw.slice(skipStart);
        }

        if (!nextPartIsChange && linesToShow.length > contextLines) {
          skipEnd = linesToShow.length - contextLines;
          linesToShow = linesToShow.slice(0, contextLines);
        }

        if (skipStart > 0) {
          output.push(` ${''.padStart(lineNumWidth, ' ')} ...`);
          oldLineNum += skipStart;
          newLineNum += skipStart;
        }

        for (const line of linesToShow) {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, ' ');
          output.push(` ${lineNum} ${line}`);
          oldLineNum++;
          newLineNum++;
        }

        if (skipEnd > 0) {
          output.push(` ${''.padStart(lineNumWidth, ' ')} ...`);
        }
      } else {
        oldLineNum += raw.length;
        newLineNum += raw.length;
      }

      lastWasChange = false;
    }
  }

  return { diff: output.join('\n'), firstChangedLine };
}

export class EditTool implements Tool {
  name = 'Edit';
  description = `Edit a file by replacing exact text. This is your PRIMARY tool for making targeted edits to code.

# When to Use
- Modifying specific code sections without rewriting entire files
- Changing function implementations, variable values, or configurations
- Fixing bugs by editing specific lines
- Updating imports, exports, or references

# When NOT to Use
- When you need to create a completely new file (use Write instead)
- When you want to append content to a file (read first, then Write)
- When making changes across multiple files (use Grep to find, then edit individually)

# Parameters
- \`file_path\`: Path to the file to edit (relative or absolute)
- \`instruction\`: Description of what to change (for your own tracking)
- \`old_string\`: The exact text to find and replace (must match exactly)
- \`new_string\`: The new text to replace with

# Critical Requirements
- \`old_string\` MUST be an EXACT match, including whitespace and indentation
- Include sufficient context (at least 3 lines) before and after the target text to ensure unique matching
- The file must exist before editing

# Fuzzy Matching
This tool supports fuzzy matching to handle minor formatting differences:
- Trailing whitespace is ignored
- Smart quotes (', ", , ) are normalized to ASCII
- Unicode dashes/hyphens are normalized to ASCII hyphen
- Special Unicode spaces are normalized to regular space

# Examples
edit(
  file_path="src/app.ts",
  instruction="Update API endpoint",
  old_string="const API_URL = 'https://api.old.com'\\nconst PORT = 8080;",
  new_string="const API_URL = 'https://api.new.com'\\nconst PORT = 3000;"
)

# Best Practices
- Read the file first to understand the exact content
- Include sufficient context in old_string to ensure unique match
- If fuzzy matching is needed, the tool will automatically apply it
- Check the diff output to verify the change is correct`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

  async execute(params: {
    file_path: string;
    instruction: string;
    old_string: string;
    new_string: string;
  }): Promise<{ success: boolean; message: string; diff?: string; firstChangedLine?: number }> {
    const { file_path, instruction, old_string, new_string } = params;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void instruction;

    try {
      const absolutePath = path.resolve(file_path);

      // Check if file exists
      try {
        await fs.access(absolutePath);
      } catch {
        return {
          success: false,
          message: `File not found: ${file_path}`,
        };
      }

      // Read the file
      const buffer = await fs.readFile(absolutePath);
      const rawContent = buffer.toString('utf-8');

      // Strip BOM before matching
      const { bom, text: content } = stripBom(rawContent);

      const originalEnding = detectLineEnding(content);
      const normalizedContent = normalizeToLF(content);
      const normalizedOldText = normalizeToLF(old_string);
      const normalizedNewText = normalizeToLF(new_string);

      // Find the old text using fuzzy matching
      const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

      if (!matchResult.found) {
        return {
          success: false,
          message: `Could not find the exact text in ${file_path}. The old text must match exactly including all whitespace and newlines.`,
        };
      }

      // Count occurrences using fuzzy-normalized content
      const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
      const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
      const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;

      if (occurrences > 1) {
        return {
          success: false,
          message: `Found ${occurrences} occurrences of the text in ${file_path}. The text must be unique. Please provide more context to make it unique.`,
        };
      }

      // Perform replacement
      const baseContent = matchResult.contentForReplacement;
      const newContent =
        baseContent.substring(0, matchResult.index) +
        normalizedNewText +
        baseContent.substring(matchResult.index + matchResult.matchLength);

      // Verify the replacement actually changed something
      if (baseContent === newContent) {
        return {
          success: false,
          message: `No changes made to ${file_path}. The replacement produced identical content.`,
        };
      }

      const finalContent = bom + restoreLineEndings(newContent, originalEnding);
      await fs.writeFile(absolutePath, finalContent, 'utf-8');

      const diffResult = await generateDiffString(baseContent, newContent);

      return {
        success: true,
        message: `Successfully replaced text in ${file_path}.`,
        diff: diffResult.diff,
        firstChangedLine: diffResult.firstChangedLine,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to edit file ${file_path}: ${error.message}`,
      };
    }
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

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
            Authorization: `Bearer ${searchApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      return {
        results: response.data.results || [],
        message: `Found ${response.data.results?.length || 0} results for "${query}"`,
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

  private todoList: Array<{
    id: string;
    task: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    priority: 'high' | 'medium' | 'low';
  }> = [];

  async execute(params: {
    todos: Array<{
      id: string;
      task: string;
      status: 'pending' | 'in_progress' | 'completed' | 'failed';
      priority: 'high' | 'medium' | 'low';
    }>;
  }): Promise<{ success: boolean; message: string; todos: any[] }> {
    const { todos } = params;

    try {
      this.todoList = todos;

      const summary = {
        pending: todos.filter((t) => t.status === 'pending').length,
        in_progress: todos.filter((t) => t.status === 'in_progress').length,
        completed: todos.filter((t) => t.status === 'completed').length,
        failed: todos.filter((t) => t.status === 'failed').length,
      };

      return {
        success: true,
        message: `Updated todo list: ${summary.pending} pending, ${summary.in_progress} in progress, ${summary.completed} completed, ${summary.failed} failed`,
        todos: this.todoList,
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

  private todoWriteTool: TodoWriteTool;

  constructor(todoWriteTool: TodoWriteTool) {
    this.todoWriteTool = todoWriteTool;
  }

  async execute(): Promise<{ todos: any[]; summary: any }> {
    try {
      const todos = this.todoWriteTool.getTodos();

      const summary = {
        total: todos.length,
        pending: todos.filter((t) => t.status === 'pending').length,
        in_progress: todos.filter((t) => t.status === 'in_progress').length,
        completed: todos.filter((t) => t.status === 'completed').length,
        failed: todos.filter((t) => t.status === 'failed').length,
      };

      return {
        todos,
        summary,
      };
    } catch (error: any) {
      throw new Error(`Failed to read todo list: ${error.message}`);
    }
  }
}

export interface SubAgentTask {
  description: string;
  prompt: string;
  subagent_type:
    | 'general-purpose'
    | 'plan-agent'
    | 'explore-agent'
    | 'frontend-tester'
    | 'code-reviewer'
    | 'frontend-developer'
    | 'backend-developer'
    | 'gui-subagent';
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

  async execute(
    params: {
      description: string;
      prompt?: string;
      query?: string; // Support both prompt and query (tool definition uses query)
      subagent_type?:
        | 'general-purpose'
        | 'plan-agent'
        | 'explore-agent'
        | 'frontend-tester'
        | 'code-reviewer'
        | 'frontend-developer'
        | 'backend-developer'
        | 'gui-subagent';
      agents?: SubAgentTask[];
      useContext?: boolean;
      outputFormat?: string;
      constraints?: string[];
      executionMode?: ExecutionMode;
      parallel?: boolean;
    },
    _executionMode?: ExecutionMode
  ): Promise<{ success: boolean; message: string; result?: any }> {
    const mode = params.executionMode || _executionMode || ExecutionMode.YOLO;

    try {
      const { getAgentManager } = await import('./agents.js');
      const agentManager = getAgentManager(process.cwd());

      const { getConfigManager } = await import('./config.js');
      const config = getConfigManager();

      const authConfig = config.getAuthConfig();
      const aiClient = createAIClient(authConfig);

      const toolRegistry = getToolRegistry();

      if (params.agents && params.agents.length > 0) {
        return await this.executeParallelAgents(
          params.agents,
          params.description,
          mode,
          agentManager,
          toolRegistry,
          config
        );
      }

      if (!params.subagent_type) {
        throw new Error('subagent_type is required for Task tool');
      }

      // Support both 'prompt' and 'query' parameter names (tool definition uses 'query')
      const prompt = params.prompt || params.query;
      if (!prompt) {
        throw new Error(
          'Task query/prompt is required. Received params: ' +
            JSON.stringify({
              subagent_type: params.subagent_type,
              prompt: params.prompt,
              query: params.query,
              description: params.description,
              agents: params.agents?.length,
            })
        );
      }

      const result = await this.executeSingleAgent(
        params.subagent_type,
        prompt,
        params.description,
        params.useContext ?? true,
        params.constraints || [],
        mode,
        agentManager,
        toolRegistry,
        config
      );

      return result;
    } catch (error: any) {
      throw new Error(`Task execution failed: ${error.message}`);
    }
  }

  /**
   * Create unified VLM caller
   * Uses remote VLM if remoteAIClient is provided, otherwise uses local VLM
   * Both modes receive full messages array for consistent behavior
   * @param remoteAIClient - Remote AI client for VLM calls
   * @param taskId - Task identifier for backend tracking
   * @param localConfig - Local VLM configuration
   * @param isFirstVlmCallRef - Reference to boolean tracking if this is the first VLM call
   * @param signal - Abort signal for cancellation
   */
  private createRemoteVlmCaller(
    remoteAIClient: any,
    taskId: string | null,
    localConfig: { baseUrl: string; apiKey: string; modelName: string },
    isFirstVlmCallRef: { current: boolean },
    signal?: AbortSignal
  ): (
    messages: any[],
    systemPrompt: string,
    taskId: string,
    isFirstVlmCallRef: { current: boolean }
  ) => Promise<string> {
    // Remote mode: use RemoteAIClient
    if (remoteAIClient) {
      return this.createRemoteVLMCaller(remoteAIClient, taskId, isFirstVlmCallRef, signal);
    }

    // Local mode: use local API
    return this.createLocalVLMCaller(localConfig, signal);
  }

  /**
   * Create remote VLM caller using RemoteAIClient
   * Now receives full messages array for consistent behavior with local mode
   * @param remoteAIClient - Remote AI client
   * @param taskId - Task identifier for backend tracking
   * @param isFirstVlmCallRef - Reference to boolean tracking if this is the first VLM call
   * @param signal - Abort signal for cancellation
   */
  private createRemoteVLMCaller(
    remoteAIClient: any,
    taskId: string | null,
    isFirstVlmCallRef: { current: boolean },
    signal?: AbortSignal
  ): (
    messages: any[],
    systemPrompt: string,
    taskId: string,
    isFirstVlmCallRef: { current: boolean }
  ) => Promise<string> {
    return async (
      messages: any[],
      systemPrompt: string,
      _taskId: string,
      _isFirstVlmCallRef: { current: boolean }
    ): Promise<string> => {
      try {
        // Use the ref to track first call status for the backend
        const status = isFirstVlmCallRef.current ? 'begin' : 'continue';
        const result = await remoteAIClient.invokeVLM(messages, systemPrompt, {
          signal,
          taskId,
          status,
        });
        // Update ref after call so subsequent calls use 'continue'
        isFirstVlmCallRef.current = false;
        return result;
      } catch (error: any) {
        throw new Error(`Remote VLM call failed: ${error.message}`);
      }
    };
  }

  /**
   * Create local VLM caller using direct API calls
   * Receives full messages array for consistent behavior with remote mode
   */
  private createLocalVLMCaller(
    localConfig: { baseUrl: string; apiKey: string; modelName: string },
    signal?: AbortSignal
  ) {
    const { baseUrl, apiKey, modelName } = localConfig;

    return async (messages: any[], _systemPrompt: string): Promise<string> => {
      const requestBody = {
        model: modelName,
        messages,
        max_tokens: 1024,
        temperature: 0.1,
      };

      const controller = signal ? new AbortController() : undefined;
      const abortSignal = signal || controller?.signal;

      // If external signal is provided, listen to it
      if (signal) {
        signal.addEventListener?.('abort', () => controller?.abort());
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`VLM API error: ${errorText}`);
      }

      const result = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return result.choices?.[0]?.message?.content || '';
    };
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
    indentLevel: number = 1,
    remoteAIClient?: any
  ): Promise<{ success: boolean; cancelled?: boolean; message: string; result?: any }> {
    const indent = '  '.repeat(indentLevel);

    console.log(`${indent}${colors.primaryBright(`${icons.robot} GUI Agent`)}: ${description}`);
    console.log(
      `${indent}${colors.border(icons.separator.repeat(Math.min(60, process.stdout.columns || 80) - indent.length))}`
    );
    console.log('');

    // Get VLM configuration for local mode
    // NOTE: guiSubagentBaseUrl must be explicitly configured, NOT fallback to baseUrl
    const baseUrl = config.get('guiSubagentBaseUrl') || '';
    const apiKey = config.get('guiSubagentApiKey') || '';
    const modelName = config.get('guiSubagentModel') || '';

    // Determine mode: remote if remoteAIClient exists, otherwise local
    const isRemoteMode = !!remoteAIClient;

    // Log mode information
    if (isRemoteMode) {
      console.log(`${indent}${colors.info(`${icons.brain} Using remote VLM service`)}`);
    } else {
      console.log(`${indent}${colors.info(`${icons.brain} Using local VLM configuration`)}`);
      // Local mode requires explicit VLM configuration
      if (!baseUrl || !apiKey || !modelName) {
        return {
          success: false,
          message: `GUI task "${description}" failed: VLM not configured. Please run /model to configure Vision-Language Model first.`,
        };
      }
      console.log(`${indent}${colors.textMuted(`  Model: ${modelName}`)}`);
      console.log(`${indent}${colors.textMuted(`  Base URL: ${baseUrl}`)}`);
    }
    console.log('');

    // Get taskId from session for tracking (remote mode only)
    let taskId: string | null = null;
    if (isRemoteMode) {
      try {
        const { getSingletonSession } = await import('./session.js');
        const session = getSingletonSession();
        taskId = session?.getTaskId() || null;
      } catch {
        taskId = null;
      }
    }

    // Track first VLM call for proper status management
    const isFirstVlmCallRef = { current: true };

    // Create remoteVlmCaller using the unified method (handles both local and remote modes)
    const remoteVlmCaller = this.createRemoteVlmCaller(
      remoteAIClient,
      taskId,
      { baseUrl, apiKey, modelName },
      isFirstVlmCallRef
    );

    // Set up stdin polling for ESC cancellation
    let rawModeEnabled = false;
    let stdinPollingInterval: NodeJS.Timeout | null = null;
    const cancellationManager = getCancellationManager();
    const logger = getLogger();

    const setupStdinPolling = () => {
      logger.debug(`[GUIAgent ESC] setupStdinPolling called, process.stdin.isTTY: ${process.stdin.isTTY}`);
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
          rawModeEnabled = true;
          process.stdin.resume();
          readline.emitKeypressEvents(process.stdin);
          logger.debug(`[GUIAgent ESC] Raw mode enabled successfully`);
        } catch (e: any) {
          logger.debug(`[GUIAgent ESC] Could not set raw mode: ${e.message}`);
        }

        stdinPollingInterval = setInterval(() => {
          try {
            if (rawModeEnabled) {
              const chunk = process.stdin.read(1);
              if (chunk && chunk.length > 0) {
                const code = chunk[0];
                if (code === 0x1b) {
                  // ESC
                  logger.debug('[GUIAgent ESC Polling] ESC detected! Code: 0x1b');
                  cancellationManager.cancel();
                } else {
                  // Log other key codes for debugging
                  logger.debug(`[GUIAgent ESC Polling] Key code: 0x${code.toString(16)}`);
                }
              }
            } else {
              logger.debug('[GUIAgent ESC Polling] rawModeEnabled is false');
            }
          } catch (e: any) {
            logger.debug(`[GUIAgent ESC Polling] Error: ${e.message}`);
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
    logger.debug(`[GUIAgent ESC] About to call setupStdinPolling`);
    setupStdinPolling();
    logger.debug(`[GUIAgent ESC] setupStdinPolling called`);

    try {
      // Import and create GUIAgent
      const { createGUISubAgent } = await import('./gui-subagent/index.js');

      const guiAgent = await createGUISubAgent({
        model: !isRemoteMode ? modelName : undefined,
        modelBaseUrl: !isRemoteMode ? baseUrl : undefined,
        modelApiKey: !isRemoteMode ? apiKey : undefined,
        taskId: taskId || undefined,
        isFirstVlmCallRef,
        remoteVlmCaller,
        isLocalMode: !isRemoteMode,
        maxLoopCount: 100,
        loopIntervalInMs: 500,
        showAIDebugInfo: config.get('showAIDebugInfo') || false,
        indentLevel: indentLevel,
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
        // Flush stdout to prevent residual output after prompt
        process.stdout.write('\n');
        return {
          success: true,
          cancelled: true, // Mark as cancelled so main agent won't continue
          message: `GUI task "${description}" cancelled by user`,
          result: 'Task cancelled',
        };
      }

      cleanupStdinPolling();
      cancellationManager.off('cancelled', cancelHandler);

      // Flush stdout to ensure all output is displayed before returning
      process.stdout.write('\n');

      // Return result based on GUIAgent status
      // Always return all info except screenshots (base64) to avoid huge payload
      const conversationsWithoutScreenshots = result.conversations.map((conv: any) => ({
        ...conv,
        screenshotBase64: undefined, // Remove screenshots to avoid huge payload
      }));

      if (result.status === 'end') {
        const iterations = conversationsWithoutScreenshots.filter(
          (c: any) => c.from === 'human' && c.screenshotContext
        ).length;
        console.log(
          `${indent}${colors.success(`${icons.check} GUI task completed in ${iterations} iterations`)}`
        );
        return {
          success: true,
          message: `GUI task "${description}" completed`,
          result: {
            status: result.status,
            iterations,
            actions: conversationsWithoutScreenshots
              .filter((c: any) => c.from === 'assistant' && c.actionType)
              .map((c: any) => c.actionType),
            conversations: conversationsWithoutScreenshots,
            error: result.error,
          },
        };
      } else if (result.status === 'call_llm') {
        // Empty action or needs LLM decision - return to main agent with full context
        console.log(
          `${indent}${colors.warning(`${icons.warning} GUI agent returned to main agent for LLM decision`)}`
        );
        return {
          success: true,
          message: `GUI task "${description}" returned for LLM decision`,
          result: {
            status: result.status,
            iterations: conversationsWithoutScreenshots.filter(
              (c: any) => c.from === 'human' && c.screenshotContext
            ).length,
            actions: conversationsWithoutScreenshots
              .filter((c: any) => c.from === 'assistant' && c.actionType)
              .map((c: any) => c.actionType),
            conversations: conversationsWithoutScreenshots,
            error: result.error,
          },
        };
      } else if (result.status === 'user_stopped') {
        return {
          success: true,
          message: `GUI task "${description}" stopped by user`,
          result: {
            status: result.status,
            iterations: conversationsWithoutScreenshots.filter(
              (c: any) => c.from === 'human' && c.screenshotContext
            ).length,
            actions: conversationsWithoutScreenshots
              .filter((c: any) => c.from === 'assistant' && c.actionType)
              .map((c: any) => c.actionType),
            conversations: conversationsWithoutScreenshots,
            stopped: true,
          },
        };
      } else {
        // status is 'error' or other non-success status
        const errorMsg = result.error || 'Unknown error';
        return {
          success: false,
          message: `GUI task "${description}" failed: ${errorMsg}`,
          result: {
            status: result.status,
            iterations: conversationsWithoutScreenshots.filter(
              (c: any) => c.from === 'human' && c.screenshotContext
            ).length,
            actions: conversationsWithoutScreenshots
              .filter((c: any) => c.from === 'assistant' && c.actionType)
              .map((c: any) => c.actionType),
            conversations: conversationsWithoutScreenshots,
            error: result.error,
          },
        };
      }
    } catch (error: any) {
      cleanupStdinPolling();
      cancellationManager.off('cancelled', cancelHandler);

      // Flush stdout to prevent residual output
      process.stdout.write('\n');

      // If the user cancelled the task, ignore any API errors (like 429)
      // and return cancelled status instead
      if (cancelled || cancellationManager.isOperationCancelled()) {
        return {
          success: true,
          cancelled: true, // Mark as cancelled so main agent won't continue
          message: `GUI task "${description}" cancelled by user`,
          result: 'Task cancelled',
        };
      }

      if (error.message === 'Operation cancelled by user') {
        return {
          success: true,
          message: `GUI task "${description}" cancelled by user`,
          result: 'Task cancelled',
        };
      }

      // Return failure without throwing - let the main agent handle it
      return {
        success: false,
        message: `GUI task "${description}" failed: ${error.message}`,
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
    config: any,
    indentLevel: number = 1
  ): Promise<{ success: boolean; message: string; result?: any }> {
    const agent = agentManager.getAgent(subagent_type);

    if (!agent) {
      throw new Error(`Agent ${subagent_type} not found`);
    }

    // Special handling for gui-subagent: directly call GUIAgent.run() instead of subagent message loop
    if (subagent_type === 'gui-subagent') {
      // Get RemoteAIClient instance from session (if available)
      let remoteAIClient: any;
      try {
        const { getSingletonSession } = await import('./session.js');
        const session = getSingletonSession();
        if (session) {
          remoteAIClient = session.getRemoteAIClient();
        }
      } catch {
        // Session not available, keep undefined
        remoteAIClient = undefined;
      }

      return this.executeGUIAgent(
        prompt,
        description,
        agent,
        mode,
        config,
        indentLevel,
        remoteAIClient
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

    // Create AI client for this subagent - each subagent gets its own independent client
    let subAgentClient;
    let isRemoteMode = false;
    let mainTaskId: string | null = null;
    const authConfig = config.getAuthConfig();

    if (authConfig.type === AuthType.OAUTH_XAGENT) {
      // Remote mode: create independent RemoteAIClient for each subagent
      // This prevents message queue conflicts when multiple subagents run in parallel
      const session = getSingletonSession();
      const remoteAIClient = session?.getRemoteAIClient();

      if (remoteAIClient) {
        // Clone or create independent client for this subagent
        // RemoteAIClient should be designed to handle concurrent requests
        subAgentClient = remoteAIClient;
        isRemoteMode = true;
        mainTaskId = session?.getTaskId() || null;
      } else {
        subAgentClient = createAIClient(authConfig);
      }
    } else {
      // Local mode: create client with subagent-specific model config
      const subAuthConfig = {
        ...authConfig,
        type: AuthType.OPENAI_COMPATIBLE,
        apiKey: apiKey,
        baseUrl: baseUrl,
        modelName: modelName,
        showAIDebugInfo: config.get('showAIDebugInfo') || false,
      };
      subAgentClient = createAIClient(subAuthConfig);
    }

    const indent = '  '.repeat(indentLevel);
    const _indentNext = '  '.repeat(indentLevel + 1);
    const agentName = agent.name || subagent_type;

    // Track execution history for better reporting to main agent
    const executionHistory: Array<{
      tool: string;
      status: 'success' | 'error';
      params: any; // 工具调用参数
      result?: any; // 工具执行结果（成功时）
      error?: string; // 错误信息（失败时）
      timestamp: string;
    }> = [];

    // Helper function to indent multi-line content
    const indentMultiline = (content: string, baseIndent: string): string => {
      return content
        .split('\n')
        .map((line) => `${baseIndent}  ${line}`)
        .join('\n');
    };

    const systemPromptGenerator = new SystemPromptGenerator(toolRegistry, mode, agent);
    const enhancedSystemPrompt = await systemPromptGenerator.generateEnhancedSystemPrompt(
      agent.systemPrompt
    );

    const fullPrompt =
      constraints.length > 0
        ? `${prompt}\n\nConstraints:\n${constraints.map((c) => `- ${c}`).join('\n')}`
        : prompt;

    // Set up raw mode and stdin polling for ESC detection
    const cancellationManager = getCancellationManager();
    const logger = getLogger();
    let cancelled = false;

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
                if (code === 0x1b) {
                  // ESC
                  logger.debug('[TaskTool] ESC detected via polling!');
                  cancellationManager.cancel();
                }
              }
            }
          } catch {
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

    // Check if operation is cancelled
    const checkCancellation = () => {
      if (cancelled || cancellationManager.isOperationCancelled()) {
        cancellationManager.off('cancelled', cancelHandler);
        cleanupStdinPolling();
        throw new Error('Operation cancelled by user');
      }
    };

    const messages: Message[] = [
      { role: 'system', content: enhancedSystemPrompt },
      { role: 'user', content: fullPrompt },
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
          parameters: { type: 'object', properties: {}, required: [] },
        },
      };
    });

    let iteration = 0;
    let lastContentStr = ''; // Track last content for final result

    // Main agent style loop: continue until AI returns no more tool_calls
    while (true) {
      iteration++;

      // Check for cancellation before each iteration
      checkCancellation();

      // Prepare chat options with taskId and model names for remote mode
      const chatOptions: any = {
        tools: toolDefinitions,
        temperature: 0.7,
      };

      // Pass taskId, status, and model names for remote mode subagent calls
      // Subagent shares the same taskId as the main task
      if (isRemoteMode && mainTaskId) {
        chatOptions.taskId = mainTaskId;
        chatOptions.status = iteration === 1 ? 'begin' : 'continue';
        // Pass model names to ensure subagent uses the same models as main task
        chatOptions.llmModelName = config.get('remote_llmModelName');
        chatOptions.vlmModelName = config.get('remote_vlmModelName');
      }

      // Use withCancellation to make API call cancellable
      const result = (await cancellationManager.withCancellation(
        subAgentClient.chatCompletion(messages, chatOptions),
        `api-${subagent_type}-${iteration}`
      )) as any;

      // Check for cancellation after API call
      checkCancellation();

      if (!result || !result.choices || result.choices.length === 0) {
        throw new Error(`Sub-agent ${subagent_type} returned empty response`);
      }

      const choice = result.choices[0];
      const messageContent = choice.message?.content;
      const reasoningContent = choice.message?.reasoning_content || '';
      const toolCalls = choice.message.tool_calls;

      let contentStr: string;
      let hasValidContent = false;

      if (typeof messageContent === 'string') {
        contentStr = messageContent;
        hasValidContent = messageContent.trim() !== '';
      } else if (Array.isArray(messageContent)) {
        const textParts = messageContent
          .filter((item) => typeof item?.text === 'string' && item.text.trim() !== '')
          .map((item) => item.text);
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

      // Add assistant message to conversation (必须包含 tool_calls，否则 tool_result 无法匹配)
      const assistantMessage: any = { role: 'assistant', content: contentStr };
      if (toolCalls && toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls;
      }
      if (reasoningContent) {
        assistantMessage.reasoning_content = reasoningContent;
      }
      messages.push(assistantMessage as Message);

      // Display reasoning content if present
      if (reasoningContent) {
        console.log(`\n${indent}${colors.textDim(`${icons.brain} Thinking Process:`)}`);
        const truncatedReasoning =
          reasoningContent.length > 500
            ? reasoningContent.substring(0, 500) + '...'
            : reasoningContent;
        const indentedReasoning = indentMultiline(truncatedReasoning, indent);
        console.log(`${indentedReasoning}\n`);
      }

      // Display assistant response (if there's any text content) with proper indentation
      if (contentStr) {
        console.log(`\n${indent}${colors.primaryBright(agentName)}: ${description}`);
        const truncatedContent =
          contentStr.length > 500 ? contentStr.substring(0, 500) + '...' : contentStr;
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
          } catch {
            parsedParams = params;
          }

          console.log(`${indent}${colors.textMuted(`${icons.loading} Tool: ${name}`)}`);

          try {
            // Check cancellation before tool execution
            checkCancellation();

            const toolResult: any = await cancellationManager.withCancellation(
              toolRegistry.execute(name, parsedParams, mode, indent),
              `subagent-${subagent_type}-${name}-${iteration}`
            );

            // Get showToolDetails config to control result display
            const showToolDetails = config.get('showToolDetails') || false;

            // Prepare result preview for history
            const resultPreview =
              typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2);
            const truncatedPreview =
              resultPreview.length > 200 ? resultPreview.substring(0, 200) + '...' : resultPreview;

            // Special handling for different tools (consistent with session.ts display logic)
            const isTodoTool = name === 'todo_write' || name === 'todo_read';
            const isEditTool = name === 'Edit';
            const isWriteTool = name === 'Write';
            const isDeleteTool = name === 'DeleteFile';
            const hasDiff = isEditTool && toolResult?.diff;
            const hasFilePreview = isWriteTool && toolResult?.preview;
            const hasDeleteInfo = isDeleteTool && toolResult?.filePath;

            // Import render functions for consistent display
            const { renderDiff, renderLines } = await import('./theme.js');

            if (isTodoTool) {
              // Display todo list
              console.log(`${indent}${colors.success(`${icons.check} Todo List:`)}`);
              const todos = toolResult?.todos || [];
              if (todos.length === 0) {
                console.log(`${indent}  ${colors.textMuted('No tasks')}`);
              } else {
                const statusConfig: Record<
                  string,
                  { icon: string; color: (text: string) => string; label: string }
                > = {
                  pending: { icon: icons.circle, color: colors.textMuted, label: 'Pending' },
                  in_progress: { icon: icons.loading, color: colors.warning, label: 'In Progress' },
                  completed: { icon: icons.success, color: colors.success, label: 'Completed' },
                  failed: { icon: icons.error, color: colors.error, label: 'Failed' },
                };
                for (const todo of todos) {
                  const status = statusConfig[todo.status] || statusConfig['pending'];
                  console.log(
                    `${indent}  ${status.color(status.icon)} ${status.color(status.label)}: ${colors.text(todo.task)}`
                  );
                }
              }
              if (toolResult?.message) {
                console.log(`${indent}${colors.textDim(toolResult.message)}`);
              }
              console.log('');
            } else if (hasDiff) {
              // Display edit result with diff
              console.log('');
              const diffOutput = renderDiff(toolResult.diff);
              const indentedDiff = diffOutput
                .split('\n')
                .map((line) => `${indent}  ${line}`)
                .join('\n');
              console.log(`${indentedDiff}\n`);
            } else if (hasFilePreview) {
              // Display new file content in preview style
              console.log('');
              console.log(`${indent}${colors.success(`${icons.file} ${toolResult.filePath}`)}`);
              console.log(`${indent}${colors.textDim(`  ${toolResult.lineCount} lines`)}`);
              console.log('');
              console.log(renderLines(toolResult.preview, { maxLines: 10, indent: indent + '  ' }));
              console.log('');
            } else if (hasDeleteInfo) {
              // Display DeleteFile result
              console.log('');
              console.log(
                `${indent}${colors.success(`${icons.check} Deleted: ${toolResult.filePath}`)}`
              );
              console.log('');
            } else if (showToolDetails) {
              // Show full result details
              const indentedPreview = indentMultiline(resultPreview, indent);
              console.log(
                `${indent}${colors.success(`${icons.check} Tool Result:`)}\n${indentedPreview}\n`
              );
            } else if (toolResult && toolResult.success === false) {
              // Tool failed
              console.log(
                `${indent}${colors.error(`${icons.cross} ${toolResult.message || 'Failed'}`)}\n`
              );
            } else if (toolResult) {
              // Show brief preview by default
              const indentedPreview = indentMultiline(truncatedPreview, indent);
              console.log(
                `${indent}${colors.success(`${icons.check} Completed`)}\n${indentedPreview}\n`
              );
            } else {
              console.log(`${indent}${colors.textDim('(no result)')}\n`);
            }

            // Record successful tool execution in history (use truncated preview to save memory)
            executionHistory.push({
              tool: name,
              status: 'success',
              params: parsedParams,
              result: truncatedPreview,
              timestamp: new Date().toISOString(),
            });

            messages.push({
              role: 'tool',
              content: JSON.stringify(toolResult),
              tool_call_id: toolCall.id,
            });
          } catch (error: any) {
            if (error.message === 'Operation cancelled by user') {
              console.log(`${indent}${colors.warning(`⚠️  Operation cancelled`)}\n`);
              cancellationManager.off('cancelled', cancelHandler);
              cleanupStdinPolling();
              const summaryPreview =
                contentStr.length > 300 ? contentStr.substring(0, 300) + '...' : contentStr;
              return {
                success: false,
                message: `Task "${description}" cancelled by user`,
                result: {
                  summary: summaryPreview,
                  executionHistory: {
                    totalIterations: iteration,
                    toolsExecuted: executionHistory.length,
                    successfulTools: executionHistory.filter((t) => t.status === 'success').length,
                    failedTools: executionHistory.filter((t) => t.status === 'error').length,
                    history: executionHistory,
                    cancelled: true,
                  },
                },
              };
            }
            console.log(`${indent}${colors.error(`${icons.cross} Error:`)} ${error.message}\n`);

            // Record failed tool execution in history
            executionHistory.push({
              tool: name,
              status: 'error',
              params: parsedParams,
              error: error.message,
              timestamp: new Date().toISOString(),
            });

            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: error.message }),
              tool_call_id: toolCall.id,
            });
          }
        }
        console.log('');
        continue; // Continue to next iteration to get final response
      }

      // No more tool calls - break loop (same as main agent)
      lastContentStr = contentStr || '';
      break;
    }

    // Loop ended - return result (same as main agent pattern)
    cancellationManager.off('cancelled', cancelHandler);
    cleanupStdinPolling();

    const summaryPreview =
      lastContentStr.length > 300 ? lastContentStr.substring(0, 300) + '...' : lastContentStr;
    return {
      success: true,
      message: `Task "${description}" completed by ${subagent_type}`,
      result: {
        summary: summaryPreview,
        executionHistory: {
          totalIterations: iteration,
          toolsExecuted: executionHistory.length,
          successfulTools: executionHistory.filter((t) => t.status === 'success').length,
          failedTools: executionHistory.filter((t) => t.status === 'error').length,
          history: executionHistory,
        },
      },
    };
  }

  private async executeParallelAgents(
    agents: SubAgentTask[],
    description: string,
    mode: ExecutionMode,
    agentManager: any,
    toolRegistry: any,
    config: any,
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
                if (code === 0x1b) {
                  // ESC
                  logger.debug('[ParallelAgents] ESC detected via polling!');
                  cancellationManager.cancel();
                }
              }
            }
          } catch {
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

    console.log(
      `\n${indent}${colors.accent('◆')} ${colors.primaryBright('Parallel Agents')}: ${agents.length} running...`
    );

    const startTime = Date.now();

    const agentPromises = agents.map(async (agentTask, _index) => {
      // Check if cancelled
      if (cancelled || cancellationManager.isOperationCancelled()) {
        return {
          success: false,
          agent: agentTask.subagent_type,
          description: agentTask.description,
          error: 'Operation cancelled by user',
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
          config,
          indentLevel + 1
        );

        return {
          success: true,
          agent: agentTask.subagent_type,
          description: agentTask.description,
          result: result.result,
        };
      } catch (error: any) {
        return {
          success: false,
          agent: agentTask.subagent_type,
          description: agentTask.description,
          error: error.message,
        };
      }
    });

    const results = await Promise.all(agentPromises);

    const duration = Date.now() - startTime;

    const successfulAgents = results.filter((r) => r.success);
    const failedAgents = results.filter((r) => !r.success);

    console.log(
      `${indent}${colors.success('✔')} Parallel task completed in ${colors.textMuted(duration + 'ms')}`
    );
    console.log(
      `${indent}${colors.info('ℹ')} Success: ${successfulAgents.length}/${agents.length} agents\n`
    );

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
      results: successfulAgents.map((r) => ({
        agent: r.agent,
        description: r.description,
        result: r.result,
      })),
      errors: failedAgents.map((r) => ({
        agent: r.agent,
        description: r.description,
        error: r.error,
      })),
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

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
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));

      const duration = Date.now() - task.startTime;
      const output = task.output.join('');
      const status = task.process.exitCode === null ? 'running' : 'completed';

      return {
        taskId: task_id,
        output,
        status,
        duration: Math.floor(duration / 1000),
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

  async execute(params: {
    prompt: string;
  }): Promise<{ content: string; url: string; status: number }> {
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
        validateStatus: () => true,
      });

      let content = response.data;

      if (typeof content === 'object') {
        content = JSON.stringify(content, null, 2);
      }

      return {
        content,
        url,
        status: response.status,
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

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
          const options = q.options.map((opt) => ({ value: opt, label: opt }));
          const result = await select({
            message: q.question,
            options,
          });

          answers.push(result as string);
        } else {
          const result = (await text({
            message: q.question,
          })) as string;

          answers.push(result);
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

  async execute(params: { fact: string }): Promise<{ success: boolean; message: string }> {
    const { fact } = params;

    try {
      const { getMemoryManager } = await import('./memory.js');
      const memoryManager = getMemoryManager(process.cwd());

      await memoryManager.saveMemory(fact, 'global');

      return {
        success: true,
        message: `Successfully saved fact to memory`,
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

  async execute(params: {
    plan: string;
  }): Promise<{ success: boolean; message: string; plan: string }> {
    const { plan } = params;

    try {
      return {
        success: true,
        message: 'Plan completed and ready for execution',
        plan,
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
        { char: "'", replacement: '&apos;' },
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
          { char: '€', replacement: '&euro;' },
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
        changes,
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
  allowedModes = [
    ExecutionMode.YOLO,
    ExecutionMode.ACCEPT_EDITS,
    ExecutionMode.PLAN,
    ExecutionMode.SMART,
  ];

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

      const configManager = await import('./config.js');
      const { getConfigManager } = configManager;
      const config = getConfigManager();
      const authConfig = config.getAuthConfig();

      const aiClient = createAIClient(authConfig);

      const textContent = task_brief ? `${task_brief}\n\n${prompt}` : prompt;
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: textContent,
            },
            {
              type: 'image_url' as const,
              image_url: {
                url: `data:${mime_type || 'image/jpeg'};base64,${imageData}`,
              },
            },
          ],
        },
      ];

      const result = await aiClient.chatCompletion(messages, {
        temperature: 0.7,
      });

      const messageContent = result.choices[0]?.message?.content;
      const analysis = typeof messageContent === 'string' ? messageContent : '';

      return {
        analysis,
        image_info: {
          input_type,
          prompt,
          task_brief,
        },
      };
    } catch (error: any) {
      throw new Error(`Failed to read image: ${error.message}`);
    }
  }
}

// export class SkillTool implements Tool {
//   name = 'Skill';
//   description = `Execute pre-defined workflows (skills) from the xAgent marketplace. Skills are reusable workflows that automate common tasks.

// # When to Use
// - When a skill exists for the requested task
// - When you need to run a multi-step workflow
// - When the task matches a marketplace workflow

// # When NOT to Use
// - When a simple tool can accomplish the task
// - When creating new functionality from scratch
// - When skill doesn't exist for the specific task

// # Parameters
// - \`skill\`: The skill/workflow name to execute

// # Examples
// - Execute a PDF processing skill
// - Run a data analysis workflow

// # Best Practices
// - Skills are pre-configured workflows from the marketplace
// - Check if a relevant skill exists first`;
//   allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

//   async execute(params: { skill: string }): Promise<{ success: boolean; message: string; result?: any }> {
//     const { skill } = params;

//     try {
//       const { getWorkflowManager } = await import('./workflow.js');
//       const workflowManager = getWorkflowManager(process.cwd());

//       const workflow = workflowManager.getWorkflow(skill);

//       if (!workflow) {
//         throw new Error(`Skill ${skill} not found`);
//       }

//       await workflowManager.executeWorkflow(skill, 'Execute skill');

//       return {
//         success: true,
//         message: `Successfully executed skill: ${skill}`,
//         result: workflow
//       };
//     } catch (error: any) {
//       throw new Error(`Failed to execute skill: ${error.message}`);
//     }
//   }
// }

export class InvokeSkillTool implements Tool {
  name = 'InvokeSkill';
  description = `Invoke a specialized skill to handle domain-specific tasks. Skills are AI-powered capabilities that understand complex requirements and generate high-quality outputs (see Available Skills section below for the list of skills).

# When to Use
- When user requests involve document processing (Word, PDF, PowerPoint)
- When user wants to create frontend interfaces or web applications
- When user needs visual design, posters, or generative art
- When user asks for documentation or internal communications
- When the task matches a specific skill domain

# When NOT to Use
- For simple file operations (use Read/Write instead)
- For basic code changes (use Edit/Write instead)
- When a regular tool can accomplish the task

# Parameters
- \`skillId\`: The skill identifier (see Available Skills section)
- \`taskDescription\`: Detailed description of what to accomplish
- \`inputFile\`: (Optional) Path to input file if applicable
- \`outputFile\`: (Optional) Desired output file path
- \`options\`: (Optional) Additional options for the skill

# Best Practices
- Provide detailed task descriptions for better results
- Include relevant file paths when working with existing files
- Match the skill to the domain (e.g., don't use frontend-design for Word docs)
- Skills will guide you through their specific workflows`;
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

  async execute(
    params: {
      skillId: string;
      taskDescription: string;
      inputFile?: string;
      outputFile?: string;
      options?: Record<string, any>;
    },
    _executionMode?: ExecutionMode
  ): Promise<{
    success: boolean;
    message: string;
    skill: string;
    task: string;
    result?: any;
    files?: string[];
    /** Tell the agent what to do next */
    nextSteps?: Array<{
      step: number;
      action: string;
      description: string;
      command?: string;
      file?: string;
      reason: string;
    }>;
    guidance?: string;
    /** Skill directory path for dependency management */
    skillPath?: string;
  }> {
    const { skillId, taskDescription, inputFile, outputFile, options } = params;

    try {
      const { getSkillInvoker } = await import('./skill-invoker.js');
      const skillInvoker = getSkillInvoker();

      await skillInvoker.initialize();

      // Verify skill exists
      const skillDetails = await skillInvoker.getSkillDetails(skillId);
      if (!skillDetails) {
        // Try to auto-match the skill
        const match = await skillInvoker.matchSkill(taskDescription);
        if (match) {
          // Auto-matched, now execute the skill to get the full guidance
          const result = await skillInvoker.executeSkill({
            skillId: match.skill.id,
            taskDescription,
            inputFile,
            outputFile,
            options,
          });

          if (result.success) {
            return {
              success: true,
              message: `Auto-matched skill: ${match.skill.name} (${match.category})`,
              skill: match.skill.id,
              task: taskDescription,
              result: result.output,
              files: result.files,
              nextSteps: result.nextSteps,
            };
          } else {
            throw new Error(result.error || 'Failed to execute matched skill');
          }
        }
        throw new Error(`Skill not found: ${skillId}`);
      }

      const result = await skillInvoker.executeSkill({
        skillId,
        taskDescription,
        inputFile,
        outputFile,
        options,
      });

      if (result.success) {
        return {
          success: true,
          message: `Skill activated: ${skillDetails.name}`,
          skill: skillId,
          task: taskDescription,
          result: result.output,
          files: result.files,
          nextSteps: result.nextSteps,
          skillPath: result.skillPath
        };
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      throw new Error(`Failed to invoke skill: ${error.message}`);
    }
  }
}

// export class ListSkillsTool implements Tool {
//   name = 'ListSkills';
//   description = `List all available skills from the xAgent skills library. Use this tool when you need to:
// - See what skills are available
// - Find skills that match a user's request
// - Get an overview of capabilities

// This returns a list of all skills with their names, descriptions, and categories.`;

//   allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.SMART];

//   async execute(): Promise<{ success: boolean; skills: any[] }> {
//     try {
//       const { getWorkflowManager } = await import('./workflow.js');
//       const workflowManager = getWorkflowManager(process.cwd());
//       const skills = await workflowManager.listSkills();

//       return {
//         success: true,
//         skills: skills.map(s => ({
//           id: s.id,
//           name: s.name,
//           description: s.description,
//           category: s.category
//         }))
//       };
//     } catch (error: any) {
//       throw new Error(`Failed to list skills: ${error.message}`);
//     }
//   }
// }

// export class GetSkillDetailsTool implements Tool {
//   name = 'GetSkillDetails';
//   description = `Get detailed information about a specific skill. Use this tool when:
// - You want to understand what a skill does before executing it
// - You need the full skill documentation to help the user
// - You need to verify a skill exists before using it

// # Parameters
// - \`skill\`: The skill name/id to get details for

// # Returns
// The full skill documentation including instructions, examples, and guidelines.`;

//   allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

//   async execute(params: { skill: string }): Promise<{ success: boolean; details: any }> {
//     const { skill } = params;

//     if (!skill) {
//       throw new Error('Skill parameter is required');
//     }

//     try {
//       const { getWorkflowManager } = await import('./workflow.js');
//       const workflowManager = getWorkflowManager(process.cwd());
//       const details = await workflowManager.getSkillDetails(skill);

//       if (!details) {
//         throw new Error(`Skill '${skill}' not found`);
//       }

//       return {
//         success: true,
//         details: {
//           id: details.id,
//           name: details.name,
//           description: details.description,
//           category: details.category,
//           content: details.content
//         }
//       };
//     } catch (error: any) {
//       throw new Error(`Failed to get skill details: ${error.message}`);
//     }
//   }
// }

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private todoWriteTool: TodoWriteTool;
  private backgroundTasks: Map<string, { process: any; startTime: number; output: string[] }> =
    new Map();

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
    this.register(new SearchFilesTool());
    this.register(new DeleteFileTool());
    this.register(new CreateDirectoryTool());
    this.register(new EditTool());
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
    // Deprecated: Use InvokeSkillTool instead (2026-01-17)
    // this.register(new SkillTool());
    // this.register(new ListSkillsTool());
    // this.register(new GetSkillDetailsTool());
    this.register(new InvokeSkillTool());
    // GUI Subagent Tools
    // this.register(new GUIOperateTool());
    // this.register(new GUIScreenshotTool());
    // this.register(new GUICleanupTool());
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register MCP tools with their simple names (without server prefix)
   * This allows the LLM to call MCP tools using simple names like "create_issue"
   * instead of "github__create_issue"
   */
  registerMCPTools(mcpTools: Map<string, any>): void {
    let registeredCount = 0;

    for (const [fullName, tool] of mcpTools) {
      const firstUnderscoreIndex = fullName.indexOf('__');

      if (
        firstUnderscoreIndex === -1 ||
        firstUnderscoreIndex === 0 ||
        firstUnderscoreIndex === fullName.length - 2
      )
        continue;

      const serverName = fullName.substring(0, firstUnderscoreIndex);

      const originalName = fullName.substring(firstUnderscoreIndex + 2);

      if (!originalName || originalName.trim() === '') continue;

      // Auto-rename if conflict, ensure unique name
      let toolName = originalName;
      let suffix = 1;

      while (this.tools.has(toolName)) {
        const existingTool = this.tools.get(toolName);
        const existingIsMcp = (existingTool as any)._isMcpTool;

        if (existingIsMcp && (existingTool as any)._mcpFullName === fullName) {
          // Same MCP tool already registered, skip silently
          break;
        }

        // Conflict - auto-rename with suffix
        toolName = `${originalName}_mcp${suffix}`;
        suffix++;
      }

      if (!this.tools.has(toolName)) {
        // Create a wrapper tool for the MCP tool - hide MCP origin from LLM
        const mcpTool: any = {
          name: toolName,
          description: tool.description || 'MCP tool',
          allowedModes: [ExecutionMode.YOLO, ExecutionMode.SMART, ExecutionMode.ACCEPT_EDITS],
          inputSchema: tool.inputSchema,
          _isMcpTool: true,
          _mcpServerName: serverName,
          _mcpFullName: fullName,
          execute: async (params: any) => {
            const { getMCPManager } = await import('./mcp.js');
            const mcpManager = getMCPManager();
            return await mcpManager.callTool(fullName, params);
          },
        };
        this.tools.set(toolName, mcpTool);
        registeredCount++;

        if (toolName !== originalName) {
          console.log(`[MCP] Tool '${originalName}' renamed to '${toolName}' to avoid conflict`);
        }
      }
    }

    if (registeredCount > 0) {
      console.log(`[MCP] Registered ${registeredCount} tool(s)`);
    }
  }

  /**
   * Remove all MCP tool wrappers (useful when MCP servers are removed)
   */
  unregisterMCPTools(serverName?: string): void {
    for (const [name, tool] of this.tools) {
      // Remove MCP tool wrappers by checking marker
      const mcpTool = tool as any;
      if (mcpTool._isMcpTool && (!serverName || mcpTool._mcpServerName === serverName)) {
        this.tools.delete(name);
      }
    }
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

  addBackgroundTask(
    taskId: string,
    task: { process: any; startTime: number; output: string[] }
  ): void {
    this.backgroundTasks.set(taskId, task);
  }

  getBackgroundTask(
    taskId: string
  ): { process: any; startTime: number; output: string[] } | undefined {
    return this.backgroundTasks.get(taskId);
  }

  removeBackgroundTask(taskId: string): void {
    this.backgroundTasks.delete(taskId);
  }

  getToolDefinitions(): any[] {
    return Array.from(this.tools.values()).map((tool) => {
      let parameters: any = {
        type: 'object',
        properties: {},
        required: [],
      };

      // Define specific parameters for each tool
      switch (tool.name) {
        case 'Read':
          parameters = {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The absolute path to the file to read',
              },
              offset: {
                type: 'number',
                description: 'Optional: Line number to start reading from (0-based)',
              },
              limit: {
                type: 'number',
                description: 'Optional: Maximum number of lines to read',
              },
            },
            required: ['filePath'],
          };
          break;

        case 'Write':
          parameters = {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The absolute path to the file to write',
              },
              content: {
                type: 'string',
                description: 'The content to write to the file',
              },
            },
            required: ['filePath', 'content'],
          };
          break;

        case 'Grep':
          parameters = {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'The regex pattern or literal string to search for',
              },
              path: {
                type: 'string',
                description: 'Optional: The path to search in (default: current directory)',
              },
              glob: {
                type: 'string',
                description: 'Optional: Glob pattern to filter files (e.g., "*.ts", "**/*.js")',
              },
              ignoreCase: {
                type: 'boolean',
                description: 'Optional: Case-insensitive search (default: false)',
              },
              literal: {
                type: 'boolean',
                description: 'Optional: Treat pattern as literal string (default: false)',
              },
              context: {
                type: 'number',
                description: 'Optional: Number of context lines to show before and after',
              },
              limit: {
                type: 'number',
                description: 'Optional: Maximum number of matches to return',
              },
            },
            required: ['pattern'],
          };
          break;

        case 'Bash':
          parameters = {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The shell command to execute',
              },
              cwd: {
                type: 'string',
                description: 'Optional: Working directory',
              },
              description: {
                type: 'string',
                description: 'Optional: Brief description of the command',
              },
              timeout: {
                type: 'number',
                description: 'Optional: Timeout in seconds (default: 120)',
              },
              run_in_bg: {
                type: 'boolean',
                description: 'Optional: Run in background (default: false)',
              },
            },
            required: ['command'],
          };
          break;

        case 'ListDirectory':
          parameters = {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Optional: The directory path to list (default: current directory)',
              },
              recursive: {
                type: 'boolean',
                description: 'Optional: List recursively (default: false)',
              },
            },
            required: [],
          };
          break;

        case 'SearchFiles':
          parameters = {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'The glob pattern to match files',
              },
              path: {
                type: 'string',
                description: 'Optional: The path to search in (default: current directory)',
              },
              limit: {
                type: 'integer',
                description: 'Optional: Maximum number of results to return (default: 1000)',
              },
            },
            required: ['pattern'],
          };
          break;

        case 'DeleteFile':
          parameters = {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The path to the file to delete',
              },
            },
            required: ['filePath'],
          };
          break;

        case 'CreateDirectory':
          parameters = {
            type: 'object',
            properties: {
              dirPath: {
                type: 'string',
                description: 'The directory path to create',
              },
              recursive: {
                type: 'boolean',
                description: 'Optional: Create parent directories (default: true)',
              },
            },
            required: ['dirPath'],
          };
          break;

        case 'Edit':
          parameters = {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'The absolute path to the file to edit',
              },
              instruction: {
                type: 'string',
                description: 'Description of what needs to be changed',
              },
              old_string: {
                type: 'string',
                description: 'The exact text to replace (supports fuzzy matching)',
              },
              new_string: {
                type: 'string',
                description: 'The new text to replace with',
              },
            },
            required: ['file_path', 'instruction', 'old_string', 'new_string'],
          };
          break;

        case 'web_search':
          parameters = {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query',
              },
            },
            required: ['query'],
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
                    status: {
                      type: 'string',
                      enum: ['pending', 'in_progress', 'completed', 'failed'],
                    },
                    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                  },
                  required: ['id', 'task', 'status'],
                },
              },
            },
            required: ['todos'],
          };
          break;

        case 'todo_read':
          parameters = {
            type: 'object',
            properties: {},
            required: [],
          };
          break;

        case 'task':
          parameters = {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Brief description of the task (3-5 words)',
              },
              agents: {
                type: 'array',
                description:
                  'Optional: Array of agents to run in parallel for comprehensive analysis',
                items: {
                  type: 'object',
                  properties: {
                    description: {
                      type: 'string',
                      description: 'Brief description of the sub-agent task',
                    },
                    prompt: {
                      type: 'string',
                      description: 'The task for the sub-agent to perform',
                    },
                    subagent_type: {
                      type: 'string',
                      enum: [
                        'general-purpose',
                        'plan-agent',
                        'explore-agent',
                        'frontend-tester',
                        'code-reviewer',
                        'frontend-developer',
                        'backend-developer',
                      ],
                      description: 'The type of specialized agent',
                    },
                    constraints: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Optional: Constraints or limitations',
                    },
                  },
                  required: ['description', 'prompt', 'subagent_type'],
                },
              },
              prompt: {
                type: 'string',
                description:
                  'Optional: The task for the agent to perform (use agents for parallel execution)',
              },
              subagent_type: {
                type: 'string',
                enum: [
                  'general-purpose',
                  'plan-agent',
                  'explore-agent',
                  'frontend-tester',
                  'code-reviewer',
                  'frontend-developer',
                  'backend-developer',
                ],
                description:
                  'Optional: The type of specialized agent (use agents for parallel execution)',
              },
              useContext: {
                type: 'boolean',
                description: 'Optional: Include main agent context',
              },
              outputFormat: {
                type: 'string',
                description: 'Optional: Output format template',
              },
              constraints: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional: Constraints or limitations',
              },
            },
            required: ['description'],
          };
          break;

        case 'ReadBashOutput':
          parameters = {
            type: 'object',
            properties: {
              task_id: {
                type: 'string',
                description: 'The ID of the task',
              },
              poll_interval: {
                type: 'number',
                description: 'Optional: Polling interval in seconds (default: 10)',
              },
            },
            required: ['task_id'],
          };
          break;

        case 'web_fetch':
          parameters = {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'Prompt containing URL(s) and processing instructions',
              },
            },
            required: ['prompt'],
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
                      description: 'Available choices (2-4 options)',
                    },
                    multiSelect: { type: 'boolean' },
                  },
                  required: ['question', 'header', 'options', 'multiSelect'],
                },
              },
            },
            required: ['questions'],
          };
          break;

        case 'save_memory':
          parameters = {
            type: 'object',
            properties: {
              fact: {
                type: 'string',
                description: 'The specific fact to remember',
              },
            },
            required: ['fact'],
          };
          break;

        case 'exit_plan_mode':
          parameters = {
            type: 'object',
            properties: {
              plan: {
                type: 'string',
                description: 'The plan to present',
              },
            },
            required: ['plan'],
          };
          break;

        case 'xml_escape':
          parameters = {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'The absolute path to the XML/HTML file',
              },
              escape_all: {
                type: 'boolean',
                description: 'Optional: Escape all special characters (default: false)',
              },
            },
            required: ['file_path'],
          };
          break;

        case 'image_read':
          parameters = {
            type: 'object',
            properties: {
              image_input: {
                type: 'string',
                description: 'Image file path or base64 data',
              },
              prompt: {
                type: 'string',
                description: 'Comprehensive VLM instruction',
              },
              task_brief: {
                type: 'string',
                description: 'Brief task description (max 15 words)',
              },
              input_type: {
                type: 'string',
                enum: ['file_path', 'base64'],
                description: 'Input type (default: file_path)',
              },
              mime_type: {
                type: 'string',
                description: 'Optional: MIME type for base64 input',
              },
            },
            required: ['image_input', 'prompt'],
          };
          break;

        case 'Skill':
          parameters = {
            type: 'object',
            properties: {
              skill: {
                type: 'string',
                description: 'The skill name to execute',
              },
            },
            required: ['skill'],
          };
          break;

        case 'ListSkills':
          parameters = {
            type: 'object',
            properties: {},
            required: [],
          };
          break;

        case 'GetSkillDetails':
          parameters = {
            type: 'object',
            properties: {
              skill: {
                type: 'string',
                description: 'The skill name/id to get details for',
              },
            },
            required: ['skill'],
          };
          break;

        default: {
          // For MCP tools, use their inputSchema; for other unknown tools, keep empty schema
          const mcpTool = tool as any;
          if (mcpTool._isMcpTool && mcpTool.inputSchema) {
            // Use MCP tool's inputSchema directly
            parameters = {
              type: 'object',
              properties: {},
              required: [],
            };
            if (mcpTool.inputSchema.properties) {
              for (const [paramName, paramDef] of Object.entries<any>(
                mcpTool.inputSchema.properties
              )) {
                parameters.properties[paramName] = {
                  type: paramDef.type || 'string',
                  description: paramDef.description || '',
                };
              }
            }
            if (mcpTool.inputSchema.required) {
              parameters.required = mcpTool.inputSchema.required;
            }
          } else {
            parameters = {
              type: 'object',
              properties: {},
              required: [],
            };
          }
        }
      }

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters,
        },
      };
    });
  }

  async execute(
    toolName: string,
    params: any,
    executionMode: ExecutionMode,
    indent: string = ''
  ): Promise<any> {
    // First try to execute as local tool
    const localTool = this.tools.get(toolName);
    if (localTool) {
      return await this.executeLocalTool(toolName, params, executionMode, indent);
    }

    // Fall back to MCP tool if local tool doesn't exist
    const { getMCPManager } = await import('./mcp.js');
    const mcpManager = getMCPManager();
    const allMcpTools = mcpManager.getAllTools();

    // Check if this is an MCP tool (format: serverName__toolName)
    if (toolName.includes('__') && allMcpTools.has(toolName)) {
      return await this.executeMCPTool(toolName, params, executionMode, indent);
    }

    // Try to find MCP tool with just the tool name (try each server)
    for (const [fullName, _tool] of allMcpTools) {
      // Split only on the first __ to preserve underscores in tool names
      const firstUnderscoreIndex = fullName.indexOf('__');
      if (firstUnderscoreIndex === -1) continue;
      const [_serverName, actualToolName] = [
        fullName.substring(0, firstUnderscoreIndex),
        fullName.substring(firstUnderscoreIndex + 2),
      ];
      if (actualToolName === toolName) {
        return await this.executeMCPTool(fullName, params, executionMode, indent);
      }
    }

    // Tool not found anywhere
    throw new Error(`Tool not found: ${toolName}`);
  }

  /**
   * Execute local tool (extracted for reuse)
   */
  private async executeLocalTool(
    toolName: string,
    params: any,
    executionMode: ExecutionMode,
    indent: string
  ): Promise<any> {
    const tool = this.get(toolName);
    const cancellationManager = getCancellationManager();

    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    if (!tool.allowedModes.includes(executionMode)) {
      throw new Error(`Tool ${toolName} is not allowed in ${executionMode} mode`);
    }

    // Smart approval mode
    if (executionMode === ExecutionMode.SMART) {
      const debugMode = process.env.DEBUG === 'smart-approval';

      // task tool bypasses smart approval entirely
      if (toolName === 'task') {
        if (debugMode) {
          const { getLogger } = await import('./logger.js');
          const logger = getLogger();
          logger.debug(
            `[SmartApprovalEngine] Tool '${toolName}' bypassed smart approval completely`
          );
        }
        return await cancellationManager.withCancellation(
          tool.execute(params, executionMode),
          `tool-${toolName}`
        );
      }

      // Remote mode (OAuth XAGENT): remote LLM has already approved the tool
      // Auto-approve InvokeSkill tools without local AI review
      const { getConfigManager } = await import('./config.js');
      const configManager = getConfigManager();
      const authConfig = configManager.getAuthConfig();
      const isRemoteMode = authConfig.type === AuthType.OAUTH_XAGENT;
      if (isRemoteMode && toolName === 'InvokeSkill') {
        console.log('');
        console.log(
          `${indent}${colors.success(`✅ [Smart Mode] Remote mode: tool '${toolName}' auto-approved (remote LLM already approved)`)}`
        );
        console.log('');
        return await cancellationManager.withCancellation(
          tool.execute(params, executionMode),
          `tool-${toolName}`
        );
      }

      const { getSmartApprovalEngine } = await import('./smart-approval.js');

      const approvalEngine = getSmartApprovalEngine(debugMode);

      // Evaluate tool call
      const result = await approvalEngine.evaluate({
        toolName,
        params,
        timestamp: Date.now(),
      });

      // Decide whether to execute based on approval result
      if (result.decision === 'approved') {
        // Whitelist or AI approval passed, execute directly
        console.log('');
        console.log(
          `${indent}${colors.success(`✅ [Smart Mode] Tool '${toolName}' passed approval, executing directly`)}`
        );
        console.log(
          `${indent}${colors.textDim(`  Detection method: ${result.detectionMethod === 'whitelist' ? 'Whitelist' : 'AI Review'}`)}`
        );
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
          console.log(
            `${indent}${colors.success(`✅ [Smart Mode] User confirmed execution of tool '${toolName}'`)}`
          );
          console.log('');
          return await cancellationManager.withCancellation(
            tool.execute(params, executionMode),
            `tool-${toolName}`
          );
        } else {
          console.log('');
          console.log(
            `${indent}${colors.warning(`⚠️  [Smart Mode] User cancelled execution of tool '${toolName}'`)}`
          );
          console.log('');
          throw new Error(`Tool execution cancelled by user: ${toolName}`);
        }
      } else {
        // Rejected execution
        console.log('');
        console.log(
          `${indent}${colors.error(`❌ [Smart Mode] Tool '${toolName}' execution rejected`)}`
        );
        console.log(`${indent}${colors.textDim(`  Reason: ${result.description}`)}`);
        console.log('');
        throw new Error(`Tool execution rejected: ${toolName}`);
      }
    }

    // Other modes execute directly
    return await cancellationManager.withCancellation(
      tool.execute(params, executionMode),
      `tool-${toolName}`
    );
  }

  /**
   * Execute an MCP tool call
   */
  private async executeMCPTool(
    toolName: string,
    params: any,
    executionMode: ExecutionMode,
    indent: string = ''
  ): Promise<any> {
    const { getMCPManager } = await import('./mcp.js');
    const mcpManager = getMCPManager();
    const cancellationManager = getCancellationManager();

    // Split only on the first __ to preserve underscores in tool names
    const firstUnderscoreIndex = toolName.indexOf('__');
    const serverName = toolName.substring(0, firstUnderscoreIndex);
    const actualToolName = toolName.substring(firstUnderscoreIndex + 2);

    // Get server info for display
    const server = mcpManager.getServer(serverName);
    const _serverTools = server?.getToolNames() || [];

    // Display tool call info
    console.log('');
    console.log(
      `${indent}${colors.warning(`${icons.tool} MCP Tool Call: ${serverName}::${actualToolName}`)}`
    );

    // Smart approval mode for MCP tools
    if (executionMode === ExecutionMode.SMART) {
      const debugMode = process.env.DEBUG === 'smart-approval';
      const { getSmartApprovalEngine } = await import('./smart-approval.js');
      const { getConfigManager } = await import('./config.js');
      const configManager = getConfigManager();
      const authConfig = configManager.getAuthConfig();
      const isRemoteMode = authConfig.type === AuthType.OAUTH_XAGENT;

      // Remote mode: remote LLM has already approved the tool, auto-approve
      if (isRemoteMode) {
        console.log(
          `${indent}${colors.success(`✅ [Smart Mode] Remote mode: MCP tool '${serverName}::${actualToolName}' auto-approved`)}`
        );
      } else {
        const approvalEngine = getSmartApprovalEngine(debugMode);

        // Evaluate MCP tool call
        const result = await approvalEngine.evaluate({
          toolName: `MCP[${serverName}]::${actualToolName}`,
          params,
          timestamp: Date.now(),
        });

        if (result.decision === 'approved') {
          console.log(
            `${indent}${colors.success(`✅ [Smart Mode] MCP tool '${serverName}::${actualToolName}' passed approval`)}`
          );
          console.log(
            `${indent}${colors.textDim(`  Detection method: ${result.detectionMethod === 'whitelist' ? 'Whitelist' : 'AI Review'}`)}`
          );
        } else if (result.decision === 'requires_confirmation') {
          const confirmed = await approvalEngine.requestConfirmation(result);
          if (!confirmed) {
            console.log(
              `${indent}${colors.warning(`⚠️  [Smart Mode] User cancelled MCP tool execution`)}`
            );
            throw new Error(`Tool execution cancelled by user: ${toolName}`);
          }
        } else {
          console.log(`${indent}${colors.error(`❌ [Smart Mode] MCP tool execution rejected`)}`);
          console.log(`${indent}${colors.textDim(`  Reason: ${result.description}`)}`);
          throw new Error(`Tool execution rejected: ${toolName}`);
        }
      }
    }

    // Execute the MCP tool call with cancellation support
    const operationId = `mcp-${serverName}-${actualToolName}-${Date.now()}`;
    return await cancellationManager.withCancellation(
      mcpManager.callTool(toolName, params),
      operationId
    );
  }

  async executeAll(
    toolCalls: Array<{ name: string; params: any }>,
    executionMode: ExecutionMode
  ): Promise<Array<{ tool: string; result: any; error?: string }>> {
    const results: Array<{ tool: string; result: any; error?: string }> = [];

    const executePromises = toolCalls.map(async (toolCall) => {
      const { name, params } = toolCall;

      try {
        const result = await this.execute(name, params, executionMode);
        return { tool: name, result, error: undefined };
      } catch (error: any) {
        return { tool: name, result: undefined, error: error.message };
      }
    });

    const settledResults = await Promise.all(executePromises);

    for (const result of settledResults) {
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
