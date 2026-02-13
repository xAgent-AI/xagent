import { TeamStore, getTeamStore } from './team-store.js';
import { TeammateSpawner, getTeammateSpawner } from './teammate-spawner.js';
import { MessageBroker, getMessageBroker, removeMessageBroker } from './message-broker.js';
import {
  TeamToolParams,
  Team,
  TeamMember,
  TeamTask,
  TeamMessage,
  MessageDeliveryInfo,
  MemberRole,
  LEAD_PERMISSIONS,
  TEAMMATE_PERMISSIONS,
  MemberPermissions,
} from './types.js';
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

  private checkPermission(
    memberPermissions: MemberPermissions,
    action: string
  ): boolean {
    const permissionMap: Record<string, keyof MemberPermissions> = {
      createTask: 'canCreateTask',
      assignTask: 'canAssignTask',
      claimTask: 'canClaimTask',
      completeTask: 'canCompleteTask',
      deleteTask: 'canDeleteTask',
      messageAll: 'canMessageAll',
      messageDirect: 'canMessageDirect',
      shutdownTeam: 'canShutdownTeam',
      shutdownMember: 'canShutdownMember',
      inviteMembers: 'canInviteMembers',
    };

    const permissionKey = permissionMap[action];
    if (!permissionKey) {
      return true;
    }
    return memberPermissions[permissionKey];
  }

  async execute(
    params: TeamToolParams
  ): Promise<{ success: boolean; message: string; result?: any }> {
    const memberId = process.env.XAGENT_MEMBER_ID || 'lead';
    const isTeamLead = process.env.XAGENT_IS_TEAM_LEAD !== 'false' || params.is_team_lead === true;

    const permissions = isTeamLead ? LEAD_PERMISSIONS : TEAMMATE_PERMISSIONS;

    switch (params.team_action) {
      case 'create':
        return this.createTeam(params);
      case 'spawn':
        if (!this.checkPermission(permissions, 'inviteMembers')) {
          return {
            success: false,
            message: 'Permission denied: Only team lead can invite new members',
          };
        }
        return this.spawnTeammate(params);
      case 'message':
        const canMessage = params.message?.to_member_id === 'broadcast'
          ? this.checkPermission(permissions, 'messageAll')
          : this.checkPermission(permissions, 'messageDirect');
        if (!canMessage) {
          return {
            success: false,
            message: 'Permission denied: You cannot send broadcast messages',
          };
        }
        return this.sendTeamMessage(params);
      case 'task_create':
        if (!this.checkPermission(permissions, 'createTask')) {
          return {
            success: false,
            message: 'Permission denied: You cannot create tasks',
          };
        }
        return this.createTeamTask(params, memberId);
      case 'task_update':
        return this.updateTeamTask(params, memberId, permissions);
      case 'task_delete':
        if (!this.checkPermission(permissions, 'deleteTask')) {
          return {
            success: false,
            message: 'Permission denied: Only lead can delete tasks',
          };
        }
        return this.deleteTeamTask(params);
      case 'task_list':
        return this.listTeamTasks(params);
      case 'shutdown':
        if (params.member_id === 'self') {
          return this.shutdownTeammate(params, memberId);
        }
        if (!params.member_id) {
          return {
            success: false,
            message: 'member_id is required for shutdown',
          };
        }
        if (!this.checkPermission(permissions, 'shutdownMember')) {
          return {
            success: false,
            message: 'Permission denied: Only team lead can shutdown other members',
          };
        }
        return this.shutdownTeammate(params, params.member_id);
      case 'cleanup':
        if (!this.checkPermission(permissions, 'shutdownTeam')) {
          return {
            success: false,
            message: 'Permission denied: Only team lead can cleanup the team',
          };
        }
        return this.cleanupTeam(params);
      case 'list_teams':
        return this.listTeams();
      case 'get_status':
        return this.getTeamStatus(params);
      default:
        throw new Error(`Unknown team action: ${params.team_action}`);
    }
  }

  private async createTeam(
    params: TeamToolParams
  ): Promise<{ success: boolean; message: string; result?: any }> {
    const team = await this.store.createTeam(
      params.team_name || 'unnamed-team',
      process.env.XAGENT_SESSION_ID || 'lead',
      process.cwd()
    );

    const displayMode = params.display_mode || 'auto';

    const broker = await this.getBroker(team.teamId);
    const brokerPort = broker.getPort();

    console.log(
      colors.primaryBright(`\n🚀 Team "${team.teamName}" created (ID: ${team.teamId})`)
    );
    console.log(colors.textMuted(`   Display mode: ${displayMode}`));
    console.log(colors.textMuted(`   Message broker: port ${brokerPort}`));

    if (displayMode !== 'auto' && displayMode !== 'in-process') {
      if (!this.spawner.isDisplayModeAvailable(displayMode)) {
        console.log(
          colors.warning(`   ⚠ ${displayMode} not available, falling back to in-process`)
        );
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
        console.log(
          colors.success(
            `  ✓ Spawned: ${member.name} (${member.memberRole || member.role}) [${member.displayMode}]`
          )
        );
      }
    }

    const leadMember = team.members[0];

    return {
      success: true,
      message: `Team "${team.teamName}" created successfully`,
      result: {
        team_id: team.teamId,
        team_name: team.teamName,
        display_mode: displayMode,
        lead_id: leadMember?.memberId,
        members: spawnedMembers.map((m) => ({
          id: m.memberId,
          name: m.name,
          role: m.memberRole || m.role,
          display_mode: m.displayMode,
        })),
      },
    };
  }

  private async spawnTeammate(
    params: TeamToolParams
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required for spawning teammates');
    }
    if (!params.teammates || params.teammates.length === 0) {
      throw new Error('teammates config is required for spawning');
    }

    const team = await this.store.getTeam(params.team_id);
    if (!team) {
      throw new Error(`Team ${params.team_id} not found`);
    }

    const displayMode = params.display_mode || 'auto';
    const broker = await this.getBroker(params.team_id);
    const brokerPort = broker.getPort();

    const spawnedMembers: TeamMember[] = [];

    for (const teammateConfig of params.teammates) {
      const member = await this.spawner.spawnTeammate(
        params.team_id,
        teammateConfig,
        team.workDir,
        displayMode,
        brokerPort
      );
      spawnedMembers.push(member);
      console.log(
        colors.success(
          `  ✓ Spawned: ${member.name} (${member.memberRole || member.role}) [${member.displayMode}]`
        )
      );
    }

    return {
      success: true,
      message: `Spawned ${spawnedMembers.length} teammate(s)`,
      result: {
        team_id: params.team_id,
        members: spawnedMembers.map((m) => ({
          id: m.memberId,
          name: m.name,
          role: m.memberRole || m.role,
          display_mode: m.displayMode,
        })),
      },
    };
  }

  private async sendTeamMessage(
    params: TeamToolParams
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }
    if (!params.message) {
      throw new Error('message is required');
    }

    const team = await this.store.getTeam(params.team_id);
    if (!team) {
      throw new Error(`Team ${params.team_id} not found`);
    }

    const fromMemberId = process.env.XAGENT_MEMBER_ID || 'lead';
    const broker = await this.getBroker(params.team_id);

    try {
      const { message, deliveryInfo } = await broker.sendMessageWithAck(
        fromMemberId,
        params.message.to_member_id || 'broadcast',
        params.message.content
      );

      const isBroadcast =
        params.message.to_member_id === 'broadcast' || !params.message.to_member_id;
      const ackCount = Array.isArray(deliveryInfo)
        ? deliveryInfo.filter((d) => d.status === 'acknowledged').length
        : deliveryInfo.status === 'acknowledged'
          ? 1
          : 0;
      const totalCount = Array.isArray(deliveryInfo) ? deliveryInfo.length : 1;

      return {
        success: true,
        message: isBroadcast
          ? `Message broadcasted and acknowledged by ${ackCount}/${totalCount} members`
          : `Message delivered and acknowledged`,
        result: {
          message_id: message.messageId,
          delivered_to: message.toMemberId,
          delivery_status: Array.isArray(deliveryInfo)
            ? deliveryInfo.map((d) => ({
                member_id: d.acknowledgedBy?.[0],
                status: d.status,
              }))
            : { status: deliveryInfo.status, acknowledged_at: deliveryInfo.acknowledgedAt },
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        result: undefined,
      };
    }
  }

  async getMessageDeliveryInfo(
    teamId: string,
    messageId: string
  ): Promise<MessageDeliveryInfo | undefined> {
    const broker = this.brokers.get(teamId);
    if (!broker) {
      return undefined;
    }
    return broker.getDeliveryInfo(messageId);
  }

  private async createTeamTask(
    params: TeamToolParams,
    createdBy: string
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }
    if (!params.task_config) {
      throw new Error('task_config is required');
    }

    const task = await this.store.createTask(params.team_id, params.task_config, createdBy);

    console.log(colors.success(`✓ Task created: ${task.title} (${task.taskId})`));

    return {
      success: true,
      message: `Task "${task.title}" created successfully`,
      result: {
        task_id: task.taskId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignee: task.assignee,
        dependencies: task.dependencies,
        created_at: task.createdAt,
      },
    };
  }

  private async updateTeamTask(
    params: TeamToolParams,
    memberId: string,
    permissions: MemberPermissions
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }
    if (!params.task_update) {
      throw new Error('task_update is required');
    }

    const { task_id, action, result } = params.task_update;

    if (action === 'claim') {
      if (!this.checkPermission(permissions, 'claimTask')) {
        return {
          success: false,
          message: 'Permission denied: You cannot claim tasks',
        };
      }

      const claimedTask = await this.store.claimTask(params.team_id, task_id, memberId);
      if (!claimedTask) {
        throw new Error(`Task ${task_id} not found or cannot be claimed`);
      }
      return {
        success: true,
        message: `Task ${task_id} claimed successfully`,
        result: {
          task_id: claimedTask.taskId,
          status: claimedTask.status,
          assignee: claimedTask.assignee,
        },
      };
    }

    if (action === 'complete') {
      if (!this.checkPermission(permissions, 'completeTask')) {
        return {
          success: false,
          message: 'Permission denied: You cannot complete tasks',
        };
      }

      const task = await this.store.updateTask(params.team_id, task_id, {
        status: 'completed',
        result,
      });
      if (!task) {
        throw new Error(`Task ${task_id} not found`);
      }
      return {
        success: true,
        message: `Task ${task_id} completed`,
        result: {
          task_id: task.taskId,
          status: task.status,
          result: task.result,
        },
      };
    }

    if (action === 'release') {
      const task = await this.store.updateTask(params.team_id, task_id, {
        status: 'pending',
        assignee: undefined,
      });
      if (!task) {
        throw new Error(`Task ${task_id} not found`);
      }
      return {
        success: true,
        message: `Task ${task_id} released back to pool`,
        result: {
          task_id: task.taskId,
          status: task.status,
        },
      };
    }

    throw new Error(`Unknown task action: ${action}`);
  }

  private async deleteTeamTask(
    params: TeamToolParams
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }

    const taskId = params.task_update?.task_id;
    if (!taskId) {
      throw new Error('task_id is required for deletion');
    }

    const deleted = await this.store.deleteTask(params.team_id, taskId);
    if (!deleted) {
      throw new Error(`Task ${taskId} not found`);
    }

    console.log(colors.success(`✓ Task ${taskId} deleted`));

    return {
      success: true,
      message: `Task ${taskId} deleted`,
      result: { task_id: taskId },
    };
  }

  private async listTeamTasks(
    params: TeamToolParams
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }

    const team = await this.store.getTeam(params.team_id);
    if (!team) {
      throw new Error(`Team ${params.team_id} not found`);
    }

    const filter = params.task_filter || 'all';
    let tasks: TeamTask[];

    switch (filter) {
      case 'pending':
        tasks = (await this.store.getTasks(params.team_id)).filter(
          (t) => t.status === 'pending'
        );
        break;
      case 'available':
        tasks = await this.store.getAvailableTasks(params.team_id);
        break;
      case 'in_progress':
        tasks = (await this.store.getTasks(params.team_id)).filter(
          (t) => t.status === 'in_progress'
        );
        break;
      case 'completed':
        tasks = (await this.store.getTasks(params.team_id)).filter(
          (t) => t.status === 'completed'
        );
        break;
      default:
        tasks = await this.store.getTasks(params.team_id);
    }

    return {
      success: true,
      message: `Found ${tasks.length} tasks (filter: ${filter})`,
      result: {
        team_id: params.team_id,
        filter,
        total_count: tasks.length,
        tasks: tasks.map((t) => ({
          task_id: t.taskId,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          assignee: t.assignee,
          dependencies: t.dependencies,
          created_at: t.createdAt,
          updated_at: t.updatedAt,
          result: t.result,
        })),
      },
    };
  }

  private async shutdownTeammate(
    params: TeamToolParams,
    memberId: string
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }
    if (!memberId) {
      throw new Error('member_id is required');
    }

    await this.spawner.shutdownTeammate(params.team_id, memberId);

    console.log(colors.warning(`✓ Teammate ${memberId} shut down`));

    return {
      success: true,
      message: `Teammate ${memberId} shut down`,
      result: { member_id: memberId },
    };
  }

  private async cleanupTeam(
    params: TeamToolParams
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }

    const team = await this.store.getTeam(params.team_id);
    if (!team) {
      throw new Error(`Team ${params.team_id} not found`);
    }

    const activeMembers = team.members.filter((m) => m.status === 'active');
    if (activeMembers.length > 0) {
      throw new Error(
        `Cannot cleanup: ${activeMembers.length} active teammates. Shutdown first.`
      );
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
      result: { team_id: params.team_id },
    };
  }

  private async listTeams(): Promise<{ success: boolean; message: string; result?: any }> {
    const teams = await this.store.listTeams();

    return {
      success: true,
      message: `Found ${teams.length} team(s)`,
      result: {
        total_count: teams.length,
        teams: teams.map((t) => ({
          team_id: t.teamId,
          team_name: t.teamName,
          member_count: t.members.length,
          status: t.status,
          created_at: t.createdAt,
          work_dir: t.workDir,
        })),
      },
    };
  }

  private async getTeamStatus(
    params: TeamToolParams
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }

    const status = await this.store.getTeamStatus(params.team_id);

    if (!status.team) {
      throw new Error(`Team ${params.team_id} not found`);
    }

    return {
      success: true,
      message: `Team status retrieved`,
      result: {
        team_id: params.team_id,
        team_name: status.team.teamName,
        status: status.team.status,
        member_count: status.memberCount,
        members: status.team.members.map((m) => ({
          id: m.memberId,
          name: m.name,
          role: m.memberRole || m.role,
          status: m.status,
          display_mode: m.displayMode,
        })),
        active_task_count: status.activeTaskCount,
        completed_task_count: status.completedTaskCount,
        created_at: status.team.createdAt,
      },
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
