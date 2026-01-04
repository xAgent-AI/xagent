import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { glob } from 'glob';

export interface MemoryFile {
  path: string;
  content: string;
  level: 'global' | 'project' | 'subdirectory';
}

export class MemoryManager {
  private globalMemoryPath: string;
  private projectMemoryPath: string;
  private memoryFiles: MemoryFile[] = [];
  private contextFileNames: string | string[];

  constructor(projectRoot?: string, contextFileName: string | string[] = 'XAGENT.md') {
    this.globalMemoryPath = path.join(os.homedir(), '.xagent', 'XAGENT.md');
    this.projectMemoryPath = projectRoot 
      ? path.join(projectRoot, 'XAGENT.md')
      : '';
    this.contextFileNames = contextFileName;
  }

  async loadMemory(): Promise<string> {
    this.memoryFiles = [];
    let combinedMemory = '';

    const globalMemory = await this.loadMemoryFile(this.globalMemoryPath, 'global');
    if (globalMemory) {
      this.memoryFiles.push(globalMemory);
      combinedMemory += globalMemory.content + '\n\n';
    }

    if (this.projectMemoryPath) {
      const projectMemory = await this.loadMemoryFile(this.projectMemoryPath, 'project');
      if (projectMemory) {
        this.memoryFiles.push(projectMemory);
        combinedMemory += projectMemory.content + '\n\n';
      }

      const subdirectoryMemories = await this.loadSubdirectoryMemories();
      for (const memory of subdirectoryMemories) {
        this.memoryFiles.push(memory);
        combinedMemory += memory.content + '\n\n';
      }
    }

    return this.processImports(combinedMemory);
  }

