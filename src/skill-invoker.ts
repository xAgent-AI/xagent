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

export type { SkillInfo } from './skill-loader.js';

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
    const outputMessages: string[] = [];
    const files: string[] = [];

    outputMessages.push(`## ${skill.name} Skill\n`);
    outputMessages.push(`**Task**: ${params.taskDescription}\n`);

    // 读取技能文档完整内容
    try {
      const skillPath = skill.skillsPath;
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      files.push(skillMdPath);

      // 读取 SKILL.md 内容
      const fs = await import('fs/promises');
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');

      // 根据任务类型提取相关内容
      const taskContent = this.extractRelevantContent(skill, params, skillContent);
      outputMessages.push(taskContent);

      // 如果有 input/output 文件，也加入文件列表
      if (params.inputFile) files.push(params.inputFile);
      if (params.outputFile) files.push(params.outputFile);

      return {
        success: true,
        output: outputMessages.join('\n'),
        files: files
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 根据任务类型提取相关的 skill 内容
   */
  private extractRelevantContent(skill: SkillInfo, params: SkillExecutionParams, fullContent: string): string {
    const taskLower = params.taskDescription.toLowerCase();
    let relevantSections: string[] = [];

    // 根据 skill 类型和任务描述提取相关内容
    switch (skill.id) {
      case 'pptx':
        return this.extractPptxContent(taskLower, fullContent);
      case 'docx':
        return this.extractDocxContent(taskLower, fullContent);
      case 'pdf':
        return this.extractPdfContent(taskLower, fullContent);
      case 'xlsx':
        return this.extractXlsxContent(taskLower, fullContent);
      default:
        return this.extractDefaultContent(skill, fullContent);
    }
  }

  private extractPptxContent(taskLower: string, fullContent: string): string {
    let content = '### PPTX Creation Workflow\n\n';

    // 检测是否使用模板
    const useTemplate = taskLower.includes('template') || taskLower.includes('模板');

    if (useTemplate) {
      content += this.extractSection(fullContent, 'Using a template') ||
        '1. Extract template text: `python -m markitdown template.pptx > template-content.md`\n' +
        '2. Create thumbnail grid: `python scripts/thumbnail.py template.pptx`\n' +
        '3. Analyze and save template inventory\n' +
        '4. Create presentation outline based on template layouts\n' +
        '5. Duplicate/reorder slides: `python scripts/rearrange.py template.pptx working.pptx 0,34,50,...`\n' +
        '6. Extract text inventory: `python scripts/inventory.py working.pptx text-inventory.json`\n' +
        '7. Generate replacements: Create JSON with new text for each shape\n' +
        '8. Apply replacements: `python scripts/replace.py working.pptx replacement-text.json output.pptx`\n';
    } else {
      content += this.extractSection(fullContent, 'Without a template') ||
        this.extractSection(fullContent, 'Creating a new PowerPoint') ||
        '### Creating New Presentation\n\n' +
        '**Step 1**: Create HTML slides (720pt × 405pt for 16:9)\n' +
        '```html\n' +
        '<html>\n<body style="width: 720pt; height: 405pt;">\n' +
        '  <h1>Title</h1>\n' +
        '  <p>Content here</p>\n' +
        '</body>\n</html>\n' +
        '```\n\n' +
        '**Step 2**: Convert using html2pptx\n' +
        '```javascript\n' +
        'const pptx = new PptxGenJS();\n' +
        'pptx.layout = "LAYOUT_16x9";\n' +
        'const { slide } = await html2pptx("slide.html", pptx);\n' +
        'await pptx.writeFile({ fileName: "presentation.pptx" });\n' +
        '```\n\n' +
        '**Critical Rules**:\n' +
        '- Text MUST be in <p>, <h1>-<h6>, <ul>, <ol> tags\n' +
        '- Use web-safe fonts: Arial, Helvetica, Times New Roman, Georgia, Courier New\n' +
        '- No manual bullets (•, -, *) - use <ul> or <ol>\n' +
        '- Rasterize gradients/icons to PNG first using Sharp\n' +
        '- Use class="placeholder" for charts/tables\n';
    }

    return content;
  }

  private extractDocxContent(taskLower: string, fullContent: string): string {
    let content = '### DOCX Creation/Editing Workflow\n\n';

    const isEditing = taskLower.includes('edit') || taskLower.includes('修改');
    const isCreating = taskLower.includes('create') || taskLower.includes('创建');

    if (isEditing) {
      content += '1. Unpack DOCX: `python ooxml/scripts/unpack.py document.docx output_dir/`\n' +
        '2. Edit XML files (document.xml, etc.)\n' +
        '3. Validate: `python ooxml/scripts/validate.py output_dir`\n' +
        '4. Repack: `python ooxml/scripts/pack.py output_dir document-edited.docx`\n';
    } else if (isCreating) {
      content += this.extractSection(fullContent, 'Creating a new Word') ||
        '1. Create Word document using docx-js library\n' +
        '2. Add paragraphs, headings, tables, images as needed\n' +
        '3. Use tracked changes for collaborative editing\n' +
        '4. Add comments for review notes\n';
    }

    return content;
  }

  private extractPdfContent(taskLower: string, fullContent: string): string {
    let content = '### PDF Workflow\n\n';

    const isForm = taskLower.includes('form') || taskLower.includes('表单');
    const isExtract = taskLower.includes('extract') || taskLower.includes('提取');
    const isMerge = taskLower.includes('merge') || taskLower.includes('合并');

    if (isForm) {
      content += '1. Unpack PDF: `python ooxml/scripts/unpack.py document.pdf output_dir/`\n' +
        '2. Edit form fields in XML\n' +
        '3. Validate changes\n' +
        '4. Repack PDF\n';
    } else if (isExtract) {
      content += 'Extract text: `python -m markitdown document.pdf`\n';
    } else if (isMerge) {
      content += 'Use PDF library to merge multiple PDFs\n';
    } else {
      content += this.extractSection(fullContent, 'Creating') ||
        '1. Create PDF using PDF library (reportlab, fpdf, etc.)\n' +
        '2. Add text, images, shapes as needed\n' +
        '3. Save to file\n';
    }

    return content;
  }

  private extractXlsxContent(taskLower: string, fullContent: string): string {
    let content = '### XLSX Workflow\n\n';

    const hasFormulas = taskLower.includes('formula') || taskLower.includes('公式');
    const hasData = taskLower.includes('data') || taskLower.includes('数据分析');

    if (hasFormulas || hasData) {
      content += '1. Create workbook using xlsx library (xlsx-js or similar)\n' +
        '2. Add worksheets with data\n' +
        '3. Define formulas where needed\n' +
        '4. Apply formatting (headers, borders, colors)\n' +
        '5. Save: `workbook.save("output.xlsx")`\n\n' +
        '**Formulas Format**: Excel-style formulas like "=SUM(A1:A10)", "=B2*C2"\n';
    } else {
      content += '1. Create Excel workbook\n' +
        '2. Add data to worksheets\n' +
        '3. Apply formatting as needed\n' +
        '4. Save to file\n';
    }

    return content;
  }

  private extractDefaultContent(skill: SkillInfo, fullContent: string): string {
    // 提取 skill 的主要内容（移除 YAML frontmatter）
    const content = fullContent.replace(/^---\n[\s\S]*?\n---/, '').trim();
    const firstLines = content.split('\n').slice(0, 50).join('\n');
    return `### ${skill.name}\n\n${firstLines}\n\n(See ${skill.skillsPath}/SKILL.md for full instructions)`;
  }

  /**
   * 从完整内容中提取指定标题下的内容
   */
  private extractSection(fullContent: string, sectionTitle: string): string {
    const lines = fullContent.split('\n');
    let found = false;
    let sectionLines: string[] = [];
    let headingLevel = 0;

    for (const line of lines) {
      if (line.match(/^#{1,6}\s/)) {
        const currentLevel = line.match(/^(#+)/)?.[1].length || 0;
        const currentTitle = line.replace(/^#+\s*/, '').toLowerCase();

        if (found && currentLevel <= headingLevel) {
          break; // 结束当前 section
        }

        if (currentTitle.includes(sectionTitle.toLowerCase()) ||
            sectionTitle.toLowerCase().includes(currentTitle)) {
          found = true;
          headingLevel = currentLevel;
          sectionLines.push(line);
        }
      } else if (found) {
        sectionLines.push(line);
        // 限制提取的字符数
        if (sectionLines.join('\n').length > 3000) {
          sectionLines.push('\n...(content truncated for brevity)...');
          break;
        }
      }
    }

    return sectionLines.length > 0 ? sectionLines.join('\n') : '';
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
