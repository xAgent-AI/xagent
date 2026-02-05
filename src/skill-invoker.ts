import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getSkillLoader, SkillInfo, SkillLoader } from './skill-loader.js';
import { getToolRegistry } from './tools.js';
import { ExecutionMode, Tool } from './types.js';
import { getConfigManager } from './config.js';

// Re-export SkillInfo for other modules
export type { SkillInfo };

/**
 * Track skill execution history for tracking failures
 */
export class SkillExecutionHistory {
  private history: Map<string, number> = new Map();

  /**
   * Get failure count for a task
   */
  getFailureCount(taskKey: string): number {
    return this.history.get(taskKey) || 0;
  }

  /**
   * Increment failure count for a task
   */
  incrementFailure(taskKey: string): number {
    const count = this.getFailureCount(taskKey) + 1;
    this.history.set(taskKey, count);
    return count;
  }

  /**
   * Reset failure count for a task (e.g., after success)
   */
  reset(taskKey: string): void {
    this.history.delete(taskKey);
  }

  /**
   * Check if threshold reached
   */
  shouldUseFallback(taskKey: string, threshold: number = 2): boolean {
    return this.getFailureCount(taskKey) >= threshold;
  }
}

// Singleton execution history
const executionHistory = new SkillExecutionHistory();

export function getExecutionHistory(): SkillExecutionHistory {
  return executionHistory;
}

export interface SkillExecutionParams {
  skillId: string;
  taskDescription: string;
  inputFile?: string;
  outputFile?: string;
  options?: Record<string, any>;
  /** Task ID for workspace directory naming */
  taskId?: string;
}

/**
 * Execution step interface - tells Agent what to do next
 */
export interface ExecutionStep {
  step: number;
  action: string;
  description: string;
  command?: string;
  file?: string;
  reason: string;
}

/**
 * Skill execution result - contains guidance and next actions
 */
export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  files?: string[];
  /** Tells Agent what to do next */
  nextSteps?: ExecutionStep[];
  /** Skill type for determining if manual execution is needed */
  requiresManualExecution?: boolean;
  /** Workspace directory used, for cleanup */
  workspaceDir?: string;
  /** Files to preserve (relative paths), skipped during cleanup */
  preserveFiles?: string[];
  /** Skill directory path - for dependency management and file operations */
  skillPath?: string;
}

export interface SkillMatcherResult {
  skill: SkillInfo;
  confidence: number;
  matchedKeywords: string[];
  category: string;
}

// ============================================================
// Workspace Utility Functions
// ============================================================

/**
 * Get workspace directory path
 * @param taskId Task ID for creating unique workspace directory
 * @returns Absolute path to workspace directory
 */
export function getWorkspaceDir(taskId: string): string {
  // Try to get from config first
  try {
    const configManager = getConfigManager();
    const config = configManager.getSettings?.();
    if (config?.workspacePath) {
      return path.join(config.workspacePath, taskId);
    }
  } catch {
    // Config not available, use default
  }

  // Default to ~/.xagent/workspace
  return path.join(os.homedir(), '.xagent', 'workspace', taskId);
}

/**
 * Get base workspace directory (without task-id)
 */
export function getBaseWorkspaceDir(): string {
  try {
    const configManager = getConfigManager();
    const config = configManager.getSettings?.();
    if (config?.workspacePath) {
      return config.workspacePath;
    }
  } catch {
    // Config not available, use default
  }

  return path.join(os.homedir(), '.xagent', 'workspace');
}

/**
 * Get workspace directory description for AI
 * Returns the actual workspace path from config, or default path
 */
export function getWorkspaceDescription(): string {
  try {
    const configManager = getConfigManager();
    const config = configManager.getSettings?.();
    if (config?.workspacePath) {
      return config.workspacePath;
    }
  } catch {
    // Config not available, use default
  }

  return path.join(os.homedir(), '.xagent', 'workspace');
}

/**
 * Ensure workspace directory exists
 * @param workspaceDir Workspace directory path
 */
