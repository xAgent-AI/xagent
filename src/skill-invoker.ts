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

interface SkillTrigger {
  skillId: string;
  keywords: string[];
  category: string;
}

export const SKILL_TRIGGERS: Record<string, SkillTrigger> = {
  docx: {
    skillId: 'docx',
    keywords: [
      'word document', 'docx', 'microsoft word', 'create word', 'edit word',
      'create .docx', '.docx file', 'word file', 'document creation',
      'word editing', 'tracked changes', 'comments'
    ],
    category: 'Document Processing'
  },
  pdf: {
    skillId: 'pdf',
    keywords: [
      'pdf', 'create pdf', 'edit pdf', 'pdf document', 'pdf file',
      'extract pdf', 'merge pdf', 'split pdf', 'pdf form', 'manipulate pdf'
    ],
    category: 'Document Processing'
  },
  pptx: {
    skillId: 'pptx',
    keywords: [
      'powerpoint', 'ppt', 'pptx', 'presentation', 'slide',
      'create presentation', 'edit powerpoint', 'create slides',
      'powerpoint file', 'presentation file'
    ],
    category: 'Document Processing'
  },
  xlsx: {
    skillId: 'xlsx',
    keywords: [
      'excel', 'spreadsheet', 'xlsx', 'create excel', 'edit spreadsheet',
      'excel file', 'spreadsheet file', 'formulas', 'data analysis'
    ],
    category: 'Spreadsheet & Data'
  },
  frontend_design: {
    skillId: 'frontend-design',
    keywords: [
      'web page', 'website', 'web app', 'frontend', 'ui', 'user interface',
      'create website', 'build website', 'web component', 'html css',
      'landing page', 'dashboard', 'react', 'vue', 'web interface'
    ],
    category: 'Frontend & Web Development'
  },
  web_artifacts_builder: {
    skillId: 'web-artifacts-builder',
    keywords: [
      'complex react', 'react artifact', 'stateful artifact', 'routing',
      'web artifact', 'interactive artifact', 'web-based tool'
    ],
    category: 'Frontend & Web Development'
  },
  webapp_testing: {
    skillId: 'webapp-testing',
    keywords: [
      'test web', 'web testing', 'browser test', 'playwright', 'e2e test',
      'frontend test', 'capture screenshot', 'verify web'
    ],
    category: 'Frontend & Web Development'
  },
  canvas_design: {
    skillId: 'canvas-design',
    keywords: [
      'poster', 'artwork', 'visual art', 'canvas', 'design art',
      'create poster', 'create artwork', 'visual design', 'graphic art'
    ],
    category: 'Visual & Creative Design'
  },
  algorithmic_art: {
    skillId: 'algorithmic-art',
    keywords: [
      'generative art', 'algorithmic art', 'p5.js', 'particle system',
      'flow field', 'creative coding', 'code art'
    ],
    category: 'Visual & Creative Design'
  },
  theme_factory: {
    skillId: 'theme-factory',
    keywords: [
      'theme', 'color scheme', 'font theme', 'styling theme',
      'consistent theme', 'apply theme', 'theme colors'
    ],
    category: 'Visual & Creative Design'
  },
  brand_guidelines: {
    skillId: 'brand-guidelines',
    keywords: [
      'brand colors', 'brand guidelines', 'anthropic brand',
      'official brand', 'brand styling'
    ],
    category: 'Visual & Creative Design'
  },
  slack_gif_creator: {
    skillId: 'slack-gif-creator',
    keywords: [
      'slack gif', 'animated gif', 'gif for slack', 'slack animation'
    ],
    category: 'Visual & Creative Design'
  },
  mcp_builder: {
    skillId: 'mcp-builder',
    keywords: [
      'mcp server', 'model context protocol', 'create mcp',
      'mcp integration', 'external api integration'
    ],
    category: 'Development & Integration'
  },
  skill_creator: {
    skillId: 'skill-creator',
    keywords: [
      'create skill', 'new skill', 'skill development',
      'extend capabilities', 'custom skill'
    ],
    category: 'Development & Integration'
  },
  doc_coauthoring: {
    skillId: 'doc-coauthoring',
    keywords: [
      'documentation', 'technical docs', 'write documentation',
      'coauthor', 'doc writing', 'technical writing'
    ],
    category: 'Communication & Documentation'
  },
  internal_comms: {
    skillId: 'internal-comms',
    keywords: [
      'internal communication', 'status report', 'newsletter',
      'internal update', 'team communication', 'announcement'
    ],
    category: 'Communication & Documentation'
  }
};

// ============================================================
// SkillInvoker Main Class
// ============================================================

export class SkillInvoker {
  private skillLoader: SkillLoader;
  private initialized: boolean = false;
  private skillCache: Map<string, SkillInfo> = new Map();

  constructor(skillLoader?: SkillLoader) {
    this.skillLoader = skillLoader || getSkillLoader();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const skills = await this.skillLoader.loadAllSkills();
    for (const skill of skills) {
      this.skillCache.set(skill.id, skill);
    }

    this.initialized = true;
  }

  /**
   * Get list of all available skills
   */
  async listAvailableSkills(): Promise<SkillInfo[]> {
    await this.initialize();
    return this.skillLoader.listSkills();
  }

