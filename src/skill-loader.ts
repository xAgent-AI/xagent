import fs from 'fs/promises';
import path from 'path';
import { WorkflowConfig } from './workflow.js';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  license: string;
  version: string;
  author: string;
  category: string;
  markdown: string;
  skillsPath: string;
}

export interface SkillLoaderConfig {
  skillsRootPath: string;
}

export class SkillLoader {
  private skillsRootPath: string;
  private loadedSkills: Map<string, SkillInfo> = new Map();

  constructor(config?: SkillLoaderConfig) {
    this.skillsRootPath = config?.skillsRootPath || path.join(process.cwd(), '..', 'skills', 'skills');
  }

  async loadAllSkills(): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];
    
    try {
      const categories = await fs.readdir(this.skillsRootPath, { withFileTypes: true });
      
      for (const category of categories) {
        if (category.isDirectory()) {
          const categoryPath = path.join(this.skillsRootPath, category.name);
          const skillInfo = await this.loadSkillFromPath(categoryPath, category.name);
          if (skillInfo) {
            skills.push(skillInfo);
            this.loadedSkills.set(skillInfo.id, skillInfo);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to load skills from ${this.skillsRootPath}:`, error);
    }
    
    return skills;
  }

  private async loadSkillFromPath(skillPath: string, category: string): Promise<SkillInfo | null> {
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    
    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = this.parseSkillMarkdown(content);
      
      return {
        id: parsed.name,
        name: parsed.name,
        description: parsed.description,
        license: parsed.license || 'Unknown',
        version: parsed.version || '1.0.0',
        author: parsed.author || 'Anonymous',
        category: category,
        markdown: content,
        skillsPath: skillPath
      };
    } catch (error) {
      console.warn(`Failed to load skill from ${skillPath}:`, error);
      return null;
    }
  }

  private parseSkillMarkdown(content: string): { name: string; description: string; license?: string; version?: string; author?: string } {
    const result = {
      name: '',
      description: '',
      license: undefined as string | undefined,
      version: undefined as string | undefined,
      author: undefined as string | undefined
    };

    // Normalize line endings to LF for consistent parsing
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---/);
    
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const lines = frontmatter.split('\n');
      
      let currentKey = '';
      let currentValue = '';
      
      for (const line of lines) {
        const keyValueMatch = line.match(/^(\w+):\s*(.*)$/);
        
        if (keyValueMatch) {
          // Save previous key-value pair
          if (currentKey) {
            let value = currentValue.trim();
            // Remove quotes if present
            value = value.replace(/^["']|["']$/g, '');
            
            if (currentKey === 'name') result.name = value;
            else if (currentKey === 'description') result.description = value;
            else if (currentKey === 'license') result.license = value;
            else if (currentKey === 'version') result.version = value;
            else if (currentKey === 'author') result.author = value;
          }
          
          currentKey = keyValueMatch[1];
          currentValue = keyValueMatch[2];
        } else if (currentKey && line.trim()) {
          // Continuation of previous value
          currentValue += ' ' + line.trim();
        }
      }
      
      // Save last key-value pair
      if (currentKey) {
        let value = currentValue.trim();
        value = value.replace(/^["']|["']$/g, '');
        
        if (currentKey === 'name') result.name = value;
        else if (currentKey === 'description') result.description = value;
        else if (currentKey === 'license') result.license = value;
        else if (currentKey === 'version') result.version = value;
        else if (currentKey === 'author') result.author = value;
      }
    }

    return result;
  }

  getSkill(skillId: string): SkillInfo | undefined {
    return this.loadedSkills.get(skillId);
  }

  listSkills(): SkillInfo[] {
    return Array.from(this.loadedSkills.values());
  }

  async convertToWorkflow(skillId: string): Promise<WorkflowConfig | null> {
    const skill = this.getSkill(skillId);
    if (!skill) return null;

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      author: skill.author,
      agents: [],
      commands: {},
      mcpServers: {},
      xagentMd: skill.markdown,
      files: {}
    };
  }

  async convertAllToWorkflows(): Promise<WorkflowConfig[]> {
    const workflows: WorkflowConfig[] = [];
    
    for (const skill of this.loadedSkills.values()) {
      const workflow = await this.convertToWorkflow(skill.id);
      if (workflow) {
        workflows.push(workflow);
      }
    }
    
    return workflows;
  }
}

let skillLoaderInstance: SkillLoader | null = null;

export function getSkillLoader(config?: SkillLoaderConfig): SkillLoader {
  if (!skillLoaderInstance) {
    skillLoaderInstance = new SkillLoader(config);
  }
  return skillLoaderInstance;
}

export async function loadSkillsFromFolder(skillsPath: string): Promise<SkillInfo[]> {
  const loader = new SkillLoader({ skillsRootPath: skillsPath });
  return await loader.loadAllSkills();
}