import fs from 'fs/promises';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import axios from 'axios';
import inquirer from 'inquirer';
import { Tool, ExecutionMode, AuthType } from './types.js';
import type { Message, ToolDefinition } from './ai-client.js';
import { colors } from './theme.js';
import { getCancellationManager } from './cancellation.js';

const execAsync = promisify(exec);

export class ReadTool implements Tool {
  name = 'Read';
  description = 'Read the contents of a file';
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
  description = 'Write content to a file';
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
  description = 'Search for text patterns in files';
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
  description = 'Execute shell commands';
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
  description = 'List files and directories in a path';
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
  description = 'Search for files matching a pattern';
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
  description = 'Delete a file';
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
  description = 'Create a directory';
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
  description = 'Replace text in a file';
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
  description = 'Search web and return results';
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
  description = 'Create and manage structured task lists';
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
  description = 'Read current session todo list';
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

export class TaskTool implements Tool {
  name = 'task';
  description = 'Launch specialized subagent for complex multi-step tasks';
  allowedModes = [ExecutionMode.YOLO, ExecutionMode.ACCEPT_EDITS, ExecutionMode.PLAN, ExecutionMode.SMART];

  async execute(params: {
    description: string;
    prompt: string;
    subagent_type: 'general-purpose' | 'plan-agent' | 'explore-agent' | 'frontend-tester';
    useContext?: boolean;
    outputFormat?: string;
    constraints?: string[];
  }): Promise<{ success: boolean; message: string; result?: any }> {
    const { description, prompt, subagent_type, useContext = true, outputFormat, constraints } = params;
    
    try {
      const { getAgentManager } = await import('./agents.js');
      const agentManager = getAgentManager(process.cwd());
      
      const agent = agentManager.getAgent(subagent_type);
      
      if (!agent) {
        throw new Error(`Agent ${subagent_type} not found`);
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
      
      const systemPrompt = agent.systemPrompt;
      const fullPrompt = constraints 
        ? `${prompt}\n\nConstraints:\n${constraints.map(c => `- ${c}`).join('\n')}`
        : prompt;
      
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullPrompt }
      ];
      
      const toolDefinitions: ToolDefinition[] = (agent.allowedTools || []).map(toolName => ({
        type: 'function' as const,
        function: {
          name: toolName,
          description: `Tool: ${toolName}`,
          parameters: { type: 'object', properties: {}, required: [] }
        }
      }));
      
      const result = await aiClient.chatCompletion(messages, {
        tools: toolDefinitions,
        temperature: 0.7
      });
      
      return {
        success: true,
        message: `Task "${description}" completed by ${subagent_type}`,
        result: result
      };
    } catch (error: any) {
      throw new Error(`Task execution failed: ${error.message}`);
    }
  }
}

export class ReadBashOutputTool implements Tool {
  name = 'ReadBashOutput';
  description = 'Retrieve output from running or completed background tasks';
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
  description = 'Fetch and process URL content, including local and private network addresses';
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
  description = 'Ask user questions during execution';
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
  description = 'Save specific information to long-term memory';
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
  description = 'Complete plan presentation in plan mode and prepare for coding';
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
  description = 'Automatically escape special characters in XML/HTML files';
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
  description = 'Read image files and generate detailed analysis using VL model';
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
              type: 'image_url',
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
  description = 'Execute skills in main conversation';
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
              prompt: {
                type: 'string',
                description: 'The task for the agent to perform'
              },
              subagent_type: {
                type: 'string',
                enum: ['general-purpose', 'plan-agent', 'explore-agent', 'frontend-tester'],
                description: 'The type of specialized agent'
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
                type: 'string',
                description: 'Optional: Constraints or limitations'
              }
            },
            required: ['description', 'prompt', 'subagent_type']
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

  async execute(toolName: string, params: any, executionMode: ExecutionMode): Promise<any> {
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
      const { getSmartApprovalEngine } = await import('./smart-approval.js');
      const { getConfigManager } = await import('./config.js');
      const configManager = getConfigManager();
      const debugMode = process.env.DEBUG === 'smart-approval';

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
        console.log(colors.success(`✅ [Smart Mode] Tool '${toolName}' passed approval, executing directly`));
        console.log(colors.textDim(`  Detection method: ${result.detectionMethod === 'whitelist' ? 'Whitelist' : 'AI Review'}`));
        console.log(colors.textDim(`  Latency: ${result.latency}ms`));
        console.log('');
        return await tool.execute(params);
      } else if (result.decision === 'requires_confirmation') {
        // Requires user confirmation
        const confirmed = await approvalEngine.requestConfirmation(result);

        if (confirmed) {
          console.log('');
          console.log(colors.success(`✅ [Smart Mode] User confirmed execution of tool '${toolName}'`));
          console.log('');
          return await tool.execute(params);
        } else {
          console.log('');
          console.log(colors.warning(`⚠️  [Smart Mode] User cancelled execution of tool '${toolName}'`));
          console.log('');
          throw new Error(`Tool execution cancelled by user: ${toolName}`);
        }
      } else {
        // Rejected execution
        console.log('');
        console.log(colors.error(`❌ [Smart Mode] Tool '${toolName}' execution rejected`));
        console.log(colors.textDim(`  Reason: ${result.description}`));
        console.log('');
        throw new Error(`Tool execution rejected: ${toolName}`);
      }
    }

    // Other modes execute directly
    return await tool.execute(params);
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