  /**
   * Match the most relevant skill based on user input
   */
  async matchSkill(userInput: string): Promise<SkillMatcherResult | null> {
    await this.initialize();

    const lowerInput = userInput.toLowerCase();
    let bestMatch: SkillMatcherResult | null = null;

    // First check predefined trigger keywords
    for (const trigger of Object.values(SKILL_TRIGGERS)) {
      const matchedKeywords = trigger.keywords.filter(kw => lowerInput.includes(kw.toLowerCase()));

      if (matchedKeywords.length > 0) {
        const confidence = matchedKeywords.length / trigger.keywords.length;
        const skill = this.skillCache.get(trigger.skillId);

        if (skill) {
          const result: SkillMatcherResult = {
            skill,
            confidence,
            matchedKeywords,
            category: trigger.category
          };

          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = result;
          }
        }
      }
    }

    return bestMatch;
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

      // Add workspaceDir to result
      if (result.success && result.nextSteps && result.nextSteps.length > 0) {
        result.workspaceDir = getWorkspaceDir(taskId);
        await ensureWorkspaceDir(result.workspaceDir);
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
   * Determine which executor to use based on skill.id
   */
  private getSkillExecutor(skillId: string): SkillExecutor {
    const docProcessingSkills = ['docx', 'pdf', 'pptx', 'xlsx'];
    const frontendSkills = ['frontend-design', 'web-artifacts-builder', 'webapp-testing'];
    const visualDesignSkills = ['canvas-design', 'algorithmic-art', 'theme-factory', 'brand-guidelines', 'slack-gif-creator'];
    const docSkills = ['doc-coauthoring', 'internal-comms'];

    if (docProcessingSkills.includes(skillId)) {
      return new DocumentSkillExecutor();
    }
    if (frontendSkills.includes(skillId)) {
      return new FrontendSkillExecutor();
    }
    if (visualDesignSkills.includes(skillId)) {
      return new VisualDesignSkillExecutor();
    }
    if (docSkills.includes(skillId)) {
      return new DocumentationSkillExecutor();
    }
    return new DefaultSkillExecutor();
  }

  /**
   * Generate skill invocation instructions (for system prompt)
   */
  generateSkillInstructions(): string {
    const categories = new Map<string, { skillId: string; name: string; description: string }[]>();

    for (const trigger of Object.values(SKILL_TRIGGERS)) {
      const skill = this.skillCache.get(trigger.skillId);
      if (skill) {
        const existing = categories.get(trigger.category) || [];
        existing.push({
          skillId: trigger.skillId,
          name: skill.name,
          description: skill.description
        });
        categories.set(trigger.category, existing);
      }
    }

    let instructions = '\n## Available Skills\n\n';
    instructions += 'When users request tasks matching these domains, invoke the "InvokeSkill" tool:\n\n';

    for (const [category, skills] of categories) {
      instructions += `### ${category}\n`;
      for (const skill of skills) {
        instructions += `**${skill.name}** (${skill.skillId}): ${skill.description}\n`;
        instructions += `  �?Use: InvokeSkill(skillId="${skill.skillId}", taskDescription="...")\n`;
      }
      instructions += '\n';
    }

    return instructions;
  }

  // ============================================================================
  // Remote Mode Tool Support Methods
  // ============================================================================

  /**
   * Check if it's a Skill tool
   * Used for remote mode tool execution
   */
  isSkillTool(toolName: string): boolean {
    // Check if it's a skill ID
    if (this.skillCache.has(toolName)) {
      return true;
    }
    // Check if in SKILL_TRIGGERS
    return Object.values(SKILL_TRIGGERS).some(t => t.skillId === toolName);
  }

  /**
   * Get all Skill definitions (for syncing to remote server)
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

    for (const [key, trigger] of Object.entries(SKILL_TRIGGERS)) {
      const skill = this.skillCache.get(trigger.skillId);
      if (skill) {
        definitions.push({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          category: trigger.category,
          triggers: trigger.keywords
        });
      }
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
    // Find corresponding Skill
    const skillTrigger = Object.entries(SKILL_TRIGGERS).find(
      ([_, t]) => t.skillId === toolName
    );

    if (!skillTrigger) {
      // Try direct skillId match
      if (!this.skillCache.has(toolName)) {
        return { success: false, error: `Skill not found: ${toolName}` };
      }
    }

    const triggerSkillId = skillTrigger ? skillTrigger[1].skillId : toolName;

    try {
      const result = await this.executeSkill({
        skillId: triggerSkillId,
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
   */
  getAvailableSkillIds(): string[] {
    return Object.values(SKILL_TRIGGERS).map(t => t.skillId);
  }
}

// ============================================================
// Skill Executor Interface and Implementation
// ============================================================

interface SkillExecutor {
  execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult>;
}

/**
 * Document Processing Skill Executor
 */
class DocumentSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## 🧠 ${skill.name} Skill - Autonomous Mode\n`);

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
   * Extract relevant skill content based on task type
   */
  private async extractRelevantContent(
    skill: SkillInfo,
    params: SkillExecutionParams,
    fullContent: string,
    nextSteps: ExecutionStep[],
    taskId: string
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();
    const workspaceBase = getWorkspaceDescription();
    const taskWorkspace = `${workspaceBase}/${taskId}`;

    // Determine required files based on skill type
    let requiredFiles: string[] = [];

    switch (skill.id) {
      case 'pptx':
        requiredFiles = ['skills/pptx/SKILL.md', 'skills/pptx/html2pptx.md', 'skills/pptx/scripts/html2pptx.js'];
        break;
      case 'docx':
        requiredFiles = ['skills/docx/SKILL.md', 'skills/docx/docx-js.md', 'skills/docx/ooxml.md'];
        break;
      case 'pdf':
        requiredFiles = ['skills/pdf/SKILL.md', 'skills/pdf/reference.md', 'skills/pdf/forms.md'];
        break;
      case 'xlsx':
        requiredFiles = ['skills/xlsx/SKILL.md', 'skills/xlsx/recalc.py'];
        break;
      case 'frontend-design':
        requiredFiles = ['skills/frontend-design/SKILL.md'];
        break;
      case 'web-artifacts-builder':
        requiredFiles = ['skills/web-artifacts-builder/SKILL.md'];
        break;
      case 'webapp-testing':
        requiredFiles = ['skills/webapp-testing/SKILL.md', 'skills/webapp-testing/examples/'];
        break;
      case 'canvas-design':
        requiredFiles = ['skills/canvas-design/SKILL.md'];
        break;
      case 'algorithmic-art':
        requiredFiles = ['skills/algorithmic-art/SKILL.md', 'skills/algorithmic-art/templates/generator_template.js'];
        break;
      case 'theme-factory':
        requiredFiles = ['skills/theme-factory/SKILL.md', 'skills/theme-factory/themes/'];
        break;
      case 'brand-guidelines':
        requiredFiles = ['skills/brand-guidelines/SKILL.md'];
        break;
      case 'internal-comms':
        requiredFiles = ['skills/internal-comms/SKILL.md', 'skills/internal-comms/examples/'];
        break;
      case 'doc-coauthoring':
        requiredFiles = ['skills/doc-coauthoring/SKILL.md'];
        break;
      case 'mcp-builder':
        requiredFiles = ['skills/mcp-builder/SKILL.md', 'skills/mcp-builder/reference/'];
        break;
      case 'skill-creator':
        requiredFiles = ['skills/skill-creator/SKILL.md'];
        break;
      case 'slack-gif-creator':
        requiredFiles = ['skills/slack-gif-creator/SKILL.md', 'skills/slack-gif-creator/core/'];
        break;
      default:
        requiredFiles = [`skills/${skill.id}/SKILL.md`];
    }

    nextSteps.push({
      step: 1,
      action: 'Read skill documentation',
      description: `Read: ${requiredFiles.join(', ')}`,
      reason: 'Understand the skill workflow and best practices'
    });

    nextSteps.push({
      step: 2,
      action: 'Analyze documentation and design approach',
      description: `Based on SKILL.md, determine the best approach for: ${taskWorkspace}`,
      reason: 'Plan your execution based on the documentation'
    });

    nextSteps.push({
      step: 3,
      action: 'Execute your plan',
      description: 'Create workspace, write code, run scripts, verify output',
      reason: 'Execute the task using your own understanding'
    });

    return `### Skill Execution\n\n` +
           `**Your task**: ${params.taskDescription}\n\n` +
           `**Read these files first**:\n` +
           requiredFiles.map(f => `- ${f}`).join('\n') + '\n\n' +
           `Then analyze the documentation and create your own execution plan.\n\n` +
           `**Workspace**: \`${taskWorkspace}\`\n\n` +
           `**⚠️ Windows Path Execution**: Use absolute paths, NOT \`cd && command\`:\n` +
           `  - ✅ Correct: \`node "${taskWorkspace}/script.js"\`\n` +
           `  - ❌ Wrong: \`cd "${taskWorkspace}" && node script.js\` (fails in PowerShell 5.1)\n` +
           `  - ✅ Correct: \`python "${taskWorkspace}/script.py"\`\n\n` +
           `**📦 Dependency Reuse**: Check existing libraries before downloading:\n` +
           `  - Node.js: pptxgenjs, playwright, sharp, docx are globally available\n` +
           `  - Python: pypdf, openpyxl, python-pptx, fitz are available\n` +
           `  - Use \`require("pptxgenjs")\` NOT \`npm install pptxgenjs\`\n` +
           `  - Use \`from openpyxl import Workbook\` NOT \`pip install openpyxl\`\n\n` +
           `**🧹 Cleanup**: Delete all intermediate/temporary files when task completes:\n` +
           `  - Remove: all files generated during the task\n` +
           `  - Keep: Only the final output file (output.pptx/docx/xlsx/pdf)\n\n` +
           `**Instructions**: read_file the documentation, understand the API, and create your own execution plan.\n` +
           `**If you encounter issues**: Explain what went wrong and suggest a different approach.\n`;
  }

