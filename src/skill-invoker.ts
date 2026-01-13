import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getSkillLoader, SkillInfo, SkillLoader } from './skill-loader.js';
import { getToolRegistry } from './tools.js';
import { ExecutionMode, Tool } from './types.js';

export interface SkillExecutionParams {
  skillId: string;
  taskDescription: string;
  inputFile?: string;
  outputFile?: string;
  options?: Record<string, any>;
}

export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  files?: string[];
}

export interface SkillMatcherResult {
  skill: SkillInfo;
  confidence: number;
  matchedKeywords: string[];
  category: string;
}

// 技能类别到关键词的映射
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
      // 根据技能类型执行相应的处理逻辑
      const executor = this.getSkillExecutor(skill.category);
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
   */
  private getSkillExecutor(category: string): SkillExecutor {
    switch (category) {
      case 'Document Processing':
        return new DocumentSkillExecutor();
      case 'Frontend & Web Development':
        return new FrontendSkillExecutor();
      case 'Visual & Creative Design':
        return new VisualDesignSkillExecutor();
      case 'Communication & Documentation':
        return new DocumentationSkillExecutor();
      default:
        return new DefaultSkillExecutor();
    }
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

interface SkillExecutor {
  execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult>;
}

class DocumentSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const toolRegistry = getToolRegistry();
    const outputMessages: string[] = [];

    outputMessages.push(`Executing skill: ${skill.name}`);
    outputMessages.push(`Task: ${params.taskDescription}`);
    outputMessages.push(`Category: Document Processing`);

    if (params.inputFile) {
      outputMessages.push(`Input file: ${params.inputFile}`);
    }
    if (params.outputFile) {
      outputMessages.push(`Output file: ${params.outputFile}`);
    }

    // 读取技能文档以获取详细指导
    try {
      const skillPath = skill.skillsPath;
      const skillMdPath = path.join(skillPath, 'SKILL.md');

      outputMessages.push(`\nSkill documentation loaded from: ${skillMdPath}`);
      outputMessages.push(`\nTo complete this task, follow the workflow outlined in the SKILL.md file.`);

      return {
        success: true,
        output: outputMessages.join('\n'),
        files: [skillMdPath]
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

class FrontendSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];

    outputMessages.push(`Executing skill: ${skill.name}`);
    outputMessages.push(`Task: ${params.taskDescription}`);
    outputMessages.push(`Category: Frontend & Web Development`);

    outputMessages.push(`\nThis skill requires creating a frontend interface.`);
    outputMessages.push(`Key considerations:`);
    outputMessages.push(`- Design thinking and aesthetic direction`);
    outputMessages.push(`- Production-grade, functional code`);
    outputMessages.push(`- Distinctive visual design avoiding generic AI aesthetics`);

    return {
      success: true,
      output: outputMessages.join('\n')
    };
  }
}

class VisualDesignSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];

    outputMessages.push(`Executing skill: ${skill.name}`);
    outputMessages.push(`Task: ${params.taskDescription}`);
    outputMessages.push(`Category: Visual & Creative Design`);

    outputMessages.push(`\nThis skill creates visual art. Process:`);
    outputMessages.push(`1. Create a design philosophy (.md file)`);
    outputMessages.push(`2. Express visually on canvas (.pdf or .png)`);
    outputMessages.push(`3. Ensure museum-quality craftsmanship`);

    return {
      success: true,
      output: outputMessages.join('\n')
    };
  }
}

class DocumentationSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const outputMessages: string[] = [];

    outputMessages.push(`Executing skill: ${skill.name}`);
    outputMessages.push(`Task: ${params.taskDescription}`);
    outputMessages.push(`Category: Communication & Documentation`);

    return {
      success: true,
      output: outputMessages.join('\n')
    };
  }
}

class DefaultSkillExecutor implements SkillExecutor {
  async execute(skill: SkillInfo, params: SkillExecutionParams): Promise<SkillExecutionResult> {
    return {
      success: true,
      output: `Executing skill: ${skill.name}\nTask: ${params.taskDescription}`
    };
  }
}

// 单例实例
let skillInvokerInstance: SkillInvoker | null = null;

export function getSkillInvoker(): SkillInvoker {
  if (!skillInvokerInstance) {
    skillInvokerInstance = new SkillInvoker();
  }
  return skillInvokerInstance;
}