export async function ensureWorkspaceDir(workspaceDir: string): Promise<void> {
  await fs.mkdir(workspaceDir, { recursive: true });
}

/**
 * Clean up workspace directory
 * @param workspaceDir Workspace directory path
 * @param preserveFiles Files to preserve (relative paths)
 */
export async function cleanupWorkspace(workspaceDir: string, preserveFiles: string[] = []): Promise<void> {
  try {
    const entries = await fs.readdir(workspaceDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(workspaceDir, entry.name);

      // Skip files to preserve
      if (preserveFiles.includes(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recursively delete subdirectories
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        // Delete files
        await fs.unlink(fullPath);
      }
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.warn(`Workspace cleanup failed: ${error.message}`);
    }
  }
}

/**
 * Determine if workspace should be auto-cleaned based on ExecutionMode
 * @param executionMode Execution mode
 * @returns Whether auto-cleanup should happen
 */
export function shouldAutoCleanup(executionMode: ExecutionMode): boolean {
  // YOLO mode: fully automatic, clean up directly
  if (executionMode === ExecutionMode.YOLO) {
    return true;
  }
  // Other modes require user confirmation
  return false;
}

/**
 * Generate cleanup prompt message
 * @param workspaceDir Workspace directory path
 */
export async function getCleanupInfo(workspaceDir: string): Promise<{ files: string[]; totalSize: string }> {
  try {
    const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      files.push(entry.name);
    }

    // Calculate total size
    let totalSize = 0;
    for (const entry of entries) {
      if (entry.isFile()) {
        const stats = await fs.stat(path.join(workspaceDir, entry.name));
        totalSize += stats.size;
      }
    }

    const formatSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    return { files, totalSize: formatSize(totalSize) };
  } catch {
    return { files: [], totalSize: '0 B' };
  }
}

// ============================================================
// Shared Content Extraction Utilities
// ============================================================

/**
 * Remove Markdown formatting (bold, italic, etc.)
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // Remove bold **
    .replace(/\*(.+?)\*/g, '$1')      // Remove italic *
    .replace(/`(.+?)`/g, '$1')        // Remove inline code `
    .trim();
}

/**
 * Extract content related to keywords (for SKILL.md content matching)
 * @param content SKILL.md full content
 * @param keywords Keyword list
 * @param maxLength Maximum return length
 * @returns Extracted relevant content
 */
