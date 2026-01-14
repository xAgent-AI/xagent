import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getSkillLoader, SkillInfo, SkillLoader } from './skill-loader.js';
import { getToolRegistry } from './tools.js';
import { ExecutionMode, Tool } from './types.js';

// 重新导出 SkillInfo 以便其他模块使用
export type { SkillInfo };

export interface SkillExecutionParams {
  skillId: string;
  taskDescription: string;
  inputFile?: string;
  outputFile?: string;
  options?: Record<string, any>;
}

/**
 * 执行步骤接口 - 告诉 Agent 接下来要做什么
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
 * 技能执行结果 - 包含指导内容和下一步行动
 */
export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  files?: string[];
  /** 告诉 Agent 接下来要做什么 */
  nextSteps?: ExecutionStep[];
  /** 技能类型，用于决定是否需要手动执行 */
  requiresManualExecution?: boolean;
}

export interface SkillMatcherResult {
  skill: SkillInfo;
  confidence: number;
  matchedKeywords: string[];
  category: string;
}

// ============================================================
// 共享的内容提取工具函数
// ============================================================

/**
 * 移除 Markdown 格式（粗体、斜体等）
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // 移除粗体 **
    .replace(/\*(.+?)\*/g, '$1')      // 移除斜体 *
    .replace(/`(.+?)`/g, '$1')        // 移除行内代码 `
    .trim();
}

/**
 * 提取与关键词相关的内容（用于SKILL.md内容匹配）
 * @param content SKILL.md 完整内容
 * @param keywords 关键词列表
 * @param maxLength 最大返回长度
 * @returns 提取的相关内容
 */