  /**
   * Extract PPTX-related content and generate steps
   */
  private extractPptxContent(taskLower: string, fullContent: string, nextSteps: ExecutionStep[], skillPath: string, taskWorkspace: string): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();
    const html2pptxPath = `${skillPath}/scripts/html2pptx.js`;
    const scriptsPath = `${skillPath}/scripts`;

    // Check if using template
    const useTemplate = taskLower.includes('template') || taskLower.includes('template');

    if (useTemplate) {
      // Add template usage steps
      nextSteps.push({
        step: 1,
        action: 'Read documentation and script',
        description: `Read pptx/html2pptx.md and ${html2pptxPath} - CRITICAL: Read the USAGE section at the top of html2pptx.js to understand the correct API: const { slide, placeholders } = await html2pptx('slide.html', pptx);`,
        file: html2pptxPath,
        reason: 'Understand html2pptx API - MUST read the usage example in the file header'
      });
      nextSteps.push({
        step: 2,
        action: 'Create workspace directory',
        description: `Create directory: ${taskWorkspace}`,
        reason: 'Create workspace directory for this task'
      });
      nextSteps.push({
        step: 3,
        action: 'Create HTML slide file in workspace',
        description: `Create slide.html inside ${taskWorkspace}/ (720pt × 405pt for 16:9)`,
        reason: 'Create slide HTML file in workspace to avoid polluting target directory'
      });
      nextSteps.push({
        step: 4,
        action: 'Create PPTX conversion script in workspace',
        description: `Create convert.js inside ${taskWorkspace}/ using CommonJS: const { slide, placeholders } = await html2pptx('slide.html', pptx); // slide is already added, use slide.addChart()/addText() for content`,
        reason: 'Write Node.js script - MUST use destructured { slide, placeholders } from html2pptx()'
      });
      nextSteps.push({
        step: 5,
        action: 'Run the script',
        description: `node "${taskWorkspace.replace(/\\/g, '/')}/convert.js"`,
        reason: 'Generate PPTX file using html2pptx (use absolute path for Windows compatibility)'
      });
      nextSteps.push({
        step: 6,
        action: 'Generate thumbnail grid for visual validation',
        description: `Run: python "${scriptsPath}/thumbnail.py" ${taskWorkspace}/output.pptx ${taskWorkspace}/thumbnails --cols 4`,
        reason: 'Create thumbnail grid to verify slide layout and visual quality'
      });
      nextSteps.push({
        step: 7,
        action: 'Copy output to target directory',
        description: `Copy ${taskWorkspace}/output.pptx to target directory`,
        reason: 'Only save final file to specified path, keep workspace clean'
      });

      const patterns = [
        /##\s*Creating\s*a\s*new\s*PowerPoint\s*presentation\s*\*\*using\s*a\s*template\*\*[\s\S]*?(?=##\s+)/i,
        /##\s*Using\s*a\s*template[\s\S]*?(?=##\s+)/i
      ];

      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          return `### Using a Template\n\n${match[0].trim()}`;
        }
      }
    }

    // Not using template
    nextSteps.push({
      step: 1,
      action: 'Read documentation and script',
      description: `Read pptx/html2pptx.md and ${html2pptxPath} - CRITICAL: Read the USAGE section at the top of html2pptx.js to understand the correct API: const { slide, placeholders } = await html2pptx('slide.html', pptx);`,
      file: html2pptxPath,
      reason: 'Understand html2pptx API - MUST read the usage example in the file header'
    });
    nextSteps.push({
      step: 2,
      action: 'Create workspace directory',
      description: `Create directory: ${taskWorkspace}`,
      reason: 'Create workspace directory for this task'
    });
    nextSteps.push({
      step: 3,
      action: 'Create HTML slide file in workspace',
      description: `Create slide.html inside ${taskWorkspace}/ (720pt × 405pt for 16:9)`,
      reason: 'Create slide HTML file in workspace to avoid polluting target directory'
    });
    nextSteps.push({
      step: 4,
      action: 'Create PPTX conversion script in workspace',
      description: `Create convert.js inside ${taskWorkspace}/ using CommonJS: const { slide, placeholders } = await html2pptx('slide.html', pptx); // slide is already added, use slide.addChart()/addText() for content`,
      reason: 'Write Node.js script - MUST use destructured { slide, placeholders } from html2pptx()'
    });
    nextSteps.push({
      step: 5,
      action: 'Run the script',
      description: `node "${taskWorkspace.replace(/\\/g, '/')}/convert.js"`,
      reason: 'Generate PPTX file using html2pptx (use absolute path for Windows compatibility)'
    });
    nextSteps.push({
      step: 6,
      action: 'Generate thumbnail grid for visual validation',
      description: `Run: python "${scriptsPath}/thumbnail.py" ${taskWorkspace}/output.pptx ${taskWorkspace}/thumbnails --cols 4`,
      reason: 'Create thumbnail grid to verify slide layout and visual quality'
    });
    nextSteps.push({
      step: 7,
      action: 'Copy output to target directory',
      description: `Copy ${taskWorkspace}/output.pptx to target directory`,
      reason: 'Only save final file to specified path, keep workspace clean'
    });

    const patterns = [
      /##\s*Creating\s*a\s*new\s*PowerPoint[\s\S]*?(?=##\s+)/i,
      /###\s*Workflow[\s\S]*?(?=###\s+|$)/i
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return `### Creating New Presentation\n\n${match[0].trim()}`;
      }
    }

    return extractContent(content, ['html2pptx', 'Creating', 'Workflow']);
  }

  /**
   * Extract DOCX-related content and generate steps
   */
  private extractDocxContent(
    taskLower: string,
    fullContent: string,
    nextSteps: ExecutionStep[],
    params: SkillExecutionParams,
    skillPath: string,
    taskWorkspace: string
  ): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();
    const unpackScript = `${skillPath}/ooxml/scripts/unpack.py`;
    const packScript = `${skillPath}/ooxml/scripts/pack.py`;
    const scriptsPath = `${skillPath}/scripts`;

    const isNew = taskLower.includes('create') || taskLower.includes('new');
    const isEditing = taskLower.includes('edit') || taskLower.includes('modify') || taskLower.includes('modify');

    if (isNew) {
      // Create new document
      nextSteps.push({
        step: 1,
        action: 'Read documentation',
        description: 'Read docx-js.md for API reference',
        file: `${skillPath}/docx-js.md`,
        reason: 'Understand how to use docx-js library to create Word documents'
      });
      nextSteps.push({
        step: 2,
        action: 'Create script in workspace',
        description: `Create create_doc.js in ${taskWorkspace}: const { Document, Paragraph, TextRun, Packer } = await import("docx");`,
        reason: 'Create Word document code using docx library with dynamic import'
            });
          nextSteps.push({
            step: 3,
            action: 'Run the script',
            description: `node "${taskWorkspace.replace(/\\/g, '/')}/create_doc.js"`,
            reason: 'Generate DOCX file in workspace (use absolute path for Windows compatibility)'
          });
          nextSteps.push({        step: 4,
        action: 'Copy output to target directory',
        description: `Copy ${taskWorkspace}/output.docx to target directory`,
        reason: 'Only save final file to specified path, keep workspace clean'
      });

      return extractContent(content, ['Creating', 'docx-js', 'Workflow']);
    }

    if (isEditing) {
      // Edit existing document - use existing scripts
      nextSteps.push({
        step: 1,
        action: 'Read documentation',
        description: 'Read ooxml.md for editing API',
        file: `${skillPath}/ooxml.md`,
        reason: 'Understand how to edit existing Word documents'
      });

      nextSteps.push({
        step: 2,
        action: 'Create workspace directory',
        description: `Create workspace directory: ${taskWorkspace}/`,
        reason: 'Create workspace directory for intermediate files'
      });

      if (params.inputFile) {
        nextSteps.push({
          step: 3,
          action: 'Unpack document in workspace',
          description: `Run: python "${unpackScript}" "${params.inputFile}" ${taskWorkspace}/docx_input`,
          reason: 'Unpack DOCX file using existing unpack.py script'
        });
      }

      nextSteps.push({
        step: 4,
        action: 'Create editing script in workspace',
        description: `Create edit_doc.py in ${taskWorkspace}: from scripts.document import Document; doc = Document("${taskWorkspace}/docx_input");`,
        reason: 'Create Python editing script using existing Document library'
      });

      if (params.inputFile || params.outputFile) {
        nextSteps.push({
          step: 5,
          action: 'Pack document',
          description: `Run: python "${packScript}" ${taskWorkspace}/docx_input ${taskWorkspace}/output.docx`,
          reason: 'Repack DOCX using existing pack.py script'
        });
      }

      nextSteps.push({
        step: 6,
        action: 'Copy output to target directory',
        description: `Copy ${taskWorkspace}/output.docx to target directory`,
        reason: 'Only save final file to specified path'
      });

      return extractContent(content, ['Editing', 'redlining', 'ooxml']);
    }

    // Default case
    nextSteps.push({
      step: 1,
      action: 'Read documentation',
      description: 'Read ooxml.md or docx-js.md',
      reason: 'Understand document processing methods'
    });
    nextSteps.push({
      step: 2,
      action: 'Create or edit document',
      description: 'Write code using appropriate library',
      reason: 'Perform document operations'
    });

    return extractContent(content, ['Creating', 'Editing', 'document', 'docx']);
  }

  /**
   * Extract PDF-related content and generate steps
   */
  private extractPdfContent(
    taskLower: string,
    fullContent: string,
    nextSteps: ExecutionStep[],
    params: SkillExecutionParams,
    skillPath: string,
    taskWorkspace: string
  ): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();
    const scriptsPath = `${skillPath}/scripts`;

    const isForm = taskLower.includes('form') || taskLower.includes('form');
    const isExtract = taskLower.includes('extract') || taskLower.includes('extract');
    const isMerge = taskLower.includes('merge') || taskLower.includes('merge');
    const isConvert = taskLower.includes('convert') || taskLower.includes('image');

    nextSteps.push({
      step: 1,
      action: 'Read documentation',
      description: 'Read reference.md for PDF operations',
      file: `${skillPath}/reference.md`,
      reason: 'Understand PDF operation methods'
    });

    nextSteps.push({
      step: 2,
      action: 'Create workspace directory',
      description: `Create workspace directory: ${taskWorkspace}/`,
      reason: 'Create workspace directory for intermediate files'
    });

    if (isForm) {
      // Check for fillable fields first
      nextSteps.push({
        step: 3,
        action: 'Check form fields',
        description: `Run: python "${scriptsPath}/check_fillable_fields.py" <input_pdf>`,
        reason: 'Check if PDF has fillable form fields'
      });
      nextSteps.push({
        step: 4,
        action: 'Create PDF form script in workspace',
        description: `Create form_script.py in ${taskWorkspace}: use "${scriptsPath}/fill_fillable_fields.py" or "${scriptsPath}/fill_pdf_form_with_annotations.py"`,
        reason: 'Create PDF form processing script using existing scripts'
      });
    } else if (isExtract) {
      nextSteps.push({
        step: 3,
        action: 'Create extraction script in workspace',
        description: `Create extract_script.py in ${taskWorkspace}: use pypdf or pdfplumber for text extraction`,
        reason: 'Create PDF content extraction script'
      });
    } else if (isMerge) {
      nextSteps.push({
        step: 3,
        action: 'Create merge script in workspace',
        description: `Create merge_script.py in ${taskWorkspace}: use pypdf to combine PDF files`,
        reason: 'Create PDF merge script'
      });
    } else if (isConvert) {
      nextSteps.push({
        step: 3,
        action: 'Convert PDF to images',
        description: `Run: python "${scriptsPath}/convert_pdf_to_images.py" <input_pdf> ${taskWorkspace}/images`,
        reason: 'Convert PDF to images using existing script'
      });
    } else {
      nextSteps.push({
        step: 3,
        action: 'Create PDF processing script in workspace',
        description: `Create pdf_script.py in ${taskWorkspace}: use pypdf for desired operations`,
        reason: 'Create PDF processing script'
      });
    }

    nextSteps.push({
      step: 5,
      action: 'Run the script',
      description: `python "${taskWorkspace.replace(/\\/g, '/')}/pdf_script.py"`,
      reason: 'Execute PDF operation script in workspace (use absolute path for Windows compatibility)'
    });

    nextSteps.push({
      step: 6,
      action: 'Copy output to target directory',
      description: `Copy ${taskWorkspace}/output.pdf to target directory`,
      reason: 'Only save final file to specified path'
    });

    return extractContent(content, ['Creating', 'pdf', 'PDF']);
  }

  /**
   * Extract XLSX relevant content and generate steps
   */
  private extractXlsxContent(taskLower: string, fullContent: string, nextSteps: ExecutionStep[], skillPath: string, taskWorkspace: string): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

    const hasFormulas = taskLower.includes('formula') || taskLower.includes('formula');
    const hasData = taskLower.includes('data') || taskLower.includes('data analysis');

    nextSteps.push({
      step: 1,
      action: 'Read documentation',
      description: 'Read SKILL.md for Excel operations',
      file: `${skillPath}/SKILL.md`,
      reason: 'Understand Excel operation methods'
    });

    nextSteps.push({
      step: 2,
      action: 'Create workspace directory',
      description: `Create workspace directory: ${taskWorkspace}/`,
      reason: 'Create workspace directory for intermediate files'
    });

    if (hasFormulas || hasData) {
      nextSteps.push({
        step: 3,
        action: 'Create spreadsheet script in workspace',
        description: `Create create_xlsx.py in ${taskWorkspace}: use openpyxl to create workbook with formulas`,
        reason: 'Create spreadsheet script with formulas in workspace'
      });
    } else {
      nextSteps.push({
        step: 3,
        action: 'Create spreadsheet script in workspace',
        description: `Create create_xlsx.py in ${taskWorkspace}: use openpyxl to create workbook`,
        reason: 'Create spreadsheet script in workspace'
      });
    }

    nextSteps.push({
      step: 4,
      action: 'Run the script',
      description: `python "${taskWorkspace.replace(/\\/g, '/')}/create_xlsx.py"`,
      reason: 'Generate XLSX file in workspace (use absolute path for Windows compatibility)'
    });

    if (hasFormulas) {
      nextSteps.push({
        step: 5,
        action: 'Recalculate formulas',
        description: `Run: python "${skillPath}/recalc.py" ${taskWorkspace}/output.xlsx to recalculate all formulas and check for errors`,
        reason: 'Recalculate formulas and verify no formula errors (#REF!, #DIV/0!, etc.)'
      });
      nextSteps.push({
        step: 6,
        action: 'Fix formula errors if any',
        description: `Check recalc.py output JSON for error locations and fix formula errors in ${taskWorkspace}`,
        reason: 'Ensure ZERO formula errors before final output'
      });
      nextSteps.push({
        step: 7,
        action: 'Copy output to target directory',
        description: `Copy ${taskWorkspace}/output.xlsx to target directory`,
        reason: 'Only save final file to specified path'
      });
    } else {
      nextSteps.push({
        step: 5,
        action: 'Copy output to target directory',
        description: `Copy ${taskWorkspace}/output.xlsx to target directory`,
        reason: 'Only save final file to specified path'
      });
    }

    return extractContent(content, ['Excel', 'xlsx', 'spreadsheet']);
  }

  /**
   * Extract default content
   */
  private extractDefaultContent(skill: SkillInfo, fullContent: string, nextSteps: ExecutionStep[]): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();
    const firstLines = content.split('\n').slice(0, 100).join('\n');

    nextSteps.push({
      step: 1,
      action: 'Read SKILL.md',
      description: `Read ${skill.id}/SKILL.md for full instructions`,
      file: `${skill.skillsPath}/SKILL.md`,
      reason: 'Understand complete execution workflow'
    });

    return `### ${skill.name}\n\n${firstLines}\n\n(See ${skill.skillsPath}/SKILL.md for full instructions)`;
  }
}