export function extractContent(content: string, keywords: string[], maxLength: number = 5000): string {
  const lines = content.split('\n');
  const relevantLines: string[] = [];
  let inRelevantSection = false;
  let sectionDepth = 0;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect headings
    if (line.match(/^#{1,6}\s/)) {
      const strippedLine = stripMarkdown(line);
      const lowerLine = strippedLine.toLowerCase();

      // Check if contains keywords
      const hasKeyword = keywords.some(kw => lowerLine.includes(kw.toLowerCase()));

      if (hasKeyword) {
        inRelevantSection = true;
        found = true;
        sectionDepth = line.match(/^(#+)/)?.[1].length || 1;
      } else if (inRelevantSection) {
        // Check if same level or higher heading (end current section)
        const currentDepth = line.match(/^(#+)/)?.[1].length || 1;
        if (currentDepth <= sectionDepth) {
          inRelevantSection = false;
        }
      }
    }

    if (inRelevantSection || found) {
      relevantLines.push(line);
    }

    // Limit content length
    if (relevantLines.join('\n').length > maxLength) {
      relevantLines.push('\n...(content truncated for brevity)...');
      break;
    }
  }

  if (relevantLines.length > 0) {
    return relevantLines.join('\n').trim();
  }

  // If still not found, return first 100 lines
  return lines.slice(0, 100).join('\n').trim() + '\n\n...(See SKILL.md for full instructions)';
}

/**
 * Read SKILL.md and extract relevant content based on task
 */
export async function readSkillContent(skillPath: string, keywords: string[], maxLength: number = 5000): Promise<string> {
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  const content = await fs.readFile(skillMdPath, 'utf-8');
  return extractContent(content, keywords, maxLength);
}

// ============================================================
// SKILL Trigger Keywords Mapping
// ============================================================

// NOTE: SKILL_TRIGGERS is disabled for experiment purposes.
// Let the LLM decide which skill to use based on system prompt information.

// interface SkillTrigger {
//   skillId: string;
//   keywords: string[];
//   category: string;
// }

// export const SKILL_TRIGGERS: Record<string, SkillTrigger> = {
//   docx: {
//     skillId: 'docx',
//     keywords: [
//       'word document', 'docx', 'microsoft word', 'create word', 'edit word',
//       'create .docx', '.docx file', 'word file', 'document creation',
//       'word editing', 'tracked changes', 'comments'
//     ],
//     category: 'Document Processing'
//   },
//   pdf: {
//     skillId: 'pdf',
//     keywords: [
//       'pdf', 'create pdf', 'edit pdf', 'pdf document', 'pdf file',
//       'extract pdf', 'merge pdf', 'split pdf', 'pdf form', 'manipulate pdf'
//     ],
//     category: 'Document Processing'
//   },
//   pptx: {
//     skillId: 'pptx',
//     keywords: [
//       'powerpoint', 'ppt', 'pptx', 'presentation', 'slide',
//       'create presentation', 'edit powerpoint', 'create slides',
//       'powerpoint file', 'presentation file'
//     ],
//     category: 'Document Processing'
//   },
//   xlsx: {
//     skillId: 'xlsx',
//     keywords: [
//       'excel', 'spreadsheet', 'xlsx', 'create excel', 'edit spreadsheet',
//       'excel file', 'spreadsheet file', 'formulas', 'data analysis'
//     ],
//     category: 'Spreadsheet & Data'
//   },
//   frontend_design: {
//     skillId: 'frontend-design',
//     keywords: [
//       'web page', 'website', 'web app', 'frontend', 'ui', 'user interface',
//       'create website', 'build website', 'web component', 'html css',
//       'landing page', 'dashboard', 'react', 'vue', 'web interface'
//     ],
//     category: 'Frontend & Web Development'
//   },
//   web_artifacts_builder: {
//     skillId: 'web-artifacts-builder',
//     keywords: [
//       'complex react', 'react artifact', 'stateful artifact', 'routing',
//       'web artifact', 'interactive artifact', 'web-based tool'
//     ],
//     category: 'Frontend & Web Development'
//   },
//   webapp_testing: {
//     skillId: 'webapp-testing',
//     keywords: [
//       'test web', 'web testing', 'browser test', 'playwright', 'e2e test',
//       'frontend test', 'capture screenshot', 'verify web'
//     ],
//     category: 'Frontend & Web Development'
//   },
//   canvas_design: {
//     skillId: 'canvas-design',
//     keywords: [
//       'poster', 'artwork', 'visual art', 'canvas', 'design art',
//       'create poster', 'create artwork', 'visual design', 'graphic art'
//     ],
//     category: 'Visual & Creative Design'
//   },
//   algorithmic_art: {
//     skillId: 'algorithmic-art',
//     keywords: [
//       'generative art', 'algorithmic art', 'p5.js', 'particle system',
//       'flow field', 'creative coding', 'code art'
//     ],
//     category: 'Visual & Creative Design'
//   },
//   theme_factory: {
//     skillId: 'theme-factory',
//     keywords: [
//       'theme', 'color scheme', 'font theme', 'styling theme',
//       'consistent theme', 'apply theme', 'theme colors'
//     ],
//     category: 'Visual & Creative Design'
//   },
//   brand_guidelines: {
//     skillId: 'brand-guidelines',
//     keywords: [
//       'brand colors', 'brand guidelines', 'anthropic brand',
//       'official brand', 'brand styling'
//     ],
//     category: 'Visual & Creative Design'
//   },
//   slack_gif_creator: {
//     skillId: 'slack-gif-creator',
//     keywords: [
//       'slack gif', 'animated gif', 'gif for slack', 'slack animation'
//     ],
//     category: 'Visual & Creative Design'
//   },
//   mcp_builder: {
//     skillId: 'mcp-builder',
//     keywords: [
//       'mcp server', 'model context protocol', 'create mcp',
//       'mcp integration', 'external api integration'
//     ],
//     category: 'Development & Integration'
//   },
//   skill_creator: {
//     skillId: 'skill-creator',
//     keywords: [
//       'create skill', 'new skill', 'skill development',
//       'extend capabilities', 'custom skill'
//     ],
//     category: 'Development & Integration'
//   },
//   doc_coauthoring: {
//     skillId: 'doc-coauthoring',
//     keywords: [
//       'documentation', 'technical docs', 'write documentation',
//       'coauthor', 'doc writing', 'technical writing'
//     ],
//     category: 'Communication & Documentation'
//   }
// };

// ============================================================
// SkillInvoker Main Class
// ============================================================

export class SkillInvoker {
  private skillLoader: SkillLoader;
  private initialized: boolean = false;
  private skillCache: Map<string, SkillInfo> = new Map(); // Stores metadata only
  // private skillContentCache: Map<string, string> = new Map(); // Stores full SKILL.md content - UNUSED

  constructor(skillLoader?: SkillLoader) {
    this.skillLoader = skillLoader || getSkillLoader();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Use discoverSkills to only discover directories without loading full content
    const skillIds = await this.skillLoader.discoverSkills();

    // Create minimal SkillInfo objects with metadata only
    for (const skillId of skillIds) {
      const skillPath = this.skillLoader.getSkillDirectory?.(skillId) || '';
      const skillInfo: SkillInfo = {
        id: skillId,
        name: skillId,
        description: '', // Will be loaded lazily
        license: 'Unknown',
        version: '1.0.0',
        author: 'Anonymous',
        category: '',
        markdown: '', // Full content loaded lazily
        skillsPath: skillPath
      };
      this.skillCache.set(skillId, skillInfo);
    }

    this.initialized = true;
  }

  /**
   * Load skill metadata (name, description, category) from SKILL.md frontmatter
   * This is called lazily when skill details are needed
   */
  async loadSkillMetadata(skillId: string): Promise<void> {
    const skill = this.skillCache.get(skillId);
    if (!skill) return;

    // Check if metadata already loaded
    if (skill.description && skill.category) return;

    const skillPath = skill.skillsPath;
    const skillMdPath = path.join(skillPath, 'SKILL.md');

    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = this.skillLoader.parseSkillMarkdown(content);

      skill.name = parsed.name || skillId;
      skill.description = parsed.description || '';
      skill.license = parsed.license || 'Unknown';
      skill.version = parsed.version || '1.0.0';
      skill.author = parsed.author || 'Anonymous';

      // Extract category from path
      const pathParts = skillPath.split(path.sep);
      const skillsIndex = pathParts.findIndex(p => p === 'skills');
      if (skillsIndex >= 0 && pathParts.length > skillsIndex + 1) {
        skill.category = pathParts[skillsIndex + 1];
      }

      skill.markdown = content; // Now we have the full content
      // this.skillContentCache.set(skillId, content); // UNUSED
    } catch (error) {
      console.warn(`[SkillInvoker] Failed to load metadata for skill ${skillId}:`, error);
    }
  }

  /**
   * Get list of all available skills (with metadata)
   */
  async listAvailableSkills(): Promise<SkillInfo[]> {
    await this.initialize();

    // Load metadata for all skills if not already loaded
    for (const skillId of this.skillCache.keys()) {
      await this.loadSkillMetadata(skillId);
    }

    return Array.from(this.skillCache.values());
  }

  /**
   * Reload all skills (e.g., after adding/removing a skill via CLI)
   * Clears the cache and re-discovers all skills
   */
  async reload(): Promise<void> {
    // Reset initialization state to allow re-discovery
    this.initialized = false;
    this.skillCache.clear();
    
    // Re-initialize
    await this.initialize();
  }

  /**
   * Match the most relevant skill based on user input
   * NOTE: SKILL_TRIGGERS disabled. Let LLM decide based on system prompt.
   * Returns null to indicate no explicit match - LLM should use its own judgment.
   */
  async matchSkill(userInput: string): Promise<SkillMatcherResult | null> {
    // SKILL_TRIGGERS is disabled for experiment purposes.
    // The LLM should decide which skill to use based on system prompt information.
    return null;
  }

  /**
   * Get skill details
   */
  async getSkillDetails(skillId: string): Promise<SkillInfo | null> {
    await this.initialize();
    return this.skillLoader.getSkill(skillId) || null;
  }

  /**
   * Execute skill
   */
  async executeSkill(params: SkillExecutionParams): Promise<SkillExecutionResult> {
    // Ensure initialized
    await this.initialize();

    // Load skill metadata if not already loaded
    await this.loadSkillMetadata(params.skillId);

    const skill = this.skillCache.get(params.skillId);

    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${params.skillId}`
      };
    }

    // Generate task ID (if not provided)
    const taskId = params.taskId || `${params.skillId}-${Date.now()}`;

    try {
      // Execute based on skillId
      const executor = this.getSkillExecutor(skill.id);
      const result = await executor.execute(skill, { ...params, taskId });

      // Add skillPath and workspaceDir to result (delay creation until actually needed)
      if (result.success) {
        // Get skillPath directly from skillDirectories (more reliable)
        result.skillPath = this.skillLoader.getSkillDirectory?.(params.skillId) || skill.skillsPath || '';
        if (result.nextSteps && result.nextSteps.length > 0) {
          result.workspaceDir = getWorkspaceDir(taskId);
          // Don't pre-create workspace - only create when actually used by LLM
        }
      }

      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up workspace based on execution result
   * @param result Skill execution result
   * @param executionMode Execution mode
   * @returns Whether cleanup was performed
   */
  async cleanupAfterExecution(result: SkillExecutionResult, executionMode: ExecutionMode): Promise<boolean> {
    if (!result.workspaceDir) {
      return false;
    }

    // YOLO mode: auto cleanup
    if (executionMode === ExecutionMode.YOLO) {
      await cleanupWorkspace(result.workspaceDir, result.preserveFiles || []);
      return true;
    }

    // Other modes: don't auto cleanup, let user decide
    return false;
  }

  /**
   * Get cleanup prompt (for asking user)
   */
  async getCleanupPrompt(result: SkillExecutionResult): Promise<string | null> {
    if (!result.workspaceDir) {
      return null;
    }

    const info = await getCleanupInfo(result.workspaceDir);
    if (info.files.length === 0) {
      return null;
    }

    return `Task completed! Workspace directory contains the following files:\n` +
      `📁 ${result.workspaceDir}\n` +
      `Files: ${info.files.join(', ')}\n` +
      `Size: ${info.totalSize}\n\n` +
      `Do you want to clean up these temporary files?`;
  }

  /**
   * Get executor for skill
   * Unified dynamic approach - all skills use GenericSkillExecutor
   */
  private getSkillExecutor(skillId: string): SkillExecutor {
    return new GenericSkillExecutor();
  }

  // ============================================================================
  // Remote Mode Tool Support Methods
  // ============================================================================

  /**
   * Check if it's a Skill tool
   * Used for remote mode tool execution
   */
  isSkillTool(toolName: string): boolean {
    // Check if it's a skill ID in cache
    return this.skillCache.has(toolName);
  }

  /**
   * Get all Skill definitions (for syncing to remote server)
   * NOTE: triggers field is empty since SKILL_TRIGGERS is disabled
   */
  getAllSkillDefinitions(): Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    triggers: string[];
  }> {
    const definitions: Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      triggers: string[];
    }> = [];

    for (const skill of this.skillCache.values()) {
      definitions.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        triggers: [] // SKILL_TRIGGERS disabled - LLM decides based on description
      });
    }

    return definitions;
  }

  /**
   * Execute Skill tool (for remote mode tool execution)
   * @param toolName - Tool name (skillId)
   * @param params - Tool parameters
   * @returns Execution result
   */
  async executeSkillTool(
    toolName: string,
    params: Record<string, any>
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    // Check if skill exists in cache
    if (!this.skillCache.has(toolName)) {
      return { success: false, error: `Skill not found: ${toolName}` };
    }

    try {
      const result = await this.executeSkill({
        skillId: toolName,
        taskDescription: params.taskDescription || params.description || '',
        inputFile: params.inputFile,
        outputFile: params.outputFile,
        options: params.options || {}
      });

      return { success: result.success, result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all available Skill ID list
   * NOTE: SKILL_TRIGGERS disabled - return all skill IDs from cache
   */
  getAvailableSkillIds(): string[] {
    return Array.from(this.skillCache.keys());
  }
}

// ============================================================
// Skill Executor Interface and Implementation
// ============================================================

interface SkillExecutor {
  execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult>;
}

/**
 * Generic Skill Executor - Unified dynamic approach for all skills
 */
class GenericSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - Execution Guide\n`);
    outputMessages.push(`**Task**: ${params.taskDescription}\n`);

    try {
      // Generate task ID
      const taskId = params.taskId || `${skill.id}-${Date.now()}`;

      // Read complete skill documentation
      const skillPath = skill.skillsPath;
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      files.push(skillMdPath);

      // Read SKILL.md content
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // Extract relevant content based on task type and generate execution steps
      const taskContent = await this.extractRelevantContent(skill, params, skillContent, nextSteps, taskId);
      outputMessages.push(taskContent);

      // Add input/output files to list if they exist
      if (params.inputFile) files.push(params.inputFile);
      if (params.outputFile) files.push(params.outputFile);

      return {
        success: true,
        output: outputMessages.join('\n'),
        files: files,
        nextSteps: nextSteps,
        requiresManualExecution: true
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract relevant skill content dynamically
   */
  private async extractRelevantContent(
    skill: SkillInfo,
    params: SkillExecutionParams,
    fullContent: string,
    nextSteps: ExecutionStep[],
    taskId: string
  ): Promise<string> {
    const workspaceBase = getWorkspaceDescription();
    const taskWorkspace = `${workspaceBase}/${taskId}`;

    // Dynamically discover files in skill directory
    const skillPath = skill.skillsPath;
    let allFiles: string[] = [];

    try {
      const entries = await fs.readdir(skillPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(skillPath, entry.name);
        if (entry.isFile()) {
          allFiles.push(fullPath);
        } else if (entry.isDirectory()) {
          // Recursively list files in subdirectories (limited depth)
          const subEntries = await fs.readdir(fullPath, { withFileTypes: true });
          for (const subEntry of subEntries) {
            if (subEntry.isFile()) {
              allFiles.push(path.join(fullPath, subEntry.name));
            }
          }
        }
      }
    } catch {
      // Fallback to just SKILL.md if directory can't be read
      allFiles = [path.join(skillPath, 'SKILL.md')];
    }

    // Step 1: Read SKILL.md first
    const skillMdPathOnly = path.join(skillPath, 'SKILL.md');
    nextSteps.push({
      step: 1,
      action: 'Read SKILL.md to understand the skill workflow',
      description: `Read: ${skillMdPathOnly}`,
      reason: 'Understand the skill workflow and best practices from the main documentation'
    });

    // Step 2: Explore skill directory and read reference files if needed (optional)
    nextSteps.push({
      step: 2,
      action: 'Explore skill directory and read reference files (if needed)',
      description: `Explore: ${skillPath}`,
      reason: 'Discover available reference files and read them based on SKILL.md guidance'
    });

    nextSteps.push({
      step: 3,
      action: 'Analyze documentation, verify data/content completeness, and design approach',
      description: `For content creation: ensure all info/materials collected. For info retrieval: ensure all required data retrieved. Then design execution plan for: ${taskWorkspace}`,
      reason: 'Review requirements, verify data/content completeness, fill gaps if needed, then plan execution based on the documentation'
    });

    nextSteps.push({
      step: 4,
      action: 'Execute your plan',
      description: 'Create workspace, write code, run scripts, verify output',
      reason: 'Execute the task using your own understanding'
    });

    return `### Skill Execution\n\n` +
           `**Your task**: ${params.taskDescription}\n\n` +
           `**Step 1**: Read SKILL.md to understand the skill workflow\n` +
           `  - read_file: ${skillMdPathOnly}\n\n` +
           `**Step 2**: Explore skill directory and read reference files (if needed)\n` +
           `  - ListDirectory(path="${skillPath}")\n` +
           `  - read_file relevant .md and script files as needed\n\n` +
           `Then analyze the documentation and create your own execution plan.\n\n` +
           `**Workspace**: \`${taskWorkspace}\`\n\n` +
           `**⚠️ Windows Path Execution**: Use absolute paths, NOT \`cd && command\`:\n` +
           `  - ✅ Correct: \`node "${taskWorkspace}/script.js"\`\n` +
           `  - ❌ Wrong: \`cd "${taskWorkspace}" && node script.js\` (fails in PowerShell 5.1)\n` +
           `  - ✅ Correct: \`python "${taskWorkspace}/script.py"\`\n\n` +
           `**📦 Dependency Management**:\n` +
           `  - Use \`skillPath\` parameter to install dependencies to skill's node_modules (persists across invocations)\n` +
           `  - ✅ Correct: Bash(command="npm install <package>", skillPath="${skillPath}")\n` +
           `  - ✅ Correct: Bash(command="npm install", skillPath="${skillPath}")\n` +
           `  - Dependencies are saved to: <userSkillsPath>/<skillName>/node_modules\n` +
           `  - 💡 Tip: Install once, reuse forever - no need to reinstall on each call!\n` +
           `  - After install, scripts can use require() directly with NODE_PATH auto-set\n` +
           `  - NODE_PATH precedence: skill's node_modules > xAgent's node_modules\n` +
           `  - Manual execution (Windows): set "NODE_PATH=${skillPath}/node_modules;<xAgentPath>/node_modules" && node script.js\n` +
           `  - Manual execution (Linux/Mac): NODE_PATH=${skillPath}/node_modules:${process.cwd()}/node_modules node script.js\n` +
           `  - ⚠️ If skillPath approach fails (module not found errors): Install directly in workspace\n` +
           `    Priority: skill's node_modules > workspace's node_modules > xAgent's node_modules\n\n` +
           `**🧹 Cleanup**: Delete all intermediate/temporary files when task completes:\n` +
           `  - Remove: all files generated during the task\n` +
           `  - Keep: Only the final output file (output.pptx/docx/xlsx/pdf or other file format required by user)\n` +
           `  - ⚠️ If user needs to check results or make adjustments: RETAIN intermediate/temporary files for debugging\n\n` +
           `**Instructions**: read_file the documentation, understand the API, and create your own execution plan.\n` +
           `**If you encounter issues**: Explain what went wrong and suggest a different approach.\n`;
  }
}
// ============================================================
// ============================================================

/**
 * Execute skill - LLM analyzes SKILL.md and generates its own steps
 * @param skill Skill to execute
 * @param params Execution parameters
 * @returns Execution result with guidance
 */
export async function executeSkill(
  skill: SkillInfo,
  params: SkillExecutionParams
): Promise<SkillExecutionResult> {
  const executor = new GenericSkillExecutor();
  return executor.execute(skill, params);
}

// ============================================================
// Singleton Instance and Exports
// ============================================================

let skillInvokerInstance: SkillInvoker | null = null;

export function getSkillInvoker(): SkillInvoker {
  if (!skillInvokerInstance) {
    skillInvokerInstance = new SkillInvoker();
  }
  return skillInvokerInstance;
}
