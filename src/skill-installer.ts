/**
 * Skill Installer - Handles remote skill installation
 * Supports: GitHub shorthand, GitHub URLs, direct SKILL.md URLs
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { getConfigManager } from './config.js';
import { getLogger } from './logger.js';

const logger = getLogger();

export interface RemoteSource {
  type: 'github' | 'direct-url' | 'local';
  url: string;
  ref?: string;        // Branch/tag
  subpath?: string;    // Path to skill within repo
  skillName?: string;  // For @owner/repo@syntax
}

export interface InstallResult {
  success: boolean;
  skillName?: string;
  skillPath?: string;
  error?: string;
}

/**
 * Parse a source string into structured format
 */
export function parseSource(input: string): RemoteSource {
  const trimmed = input.trim();

  // Check if local path
  if (isLocalPath(trimmed)) {
    return { type: 'local', url: trimmed };
  }

  // Direct SKILL.md URL (non-GitHub)
  if (isDirectSkillUrl(trimmed)) {
    return { type: 'direct-url', url: trimmed };
  }

  // GitHub URL with path: https://github.com/owner/repo/tree/branch/path/to/skill
  const githubTreeWithPathMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (githubTreeWithPathMatch) {
    const [, owner, repo, ref, subpath] = githubTreeWithPathMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref,
      subpath
    };
  }

  // GitHub URL with branch only: https://github.com/owner/repo/tree/branch
  const githubTreeMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/);
  if (githubTreeMatch) {
    const [, owner, repo, ref] = githubTreeMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref
    };
  }

  // GitHub URL: https://github.com/owner/repo
  const githubRepoMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    const cleanRepo = repo.replace(/\.git$/, '');
    return {
      type: 'github',
      url: `https://github.com/${owner}/${cleanRepo}.git`
    };
  }

  // GitHub shorthand: owner/repo, owner/repo@skill-name
  const atSkillMatch = trimmed.match(/^([^/]+)\/([^/@]+)@(.+)$/);
  if (atSkillMatch && !trimmed.includes(':') && !trimmed.startsWith('.') && !trimmed.startsWith('/')) {
    const [, owner, repo, skillName] = atSkillMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      skillName
    };
  }

  const shorthandMatch = trimmed.match(/^([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (shorthandMatch && !trimmed.includes(':') && !trimmed.startsWith('.') && !trimmed.startsWith('/')) {
    const [, owner, repo, subpath] = shorthandMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      subpath
    };
  }

  // Fallback: treat as direct URL
  return { type: 'direct-url', url: trimmed };
}

/**
 * Check if input is a local path
 */
function isLocalPath(input: string): boolean {
  return (
    path.isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input === '.' ||
    input === '..' ||
    /^[a-zA-Z]:[/\\]/.test(input)
  );
}

/**
 * Check if URL is a direct link to SKILL.md file
 */
function isDirectSkillUrl(input: string): boolean {
  if (!input.startsWith('http://') && !input.startsWith('https://')) {
    return false;
  }

  if (!input.toLowerCase().endsWith('/skill.md') && !input.toLowerCase().endsWith('/skill')) {
    return false;
  }

  // Exclude GitHub/GitLab URLs (they have their own handling)
  if (input.includes('github.com/') && !input.includes('raw.githubusercontent.com')) {
    return false;
  }
  if (input.includes('gitlab.com/') && !input.includes('/-/raw/')) {
    return false;
  }

  return true;
}

/**
 * Extract skill name from SKILL.md content
 */
function extractSkillName(content: string): string | null {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  return nameMatch ? nameMatch[1].trim() : null;
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Remove directory recursively
 */
async function removeDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Copy directory contents
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Fetch remote file content via HTTP
 */
async function fetchRemoteFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * Find SKILL.md in a directory
 */
async function findSkillMd(dirPath: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories
        if (entry.name.startsWith('.') && entry.name !== '.') continue;

        // Check subdirectory for SKILL.md
        const result = await findSkillMd(fullPath);
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
 * Get GitHub raw content URL
 */
function getRawUrl(owner: string, repo: string, ref: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
}

/**
 * Install skill from direct URL (single SKILL.md file)
 */
async function installFromDirectUrl(source: RemoteSource): Promise<InstallResult> {
  const configManager = getConfigManager();
  const userSkillsPath = configManager.getUserSkillsPath() || path.join(os.homedir(), '.xagent', 'skills');

  try {
    const content = await fetchRemoteFile(source.url);
    const skillName = extractSkillName(content);

    if (!skillName) {
      return { success: false, error: 'Could not extract skill name from SKILL.md' };
    }

    const skillPath = path.join(userSkillsPath, skillName);
    
    // Check if skill already exists
    try {
      await fs.access(skillPath);
      return { success: false, error: `Skill "${skillName}" already installed` };
    } catch {
      // Doesn't exist, proceed
    }

    // Create skill directory
    await ensureDir(skillPath);

    // Write SKILL.md
    await fs.writeFile(path.join(skillPath, 'SKILL.md'), content, 'utf-8');

    return { success: true, skillName, skillPath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Install skill from GitHub repository
 */
async function installFromGitHub(source: RemoteSource): Promise<InstallResult> {
  const configManager = getConfigManager();
  const userSkillsPath = configManager.getUserSkillsPath() || path.join(os.homedir(), '.xagent', 'skills');

  // Parse owner/repo from URL
  const urlMatch = source.url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!urlMatch) {
    return { success: false, error: 'Invalid GitHub URL' };
  }

  const [, owner, repo] = urlMatch;
  const cleanRepo = repo.replace(/\.git$/, '');
  const ref = source.ref || 'main';

  try {
    let skillContent: string | null = null;
    let skillName: string | null = null;
    let tempDir: string | null = null;

    if (source.subpath) {
      // Specific path to skill provided
      const skillMdUrl = getRawUrl(owner, cleanRepo, ref, `${source.subpath}/SKILL.md`);
      try {
        skillContent = await fetchRemoteFile(skillMdUrl);
      } catch {
        // Try with skill instead of SKILL.md
        const altUrl = getRawUrl(owner, cleanRepo, ref, `${source.subpath}/skill`);
        try {
          skillContent = await fetchRemoteFile(altUrl);
        } catch {
          return { success: false, error: `SKILL.md not found at ${source.subpath}` };
        }
      }
    } else if (source.skillName) {
      // @owner/repo@syntax - fetch specific skill
      const skillMdUrl = getRawUrl(owner, cleanRepo, ref, `skills/${source.skillName}/SKILL.md`);
      try {
        skillContent = await fetchRemoteFile(skillMdUrl);
      } catch {
        return { success: false, error: `Skill "${source.skillName}" not found` };
      }
    } else {
      // No specific path - need to find SKILL.md in repo
      // Try to fetch repository tree and find skills
      const treeUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/contents/skills?ref=${ref}`;
      
      try {
        const response = await fetch(treeUrl);
        if (response.ok) {
          const data = await response.json() as Array<{ name: string; type: string; path: string }>;
          const skills = data.filter(item => item.type === 'dir');
          
          if (skills.length > 0) {
            // Install all skills from the repo
            const firstSkill = skills[0];
            const skillMdUrl = getRawUrl(owner, cleanRepo, ref, `${firstSkill.path}/SKILL.md`);
            skillContent = await fetchRemoteFile(skillMdUrl);
          } else {
            return { success: false, error: 'No skills found in repository' };
          }
        } else if (response.status === 404) {
          return { success: false, error: 'Repository or branch not found' };
        } else {
          throw new Error(`GitHub API error: ${response.status}`);
        }
      } catch (e) {
        // Fallback: try common skill locations
        const possiblePaths = [
          `skills/${cleanRepo}/SKILL.md`,
          `skill/SKILL.md`,
          `SKILL.md`
        ];

        for (const p of possiblePaths) {
          try {
            const url = getRawUrl(owner, cleanRepo, ref, p);
            skillContent = await fetchRemoteFile(url);
            break;
          } catch {
            continue;
          }
        }

        if (!skillContent) {
          return { success: false, error: 'No SKILL.md found in repository' };
        }
      }
    }

    if (!skillContent) {
      return { success: false, error: 'Could not fetch skill content' };
    }

    skillName = extractSkillName(skillContent);
    if (!skillName) {
      return { success: false, error: 'Could not extract skill name from SKILL.md' };
    }

    const skillPath = path.join(userSkillsPath, skillName);

    // Check if skill already exists
    try {
      await fs.access(skillPath);
      return { success: false, error: `Skill "${skillName}" already installed` };
    } catch {
      // Doesn't exist, proceed
    }

    // Create skill directory
    await ensureDir(skillPath);

    // Write SKILL.md
    await fs.writeFile(path.join(skillPath, 'SKILL.md'), skillContent, 'utf-8');

    // Try to fetch additional files from the skill directory
    if (source.subpath || source.skillName) {
      const skillDirPath = source.subpath || `skills/${source.skillName}`;
      
      try {
        const contentsUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${skillDirPath}?ref=${ref}`;
        const response = await fetch(contentsUrl);
        
        if (response.ok) {
          const files = await response.json() as Array<{ name: string; type: string; download_url: string }>;
          
          for (const file of files) {
            if (file.type === 'file' && file.name !== 'SKILL.md' && file.name !== 'package.json') {
              try {
                const fileContent = await fetchRemoteFile(file.download_url);
                await fs.writeFile(path.join(skillPath, file.name), fileContent, 'utf-8');
              } catch {
                // Skip files that can't be fetched
              }
            }
          }
        }
      } catch {
        // Ignore errors fetching additional files
      }
    }

    return { success: true, skillName, skillPath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Install skill from local path
 */
async function installFromLocal(source: RemoteSource): Promise<InstallResult> {
  const configManager = getConfigManager();
  const userSkillsPath = configManager.getUserSkillsPath() || path.join(os.homedir(), '.xagent', 'skills');

  try {
    const resolvedPath = path.resolve(source.url);
    
    // Check if source exists
    await fs.access(resolvedPath);

    // Find SKILL.md
    const skillMdPath = await findSkillMd(resolvedPath);
    if (!skillMdPath) {
      return { success: false, error: 'SKILL.md not found in source directory' };
    }

    const content = await fs.readFile(skillMdPath, 'utf-8');
    const skillName = extractSkillName(content);

    if (!skillName) {
      return { success: false, error: 'Could not extract skill name from SKILL.md' };
    }

    const skillPath = path.join(userSkillsPath, skillName);

    // Check if skill already exists
    try {
      await fs.access(skillPath);
      return { success: false, error: `Skill "${skillName}" already installed` };
    } catch {
      // Doesn't exist, proceed
    }

    // Copy the skill directory
    const sourceDir = path.dirname(skillMdPath);
    await copyDir(sourceDir, skillPath);

    return { success: true, skillName, skillPath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Main function to install a skill from source
 */
export async function installSkill(source: string): Promise<InstallResult> {
  const parsed = parseSource(source);

  switch (parsed.type) {
    case 'direct-url':
      return installFromDirectUrl(parsed);
    case 'github':
      return installFromGitHub(parsed);
    case 'local':
      return installFromLocal(parsed);
    default:
      return { success: false, error: 'Unknown source type' };
  }
}

/**
 * Remove an installed skill
 */
export async function removeSkill(skillName: string): Promise<InstallResult> {
  const configManager = getConfigManager();
  const userSkillsPath = configManager.getUserSkillsPath() || path.join(os.homedir(), '.xagent', 'skills');
  const skillPath = path.join(userSkillsPath, skillName);

  try {
    await fs.access(skillPath);
    await removeDir(skillPath);
    return { success: true, skillName, skillPath };
  } catch {
    return { success: false, error: `Skill "${skillName}" not found` };
  }
}

/**
 * List installed user skills
 */
export async function listUserSkills(): Promise<Array<{ name: string; description: string; path: string }>> {
  const configManager = getConfigManager();
  const userSkillsPath = configManager.getUserSkillsPath() || path.join(os.homedir(), '.xagent', 'skills');

  const skills: Array<{ name: string; description: string; path: string }> = [];

  try {
    const entries = await fs.readdir(userSkillsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(userSkillsPath, entry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');

        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          const descMatch = content.match(/^description:\s*(.+)$/m);

          skills.push({
            name: nameMatch ? nameMatch[1].trim() : entry.name,
            description: descMatch ? descMatch[1].trim() : 'No description',
            path: skillPath
          });
        } catch {
          skills.push({
            name: entry.name,
            description: '(Missing SKILL.md)',
            path: skillPath
          });
        }
      }
    }
  } catch {
    // Directory doesn't exist or is empty
  }

  return skills;
}
