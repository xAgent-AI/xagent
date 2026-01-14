import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getSkillLoader, SkillInfo, SkillLoader } from './skill-loader.js';
import { getToolRegistry } from './tools.js';
import { ExecutionMode, Tool } from './types.js';

// Re-export SkillInfo for other modules
export type { SkillInfo };

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
  return path.join(os.homedir(), '.xagent', 'workspace', taskId);
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

const SKILL_TRIGGERS: Record<string, { skillId: string; keywords: string[]; category: string }> = {
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
        instructions += `  → Use: InvokeSkill(skillId="${skill.skillId}", taskDescription="...")\n`;
      }
      instructions += '\n';
    }

    return instructions;
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

    outputMessages.push(`## ${skill.name} Skill - Execution Guide\n`);
    outputMessages.push(`**Task**: ${params.taskDescription}\n`);

    try {
      // Read complete skill documentation
      const skillPath = skill.skillsPath;
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      files.push(skillMdPath);

      // Read SKILL.md content
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // Extract relevant content based on task type and generate execution steps
      const taskContent = await this.extractRelevantContent(skill, params, skillContent, nextSteps);
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
   * Extract relevant skill content based on task type and generate execution steps
   */
  private async extractRelevantContent(
    skill: SkillInfo,
    params: SkillExecutionParams,
    fullContent: string,
    nextSteps: ExecutionStep[]
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();

    // Extract content based on skill type
    switch (skill.id) {
      case 'pptx':
        return this.extractPptxContent(taskLower, fullContent, nextSteps);
      case 'docx':
        return this.extractDocxContent(taskLower, fullContent, nextSteps, params);
      case 'pdf':
        return this.extractPdfContent(taskLower, fullContent, nextSteps, params);
      case 'xlsx':
        return this.extractXlsxContent(taskLower, fullContent, nextSteps);
      default:
        return this.extractDefaultContent(skill, fullContent, nextSteps);
    }
  }

  /**
   * Extract PPTX-related content and generate steps
   */
  private extractPptxContent(taskLower: string, fullContent: string, nextSteps: ExecutionStep[]): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

    // Check if using template
    const useTemplate = taskLower.includes('template') || taskLower.includes('template');

    if (useTemplate) {
      // Add template usage steps
      nextSteps.push({
        step: 1,
        action: 'Read documentation',
        description: 'Read html2pptx.md for template usage',
        file: 'skills/skills/pptx/html2pptx.md',
        reason: 'Understand how to create PPTX using templates'
      });
      nextSteps.push({
        step: 2,
        action: 'Create HTML slide file in workspace',
        description: 'Create slide.html in workspace (~/.xagent/workspace/<task-id>/) with content and styling (720pt × 405pt for 16:9)',
        reason: 'Create slide HTML file in workspace to avoid polluting target directory'
      });
      nextSteps.push({
        step: 3,
        action: 'Create JS file using html2pptx library',
        description: 'Create create_ppt.js in workspace using dynamic import with absolute path: const { html2pptx } = await import("D:/xagent/xagent/skills/skills/pptx/scripts/html2pptx.js");',
        reason: 'Use html2pptx library to convert HTML to PPTX (must use dynamic import with absolute path)'
      });
      nextSteps.push({
        step: 4,
        action: 'Run the script in workspace',
        description: 'Execute: node create_ppt.js in workspace directory',
        reason: 'Generate PPTX file in workspace'
      });
      nextSteps.push({
        step: 5,
        action: 'Copy output to target directory',
        description: 'Copy output.pptx from workspace to target directory',
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
      action: 'Read documentation',
      description: 'Read html2pptx.md for creation workflow',
      file: 'skills/skills/pptx/html2pptx.md',
      reason: 'Understand how to create PPTX presentations'
    });
    nextSteps.push({
      step: 2,
      action: 'Create HTML slide file in workspace',
      description: 'Create slide.html in workspace (~/.xagent/workspace/<task-id>/) with content and styling (720pt × 405pt for 16:9)',
      reason: 'Create slide HTML file in workspace to avoid polluting target directory'
    });
    nextSteps.push({
      step: 3,
      action: 'Create JS file using html2pptx library',
      description: 'Create create_ppt.js in workspace using dynamic import with absolute path: const { html2pptx } = await import("D:/xagent/xagent/skills/skills/pptx/scripts/html2pptx.js");',
      reason: 'Use html2pptx library to convert HTML to PPTX (must use dynamic import with absolute path)'
    });
    nextSteps.push({
      step: 4,
      action: 'Run the script in workspace',
      description: 'Execute: node create_ppt.js in workspace directory',
      reason: 'Generate PPTX file in workspace'
    });
    nextSteps.push({
      step: 5,
      action: 'Copy output to target directory',
      description: 'Copy output.pptx from workspace to target directory',
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
    params: SkillExecutionParams
  ): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

    const isNew = taskLower.includes('create') || taskLower.includes('new');
    const isEditing = taskLower.includes('edit') || taskLower.includes('modify') || taskLower.includes('modify');

    if (isNew) {
      // Create new document
      nextSteps.push({
        step: 1,
        action: 'Read documentation',
        description: 'Read docx-js.md for API reference',
        file: 'skills/skills/docx/docx-js.md',
        reason: 'Understand how to use docx-js library to create Word documents'
      });
      nextSteps.push({
        step: 2,
        action: 'Create script in workspace',
        description: 'Create create_doc.js in workspace (~/.xagent/workspace/<task-id>/): const { Document, Paragraph, TextRun, Packer } = await import("docx");',
        reason: 'Create Word document code in workspace using docx library with dynamic import'
      });
      nextSteps.push({
        step: 3,
        action: 'Run the script',
        description: 'Execute: node create_doc.js in workspace',
        reason: 'Generate DOCX file in workspace'
      });
      nextSteps.push({
        step: 4,
        action: 'Copy output to target directory',
        description: 'Copy output.docx from workspace to target directory',
        reason: 'Only save final file to specified path, keep workspace clean'
      });

      return extractContent(content, ['Creating', 'docx-js', 'Workflow']);
    }

    if (isEditing) {
      // Edit existing document
      nextSteps.push({
        step: 1,
        action: 'Read documentation',
        description: 'Read ooxml.md for editing API',
        file: 'skills/skills/docx/ooxml.md',
        reason: 'Understand how to edit existing Word documents'
      });

      nextSteps.push({
        step: 2,
        action: 'Create workspace directory',
        description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
        reason: 'Create workspace directory for intermediate files'
      });

      if (params.inputFile) {
        nextSteps.push({
          step: 3,
          action: 'Unpack document in workspace',
          description: `Run: python skills/skills/docx/ooxml/scripts/unpack.py "${params.inputFile}" <workspace_dir>/docx_input`,
          reason: 'Unpack DOCX file in workspace for editing'
        });
      }

      nextSteps.push({
        step: 4,
        action: 'Create editing script in workspace',
        description: 'Create edit_doc.py in workspace: from ooxml import Document; doc = Document("<workspace_dir>/docx_input");',
        reason: 'Create Python editing script in workspace'
      });

      if (params.inputFile || params.outputFile) {
        nextSteps.push({
          step: 5,
          action: 'Pack document',
          description: 'Run: python skills/skills/docx/ooxml/scripts/pack.py <workspace_dir>/docx_input <workspace_dir>/output.docx',
          reason: 'Repack DOCX in workspace'
        });
      }

      nextSteps.push({
        step: 6,
        action: 'Copy output to target directory',
        description: 'Copy output.docx from workspace to target directory',
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
    params: SkillExecutionParams
  ): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

    const isForm = taskLower.includes('form') || taskLower.includes('form');
    const isExtract = taskLower.includes('extract') || taskLower.includes('extract');
    const isMerge = taskLower.includes('merge') || taskLower.includes('merge');

    nextSteps.push({
      step: 1,
      action: 'Read documentation',
      description: 'Read reference.md for PDF operations',
      file: 'skills/skills/pdf/reference.md',
      reason: 'Understand PDF operation methods'
    });

    nextSteps.push({
      step: 2,
      action: 'Create workspace directory',
      description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
      reason: 'Create workspace directory for intermediate files'
    });

    if (isForm) {
      nextSteps.push({
        step: 3,
        action: 'Create PDF form script in workspace',
        description: 'Create pdf_script.py in workspace using pypdf or similar library for form fields',
        reason: 'Create PDF form processing script in workspace'
      });
    } else if (isExtract) {
      nextSteps.push({
        step: 3,
        action: 'Create extraction script in workspace',
        description: 'Create extract_script.py in workspace using markitdown or pypdf for text extraction',
        reason: 'Create PDF content extraction script in workspace'
      });
    } else if (isMerge) {
      nextSteps.push({
        step: 3,
        action: 'Create merge script in workspace',
        description: 'Create merge_script.py in workspace using pypdf.Merger to combine files',
        reason: 'Create PDF merge script in workspace'
      });
    }

    nextSteps.push({
      step: 4,
      action: 'Run the script',
      description: 'Execute: python pdf_script.py in workspace',
      reason: 'Execute PDF operation script in workspace'
    });

    nextSteps.push({
      step: 5,
      action: 'Copy output to target directory',
      description: 'Copy output.pdf from workspace to target directory',
      reason: 'Only save final file to specified path'
    });

    return extractContent(content, ['Creating', 'pdf', 'PDF']);
  }

  /**
   * Extract XLSX relevant content and generate steps
   */
  private extractXlsxContent(taskLower: string, fullContent: string, nextSteps: ExecutionStep[]): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

    const hasFormulas = taskLower.includes('formula') || taskLower.includes('公式');
    const hasData = taskLower.includes('data') || taskLower.includes('数据分析');

    nextSteps.push({
      step: 1,
      action: 'Read documentation',
      description: 'Read openpyxl documentation for Excel operations',
      reason: 'Understand Excel operation methods'
    });

    nextSteps.push({
      step: 2,
      action: 'Create workspace directory',
      description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
      reason: 'Create workspace directory for intermediate files'
    });

    if (hasFormulas || hasData) {
      nextSteps.push({
        step: 3,
        action: 'Create spreadsheet script in workspace',
        description: 'Create create_xlsx.py in workspace using openpyxl to create workbook with formulas',
        reason: 'Create spreadsheet script with formulas in workspace'
      });
    } else {
      nextSteps.push({
        step: 3,
        action: 'Create spreadsheet script in workspace',
        description: 'Create create_xlsx.py in workspace using openpyxl to create workbook',
        reason: 'Create spreadsheet script in workspace'
      });
    }

    nextSteps.push({
      step: 4,
      action: 'Run the script',
      description: 'Execute: python create_xlsx.py in workspace',
      reason: 'Generate XLSX file in workspace'
    });

    nextSteps.push({
      step: 5,
      action: 'Copy output to target directory',
      description: 'Copy output.xlsx from workspace to target directory',
      reason: 'Only save final file to specified path'
    });

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
      description: `Read ${skill.skillsPath}/SKILL.md for full instructions`,
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

    try {
      // Read SKILL.md content
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // Generate execution steps
      const taskContent = await this.extractFrontendContent(skill, params, skillContent, nextSteps);
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
    nextSteps: ExecutionStep[]
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();

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
          description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
          reason: 'Create workspace directory for frontend files'
        });
        nextSteps.push({
          step: 4,
          action: 'Create frontend files in workspace',
          description: 'Create index.html, styles.css, app.js in workspace',
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
          description: 'Open files in workspace to verify',
          reason: 'Verify in browser'
        });
        nextSteps.push({
          step: 7,
          action: 'Copy files to target directory',
          description: 'Copy frontend files from workspace to target directory',
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['frontend', 'design', 'web', 'interface']);

      case 'web-artifacts-builder':
        nextSteps.push({
          step: 3,
          action: 'Create workspace directory',
          description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
          reason: 'Create workspace directory for component files'
        });
        nextSteps.push({
          step: 4,
          action: 'Build React artifact in workspace',
          description: 'Create React component files in workspace using shadcn/ui',
          reason: 'Build React component in workspace'
        });
        nextSteps.push({
          step: 5,
          action: 'Test artifact',
          description: 'Test the artifact in workspace',
          reason: 'Test component functionality'
        });
        nextSteps.push({
          step: 6,
          action: 'Copy artifact to target directory',
          description: 'Copy component files from workspace to target directory',
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['Web Artifacts Builder', 'React', 'Quick Start']);

      case 'webapp-testing':
        nextSteps.push({
          step: 3,
          action: 'Create workspace directory',
          description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
          reason: 'Create workspace directory for test files'
        });
        nextSteps.push({
          step: 4,
          action: 'Write Playwright tests in workspace',
          description: 'Create test scripts in workspace for web application',
          reason: 'Write test scripts in workspace'
        });
        nextSteps.push({
          step: 5,
          action: 'Run tests',
          description: 'Execute: npx playwright test in workspace',
          reason: 'Run tests'
        });
        nextSteps.push({
          step: 6,
          action: 'Copy test reports to target directory',
          description: 'Copy test reports from workspace to target directory',
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

    try {
      // Read SKILL.md content
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // Generate execution steps
      const taskContent = await this.extractVisualContent(skill, params, skillContent, nextSteps);
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
    nextSteps: ExecutionStep[]
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();

    switch (skill.id) {
      case 'canvas-design':
        // Canvas Design: Two-step process
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
          reason: 'Create workspace directory for design files'
        });
        nextSteps.push({
          step: 2,
          action: 'Design Philosophy Creation',
          description: 'Create manifesto/md file in workspace defining aesthetic movement',
          reason: 'Create design philosophy document in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'Canvas Creation',
          description: 'Express philosophy visually using PDF/PNG output in workspace',
          reason: 'Express philosophy visually on canvas in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Copy output to target directory',
          description: 'Copy output files from workspace to target directory',
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['design', 'art', 'visual', 'philosophy']);

      case 'algorithmic-art':
        // Algorithmic Art
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
          reason: 'Create workspace directory for generative art files'
        });
        nextSteps.push({
          step: 2,
          action: 'Algorithmic Philosophy',
          description: 'Define generative art philosophy in workspace',
          reason: 'Create generative art philosophy in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'P5.js Implementation',
          description: 'Write p5.js code in workspace for generative art',
          reason: 'Implement generative art code in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Generate artwork',
          description: 'Run p5.js code in workspace to generate artwork',
          reason: 'Run generative art code'
        });
        nextSteps.push({
          step: 5,
          action: 'Copy output to target directory',
          description: 'Copy output files from workspace to target directory',
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['generative', 'algorithmic', 'art']);

      case 'theme-factory':
        // Theme Factory
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
          reason: 'Create workspace directory for theme files'
        });
        nextSteps.push({
          step: 2,
          action: 'Select theme',
          description: 'Choose from available themes or create custom in workspace',
          reason: 'Select or create theme in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'Apply theme',
          description: 'Apply colors, fonts to design in workspace',
          reason: 'Apply theme to design in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Copy output to target directory',
          description: 'Copy theme files from workspace to target directory',
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['Theme Factory', 'Themes', 'apply']);

      case 'brand-guidelines':
        // Brand Guidelines
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
          reason: 'Create workspace directory for brand files'
        });
        nextSteps.push({
          step: 2,
          action: 'Apply brand colors',
          description: 'Use Anthropic brand colors and typography in workspace',
          reason: 'Apply brand colors in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'Follow guidelines',
          description: 'Apply brand styling consistently in workspace',
          reason: 'Follow brand guidelines in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Copy output to target directory',
          description: 'Copy brand files from workspace to target directory',
          reason: 'Only save final files to specified path'
        });
        return extractContent(fullContent, ['Brand Guidelines', 'Colors', 'Typography']);

      default:
        nextSteps.push({
          step: 1,
          action: 'Create workspace directory',
          description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
          reason: 'Create workspace directory for design files'
        });
        nextSteps.push({
          step: 2,
          action: 'Create visual design',
          description: 'Write design code or use canvas in workspace',
          reason: 'Create visual design in workspace'
        });
        nextSteps.push({
          step: 3,
          action: 'Copy output to target directory',
          description: 'Copy output files from workspace to target directory',
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

    try {
      // Read SKILL.md content
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // Generate execution steps
      const taskContent = await this.extractDocContent(skill, params, skillContent, nextSteps);
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
    nextSteps: ExecutionStep[]
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();

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
          description: 'Create workspace directory: ~/.xagent/workspace/<task-id>/',
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
          description: 'Structure and draft content in workspace',
          reason: 'Structure and draft document in workspace'
        });
        nextSteps.push({
          step: 4,
          action: 'Stage 3: Reader Testing',
          description: 'Test with fresh Claude and refine in workspace',
          reason: 'Test and refine document in workspace'
        });
        nextSteps.push({
          step: 5,
          action: 'Copy final document to target directory',
          description: 'Copy final document from workspace to target directory',
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
// Singleton Instance and Exports
// ============================================================

let skillInvokerInstance: SkillInvoker | null = null;

export function getSkillInvoker(): SkillInvoker {
  if (!skillInvokerInstance) {
    skillInvokerInstance = new SkillInvoker();
  }
  return skillInvokerInstance;
}
