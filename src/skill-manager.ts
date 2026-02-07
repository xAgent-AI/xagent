/**
 * Skill Manager - Unified skill management
 * - Initializes user skills directory by copying built-in skills
 * - Provides unified access to all skills
 * - Removes distinction between built-in and user skills
 */
import fs from 'fs/promises';
import os from 'os';
import _fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfigManager } from './config.js';
import { getLogger } from './logger.js';

const logger = getLogger();

export interface SkillManagerConfig {
  builtinSkillsRoot?: string;  // Built-in skills root (e.g., {xagent}/skills/skills)
  userSkillsRoot?: string;     // User skills root (e.g., ~/.xagent/skills)
}

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

export class SkillManager {
  private builtinSkillsRoot: string;
  private userSkillsRoot: string;
  private initialized: boolean = false;

  constructor(config?: SkillManagerConfig) {
    const configManager = getConfigManager();

    // Built-in skills root: {xagent}/skills/skills
    if (config?.builtinSkillsRoot) {
      this.builtinSkillsRoot = config.builtinSkillsRoot;
    } else {
      this.builtinSkillsRoot = this.detectBuiltinSkillsPath();
    }

    // User skills root: ~/.xagent/skills
    if (config?.userSkillsRoot) {
      this.userSkillsRoot = config.userSkillsRoot;
    } else {
      this.userSkillsRoot = configManager.getUserSkillsPath() ||
        path.join(os.homedir(), '.xagent', 'skills');
    }
  }