  private async loadMemoryFile(filePath: string, level: 'global' | 'project' | 'subdirectory'): Promise<MemoryFile | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { path: filePath, content, level };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to load memory file ${filePath}:`, error);
      }
      return null;
    }
  }

  private async loadSubdirectoryMemories(): Promise<MemoryFile[]> {
    const memories: MemoryFile[] = [];
    
    if (!this.projectMemoryPath) {
      return memories;
    }

    const projectRoot = path.dirname(this.projectMemoryPath);
    
    try {
      const files = await glob('**/XAGENT.md', {
        cwd: projectRoot,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**']
      });

      for (const file of files) {
        if (file !== 'XAGENT.md') {
          const filePath = path.join(projectRoot, file);
          const memory = await this.loadMemoryFile(filePath, 'subdirectory');
          if (memory) {
            memories.push(memory);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load subdirectory memories:', error);
    }

    return memories;
  }

  private processImports(content: string): string {
    const importRegex = /@([^\s\n]+)/g;
    let processedContent = content;
    const visitedFiles = new Set<string>();

    const processImport = (match: string, importPath: string): string => {
      const absolutePath = path.isAbsolute(importPath)
        ? importPath
        : path.resolve(process.cwd(), importPath);

      if (visitedFiles.has(absolutePath)) {
        return '';
      }

      visitedFiles.add(absolutePath);

      try {
        const importedContent = fsSync.readFileSync(absolutePath, 'utf-8');
        return `\n\n${importedContent}\n\n`;
      } catch (error) {
        console.warn(`Failed to import ${importPath}:`, error);
        return '';
      }
    };

    let maxIterations = 10;
    let iterations = 0;

    while (importRegex.test(processedContent) && iterations < maxIterations) {
      processedContent = processedContent.replace(importRegex, processImport);
      iterations++;
    }

    return processedContent;
  }

  async saveMemory(content: string, scope: 'global' | 'project' = 'global'): Promise<void> {
    const filePath = scope === 'global' ? this.globalMemoryPath : this.projectMemoryPath;
    
    if (!filePath) {
      throw new Error('Project memory path not set');
    }

    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(filePath, content, 'utf-8');
    
    if (scope === 'global') {
      const existingMemory = this.memoryFiles.find(m => m.level === 'global');
      if (existingMemory) {
        existingMemory.content = content;
      } else {
        this.memoryFiles.push({ path: filePath, content, level: 'global' });
      }
    }
  }

  async addMemoryEntry(entry: string, scope: 'global' | 'project' = 'global'): Promise<void> {
    const filePath = scope === 'global' ? this.globalMemoryPath : this.projectMemoryPath;
    
    if (!filePath) {
      throw new Error('Project memory path not set');
    }

    let existingContent = '';
    try {
      existingContent = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const newContent = existingContent + `\n\n## Memory Entry (${new Date().toISOString()})\n\n${entry}\n`;
    await this.saveMemory(newContent, scope);
  }

  getMemoryFiles(): MemoryFile[] {
    return [...this.memoryFiles];
  }

  async initializeProject(projectRoot: string): Promise<void> {
    this.projectMemoryPath = path.join(projectRoot, 'XAGENT.md');
    
    const existingMemory = await this.loadMemoryFile(this.projectMemoryPath, 'project');
    if (existingMemory) {
      console.log('XAGENT.md already exists. Skipping initialization.');
      return;
    }

    console.log('Creating XAGENT.md...');
    await this.saveMemory('# Project Context\n\nProject-specific context will be added here.', 'project');
    
    console.log('Analyzing project structure...');
    const analysis = await this.analyzeProject(projectRoot);
    
    console.log('Generating project-specific context...');
    await this.saveMemory(analysis, 'project');
    
    console.log('✅ XAGENT.md has been successfully populated with project-specific information.');
  }

  private async analyzeProject(projectRoot: string): Promise<string> {
    let analysis = '# Project Context\n\n';

    try {
      const packageJsonPath = path.join(projectRoot, 'package.json');
      const packageJson = await this.loadJsonFile(packageJsonPath);
      
      if (packageJson) {
        analysis += '## Project Overview\n\n';
        analysis += `Name: ${packageJson.name || 'Unknown'}\n`;
        analysis += `Version: ${packageJson.version || 'Unknown'}\n`;
        analysis += `Description: ${packageJson.description || 'No description'}\n\n`;

        if (packageJson.dependencies) {
          analysis += '## Dependencies\n\n';
          analysis += '```json\n' + JSON.stringify(packageJson.dependencies, null, 2) + '\n```\n\n';
        }

        if (packageJson.scripts) {
          analysis += '## Scripts\n\n';
          Object.entries(packageJson.scripts).forEach(([name, script]) => {
            analysis += `- ${name}: ${script}\n`;
          });
          analysis += '\n';
        }
      }

      const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
      const tsconfig = await this.loadJsonFile(tsconfigPath);
      
      if (tsconfig) {
        analysis += '## TypeScript Configuration\n\n';
        analysis += '```json\n' + JSON.stringify(tsconfig, null, 2) + '\n```\n\n';
      }

      analysis += '## Project Structure\n\n';
      analysis += '```\n';
      const structure = await this.getProjectStructure(projectRoot);
      analysis += structure;
      analysis += '```\n\n';

      analysis += '## Development Guidelines\n\n';
      analysis += '- Follow existing code style and conventions\n';
      analysis += '- Write clear, descriptive commit messages\n';
      analysis += '- Add tests for new features\n';
      analysis += '- Update documentation as needed\n';
    } catch (error) {
      console.error('Failed to analyze project:', error);
      analysis += '## Project Analysis Failed\n\n';
      analysis += 'Unable to analyze project structure automatically.\n';
    }

    return analysis;
  }

  private async loadJsonFile(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  private async getProjectStructure(rootPath: string, maxDepth: number = 3, currentDepth: number = 0): Promise<string> {
    if (currentDepth >= maxDepth) {
      return '';
    }

    let structure = '';
    
    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }

        if (entry.isDirectory()) {
          structure += '  '.repeat(currentDepth) + entry.name + '/\n';
          const subPath = path.join(rootPath, entry.name);
          structure += await this.getProjectStructure(subPath, maxDepth, currentDepth + 1);
        } else {
          structure += '  '.repeat(currentDepth) + entry.name + '\n';
        }
      }
    } catch (error) {
      console.error(`Failed to read directory ${rootPath}:`, error);
    }

    return structure;
  }
}

let memoryManagerInstance: MemoryManager | null = null;

export function getMemoryManager(projectRoot?: string, contextFileName?: string | string[]): MemoryManager {
  if (!memoryManagerInstance || projectRoot) {
    memoryManagerInstance = new MemoryManager(projectRoot, contextFileName);
  }
  return memoryManagerInstance;
}