/**
 * Frontend Development Skill Executor
 */
class FrontendSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - Execution Guide\n`);
    outputMessages.push(`**Task**: ${params.taskDescription}\n`);

    // Get or generate task ID
    const taskId = params.taskId || `${skill.id}-${Date.now()}`;

    try {
      // Read SKILL.md content
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // Generate execution steps
      const taskContent = await this.extractFrontendContent(skill, params, skillContent, nextSteps, taskId);
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
   * Extract relevant content based on frontend skill type and generate steps
   */
  private async extractFrontendContent(
    skill: SkillInfo,
    params: SkillExecutionParams,
    fullContent: string,
    nextSteps: ExecutionStep[],
    taskId: string
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();
    const workspaceBase = getWorkspaceDescription();
    const taskWorkspace = `${workspaceBase}/${taskId}`;

    // Add common steps
    nextSteps.push({
      step: 1,
      action: 'Design Thinking',
      description: 'Understand requirements, define aesthetic direction',
      reason: 'Clarify design direction and goals'
    });
    nextSteps.push({
      step: 2,
      action: 'Create implementation',
      description: 'Write production-grade HTML/CSS/JS or React code',
      reason: 'Implement frontend interface'
    });

    switch (skill.id) {
      case 'frontend-design':
        nextSteps.push({
          step: 3,
          action: 'Create workspace directory',
          description: `Create workspace directory: ${taskWorkspace}/`,
          reason: 'Create workspace directory for frontend files'
        });
        nextSteps.push({
          step: 4,
          action: 'Create frontend files in workspace',
          description: `Create index.html, styles.css, app.js in ${taskWorkspace}`,
          reason: 'Create frontend files in workspace'
        });
        if (taskLower.includes('landing')) {
          nextSteps.push({
            step: 5,
            action: 'Focus areas',
            description: 'Hero section, features, pricing, testimonials, footer',
            reason: 'Implement landing page sections'
          });
        } else if (taskLower.includes('dashboard')) {
          nextSteps.push({
            step: 5,
            action: 'Focus areas',
            description: 'Charts, data visualization, navigation panels',
            reason: 'Implement dashboard functionality'
          });
        }
        nextSteps.push({
          step: 6,
          action: 'Verify in browser',
          description: `Open files in ${taskWorkspace} to verify`,
          reason: 'Verify in browser'
        });
        nextSteps.push({
          step: 7,
          action: 'Copy files to target directory',
          description: `Copy frontend files from ${taskWorkspace} to target directory`,
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['frontend', 'design', 'web', 'interface']);

      case 'web-artifacts-builder':
        nextSteps.push({
          step: 3,
          action: 'Create workspace directory',
          description: `Create workspace directory: ${taskWorkspace}/`,
          reason: 'Create workspace directory for component files'
        });
        nextSteps.push({
          step: 4,
          action: 'Build React artifact in workspace',
          description: `Create React component files in ${taskWorkspace} using shadcn/ui`,
          reason: 'Build React component in workspace'
        });
        nextSteps.push({
          step: 5,
          action: 'Test artifact',
          description: `Test the artifact in ${taskWorkspace}`,
          reason: 'Test component functionality'
        });
        nextSteps.push({
          step: 6,
          action: 'Copy artifact to target directory',
          description: `Copy component files from ${taskWorkspace} to target directory`,
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['Web Artifacts Builder', 'React', 'Quick Start']);

      case 'webapp-testing':
        const scriptsPath = `${skill.skillsPath}/scripts`;
        nextSteps.push({
          step: 3,
          action: 'Read documentation and helper script',
          description: 'Read SKILL.md and scripts/with_server.py',
          file: `${scriptsPath}/with_server.py`,
          reason: 'Understand webapp testing workflow and with_server.py usage'
        });
        nextSteps.push({
          step: 4,
          action: 'Create workspace directory',
          description: `Create workspace directory: ${taskWorkspace}/`,
          reason: 'Create workspace directory for test files'
        });
        nextSteps.push({
          step: 5,
          action: 'Write Playwright tests in workspace',
          description: `Create test.py in ${taskWorkspace} for web application testing`,
          reason: 'Write test scripts in workspace'
        });
        nextSteps.push({
          step: 6,
          action: 'Run tests with server',
          description: `Run: python "${scriptsPath}/with_server.py" --server "<start_command>" --port <port> -- python ${taskWorkspace}/test.py`,
          reason: 'Run tests with server using existing with_server.py helper'
        });
        nextSteps.push({
          step: 7,
          action: 'Copy test reports to target directory',
          description: `Copy test reports from ${taskWorkspace} to target directory`,
          reason: 'Only save test reports to specified path'
        });
        return extractContent(fullContent, ['test', 'web', 'playwright', 'testing']);

      default:
        return extractContent(fullContent, ['frontend', 'design', 'web']);
    }
  }
}

/**
 * Visual Design Skill Executor
 */
class VisualDesignSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - Execution Guide\n`);
    outputMessages.push(`**Task**: ${params.taskDescription}\n`);

    // Get or generate task ID
    const taskId = params.taskId || `${skill.id}-${Date.now()}`;

    try {
      // Read SKILL.md content
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // Generate execution steps
      const taskContent = await this.extractVisualContent(skill, params, skillContent, nextSteps, taskId);
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
   * Extract relevant content based on visual design skill type and generate steps
   */
  private async extractVisualContent(
    skill: SkillInfo,
    params: SkillExecutionParams,
    fullContent: string,
    nextSteps: ExecutionStep[],
    taskId: string
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();
    const workspaceBase = getWorkspaceDescription();
    const taskWorkspace = `${workspaceBase}/${taskId}`;

    switch (skill.id) {
      case 'canvas-design':
        // Canvas Design: Two-step process
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: `Create workspace directory: ${taskWorkspace}/`,
          reason: 'Create workspace directory for design files'
        });
        nextSteps.push({
          step: 2,
          action: 'Design Philosophy Creation',
          description: `Create manifesto/md file in ${taskWorkspace} defining aesthetic movement`,
          reason: 'Create design philosophy document in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'Canvas Creation',
          description: `Express philosophy visually using PDF/PNG output in ${taskWorkspace}`,
          reason: 'Express philosophy visually on canvas in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Copy output to target directory',
          description: `Copy output files from ${taskWorkspace} to target directory`,
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['design', 'art', 'visual', 'philosophy']);

      case 'algorithmic-art':
        // Algorithmic Art
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: `Create workspace directory: ${taskWorkspace}/`,
          reason: 'Create workspace directory for generative art files'
        });
        nextSteps.push({
          step: 2,
          action: 'Algorithmic Philosophy',
          description: `Define generative art philosophy in ${taskWorkspace}`,
          reason: 'Create generative art philosophy in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'P5.js Implementation',
          description: `Write p5.js code in ${taskWorkspace} for generative art`,
          reason: 'Implement generative art code in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Generate artwork',
          description: `Run p5.js code in ${taskWorkspace} to generate artwork`,
          reason: 'Run generative art code'
        });
        nextSteps.push({
          step: 5,
          action: 'Copy output to target directory',
          description: `Copy output files from ${taskWorkspace} to target directory`,
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['generative', 'algorithmic', 'art']);

      case 'theme-factory':
        // Theme Factory
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: `Create workspace directory: ${taskWorkspace}/`,
          reason: 'Create workspace directory for theme files'
        });
        nextSteps.push({
          step: 2,
          action: 'Select theme',
          description: `Choose from available themes or create custom in ${taskWorkspace}`,
          reason: 'Select or create theme in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'Apply theme',
          description: `Apply colors, fonts to design in ${taskWorkspace}`,
          reason: 'Apply theme to design in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Copy output to target directory',
          description: `Copy theme files from ${taskWorkspace} to target directory`,
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['Theme Factory', 'Themes', 'apply']);

      case 'brand-guidelines':
        // Brand Guidelines
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: `Create workspace directory: ${taskWorkspace}/`,
          reason: 'Create workspace directory for brand files'
        });
        nextSteps.push({
          step: 2,
          action: 'Apply brand colors',
          description: `Use Anthropic brand colors and typography in ${taskWorkspace}`,
          reason: 'Apply brand colors in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'Follow guidelines',
          description: `Apply brand styling consistently in ${taskWorkspace}`,
          reason: 'Follow brand guidelines in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Copy output to target directory',
          description: `Copy brand files from ${taskWorkspace} to target directory`,
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['Brand Guidelines', 'Colors', 'Typography']);

      default:
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: `Create workspace directory: ${taskWorkspace}/`,
          reason: 'Create workspace directory for design files'
        });
        nextSteps.push({
          step: 2,
          action: 'Create visual design',
          description: `Write design code or use canvas in ${taskWorkspace}`,
          reason: 'Create visual design in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'Copy output to target directory',
          description: `Copy output files from ${taskWorkspace} to target directory`,
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['design', 'art', 'visual']);
    }
  }
}

