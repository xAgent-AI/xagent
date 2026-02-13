import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  Team,
  TeamMember,
  TeamTask,
  TeamMessage,
  TaskCreateConfig,
  MemberRole,
  LEAD_PERMISSIONS,
  TEAMMATE_PERMISSIONS,
  MemberPermissions,
} from './types.js';

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
    await fs.mkdir(path.join(teamDir, 'inbox'), { recursive: true });
    await fs.mkdir(path.join(teamDir, 'inbox', leadMemberId), { recursive: true });
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

    const memberInboxDir = path.join(this.getTeamDir(teamId), 'inbox', member.memberId);
    await fs.mkdir(memberInboxDir, { recursive: true });

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
    };

    const tasksDir = path.join(this.getTeamDir(teamId), 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });

    const taskPath = path.join(tasksDir, `${task.taskId}.json`);
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2));

    team.sharedTaskList.push(task);
    await this.saveTeam(team);

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

  async updateTask(
    teamId: string,
    taskId: string,
    updates: Partial<TeamTask>
  ): Promise<TeamTask | null> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return null;
    }

    const taskIndex = team.sharedTaskList.findIndex((t) => t.taskId === taskId);
    if (taskIndex < 0) {
      const task = await this.getTask(teamId, taskId);
      if (!task) return null;

      Object.assign(task, updates, { updatedAt: Date.now() });
      const taskPath = path.join(this.getTeamDir(teamId), 'tasks', `${taskId}.json`);
      await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
      return task;
    }

    Object.assign(team.sharedTaskList[taskIndex], updates, { updatedAt: Date.now() });
    const taskPath = path.join(this.getTeamDir(teamId), 'tasks', `${taskId}.json`);
    await fs.writeFile(taskPath, JSON.stringify(team.sharedTaskList[taskIndex], null, 2));
    await this.saveTeam(team);

    return team.sharedTaskList[taskIndex];
  }

  async deleteTask(teamId: string, taskId: string): Promise<boolean> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return false;
    }

    const taskIndex = team.sharedTaskList.findIndex((t) => t.taskId === taskId);
    if (taskIndex < 0) {
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
    const task = await this.getTask(teamId, taskId);
    if (!task) return null;

    if (task.status !== 'pending') {
      throw new Error(`Task ${taskId} is not available (status: ${task.status})`);
    }

    const tasks = await this.getTasks(teamId);
    const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

    const uncompletedDeps = task.dependencies.filter((depId) => {
      const dep = taskMap.get(depId);
      return dep && dep.status !== 'completed';
    });

    if (uncompletedDeps.length > 0) {
      throw new Error(`Task has uncompleted dependencies: ${uncompletedDeps.join(', ')}`);
    }

    return this.updateTask(teamId, taskId, {
      status: 'in_progress',
      assignee: memberId,
    });
  }

  async sendMessage(
    teamId: string,
    fromMemberId: string,
    toMemberId: string | 'broadcast',
    content: string,
    type: TeamMessage['type'] = 'direct'
  ): Promise<TeamMessage> {
    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const fromMember = team.members.find((m) => m.memberId === fromMemberId);

    const message: TeamMessage = {
      messageId: generateId(),
      teamId,
      fromMemberId,
      fromMemberName: fromMember?.name,
      toMemberId,
      content,
      timestamp: Date.now(),
      type,
      read: false,
    };

    if (toMemberId === 'broadcast') {
      for (const member of team.members) {
        if (member.memberId !== fromMemberId) {
          await this.deliverMessage(teamId, member.memberId, message);
        }
      }
    } else {
      await this.deliverMessage(teamId, toMemberId, message);
    }

    return message;
  }

  private async deliverMessage(
    teamId: string,
    memberId: string,
    message: TeamMessage
  ): Promise<void> {
    const inboxPath = path.join(this.getTeamDir(teamId), 'inbox', memberId);
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
    await fs.mkdir(inboxPath, { recursive: true });
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
