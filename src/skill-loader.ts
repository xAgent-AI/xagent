import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WorkflowConfig } from './workflow.js';
import { getConfigManager } from './config.js';

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
  skillsRootPath?: string;
  onError?: (error: SkillLoadError) => void;
  onWarning?: (warning: SkillLoadWarning) => void;
}

export interface SkillLoadError {
  skillId?: string;
  path: string;
  error: Error;
  phase: 'directory_read' | 'file_read' | 'parse_markdown';
}

export interface SkillLoadWarning {
  skillId?: string;
  path: string;
  warning: string;
  reason?: string;
}

export class SkillLoader {
  private skillsRootPath: string;
  private loadedSkills: Map<string, SkillInfo> = new Map();
  private skillDirectories: Map<string, string> = new Map(); // skillId -> path mapping
  private errorCallback?: (error: SkillLoadError) => void;
  private warningCallback?: (warning: SkillLoadWarning) => void;
  private loadStats: {
    totalFound: number;
    successfullyLoaded: number;
    failed: number;
    errors: SkillLoadError[];
  } = { totalFound: 0, successfullyLoaded: 0, failed: 0, errors: [] };

  constructor(config?: SkillLoaderConfig) {
    if (config?.skillsRootPath) {
      // Explicit path provided
      this.skillsRootPath = config.skillsRootPath;
    } else {
      // Try to get from config first
      const configManager = getConfigManager();
      const configuredPath = configManager.getSkillsPath();

      if (configuredPath) {
        this.skillsRootPath = configuredPath;
      } else {
        // Fallback: auto-detect from script location
        this.skillsRootPath = this.detectSkillsPath();
      }
    }

    // Set error and warning callbacks
    this.errorCallback = config?.onError;
    this.warningCallback = config?.onWarning;
  }