/**
 * Documentation Skill Executor
 */
class DocumentationSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - Execution Guide\n`);
    outputMessages.push(`**Task**: ${params.taskDescription}\n`);

    // Get or generate task ID
    const taskId = params.taskId || `${skill.id}-${Date.now()}`;

    try {
      // Read SKILL.md content
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // Generate execution steps
      const taskContent = await this.extractDocContent(skill, params, skillContent, nextSteps, taskId);
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
   * Extract relevant content based on documentation skill type and generate steps
   */
  private async extractDocContent(
    skill: SkillInfo,
    params: SkillExecutionParams,
    fullContent: string,
    nextSteps: ExecutionStep[],
    taskId: string
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();
    const workspaceBase = getWorkspaceDescription();
    const taskWorkspace = `${workspaceBase}/${taskId}`;

    switch (skill.id) {
      case 'internal-comms':
        // Internal Comms
        if (taskLower.includes('status') || taskLower.includes('report')) {
          nextSteps.push({
            step: 1,
            action: 'Gather information',
            description: 'Collect progress, plans, problems',
            reason: 'Gather status information'
          });
          nextSteps.push({
            step: 2,
            action: 'Write update',
            description: 'Draft 3P update format',
            reason: 'Write status update'
          });
        } else if (taskLower.includes('newsletter')) {
          nextSteps.push({
            step: 1,
            action: 'Create newsletter',
            description: 'Write company newsletter content',
            reason: 'Create company newsletter'
          });
        }
        return extractContent(fullContent, ['documentation', 'writing', 'internal']);

      case 'doc-coauthoring':
        // Doc Co-Authoring: Three-stage process
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: `Create workspace directory: ${taskWorkspace}/`,
          reason: 'Create workspace directory for document drafts'
        });
        nextSteps.push({
          step: 2,
          action: 'Stage 1: Context Gathering',
          description: 'Gather requirements and initial questions',
          reason: 'Gather document background and requirements'
        });
        nextSteps.push({
          step: 3,
          action: 'Stage 2: Refinement',
          description: `Structure and draft content in ${taskWorkspace}`,
          reason: 'Structure and draft document in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Stage 3: Reader Testing',
          description: `Test with fresh Claude and refine in ${taskWorkspace}`,
          reason: 'Test and refine document in workspace'
        });
        nextSteps.push({
          step: 5,
          action: 'Copy final document to target directory',
          description: `Copy final document from ${taskWorkspace} to target directory`,
          reason: 'Only save final document to specified path'
        });
        return extractContent(fullContent, ['documentation', 'coauthor', 'workflow']);

      default:
        return extractContent(fullContent, ['documentation', 'writing', 'guide']);
    }
  }
}

/**
 * Default Skill Executor
 */
class DefaultSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - Execution Guide\n`);
    outputMessages.push(`**Task**: ${params.taskDescription}\n`);

    try {
      // Read SKILL.md content
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // Generate execution steps
      const taskContent = this.extractDefaultContent(skill, skillContent, nextSteps);
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
   * Extract default skill content and generate steps
   */
  private extractDefaultContent(skill: SkillInfo, fullContent: string, nextSteps: ExecutionStep[]): string {
    nextSteps.push({
      step: 1,
      action: 'Read SKILL.md',
      description: `Read ${skill.skillsPath}/SKILL.md for full instructions`,
      reason: 'Understand complete execution workflow'
    });
    nextSteps.push({
      step: 2,
      action: 'Follow workflow',
      description: 'Execute according to SKILL.md instructions',
      reason: 'Follow SKILL.md guidance for execution'
    });

    return extractContent(fullContent, ['skill', 'guide', 'how to', skill.name]);
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
  const executor = new DocumentSkillExecutor();
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