export function extractContent(content: string, keywords: string[], maxLength: number = 5000): string {
  const lines = content.split('\n');
  const relevantLines: string[] = [];
  let inRelevantSection = false;
  let sectionDepth = 0;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测标题
    if (line.match(/^#{1,6}\s/)) {
      const strippedLine = stripMarkdown(line);
      const lowerLine = strippedLine.toLowerCase();

      // 检查是否包含关键词
      const hasKeyword = keywords.some(kw => lowerLine.includes(kw.toLowerCase()));

      if (hasKeyword) {
        inRelevantSection = true;
        found = true;
        sectionDepth = line.match(/^(#+)/)?.[1].length || 1;
      } else if (inRelevantSection) {
        // 检查是否是同级或更高级别标题（结束当前 section）
        const currentDepth = line.match(/^(#+)/)?.[1].length || 1;
        if (currentDepth <= sectionDepth) {
          inRelevantSection = false;
        }
      }
    }

    if (inRelevantSection || found) {
      relevantLines.push(line);
    }

    // 限制内容长度
    if (relevantLines.join('\n').length > maxLength) {
      relevantLines.push('\n...(content truncated for brevity)...');
      break;
    }
  }

  if (relevantLines.length > 0) {
    return relevantLines.join('\n').trim();
  }

  // 如果还是找不到，返回前 100 行
  return lines.slice(0, 100).join('\n').trim() + '\n\n...(See SKILL.md for full instructions)';
}

/**
 * 读取 SKILL.md 并根据任务提取相关内容
 */
export async function readSkillContent(skillPath: string, keywords: string[], maxLength: number = 5000): Promise<string> {
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  const content = await fs.readFile(skillMdPath, 'utf-8');
  return extractContent(content, keywords, maxLength);
}

// ============================================================
// SKILL 触发词映射
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
// SkillInvoker 主类
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
   * 获取所有可用的技能列表
   */
  async listAvailableSkills(): Promise<SkillInfo[]> {
    await this.initialize();
    return this.skillLoader.listSkills();
  }

  /**
   * 根据用户输入匹配最相关的技能
   */
  async matchSkill(userInput: string): Promise<SkillMatcherResult | null> {
    await this.initialize();

    const lowerInput = userInput.toLowerCase();
    let bestMatch: SkillMatcherResult | null = null;

    // 首先检查预定义的触发词
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
   * 获取技能详情
   */
  async getSkillDetails(skillId: string): Promise<SkillInfo | null> {
    await this.initialize();
    return this.skillLoader.getSkill(skillId) || null;
  }

  /**
   * 执行技能
   */
  async executeSkill(params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const skill = this.skillCache.get(params.skillId);

    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${params.skillId}`
      };
    }

    try {
      // 根据 skillId 执行相应的处理逻辑
      const executor = this.getSkillExecutor(skill.id);
      return await executor.execute(skill, params);
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取技能对应的执行器
   * 根据 skill.id 判断使用哪个执行器
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
   * 生成技能调用说明（用于 system prompt）
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
// Skill Executor 接口和实现
// ============================================================

interface SkillExecutor {
  execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult>;
}

/**
 * 文档处理技能执行器
 */
class DocumentSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - 执行指南\n`);
    outputMessages.push(`**任务**: ${params.taskDescription}\n`);

    try {
      // 读取技能文档完整内容
      const skillPath = skill.skillsPath;
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      files.push(skillMdPath);

      // 读取 SKILL.md 内容
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // 根据任务类型提取相关内容并生成执行步骤
      const taskContent = await this.extractRelevantContent(skill, params, skillContent, nextSteps);
      outputMessages.push(taskContent);

      // 如果有 input/output 文件，也加入文件列表
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
   * 根据任务类型提取相关的 skill 内容并生成执行步骤
   */
  private async extractRelevantContent(
    skill: SkillInfo,
    params: SkillExecutionParams,
    fullContent: string,
    nextSteps: ExecutionStep[]
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();

    // 根据 skill 类型提取相关内容
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
   * 提取 PPTX 相关内容并生成步骤
   */
  private extractPptxContent(taskLower: string, fullContent: string, nextSteps: ExecutionStep[]): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

    // 检测是否使用模板
    const useTemplate = taskLower.includes('template') || taskLower.includes('模板');

    if (useTemplate) {
      // 添加使用模板的步骤
      nextSteps.push({
        step: 1,
        action: 'Read documentation',
        description: 'Read html2pptx.md for template usage',
        file: 'skills/skills/pptx/html2pptx.md',
        reason: '了解如何使用模板创建 PPTX'
      });
      nextSteps.push({
        step: 2,
        action: 'Create HTML slide file',
        description: 'Create slide.html with content and styling (720pt × 405pt for 16:9)',
        reason: '创建幻灯片 HTML 文件'
      });
      nextSteps.push({
        step: 3,
        action: 'Create JS file using html2pptx library',
        description: 'Create create_ppt.js: const { html2pptx } = require("./skills/skills/pptx/scripts/html2pptx.js");',
        reason: '使用 html2pptx 库将 HTML 转换为 PPTX'
      });
      nextSteps.push({
        step: 4,
        action: 'Run the script',
        description: 'Execute: node create_ppt.js',
        reason: '生成 PPTX 文件'
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

    // 不使用模板的情况
    nextSteps.push({
      step: 1,
      action: 'Read documentation',
      description: 'Read html2pptx.md for creation workflow',
      file: 'skills/skills/pptx/html2pptx.md',
      reason: '了解如何创建 PPTX 演示文稿'
    });
    nextSteps.push({
      step: 2,
      action: 'Create HTML slide file',
      description: 'Create slide.html with content and styling (720pt × 405pt for 16:9)',
      reason: '创建幻灯片 HTML 文件'
    });
    nextSteps.push({
      step: 3,
      action: 'Create JS file using html2pptx library',
      description: 'Create create_ppt.js: const { html2pptx } = require("./skills/skills/pptx/scripts/html2pptx.js");',
      reason: '使用 html2pptx 库将 HTML 转换为 PPTX'
    });
    nextSteps.push({
      step: 4,
      action: 'Run the script',
      description: 'Execute: node create_ppt.js',
      reason: '生成 PPTX 文件'
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
   * 提取 DOCX 相关内容并生成步骤
   */
  private extractDocxContent(
    taskLower: string,
    fullContent: string,
    nextSteps: ExecutionStep[],
    params: SkillExecutionParams
  ): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

    const isNew = taskLower.includes('create') || taskLower.includes('new');
    const isEditing = taskLower.includes('edit') || taskLower.includes('modify') || taskLower.includes('修改');

    if (isNew) {
      // 创建新文档
      nextSteps.push({
        step: 1,
        action: 'Read documentation',
        description: 'Read docx-js.md for API reference',
        file: 'skills/skills/docx/docx-js.md',
        reason: '了解如何使用 docx-js 库创建 Word 文档'
      });
      nextSteps.push({
        step: 2,
        action: 'Create TypeScript/JavaScript file',
        description: 'Create create_doc.js: const { Document, Paragraph, TextRun, Packer } = require("docx");',
        reason: '创建 Word 文档代码，使用 docx 库'
      });
      nextSteps.push({
        step: 3,
        action: 'Export to .docx',
        description: 'Use Packer.toBuffer() to export',
        reason: '导出为 .docx 文件'
      });

      return extractContent(content, ['Creating', 'docx-js', 'Workflow']);
    }

    if (isEditing) {
      // 编辑现有文档
      nextSteps.push({
        step: 1,
        action: 'Read documentation',
        description: 'Read ooxml.md for editing API',
        file: 'skills/skills/docx/ooxml.md',
        reason: '了解如何编辑现有 Word 文档'
      });

      if (params.inputFile) {
        nextSteps.push({
          step: 2,
          action: 'Unpack document',
          description: `Run: python skills/skills/docx/ooxml/scripts/unpack.py "${params.inputFile}" <output_dir>`,
          reason: '解压 DOCX 文件以便编辑'
        });
      }

      nextSteps.push({
        step: 3,
        action: 'Create editing script',
        description: 'Create edit_doc.py: from ooxml import Document; doc = Document("<dir>");',
        reason: '编写 Python 编辑脚本，使用 ooxml 库的 Document 类'
      });

      if (params.inputFile || params.outputFile) {
        nextSteps.push({
          step: 4,
          action: 'Pack document',
          description: 'Run: python skills/skills/docx/ooxml/scripts/pack.py <input_dir> <output_file>',
          reason: '重新打包为 DOCX'
        });
      }

      return extractContent(content, ['Editing', 'redlining', 'ooxml']);
    }

    // 默认情况
    nextSteps.push({
      step: 1,
      action: 'Read documentation',
      description: 'Read ooxml.md or docx-js.md',
      reason: '了解文档处理方法'
    });
    nextSteps.push({
      step: 2,
      action: 'Create or edit document',
      description: 'Write code using appropriate library',
      reason: '执行文档操作'
    });

    return extractContent(content, ['Creating', 'Editing', 'document', 'docx']);
  }

  /**
   * 提取 PDF 相关内容并生成步骤
   */
  private extractPdfContent(
    taskLower: string,
    fullContent: string,
    nextSteps: ExecutionStep[],
    params: SkillExecutionParams
  ): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

    const isForm = taskLower.includes('form') || taskLower.includes('表单');
    const isExtract = taskLower.includes('extract') || taskLower.includes('提取');
    const isMerge = taskLower.includes('merge') || taskLower.includes('合并');

    nextSteps.push({
      step: 1,
      action: 'Read documentation',
      description: 'Read reference.md for PDF operations',
      file: 'skills/skills/pdf/reference.md',
      reason: '了解 PDF 操作方法'
    });

    if (isForm) {
      nextSteps.push({
        step: 2,
        action: 'Create/edit PDF form',
        description: 'Use pypdf or similar library for form fields',
        reason: '处理 PDF 表单'
      });
    } else if (isExtract) {
      nextSteps.push({
        step: 2,
        action: 'Extract content',
        description: 'Use markitdown or pypdf for text extraction',
        reason: '提取 PDF 内容'
      });
    } else if (isMerge) {
      nextSteps.push({
        step: 2,
        action: 'Merge PDFs',
        description: 'Use pypdf.Merger to combine files',
        reason: '合并 PDF 文件'
      });
    }

    return extractContent(content, ['Creating', 'pdf', 'PDF']);
  }

  /**
   * 提取 XLSX 相关内容并生成步骤
   */
  private extractXlsxContent(taskLower: string, fullContent: string, nextSteps: ExecutionStep[]): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

    const hasFormulas = taskLower.includes('formula') || taskLower.includes('公式');
    const hasData = taskLower.includes('data') || taskLower.includes('数据分析');

    nextSteps.push({
      step: 1,
      action: 'Read documentation',
      description: 'Read openpyxl documentation for Excel operations',
      reason: '了解 Excel 操作方法'
    });

    if (hasFormulas || hasData) {
      nextSteps.push({
        step: 2,
        action: 'Create spreadsheet with formulas',
        description: 'Use openpyxl to create workbook with formulas',
        reason: '创建包含公式的电子表格'
      });
    } else {
      nextSteps.push({
        step: 2,
        action: 'Create spreadsheet',
        description: 'Use openpyxl to create workbook',
        reason: '创建电子表格'
      });
    }

    return extractContent(content, ['Excel', 'xlsx', 'spreadsheet']);
  }

  /**
   * 提取默认内容
   */
  private extractDefaultContent(skill: SkillInfo, fullContent: string, nextSteps: ExecutionStep[]): string {
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();
    const firstLines = content.split('\n').slice(0, 100).join('\n');

    nextSteps.push({
      step: 1,
      action: 'Read SKILL.md',
      description: `Read ${skill.skillsPath}/SKILL.md for full instructions`,
      file: `${skill.skillsPath}/SKILL.md`,
      reason: '了解完整的执行流程'
    });

    return `### ${skill.name}\n\n${firstLines}\n\n(See ${skill.skillsPath}/SKILL.md for full instructions)`;
  }
}

/**
 * 前端开发技能执行器
 */
class FrontendSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - 执行指南\n`);
    outputMessages.push(`**任务**: ${params.taskDescription}\n`);

    try {
      // 读取 SKILL.md 内容
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // 生成执行步骤
      const taskContent = await this.extractFrontendContent(skill, params, skillContent, nextSteps);
      outputMessages.push(taskContent);

      // 如果有 input/output 文件，也加入文件列表
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
   * 根据前端技能类型提取相关内容并生成步骤
   */
  private async extractFrontendContent(
    skill: SkillInfo,
    params: SkillExecutionParams,
    fullContent: string,
    nextSteps: ExecutionStep[]
  ): Promise<string> {
    const taskLower = params.taskDescription.toLowerCase();

    // 添加通用步骤
    nextSteps.push({
      step: 1,
      action: 'Design Thinking',
      description: 'Understand requirements, define aesthetic direction',
      reason: '明确设计方向和目标'
    });
    nextSteps.push({
      step: 2,
      action: 'Create implementation',
      description: 'Write production-grade HTML/CSS/JS or React code',
      reason: '实现前端界面'
    });

    switch (skill.id) {
      case 'frontend-design':
        if (taskLower.includes('landing')) {
          nextSteps.push({
            step: 3,
            action: 'Focus areas',
            description: 'Hero section, features, pricing, testimonials, footer',
            reason: '重点实现落地页各部分'
          });
        } else if (taskLower.includes('dashboard')) {
          nextSteps.push({
            step: 3,
            action: 'Focus areas',
            description: 'Charts, data visualization, navigation panels',
            reason: '重点实现仪表盘功能'
          });
        }
        return extractContent(fullContent, ['frontend', 'design', 'web', 'interface']);

      case 'web-artifacts-builder':
        nextSteps.push({
          step: 3,
          action: 'Build React artifact',
          description: 'Use React with shadcn/ui components',
          reason: '构建 React 交互式组件'
        });
        return extractContent(fullContent, ['Web Artifacts Builder', 'React', 'Quick Start']);

      case 'webapp-testing':
        nextSteps.push({
          step: 3,
          action: 'Write Playwright tests',
          description: 'Create test scripts for web application',
          reason: '编写测试脚本'
        });
        return extractContent(fullContent, ['test', 'web', 'playwright', 'testing']);

      default:
        return extractContent(fullContent, ['frontend', 'design', 'web']);
    }
  }
}

/**
 * 视觉设计技能执行器
 */
class VisualDesignSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - 执行指南\n`);
    outputMessages.push(`**任务**: ${params.taskDescription}\n`);

    try {
      // 读取 SKILL.md 内容
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // 生成执行步骤
      const taskContent = await this.extractVisualContent(skill, params, skillContent, nextSteps);
      outputMessages.push(taskContent);

      // 如果有 input/output 文件，也加入文件列表
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
   * 根据视觉设计技能类型提取相关内容并生成步骤
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
        // Canvas Design: 两步流程
        nextSteps.push({
          step: 1,
          action: 'Design Philosophy Creation',
          description: 'Create manifesto/md file defining aesthetic movement',
          reason: '创建设计哲学文档'
        });
        nextSteps.push({
          step: 2,
          action: 'Canvas Creation',
          description: 'Express philosophy visually using PDF/PNG output',
          reason: '在画布上表达设计哲学'
        });
        return extractContent(fullContent, ['design', 'art', 'visual', 'philosophy']);

      case 'algorithmic-art':
        // Algorithmic Art
        nextSteps.push({
          step: 1,
          action: 'Algorithmic Philosophy',
          description: 'Define generative art philosophy',
          reason: '创建生成艺术哲学'
        });
        nextSteps.push({
          step: 2,
          action: 'P5.js Implementation',
          description: 'Write p5.js code for generative art',
          reason: '实现生成艺术代码'
        });
        return extractContent(fullContent, ['generative', 'algorithmic', 'art']);

      case 'theme-factory':
        // Theme Factory
        nextSteps.push({
          step: 1,
          action: 'Select theme',
          description: 'Choose from available themes or create custom',
          reason: '选择或创建主题'
        });
        nextSteps.push({
          step: 2,
          action: 'Apply theme',
          description: 'Apply colors, fonts to design',
          reason: '应用主题到设计'
        });
        return extractContent(fullContent, ['Theme Factory', 'Themes', 'apply']);

      case 'brand-guidelines':
        // Brand Guidelines
        nextSteps.push({
          step: 1,
          action: 'Apply brand colors',
          description: 'Use Anthropic brand colors and typography',
          reason: '应用品牌颜色'
        });
        nextSteps.push({
          step: 2,
          action: 'Follow guidelines',
          description: 'Apply brand styling consistently',
          reason: '遵循品牌指南'
        });
        return extractContent(fullContent, ['Brand Guidelines', 'Colors', 'Typography']);

      default:
        nextSteps.push({
          step: 1,
          action: 'Create visual design',
          description: 'Write design code or use canvas',
          reason: '创建视觉设计'
        });
        return extractContent(fullContent, ['design', 'art', 'visual']);
    }
  }
}

/**
 * 文档编写技能执行器
 */
class DocumentationSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - 执行指南\n`);
    outputMessages.push(`**任务**: ${params.taskDescription}\n`);

    try {
      // 读取 SKILL.md 内容
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // 生成执行步骤
      const taskContent = await this.extractDocContent(skill, params, skillContent, nextSteps);
      outputMessages.push(taskContent);

      // 如果有 input/output 文件，也加入文件列表
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
   * 根据文档编写技能类型提取相关内容并生成步骤
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
            reason: '收集状态信息'
          });
          nextSteps.push({
            step: 2,
            action: 'Write update',
            description: 'Draft 3P update format',
            reason: '编写状态更新'
          });
        } else if (taskLower.includes('newsletter')) {
          nextSteps.push({
            step: 1,
            action: 'Create newsletter',
            description: 'Write company newsletter content',
            reason: '创建公司通讯'
          });
        }
        return extractContent(fullContent, ['documentation', 'writing', 'internal']);

      case 'doc-coauthoring':
        // Doc Co-Authoring: 三阶段流程
        nextSteps.push({
          step: 1,
          action: 'Stage 1: Context Gathering',
          description: 'Gather requirements and initial questions',
          reason: '收集文档背景和需求'
        });
        nextSteps.push({
          step: 2,
          action: 'Stage 2: Refinement',
          description: 'Structure and draft content',
          reason: '构建文档结构并起草'
        });
        nextSteps.push({
          step: 3,
          action: 'Stage 3: Reader Testing',
          description: 'Test with fresh Claude and refine',
          reason: '测试并优化文档'
        });
        return extractContent(fullContent, ['documentation', 'coauthor', 'workflow']);

      default:
        return extractContent(fullContent, ['documentation', 'writing', 'guide']);
    }
  }
}

/**
 * 默认技能执行器
 */
class DefaultSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];
    const files: string[] = [];
    const nextSteps: ExecutionStep[] = [];

    outputMessages.push(`## ${skill.name} Skill - 执行指南\n`);
    outputMessages.push(`**任务**: ${params.taskDescription}\n`);

    try {
      // 读取 SKILL.md 内容
      const skillMdPath = path.join(skill.skillsPath, 'SKILL.md');
      files.push(skillMdPath);
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // 生成执行步骤
      const taskContent = this.extractDefaultContent(skill, skillContent, nextSteps);
      outputMessages.push(taskContent);

      // 如果有 input/output 文件，也加入文件列表
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
   * 提取默认技能内容并生成步骤
   */
  private extractDefaultContent(skill: SkillInfo, fullContent: string, nextSteps: ExecutionStep[]): string {
    nextSteps.push({
      step: 1,
      action: 'Read SKILL.md',
      description: `Read ${skill.skillsPath}/SKILL.md for full instructions`,
      reason: '了解完整的执行流程'
    });
    nextSteps.push({
      step: 2,
      action: 'Follow workflow',
      description: 'Execute according to SKILL.md instructions',
      reason: '按照 SKILL.md 指导执行'
    });

    return extractContent(fullContent, ['skill', 'guide', 'how to', skill.name]);
  }
}

// ============================================================
// 单例实例和导出
// ============================================================

let skillInvokerInstance: SkillInvoker | null = null;

export function getSkillInvoker(): SkillInvoker {
  if (!skillInvokerInstance) {
    skillInvokerInstance = new SkillInvoker();
  }
  return skillInvokerInstance;
}