  private detectSkillsPath(): string {
    // Skills folder is always at {xagent_root}/skills/skills
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'skills');
  }

  async loadAllSkills(): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];

    // Reset stats
    this.loadStats = { totalFound: 0, successfullyLoaded: 0, failed: 0, errors: [] };

    try {
      const categories = await fs.readdir(this.skillsRootPath, { withFileTypes: true });

      // First pass: discover all skill directories
      const skillDirs: { path: string; category: string }[] = [];
      for (const category of categories) {
        if (category.isDirectory()) {
          const categoryPath = path.join(this.skillsRootPath, category.name);
          skillDirs.push({ path: categoryPath, category: category.name });
          this.loadStats.totalFound++;
        }
      }

      // Second pass: load skills (can be parallelized)
      const loadPromises = skillDirs.map(async ({ path: skillPath, category }) => {
        const skillInfo = await this.loadSkillFromPath(skillPath, category);
        if (skillInfo) {
          this.loadedSkills.set(skillInfo.id, skillInfo);
          this.skillDirectories.set(skillInfo.id, skillPath);
          this.loadStats.successfullyLoaded++;
          return skillInfo;
        } else {
          this.loadStats.failed++;
          return null;
        }
      });

      const results = await Promise.all(loadPromises);
      for (const skill of results) {
        if (skill) skills.push(skill);
      }

      // Log summary if there were errors
      if (this.loadStats.failed > 0) {
        const errorMsg = `Loaded ${this.loadStats.successfullyLoaded}/${this.loadStats.totalFound} skills, ${this.loadStats.failed} failed`;
        if (this.warningCallback) {
          this.warningCallback({
            skillId: undefined,
            path: this.skillsRootPath,
            warning: errorMsg,
            reason: `${this.loadStats.errors.length} parsing errors`
          });
        } else {
          console.warn(`[SkillLoader] ${errorMsg}`);
        }
      }

    } catch (error) {
      const loadError: SkillLoadError = {
        skillId: undefined,
        path: this.skillsRootPath,
        error: error as Error,
        phase: 'directory_read'
      };
      this.loadStats.errors.push(loadError);

      if (this.errorCallback) {
        this.errorCallback(loadError);
      } else {
        console.error(`[SkillLoader] Failed to load skills from ${this.skillsRootPath}:`, error);
      }
    }

    return skills;
  }

  /**
   * Lazy load a single skill by ID - only loads when needed
   * This is the key optimization for on-demand loading
   */
  async loadSkill(skillId: string): Promise<SkillInfo | null> {
    // Return from cache if already loaded
    const cached = this.loadedSkills.get(skillId);
    if (cached) return cached;

    // Try to find and load the specific skill
    const skillPath = this.skillDirectories.get(skillId);
    if (skillPath) {
      const skillInfo = await this.loadSkillFromPath(skillPath, '');
      if (skillInfo) {
        this.loadedSkills.set(skillInfo.id, skillInfo);
        return skillInfo;
      }
    }

    // Fallback: search in skills root directory
    return this.loadSkillBySearching(skillId);
  }

  /**
   * Search for a skill by ID in the skills root directory
   */
  private async loadSkillBySearching(skillId: string): Promise<SkillInfo | null> {
    try {
      const categories = await fs.readdir(this.skillsRootPath, { withFileTypes: true });

      for (const category of categories) {
        if (category.isDirectory()) {
          const categoryPath = path.join(this.skillsRootPath, category.name);
          const skillMdPath = path.join(categoryPath, 'SKILL.md');

          try {
            const content = await fs.readFile(skillMdPath, 'utf-8');
            const parsed = this._parseSkillMarkdown(content);

            if (parsed.name === skillId) {
              this.skillDirectories.set(skillId, categoryPath);
              const skillInfo: SkillInfo = {
                id: parsed.name,
                name: parsed.name,
                description: parsed.description,
                license: parsed.license || 'Unknown',
                version: parsed.version || '1.0.0',
                author: parsed.author || 'Anonymous',
                category: category.name,
                markdown: content,
                skillsPath: categoryPath
              };
              this.loadedSkills.set(skillId, skillInfo);
              return skillInfo;
            }
          } catch {
            // Continue searching
            continue;
          }
        }
      }
    } catch (error) {
      const loadError: SkillLoadError = {
        skillId,
        path: this.skillsRootPath,
        error: error as Error,
        phase: 'directory_read'
      };
      this.handleError(loadError);
    }

    return null;
  }

  /**
   * Pre-discover skill directories without loading content
   * This allows faster subsequent lazy loading
   */
  async discoverSkills(): Promise<string[]> {
    const skillIds: string[] = [];

    try {
      const categories = await fs.readdir(this.skillsRootPath, { withFileTypes: true });

      for (const category of categories) {
        if (category.isDirectory()) {
          const categoryPath = path.join(this.skillsRootPath, category.name);
          const skillMdPath = path.join(categoryPath, 'SKILL.md');

          try {
            const content = await fs.readFile(skillMdPath, 'utf-8');
            const parsed = this._parseSkillMarkdown(content);

            if (parsed.name) {
              this.skillDirectories.set(parsed.name, categoryPath);
              skillIds.push(parsed.name);
            }
          } catch (error) {
            const loadError: SkillLoadError = {
              skillId: undefined,
              path: categoryPath,
              error: error as Error,
              phase: 'file_read'
            };
            this.handleError(loadError);
          }
        }
      }
    } catch (error) {
      const loadError: SkillLoadError = {
        skillId: undefined,
        path: this.skillsRootPath,
        error: error as Error,
        phase: 'directory_read'
      };
      this.handleError(loadError);
    }

    return skillIds;
  }

  /**
   * Get load statistics
   */
  getLoadStats(): { totalFound: number; successfullyLoaded: number; failed: number; errors: SkillLoadError[] } {
    return { ...this.loadStats };
  }

  /**
   * Handle error with callback or console
   */
  private handleError(error: SkillLoadError): void {
    this.loadStats.errors.push(error);

    if (this.errorCallback) {
      this.errorCallback(error);
    } else {
      console.error(`[SkillLoader] Error loading skill from ${error.path}:`, error.error.message);
    }
  }

  private async loadSkillFromPath(skillPath: string, category: string): Promise<SkillInfo | null> {
    const skillMdPath = path.join(skillPath, 'SKILL.md');

    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = this._parseSkillMarkdown(content);

      if (!parsed.name) {
        const warning: SkillLoadWarning = {
          skillId: undefined,
          path: skillPath,
          warning: 'SKILL.md missing required "name" field',
          reason: 'Cannot determine skill ID'
        };
        if (this.warningCallback) {
          this.warningCallback(warning);
        } else {
          console.warn(`[SkillLoader] Warning: ${warning.warning} in ${skillPath}`);
        }
        return null;
      }

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
      const loadError: SkillLoadError = {
        skillId: undefined,
        path: skillPath,
        error: error as Error,
        phase: 'file_read'
      };
      this.handleError(loadError);
      return null;
    }
  }

  private _parseSkillMarkdown(content: string): { name: string; description: string; license?: string; version?: string; author?: string } {
    const result = {
      name: '',
      description: '',
      license: undefined as string | undefined,
      version: undefined as string | undefined,
      author: undefined as string | undefined
    };

    // Normalize line endings to LF for consistent parsing
    const normalizedContent = content.replace(/\r\n/g, '\n');

    // Try to extract frontmatter - support both formats:
    // 1. Standard YAML: ---name: docx...--- 2. No opening ---: name: docx...
    let frontmatter = '';
    let contentStart = 0;

    const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      // Standard format with --- at start and end
      frontmatter = frontmatterMatch[1];
      contentStart = frontmatterMatch[0].length;
    } else {
      // Check for format without opening --- (just YAML at the start)
      const yamlMatch = normalizedContent.match(/^([\s\S]*?)\n---/);
      if (yamlMatch) {
        frontmatter = yamlMatch[1];
        contentStart = yamlMatch[0].length;
      }
    }

    if (frontmatter) {
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

  /**
   * Get the directory path for a skill
   */
  getSkillDirectory(skillId: string): string | undefined {
    return this.skillDirectories.get(skillId);
  }

  /**
   * Public method to parse skill markdown frontmatter
   */
  parseSkillMarkdown(content: string): { name: string; description: string; license?: string; version?: string; author?: string } {
    return this._parseSkillMarkdown(content);
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