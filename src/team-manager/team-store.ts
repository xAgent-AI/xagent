import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { Team, TeamMember, TeamTask, TeamMessage, TaskCreateConfig } from './types.js';

const generateId = () => crypto.randomUUID();

export class TeamStore {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(os.homedir(), '.xagent', 'teams');
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
    const team: Team = {
      teamId,
      teamName: name,
      createdAt: Date.now(),
      leadSessionId,
      members: [],
      status: 'active',
      workDir
    };

    const teamDir = this.getTeamDir(teamId);
    await fs.mkdir(teamDir, { recursive: true });
    await fs.mkdir(path.join(teamDir, 'inbox'), { recursive: true });
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

  async addMember(teamId: string, member: TeamMember): Promise<void> {
    const team = await this.getTeam(teamId);
    if (team) {
      const existingIndex = team.members.findIndex(m => m.memberId === member.memberId);
      if (existingIndex >= 0) {
        team.members[existingIndex] = member;
      } else {
        team.members.push(member);
      }
      await this.saveTeam(team);
    }
  }

  async updateMember(teamId: string, memberId: string, updates: Partial<TeamMember>): Promise<void> {
    const team = await this.getTeam(teamId);
    if (team) {
      const member = team.members.find(m => m.memberId === memberId);
      if (member) {
        Object.assign(member, updates);
        await this.saveTeam(team);
      }
    }
  }

  async getMember(teamId: string, memberId: string): Promise<TeamMember | null> {
    const team = await this.getTeam(teamId);
    if (team) {
      return team.members.find(m => m.memberId === memberId) || null;
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

  async createTask(teamId: string, config: TaskCreateConfig): Promise<TeamTask> {
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
      updatedAt: Date.now()
    };

    const tasksDir = path.join(this.getTeamDir(teamId), 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });
    
    const taskPath = path.join(tasksDir, `${task.taskId}.json`);
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
    return task;
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

  async updateTask(teamId: string, taskId: string, updates: Partial<TeamTask>): Promise<TeamTask | null> {
    const task = await this.getTask(teamId, taskId);
    if (task) {
      Object.assign(task, updates, { updatedAt: Date.now() });
      const taskPath = path.join(this.getTeamDir(teamId), 'tasks', `${taskId}.json`);
      await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
      return task;
    }
    return null;
  }

  async getTasks(teamId: string): Promise<TeamTask[]> {
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
    const taskMap = new Map(tasks.map(t => [t.taskId, t]));
    
    return tasks.filter(task => {
      if (task.status !== 'pending') return false;
      return task.dependencies.every(depId => {
        const dep = taskMap.get(depId);
        return dep && dep.status === 'completed';
      });
    });
  }

  async claimTask(teamId: string, taskId: string, memberId: string): Promise<TeamTask | null> {
    const task = await this.getTask(teamId, taskId);
    if (!task) return null;

    if (task.status !== 'pending') {
      throw new Error(`Task ${taskId} is not available (status: ${task.status})`);
    }

    const tasks = await this.getTasks(teamId);
    const taskMap = new Map(tasks.map(t => [t.taskId, t]));
    
    const uncompletedDeps = task.dependencies.filter(depId => {
      const dep = taskMap.get(depId);
      return dep && dep.status !== 'completed';
    });

    if (uncompletedDeps.length > 0) {
      throw new Error(`Task has uncompleted dependencies: ${uncompletedDeps.join(', ')}`);
    }

    return this.updateTask(teamId, taskId, {
      status: 'in_progress',
      assignee: memberId
    });
  }

  async sendMessage(
    teamId: string,
    fromMemberId: string,
    toMemberId: string | 'broadcast',
    content: string,
    type: TeamMessage['type'] = 'direct'
  ): Promise<TeamMessage> {
    const message: TeamMessage = {
      messageId: generateId(),
      teamId,
      fromMemberId,
      toMemberId,
      content,
      timestamp: Date.now(),
      type,
      read: false
    };

    if (toMemberId === 'broadcast') {
      const team = await this.getTeam(teamId);
      if (team) {
        for (const member of team.members) {
          if (member.memberId !== fromMemberId) {
            await this.deliverMessage(member.memberId, message);
          }
        }
      }
    } else {
      await this.deliverMessage(toMemberId, message);
    }

    return message;
  }

  private async deliverMessage(memberId: string, message: TeamMessage): Promise<void> {
    const inboxPath = path.join(this.getTeamDir(message.teamId), 'inbox', memberId);
    await fs.mkdir(inboxPath, { recursive: true });
    const messagePath = path.join(inboxPath, `${message.messageId}.json`);
    await fs.writeFile(messagePath, JSON.stringify(message, null, 2));
  }

  async getMessages(teamId: string, memberId: string): Promise<TeamMessage[]> {
    const inboxPath = path.join(this.getTeamDir(teamId), 'inbox', memberId);
    const messages: TeamMessage[] = [];
    
    try {
      const files = await fs.readdir(inboxPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(inboxPath, file), 'utf-8');
          messages.push(JSON.parse(content));
        }
      }
    } catch {
      // directory doesn't exist
    }
    
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }

  async clearMessages(teamId: string, memberId: string): Promise<void> {
    const inboxPath = path.join(this.getTeamDir(teamId), 'inbox', memberId);
    await fs.rm(inboxPath, { recursive: true, force: true });
  }

  async markMessagesRead(teamId: string, memberId: string): Promise<void> {
    const inboxPath = path.join(this.getTeamDir(teamId), 'inbox', memberId);
    
    try {
      const files = await fs.readdir(inboxPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(inboxPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const message: TeamMessage = JSON.parse(content);
          message.read = true;
          await fs.writeFile(filePath, JSON.stringify(message, null, 2));
        }
      }
    } catch {
      // ignore
    }
  }
}

let teamStoreInstance: TeamStore | null = null;

export function getTeamStore(): TeamStore {
  if (!teamStoreInstance) {
    teamStoreInstance = new TeamStore();
  }
  return teamStoreInstance;
}
