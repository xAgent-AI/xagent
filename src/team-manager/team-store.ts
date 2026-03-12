import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  Team,
  TeamMember,
  TeamTask,
  TaskCreateConfig,
  MemberRole,
  LEAD_PERMISSIONS,
  TEAMMATE_PERMISSIONS,
  MemberPermissions,
} from './types.js';

const generateId = () => crypto.randomUUID();

// Lock timeout in milliseconds
const LOCK_TIMEOUT_MS = 10000;
// Maximum retries for acquiring lock
const MAX_LOCK_RETRIES = 50;
// Delay between lock retries in milliseconds
const LOCK_RETRY_DELAY_MS = 100;

interface LockInfo {
  memberId: string;
  timestamp: number;
  pid: number;
}

export class TeamStore {
  private baseDir: string;
  private activeLocks: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.baseDir = path.join(os.homedir(), '.xagent', 'teams');
  }

  /**
   * Acquire a file-based lock for a task.
   * Uses exclusive file creation for atomicity across processes.
   */
  private async acquireTaskLock(teamId: string, taskId: string, memberId: string): Promise<boolean> {
    const lockDir = path.join(this.getTeamDir(teamId), 'locks');
    await fs.mkdir(lockDir, { recursive: true });
    const lockPath = path.join(lockDir, `${taskId}.lock`);

    const lockInfo: LockInfo = {
      memberId,
      timestamp: Date.now(),
      pid: process.pid,
    };

    for (let attempt = 0; attempt < MAX_LOCK_RETRIES; attempt++) {
      try {
        // Try to create lock file exclusively (atomic operation)
        const handle = await fs.open(lockPath, 'wx');
        await handle.writeFile(JSON.stringify(lockInfo));
        await handle.close();

        // Set up auto-release timeout
        const timeoutId = setTimeout(() => {
          this.releaseTaskLock(teamId, taskId).catch(() => {});
        }, LOCK_TIMEOUT_MS);
        this.activeLocks.set(`${teamId}:${taskId}`, timeoutId);

        return true;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          // Lock file exists, check if it's stale
          try {
            const content = await fs.readFile(lockPath, 'utf-8');
            const existingLock: LockInfo = JSON.parse(content);

            // Check if lock is stale (older than timeout)
            if (Date.now() - existingLock.timestamp > LOCK_TIMEOUT_MS) {
              // Remove stale lock and retry
              await fs.rm(lockPath, { force: true });
              continue;
            }

            // Lock is held by another process, wait and retry
            await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
            continue;
          } catch {
            // Failed to read lock file, try to remove it
            await fs.rm(lockPath, { force: true });
            continue;
          }
        }
        throw error;
      }
    }

    return false;
  }

  /**
   * Release a task lock.
   */
  private async releaseTaskLock(teamId: string, taskId: string): Promise<void> {
    const lockPath = path.join(this.getTeamDir(teamId), 'locks', `${taskId}.lock`);

    // Clear auto-release timeout
    const lockKey = `${teamId}:${taskId}`;
    const timeoutId = this.activeLocks.get(lockKey);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.activeLocks.delete(lockKey);
    }

    try {
      // Verify we own the lock before releasing
      const content = await fs.readFile(lockPath, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(content);

      // Only release if we own the lock (same pid or stale)
      if (lockInfo.pid === process.pid || Date.now() - lockInfo.timestamp > LOCK_TIMEOUT_MS) {
        await fs.rm(lockPath, { force: true });
      }
    } catch {
      // Lock file doesn't exist or is corrupted, ignore
    }
  }

  /**
   * Check if a task is locked by another member.
   */
  async isTaskLocked(teamId: string, taskId: string): Promise<boolean> {
    const lockPath = path.join(this.getTeamDir(teamId), 'locks', `${taskId}.lock`);

    try {
      const content = await fs.readFile(lockPath, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(content);

      // Check if lock is stale
      if (Date.now() - lockInfo.timestamp > LOCK_TIMEOUT_MS) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  private getTeamDir(teamId: string): string {
    return path.join(this.baseDir, teamId);
  }

  async ensureBaseDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async createTeam(name: string, leadSessionId: string, workDir: string): Promise<Team> {
    await this.ensureBaseDir();

    const teamId = generateId();
    const leadMemberId = generateId();

    const leadMember: TeamMember = {
      memberId: leadMemberId,
      name: 'Lead',
      role: 'lead',
      memberRole: 'Team Lead',
      status: 'active',
      permissions: LEAD_PERMISSIONS,
    };

    const team: Team = {
      teamId,
      teamName: name,
      createdAt: Date.now(),
      leadSessionId,
      leadMemberId,
      members: [leadMember],
      status: 'active',
      workDir,
      sharedTaskList: [],
    };

    const teamDir = this.getTeamDir(teamId);
    await fs.mkdir(teamDir, { recursive: true });
    await fs.mkdir(path.join(teamDir, 'tasks'), { recursive: true });

    await this.saveTeam(team);
    return team;
  }

  async getTeam(teamId: string): Promise<Team | null> {
    try {
      const configPath = path.join(this.getTeamDir(teamId), 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async saveTeam(team: Team): Promise<void> {
    await this.ensureBaseDir();
    const configPath = path.join(this.getTeamDir(team.teamId), 'config.json');
    await fs.writeFile(configPath, JSON.stringify(team, null, 2));
  }

  async addMember(
    teamId: string,
    member: Omit<TeamMember, 'permissions' | 'role'>
  ): Promise<TeamMember> {
    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const newMember: TeamMember = {
      ...member,
      role: 'teammate',
      permissions: TEAMMATE_PERMISSIONS,
    };

    const existingIndex = team.members.findIndex((m) => m.memberId === member.memberId);
    if (existingIndex >= 0) {
      team.members[existingIndex] = newMember;
    } else {
      team.members.push(newMember);
    }

    await this.saveTeam(team);
    return newMember;
  }

  async updateMember(
    teamId: string,
    memberId: string,
    updates: Partial<TeamMember>
  ): Promise<void> {
    const team = await this.getTeam(teamId);
    if (team) {
      const member = team.members.find((m) => m.memberId === memberId);
      if (member) {
        Object.assign(member, updates);
        await this.saveTeam(team);
      }
    }
  }

  async getMember(teamId: string, memberId: string): Promise<TeamMember | null> {
    const team = await this.getTeam(teamId);
    if (team) {
      return team.members.find((m) => m.memberId === memberId) || null;
    }
    return null;
  }

  async deleteTeam(teamId: string): Promise<void> {
    const teamDir = this.getTeamDir(teamId);
    await fs.rm(teamDir, { recursive: true, force: true });
  }

  async listTeams(): Promise<Team[]> {
    await this.ensureBaseDir();
    const teams: Team[] = [];

    try {
      const dirs = await fs.readdir(this.baseDir);
      for (const dir of dirs) {
        const team = await this.getTeam(dir);
        if (team) {
          teams.push(team);
        }
      }
    } catch {
      // ignore
    }

    return teams.sort((a, b) => b.createdAt - a.createdAt);
  }

  async createTask(
    teamId: string,
    config: TaskCreateConfig,
    createdBy: string
  ): Promise<TeamTask> {
    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    // Validate that all dependencies exist
    if (config.dependencies && config.dependencies.length > 0) {
      const existingTasks = await this.getTasks(teamId);
      const existingTaskIds = new Set(existingTasks.map(t => t.taskId));
      const invalidDeps = config.dependencies.filter(depId => !existingTaskIds.has(depId));

      if (invalidDeps.length > 0) {
        throw new Error(`Invalid task dependencies: tasks not found: ${invalidDeps.join(', ')}`);
      }

      // Check for circular dependencies
      const depCheck = this.checkCircularDependency(config.dependencies, [], existingTasks);
      if (depCheck.hasCycle) {
        throw new Error(`Circular dependency detected: ${depCheck.cyclePath?.join(' -> ')}`);
      }
    }

    const task: TeamTask = {
      taskId: generateId(),
      teamId,
      title: config.title,
      description: config.description,
      status: 'pending',
      assignee: config.assignee,
      dependencies: config.dependencies || [],
      priority: config.priority || 'medium',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy,
      version: 1,
    };

    const tasksDir = path.join(this.getTeamDir(teamId), 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });

    const taskPath = path.join(tasksDir, `${task.taskId}.json`);
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2));

    team.sharedTaskList.push(task);
    await this.saveTeam(team);

    return task;
  }

  /**
   * Check for circular dependencies in task graph.
   */
  private checkCircularDependency(
    taskIds: string[],
    visited: string[],
    allTasks: TeamTask[]
  ): { hasCycle: boolean; cyclePath?: string[] } {
    const taskMap = new Map(allTasks.map(t => [t.taskId, t]));

    for (const taskId of taskIds) {
      if (visited.includes(taskId)) {
        return { hasCycle: true, cyclePath: [...visited, taskId] };
      }

      const task = taskMap.get(taskId);
      if (task && task.dependencies.length > 0) {
        const result = this.checkCircularDependency(
          task.dependencies,
          [...visited, taskId],
          allTasks
        );
        if (result.hasCycle) {
          return result;
        }
      }
    }

    return { hasCycle: false };
  }

  async getTask(teamId: string, taskId: string): Promise<TeamTask | null> {
    try {
      const taskPath = path.join(this.getTeamDir(teamId), 'tasks', `${taskId}.json`);
      const content = await fs.readFile(taskPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async updateTask(
    teamId: string,
    taskId: string,
    updates: Partial<TeamTask>,
    expectedVersion?: number
  ): Promise<TeamTask | null> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return null;
    }

    const taskIndex = team.sharedTaskList.findIndex((t) => t.taskId === taskId);
    if (taskIndex < 0) {
      const task = await this.getTask(teamId, taskId);
      if (!task) return null;

      if (expectedVersion !== undefined && task.version !== expectedVersion) {
        return null;
      }

      Object.assign(task, updates, { updatedAt: Date.now(), version: task.version + 1 });
      const taskPath = path.join(this.getTeamDir(teamId), 'tasks', `${taskId}.json`);
      await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
      return task;
    }

    if (expectedVersion !== undefined && team.sharedTaskList[taskIndex].version !== expectedVersion) {
      return null;
    }

    Object.assign(team.sharedTaskList[taskIndex], updates, { updatedAt: Date.now(), version: (team.sharedTaskList[taskIndex].version || 0) + 1 });
    const taskPath = path.join(this.getTeamDir(teamId), 'tasks', `${taskId}.json`);
    await fs.writeFile(taskPath, JSON.stringify(team.sharedTaskList[taskIndex], null, 2));
    await this.saveTeam(team);

    return team.sharedTaskList[taskIndex];
  }

  async deleteTask(teamId: string, taskId: string, expectedVersion?: number): Promise<boolean> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return false;
    }

    const taskIndex = team.sharedTaskList.findIndex((t) => t.taskId === taskId);
    if (taskIndex < 0) {
      return false;
    }

    if (expectedVersion !== undefined && team.sharedTaskList[taskIndex].version !== expectedVersion) {
      return false;
    }

    team.sharedTaskList.splice(taskIndex, 1);

    const taskPath = path.join(this.getTeamDir(teamId), 'tasks', `${taskId}.json`);
    await fs.rm(taskPath, { force: true });

    await this.saveTeam(team);
    return true;
  }

  async getTasks(teamId: string): Promise<TeamTask[]> {
    const team = await this.getTeam(teamId);
    if (team) {
      return team.sharedTaskList.sort((a, b) => a.createdAt - b.createdAt);
    }

    const tasksDir = path.join(this.getTeamDir(teamId), 'tasks');
    const tasks: TeamTask[] = [];

    try {
      const files = await fs.readdir(tasksDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(tasksDir, file), 'utf-8');
          tasks.push(JSON.parse(content));
        }
      }
    } catch {
      // directory doesn't exist
    }

    return tasks.sort((a, b) => a.createdAt - b.createdAt);
  }

  async getAvailableTasks(teamId: string): Promise<TeamTask[]> {
    const tasks = await this.getTasks(teamId);
    const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

    return tasks.filter((task) => {
      if (task.status !== 'pending') return false;
      return task.dependencies.every((depId) => {
        const dep = taskMap.get(depId);
        return dep && dep.status === 'completed';
      });
    });
  }

  async claimTask(
    teamId: string,
    taskId: string,
    memberId: string
  ): Promise<TeamTask | null> {
    // Acquire lock first to prevent race conditions
    const lockAcquired = await this.acquireTaskLock(teamId, taskId, memberId);
    if (!lockAcquired) {
      throw new Error(`Task ${taskId} is currently being claimed by another member. Please try again.`);
    }

    try {
      // Re-read task after acquiring lock to ensure we have latest state
      const task = await this.getTask(teamId, taskId);
      if (!task) return null;

      if (task.status !== 'pending') {
        throw new Error(`Task ${taskId} is not available (status: ${task.status})`);
      }

      // Re-check dependencies after acquiring lock
      const tasks = await this.getTasks(teamId);
      const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

      const uncompletedDeps = task.dependencies.filter((depId) => {
        const dep = taskMap.get(depId);
        return dep && dep.status !== 'completed';
      });

      if (uncompletedDeps.length > 0) {
        throw new Error(`Task has uncompleted dependencies: ${uncompletedDeps.join(', ')}`);
      }

      // Update task with version check
      const result = await this.updateTask(teamId, taskId, {
        status: 'in_progress',
        assignee: memberId,
      }, task.version);

      if (!result) {
        throw new Error(`Task ${taskId} was already claimed by another member`);
      }

      return result;
    } finally {
      // Always release the lock
      await this.releaseTaskLock(teamId, taskId);
    }
  }

  async getTeamStatus(teamId: string): Promise<{
    team: Team | null;
    memberCount: number;
    activeTaskCount: number;
    completedTaskCount: number;
  }> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return { team: null, memberCount: 0, activeTaskCount: 0, completedTaskCount: 0 };
    }

    const tasks = await this.getTasks(teamId);
    const activeTaskCount = tasks.filter((t) => t.status === 'in_progress').length;
    const completedTaskCount = tasks.filter((t) => t.status === 'completed').length;

    return {
      team,
      memberCount: team.members.length,
      activeTaskCount,
      completedTaskCount,
    };
  }

  getPermissionsForRole(role: MemberRole): MemberPermissions {
    return role === 'lead' ? LEAD_PERMISSIONS : TEAMMATE_PERMISSIONS;
  }
}

let teamStoreInstance: TeamStore | null = null;

export function getTeamStore(): TeamStore {
  if (!teamStoreInstance) {
    teamStoreInstance = new TeamStore();
  }
  return teamStoreInstance;
}
