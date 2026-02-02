import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { Checkpoint, ChatMessage, ToolCall } from './types.js';

const execAsync = promisify(exec);

export class CheckpointManager {
  private snapshotsDir: string;
  private checkpointsDir: string;
  private projectHash: string;
  private checkpoints: Map<string, Checkpoint> = new Map();
  private enabled: boolean;
  private maxCheckpoints: number;

  constructor(projectRoot: string, enabled: boolean = false, maxCheckpoints: number = 10) {
    this.projectHash = this.generateProjectHash(projectRoot);
    this.snapshotsDir = path.join(os.homedir(), '.xagent', 'snapshots', this.projectHash);
    this.checkpointsDir = path.join(os.homedir(), '.xagent', 'cache', this.projectHash, 'checkpoints');
    this.enabled = enabled;
    this.maxCheckpoints = maxCheckpoints;
  }

  private generateProjectHash(projectRoot: string): string {
    return crypto.createHash('md5').update(projectRoot).digest('hex').substring(0, 16);
  }

  async initialize(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await fs.mkdir(this.snapshotsDir, { recursive: true });
    await fs.mkdir(this.checkpointsDir, { recursive: true });

    await this.initializeShadowGit();
    await this.loadExistingCheckpoints();
  }

  private async initializeShadowGit(): Promise<void> {
    const gitDir = path.join(this.snapshotsDir, '.git');

    try {
      await fs.access(gitDir);
    } catch {
      console.log('Initializing shadow Git repository for checkpoints...');
      await execAsync('git init', { cwd: this.snapshotsDir });
      await execAsync('git config user.email "xagent@checkpoint.local"', { cwd: this.snapshotsDir });
      await execAsync('git config user.name "xAgent Checkpoint"', { cwd: this.snapshotsDir });
    }
  }

  private async loadExistingCheckpoints(): Promise<void> {
    try {
      const files = await fs.readdir(this.checkpointsDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.checkpointsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const checkpoint: Checkpoint = JSON.parse(content);
          this.checkpoints.set(checkpoint.id, checkpoint);
        }
      }
    } catch (error) {
      console.error('Failed to load existing checkpoints:', error);
    }
  }

  async createCheckpoint(description: string, conversation: ChatMessage[], tool_calls: ToolCall[]): Promise<Checkpoint> {
    if (!this.enabled) {
      throw new Error('Checkpointing is not enabled');
    }

    const checkpointId = `checkpoint_${Date.now()}`;
    const timestamp = Date.now();

    const checkpoint: Checkpoint = {
      id: checkpointId,
      timestamp,
      description,
      conversationSnapshot: conversation,
      tool_calls
    };

    await this.createGitSnapshot(checkpointId);
    await this.saveCheckpointMetadata(checkpoint);

    this.checkpoints.set(checkpointId, checkpoint);
    await this.cleanupOldCheckpoints();

    console.log(`✅ Checkpoint created: ${checkpointId}`);
    return checkpoint;
  }

  private async createGitSnapshot(checkpointId: string): Promise<void> {
    try {
      await execAsync('git add -A', { cwd: this.snapshotsDir });
      await execAsync(`git commit -m "Checkpoint: ${checkpointId}"`, { cwd: this.snapshotsDir });
      await execAsync(`git tag ${checkpointId}`, { cwd: this.snapshotsDir });
    } catch (error) {
      console.error('Failed to create Git snapshot:', error);
    }
  }

  private async saveCheckpointMetadata(checkpoint: Checkpoint): Promise<void> {
    const filePath = path.join(this.checkpointsDir, `${checkpoint.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }

  async restoreCheckpoint(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId);
    
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    console.log(`Restoring checkpoint: ${checkpointId}`);
    console.log(`Description: ${checkpoint.description}`);
    console.log(`Created: ${new Date(checkpoint.timestamp).toLocaleString()}`);

    await this.restoreGitSnapshot(checkpointId);

    console.log('✅ Checkpoint restored successfully');
  }

  private async restoreGitSnapshot(checkpointId: string): Promise<void> {
    try {
      await execAsync(`git checkout ${checkpointId}`, { cwd: this.snapshotsDir });
    } catch (error) {
      console.error('Failed to restore Git snapshot:', error);
      throw new Error(`Failed to restore checkpoint: ${error}`);
    }
  }

  listCheckpoints(): Checkpoint[] {
    return Array.from(this.checkpoints.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId);
    
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    try {
      const metadataPath = path.join(this.checkpointsDir, `${checkpointId}.json`);
      await fs.unlink(metadataPath);

      try {
        await execAsync(`git tag -d ${checkpointId}`, { cwd: this.snapshotsDir });
      } catch (error) {
        console.warn('Failed to delete Git tag:', error);
      }

      this.checkpoints.delete(checkpointId);
      console.log(`✅ Checkpoint deleted: ${checkpointId}`);
    } catch (error) {
      console.error('Failed to delete checkpoint:', error);
      throw error;
    }
  }

  private async cleanupOldCheckpoints(): Promise<void> {
    const checkpoints = this.listCheckpoints();
    
    if (checkpoints.length <= this.maxCheckpoints) {
      return;
    }

    const toDelete = checkpoints.slice(this.maxCheckpoints);
    
    for (const checkpoint of toDelete) {
      try {
        await this.deleteCheckpoint(checkpoint.id);
      } catch (error) {
        console.error(`Failed to delete old checkpoint ${checkpoint.id}:`, error);
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.snapshotsDir, { recursive: true, force: true });
      await fs.rm(this.checkpointsDir, { recursive: true, force: true });
      this.checkpoints.clear();
      console.log('✅ Checkpoint data cleaned up');
    } catch (error) {
      console.error('Failed to cleanup checkpoint data:', error);
    }
  }
}

let checkpointManagerInstance: CheckpointManager | null = null;

export function getCheckpointManager(projectRoot?: string, enabled?: boolean, maxCheckpoints?: number): CheckpointManager {
  if (!checkpointManagerInstance && projectRoot) {
    checkpointManagerInstance = new CheckpointManager(projectRoot, enabled, maxCheckpoints);
    checkpointManagerInstance.initialize();
  }
  return checkpointManagerInstance!;
}
