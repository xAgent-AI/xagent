import { TeamStore, getTeamStore } from './team-store.js';
import { TeammateSpawner, getTeammateSpawner } from './teammate-spawner.js';
import { MessageBroker, getMessageBroker, removeMessageBroker } from './message-broker.js';
import { TeamToolParams, Team, TeamMember, TeamTask, TeamMessage } from './types.js';
import { colors } from '../theme.js';

export class TeamCoordinator {
  private store: TeamStore;
  private spawner: TeammateSpawner;
  private brokers: Map<string, MessageBroker> = new Map();

  constructor() {
    this.store = getTeamStore();
    this.spawner = getTeammateSpawner();
  }

  private async getBroker(teamId: string): Promise<MessageBroker> {
    if (!this.brokers.has(teamId)) {
      const broker = getMessageBroker(teamId);
      if (!broker.isConnected()) {
        await broker.start();
      }
      this.brokers.set(teamId, broker);
    }
    return this.brokers.get(teamId)!;
  }

  async execute(params: TeamToolParams): Promise<{ success: boolean; message: string; result?: any }> {
    switch (params.team_action) {
      case 'create':
        return this.createTeam(params);
      case 'message':
        return this.sendTeamMessage(params);
      case 'task_create':
        return this.createTeamTask(params);
      case 'task_update':
        return this.updateTeamTask(params);
      case 'shutdown':
        return this.shutdownTeammate(params);
      case 'cleanup':
        return this.cleanupTeam(params);
      default:
        throw new Error(`Unknown team action: ${params.team_action}`);
    }
  }

  private async createTeam(params: TeamToolParams): Promise<{ success: boolean; message: string; result?: any }> {
    const team = await this.store.createTeam(
      params.team_name || 'unnamed-team',
      process.env.XAGENT_SESSION_ID || 'lead',
      process.cwd()
    );

    const displayMode = params.display_mode || 'auto';

    const broker = await this.getBroker(team.teamId);
    const brokerPort = broker.getPort();

    console.log(colors.primaryBright(`\n🚀 Team "${team.teamName}" created (ID: ${team.teamId})`));
    console.log(colors.textMuted(`   Display mode: ${displayMode}`));
    console.log(colors.textMuted(`   Message broker: port ${brokerPort}`));

    if (displayMode !== 'auto' && displayMode !== 'in-process') {
      if (!this.spawner.isDisplayModeAvailable(displayMode)) {
        console.log(colors.warning(`   ⚠ ${displayMode} not available, falling back to in-process`));
      }
    }

    const spawnedMembers: TeamMember[] = [];
    if (params.teammates && params.teammates.length > 0) {
      for (const teammateConfig of params.teammates) {
        const member = await this.spawner.spawnTeammate(
          team.teamId,
          teammateConfig,
          team.workDir,
          displayMode,
          brokerPort
        );
        spawnedMembers.push(member);
        console.log(colors.success(`  ✓ Spawned: ${member.name} (${member.role}) [${member.displayMode}]`));
      }
    }

    return {
      success: true,
      message: `Team "${team.teamName}" created successfully`,
      result: {
        team_id: team.teamId,
        team_name: team.teamName,
        display_mode: displayMode,
        members: spawnedMembers.map((m) => ({
          id: m.memberId,
          name: m.name,
          role: m.role,
          display_mode: m.displayMode
        }))
      }
    };
  }

  private async sendTeamMessage(params: TeamToolParams): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) throw new Error('team_id is required');
    if (!params.message) throw new Error('message is required');

    const team = await this.store.getTeam(params.team_id);
    if (!team) throw new Error(`Team ${params.team_id} not found`);

    const fromMemberId = process.env.XAGENT_MEMBER_ID || 'lead';
    const broker = await this.getBroker(params.team_id);

    const message = broker.sendMessage(
      fromMemberId,
      params.message.to_member_id || 'broadcast',
      params.message.content
    );

    return {
      success: true,
      message: 'Message sent successfully',
      result: {
        message_id: message.messageId,
        delivered_to: message.toMemberId
      }
    };
  }

  private async createTeamTask(params: TeamToolParams): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) throw new Error('team_id is required');
    if (!params.task_config) throw new Error('task_config is required');

    const task = await this.store.createTask(params.team_id, params.task_config);

    console.log(colors.success(`✓ Task created: ${task.title} (${task.taskId})`));

    return {
      success: true,
      message: `Task "${task.title}" created successfully`,
      result: {
        task_id: task.taskId,
        title: task.title,
        status: task.status
      }
    };
  }

  private async updateTeamTask(params: TeamToolParams): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) throw new Error('team_id is required');
    if (!params.task_update) throw new Error('task_update is required');

    const { task_id, action, result } = params.task_update;
    const memberId = process.env.XAGENT_MEMBER_ID || 'lead';

    if (action === 'claim') {
      const claimedTask = await this.store.claimTask(params.team_id, task_id, memberId);
      if (!claimedTask) throw new Error(`Task ${task_id} not found or cannot be claimed`);
      return {
        success: true,
        message: `Task ${task_id} claimed successfully`,
        result: {
          task_id: claimedTask.taskId,
          status: claimedTask.status,
          assignee: claimedTask.assignee
        }
      };
    }

    if (action === 'complete') {
      const task = await this.store.updateTask(params.team_id, task_id, { status: 'completed', result });
      if (!task) throw new Error(`Task ${task_id} not found`);
      return {
        success: true,
        message: `Task ${task_id} completed`,
        result: {
          task_id: task.taskId,
          status: task.status
        }
      };
    }

    throw new Error(`Unknown task action: ${action}`);
  }

  private async shutdownTeammate(params: TeamToolParams): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) throw new Error('team_id is required');
    if (!params.member_id) throw new Error('member_id is required');

    await this.spawner.shutdownTeammate(params.team_id, params.member_id);

    console.log(colors.warning(`✓ Teammate ${params.member_id} shut down`));

    return {
      success: true,
      message: `Teammate ${params.member_id} shut down`,
      result: { member_id: params.member_id }
    };
  }

  private async cleanupTeam(params: TeamToolParams): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) throw new Error('team_id is required');

    const team = await this.store.getTeam(params.team_id);
    if (!team) throw new Error(`Team ${params.team_id} not found`);

    const activeMembers = team.members.filter((m) => m.status === 'active');
    if (activeMembers.length > 0) {
      throw new Error(`Cannot cleanup: ${activeMembers.length} active teammates. Shutdown first.`);
    }

    const broker = this.brokers.get(params.team_id);
    if (broker) {
      await broker.stop();
      this.brokers.delete(params.team_id);
      removeMessageBroker(params.team_id);
    }

    await this.store.deleteTeam(params.team_id);

    console.log(colors.success(`✓ Team ${params.team_id} cleaned up`));

    return {
      success: true,
      message: `Team ${params.team_id} cleaned up`,
      result: { team_id: params.team_id }
    };
  }
}

let teamCoordinatorInstance: TeamCoordinator | null = null;

export function getTeamCoordinator(): TeamCoordinator {
  if (!teamCoordinatorInstance) {
    teamCoordinatorInstance = new TeamCoordinator();
  }
  return teamCoordinatorInstance;
}