  private detectBuiltinSkillsPath(): string {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'skills');
  }

  /**
   * Initialize user skills directory
   * - Copy all built-in skills to user directory on first run
   * - Preserve user modifications (don't overwrite existing skills)
   */
  async initialize(): Promise<{ copied: number; skipped: number }> {
    if (this.initialized) {
      return { copied: 0, skipped: 0 };
    }

    try {
      await fs.mkdir(this.userSkillsRoot, { recursive: true });
    } catch {
      // Ignore - directory exists
    }

    let copied = 0;
    let skipped = 0;

    try {
      const builtinCategories = await fs.readdir(this.builtinSkillsRoot, { withFileTypes: true });

      for (const category of builtinCategories) {
        if (category.isDirectory()) {
          const srcPath = path.join(this.builtinSkillsRoot, category.name);
          const destPath = path.join(this.userSkillsRoot, category.name);

          try {
            // Check if skill already exists in user directory
            await fs.access(destPath);
            skipped++;
            logger.debug(`[SkillManager] Skill "${category.name}" already exists, skipping`);
          } catch {
            // Copy the entire skill directory
            await this.copyDirectory(srcPath, destPath);
            copied++;
            logger.debug(`[SkillManager] Copied skill "${category.name}" to user directory`);
          }
        }
      }

      this.initialized = true;
      logger.info(`[SkillManager] Initialized: ${copied} copied, ${skipped} skipped`);
    } catch (error) {
      logger.error(`[SkillManager] Failed to initialize: ${error}`);
    }

    return { copied, skipped };
  }

  /**
   * Check if user skills directory is initialized (has skills)
   */
  async isInitialized(): Promise<boolean> {
    try {
      const entries = await fs.readdir(this.userSkillsRoot, { withFileTypes: true });
      return entries.some(e => e.isDirectory());
    } catch {
      return false;
    }
  }

  /**
   * Get the user skills root path
   */
  getUserSkillsRoot(): string {
    return this.userSkillsRoot;
  }

  /**
   * Get the built-in skills root path
   */
  getBuiltinSkillsRoot(): string {
    return this.builtinSkillsRoot;
  }

  /**
   * List all user skills
   */
  async listSkills(): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];

    try {
      const categories = await fs.readdir(this.userSkillsRoot, { withFileTypes: true });

      for (const category of categories) {
        if (category.isDirectory()) {
          const skillPath = path.join(this.userSkillsRoot, category.name);
          const skillMdPath = path.join(skillPath, 'SKILL.md');

          try {
            const content = await fs.readFile(skillMdPath, 'utf-8');
            const parsed = this.parseSkillMarkdown(content);

            if (parsed.name) {
              skills.push({
                id: parsed.name,
                name: parsed.name,
                description: parsed.description,
                license: parsed.license || 'Unknown',
                version: parsed.version || '1.0.0',
                author: parsed.author || 'Anonymous',
                category: category.name,
                markdown: content,
                skillsPath: skillPath
              });
            }
          } catch {
            // Skip skills without SKILL.md
          }
        }
      }
    } catch (error) {
      logger.error(`[SkillManager] Failed to list skills: ${error}`);
    }

    return skills;
  }

  /**
   * Install a skill from local path (copy to user directory)
   */
  async installLocal(sourcePath: string): Promise<{ success: boolean; skillName?: string; error?: string }> {
    try {
      const resolvedPath = path.resolve(sourcePath);
      const skillName = path.basename(resolvedPath);
      const _destPath = path.join(this.userSkillsRoot, skillName);

      // Check if source exists
      await fs.access(resolvedPath);

      // Find SKILL.md in source
      const skillMdPath = await this.findSkillMd(resolvedPath);
      if (!skillMdPath) {
        return { success: false, error: 'SKILL.md not found in source directory' };
      }

      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = this.parseSkillMarkdown(content);
      const actualName = parsed.name || skillName;

      const actualDestPath = path.join(this.userSkillsRoot, actualName);

      // Check if skill already exists
      try {
        await fs.access(actualDestPath);
        return { success: false, error: `Skill "${actualName}" already installed` };
      } catch {
        // Doesn't exist, proceed
      }

      // Ensure user skills directory exists
      await fs.mkdir(this.userSkillsRoot, { recursive: true });

      // Copy the skill
      await this.copyDirectory(resolvedPath, actualDestPath);

      return { success: true, skillName: actualName };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Remove a skill from user directory
   */
  async removeSkill(skillName: string): Promise<{ success: boolean; error?: string }> {
    const skillPath = path.join(this.userSkillsRoot, skillName);

    try {
      await fs.access(skillPath);

      // Verify it's in user skills path
      if (!skillPath.startsWith(this.userSkillsRoot)) {
        return { success: false, error: 'Cannot remove skill outside user directory' };
      }

      await fs.rm(skillPath, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get a single skill by name
   */
  async getSkill(skillName: string): Promise<SkillInfo | null> {
    const skillPath = path.join(this.userSkillsRoot, skillName);
    const skillMdPath = path.join(skillPath, 'SKILL.md');

    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = this.parseSkillMarkdown(content);

      return {
        id: parsed.name || skillName,
        name: parsed.name || skillName,
        description: parsed.description,
        license: parsed.license || 'Unknown',
        version: parsed.version || '1.0.0',
        author: parsed.author || 'Anonymous',
        category: '',
        markdown: content,
        skillsPath: skillPath
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse skill markdown frontmatter
   */
  private parseSkillMarkdown(content: string): { name: string; description: string; license?: string; version?: string; author?: string } {
    const result = { name: '', description: '', license: undefined as string | undefined, version: undefined as string | undefined, author: undefined as string | undefined };
    const normalizedContent = content.replace(/\r\n/g, '\n');

    // Try to extract frontmatter
    const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      // Try format without opening ---
      const yamlMatch = normalizedContent.match(/^([\s\S]*?)\n---/);
      if (yamlMatch) {
        return this.parseYamlBlock(yamlMatch[1], result);
      }
      return result;
    }

    return this.parseYamlBlock(frontmatterMatch[1], result);
  }

  private parseYamlBlock(block: string, result: { name: string; description: string; license?: string; version?: string; author?: string }): { name: string; description: string; license?: string; version?: string; author?: string } {
    const lines = block.split('\n');
    let currentKey = '';
    let currentValue = '';

    for (const line of lines) {
      const keyValueMatch = line.match(/^(\w+):\s*(.*)$/);
      if (keyValueMatch) {
        if (currentKey) {
          const value = currentValue.trim().replace(/^["']|["']$/g, '');
          if (currentKey === 'name') result.name = value;
          else if (currentKey === 'description') result.description = value;
          else if (currentKey === 'license') result.license = value;
          else if (currentKey === 'version') result.version = value;
          else if (currentKey === 'author') result.author = value;
        }
        currentKey = keyValueMatch[1];
        currentValue = keyValueMatch[2];
      } else if (currentKey && line.trim()) {
        currentValue += ' ' + line.trim();
      }
    }

    if (currentKey) {
      const value = currentValue.trim().replace(/^["']|["']$/g, '');
      if (currentKey === 'name') result.name = value;
      else if (currentKey === 'description') result.description = value;
      else if (currentKey === 'license') result.license = value;
      else if (currentKey === 'version') result.version = value;
      else if (currentKey === 'author') result.author = value;
    }

    return result;
  }

  /**
   * Find SKILL.md in a directory (recursive)
   */
  private async findSkillMd(dirPath: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') && entry.name !== '.') continue;
          const result = await this.findSkillMd(fullPath);
          if (result) return result;
        } else if (entry.isFile() && entry.name.toUpperCase() === 'SKILL.MD') {
          return fullPath;
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });
    await fs.mkdir(dest, { recursive: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

let skillManagerInstance: SkillManager | null = null;

export function getSkillManager(config?: SkillManagerConfig): SkillManager {
  if (!skillManagerInstance) {
    skillManagerInstance = new SkillManager(config);
  }
  return skillManagerInstance;
}

export async function initializeSkills(): Promise<{ copied: number; skipped: number }> {
  const manager = getSkillManager();
  return await manager.initialize();
}
