import { TeamStore, getTeamStore } from './team-store.js';
import { TeammateSpawner, getTeammateSpawner } from './teammate-spawner.js';
import { MessageBroker, MessageClient, getMessageBroker, removeMessageBroker, getTeammateClient } from './message-broker.js';
import {
  TeamToolParams,
  TeamMember,
  TeamTask,
  MessageDeliveryInfo,
  LEAD_PERMISSIONS,
  TEAMMATE_PERMISSIONS,
  MemberPermissions,
} from './types.js';
import { colors, icons } from '../theme.js';

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

  private async broadcastTaskUpdate(
    teamId: string,
    fromMemberId: string,
    taskId: string,
    action: 'created' | 'claimed' | 'completed' | 'released' | 'deleted',
    taskInfo?: { title: string; assignee?: string; result?: string }
  ): Promise<void> {
    const envBrokerPort = process.env.XAGENT_BROKER_PORT;
    const content = JSON.stringify({
      taskId,
      action,
      ...taskInfo,
      timestamp: Date.now()
    });

    // Teammate processes use MessageClient to broadcast
    if (envBrokerPort && fromMemberId === process.env.XAGENT_MEMBER_ID) {
      await this.broadcastAsTeammate(teamId, fromMemberId, parseInt(envBrokerPort, 10), content, 'task_update');
      return;
    }

    // Lead processes use broker directly
    try {
      const broker = await this.getBroker(teamId);
      broker.sendMessage(fromMemberId, 'broadcast', content, 'task_update');
    } catch (error) {
      console.warn('[Team] Failed to broadcast task update:', error);
    }
  }

  /**
   * Broadcast message as teammate using persistent MessageClient
   */
  private async broadcastAsTeammate(
    teamId: string,
    memberId: string,
    brokerPort: number,
    content: string,
    type: string
  ): Promise<void> {
    // Try to use the persistent client first
    const persistentClient = getTeammateClient();

    if (persistentClient && persistentClient.isConnected()) {
      if (type === 'task_update') {
        persistentClient.sendTaskUpdate('', '', content);
      } else {
        persistentClient.broadcast(content);
      }
      return;
    }

    // Fallback: create temporary connection
    return this.broadcastWithTempClient(teamId, memberId, brokerPort, content, type);
  }

  /**
   * Fallback: broadcast with temporary MessageClient connection
   */
  private async broadcastWithTempClient(
    teamId: string,
    memberId: string,
    brokerPort: number,
    content: string,
    type: string
  ): Promise<void> {
    return new Promise((resolve) => {
      const client = new MessageClient(teamId, memberId, brokerPort);
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          client.disconnect().catch(() => {});
        }
      };

      // Timeout after 5 seconds
      const timeout = setTimeout(() => {
        cleanup();
        resolve(); // Resolve anyway, broadcast is fire-and-forget
      }, 5000);

      client.on('connected', () => {
        if (type === 'task_update') {
          client.sendTaskUpdate('', '', content);
        } else {
          client.broadcast(content);
        }

        // Small delay before closing
        setTimeout(() => {
          clearTimeout(timeout);
          cleanup();
          resolve();
        }, 300);
      });

      client.on('error', () => {
        clearTimeout(timeout);
        cleanup();
        resolve(); // Resolve anyway, broadcast is fire-and-forget
      });

      client.on('disconnected', () => {
        if (!resolved) {
          clearTimeout(timeout);
          cleanup();
          resolve();
        }
      });

      client.connect().catch(() => {
        clearTimeout(timeout);
        cleanup();
        resolve();
      });
    });
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
    const memberId = process.env.XAGENT_MEMBER_ID;
    // Role determined by action type:
    // - create: caller is lead
    // - other actions: if XAGENT_MEMBER_ID is not set, caller is lead
    const isTeamLead = params.team_action === 'create' || !memberId;

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
      case 'message': {
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
      }
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
        if (!params.team_id) {
          return { success: false, message: 'team_id is required for shutdown' };
        }
        {
          const team = await this.store.getTeam(params.team_id);
          if (!team) {
            return { success: false, message: `Team ${params.team_id} not found` };
          }
          const actualMemberId = memberId || team.leadMemberId;

          // Prevent shutting down self - use cleanup to shutdown entire team
          if (params.member_id === 'self' || params.member_id === actualMemberId) {
            return {
              success: false,
              message: 'Cannot shutdown yourself.',
            };
          }

          // Prevent shutting down lead - lead should only be removed via cleanup
          if (params.member_id === team.leadMemberId) {
            return {
              success: false,
              message: 'Cannot shutdown team lead.',
            };
          }
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
    if (!params.team_name) {
      return { success: false, message: 'team_name is required' };
    }
    if (!params.teammates || params.teammates.length === 0) {
      return { success: false, message: 'teammates is required' };
    }

    // 检查每个 teammate 配置
    for (let i = 0; i < params.teammates.length; i++) {
      const t = params.teammates[i];
      if (!t.name) {
        return { success: false, message: `teammates[${i}].name is required` };
      }
      if (!t.role) {
        return { success: false, message: `teammates[${i}].role is required` };
      }
      if (!t.prompt) {
        return { success: false, message: `teammates[${i}].prompt is required` };
      }
    }

    const team = await this.store.createTeam(
      params.team_name || 'unnamed-team',
      process.env.XAGENT_SESSION_ID || 'lead',
      process.cwd()
    );

    const displayMode = 'auto';

    const broker = await this.getBroker(team.teamId);
    const brokerPort = broker.getPort();

    console.log(
      colors.primaryBright(`\n${icons.rocket} Team "${team.teamName}" created`)
    );
    console.log(colors.textMuted(`   ${icons.arrow} Broker: port ${brokerPort}`));

    const spawnedMembers: TeamMember[] = [];
    const initialTasks: { taskId: string; title: string; assignee: string }[] = [];

    const leadMember = team.members[0];
    const leadMemberId = leadMember?.memberId;

    // Spawn teammates with lead ID
    if (params.teammates && params.teammates.length > 0) {
      console.log(colors.text(`   ${icons.bullet} Members:`));
      
      for (const teammateConfig of params.teammates) {
        // Create initial task BEFORE spawning, so we can pass task ID to teammate
        const task = await this.store.createTask(team.teamId, {
          title: `Initial task for ${teammateConfig.name}`,
          description: teammateConfig.prompt,
          priority: 'high',
        }, 'lead');

        initialTasks.push({
          taskId: task.taskId,
          title: task.title,
          assignee: '', // Will be set after spawn
        });

        // Spawn teammate with initial task ID and lead ID
        const member = await this.spawner.spawnTeammate(
          team.teamId,
          teammateConfig,
          team.workDir,
          displayMode,
          brokerPort,
          task.taskId,  // Pass initial task ID
          leadMemberId   // Pass lead member ID
        );
        spawnedMembers.push(member);
        const displayName = member.name || member.memberId.slice(0, 8);
        const statusIcon = member.status === 'active' ? '🟢' : '🟡';

        console.log(
          `     ${statusIcon} ${colors.primary(displayName)} ${colors.textMuted(`(${member.memberRole || member.role})`)}`
        );

        // Mark task as in_progress and assign to the teammate
        await this.store.updateTask(team.teamId, task.taskId, {
          status: 'in_progress',
          assignee: member.memberId,
        }, task.version);

        // Update initialTasks with assignee
        initialTasks[initialTasks.length - 1].assignee = member.memberId;
      }
    }

    return {
      success: true,
      message: `Team "${team.teamName}" created successfully with ${initialTasks.length} initial tasks`,
      result: {
        team_id: team.teamId,
        team_name: team.teamName,
        display_mode: displayMode,
        lead_id: leadMemberId,
        your_role: 'lead',
        your_member_id: leadMemberId,
        broker_port: brokerPort,
        is_team_lead: true,
        members: spawnedMembers.map((m) => ({
          id: m.memberId,
          name: m.name,
          role: m.memberRole || m.role,
          display_mode: m.displayMode,
        })),
        initial_tasks: initialTasks,
      },
    };
  }

  private async spawnTeammate(
    params: TeamToolParams
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      return { success: false, message: 'team_id is required' };
    }
    if (!params.teammates || params.teammates.length === 0) {
      return { success: false, message: 'teammates[0] is required' };
    }

    // 只检查第一个 teammate
    const t = params.teammates[0];
    if (!t.name) {
      return { success: false, message: 'teammates[0].name is required' };
    }
    if (!t.role) {
      return { success: false, message: 'teammates[0].role is required' };
    }
    if (!t.prompt) {
      return { success: false, message: 'teammates[0].prompt is required' };
    }

    const team = await this.store.getTeam(params.team_id);
    if (!team) {
      return { success: false, message: `Team ${params.team_id} not found` };
    }

    const displayMode = 'auto';
    const broker = await this.getBroker(params.team_id);
    const brokerPort = broker.getPort();
    const leadMemberId = team.leadMemberId;

    // 只 spawn 一个 teammate
    const teammateConfig = params.teammates[0];
    const member = await this.spawner.spawnTeammate(
      params.team_id,
      teammateConfig,
      team.workDir,
      displayMode,
      brokerPort,
      undefined,  // No initial task ID for dynamic spawn
      leadMemberId
    );

    const displayName = member.name || member.memberId.slice(0, 8);
    const statusIcon = member.status === 'active' ? '🟢' : '🟡';
    console.log(
      `  ${statusIcon} ${colors.success('Spawned:')} ${colors.primary(displayName)} ${colors.textMuted(`(${member.memberRole || member.role})`)}`
    );

    return {
      success: true,
      message: `Spawned teammate: ${displayName}`,
      result: {
        team_id: params.team_id,
        member_id: member.memberId,
        name: member.name,
        role: member.memberRole || member.role,
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

    // Determine fromMemberId: use env var for teammates, or team.leadMemberId for lead
    const envMemberId = process.env.XAGENT_MEMBER_ID;
    const envBrokerPort = process.env.XAGENT_BROKER_PORT;
    const fromMemberId = envMemberId || team.leadMemberId;

    // Resolve target: convert 'lead' to actual leadMemberId for direct messages
    let targetMemberId = params.message.to_member_id || 'broadcast';
    if (targetMemberId === 'lead') {
      targetMemberId = team.leadMemberId;
    }

    // Check if this is a teammate process (has broker port env var)
    // Teammate should use MessageClient to connect to lead's broker
    if (envBrokerPort && envMemberId) {
      return this.sendMessageAsTeammate(
        params.team_id,
        envMemberId,
        parseInt(envBrokerPort, 10),
        targetMemberId,
        params.message.content
      );
    }

    // Lead process: use broker directly
    const broker = await this.getBroker(params.team_id);

    try {
      const { message, deliveryInfo } = await broker.sendMessageWithAck(
        fromMemberId,
        targetMemberId,
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

  /**
   * Send message as teammate using persistent MessageClient
   */
  private async sendMessageAsTeammate(
    teamId: string,
    memberId: string,
    brokerPort: number,
    targetMemberId: string,
    content: string
  ): Promise<{ success: boolean; message: string; result?: any }> {
    // Try to use the persistent client first
    const persistentClient = getTeammateClient();

    if (persistentClient && persistentClient.isConnected()) {
      // Send message using appropriate method
      if (targetMemberId === 'broadcast') {
        persistentClient.broadcast(content);
      } else {
        persistentClient.sendDirect(targetMemberId, content);
      }

      const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return {
        success: true,
        message: `Message sent to ${targetMemberId}`,
        result: {
          message_id: messageId,
          delivered_to: targetMemberId,
          delivery_status: { status: 'sent' },
        },
      };
    }

    // Fallback: create temporary connection if persistent client not available
    return this.sendMessageWithTempClient(teamId, memberId, brokerPort, targetMemberId, content);
  }

  /**
   * Fallback: send message with temporary MessageClient connection
   */
  private async sendMessageWithTempClient(
    teamId: string,
    memberId: string,
    brokerPort: number,
    targetMemberId: string,
    content: string
  ): Promise<{ success: boolean; message: string; result?: any }> {
    return new Promise((resolve) => {
      const client = new MessageClient(teamId, memberId, brokerPort);
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          client.disconnect().catch(() => {});
        }
      };

      // Timeout after 10 seconds
      const timeout = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          message: 'Failed to send message: timeout',
          result: undefined,
        });
      }, 10000);

      client.on('connected', () => {
        // Send message using appropriate method
        if (targetMemberId === 'broadcast') {
          client.broadcast(content);
        } else {
          client.sendDirect(targetMemberId, content);
        }

        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Give a small delay for the message to be sent before closing
        setTimeout(() => {
          clearTimeout(timeout);
          cleanup();
          resolve({
            success: true,
            message: `Message sent to ${targetMemberId}`,
            result: {
              message_id: messageId,
              delivered_to: targetMemberId,
              delivery_status: { status: 'sent' },
            },
          });
        }, 500);
      });

      client.on('error', (err: Error) => {
        clearTimeout(timeout);
        cleanup();
        resolve({
          success: false,
          message: `Failed to send message: ${err.message}`,
          result: undefined,
        });
      });

      client.on('disconnected', () => {
        if (!resolved) {
          clearTimeout(timeout);
          cleanup();
          resolve({
            success: false,
            message: 'Failed to send message: disconnected from broker',
            result: undefined,
          });
        }
      });

      client.connect().catch((err) => {
        clearTimeout(timeout);
        cleanup();
        resolve({
          success: false,
          message: `Failed to connect to broker: ${err.message}`,
          result: undefined,
        });
      });
    });
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
    createdBy: string | undefined
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }
    if (!params.task_config) {
      throw new Error('task_config is required');
    }

    // Get team to resolve leadMemberId if createdBy is not provided
    const team = await this.store.getTeam(params.team_id);
    if (!team) {
      throw new Error(`Team ${params.team_id} not found`);
    }
    const actualCreatedBy = createdBy || team.leadMemberId;

    const task = await this.store.createTask(params.team_id, params.task_config, actualCreatedBy);

    console.log(colors.success(`✓ Task created: ${task.title} (${task.taskId})`));

    await this.broadcastTaskUpdate(params.team_id!, actualCreatedBy, task.taskId, 'created', {
      title: task.title
    });

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
    memberId: string | undefined,
    permissions: MemberPermissions
  ): Promise<{ success: boolean; message: string; result?: any }> {
    if (!params.team_id) {
      throw new Error('team_id is required');
    }
    if (!params.task_update) {
      throw new Error('task_update is required');
    }

    // Get team to resolve leadMemberId if memberId is not provided
    const team = await this.store.getTeam(params.team_id);
    if (!team) {
      throw new Error(`Team ${params.team_id} not found`);
    }
    const actualMemberId = memberId || team.leadMemberId;

    const { task_id, action, result } = params.task_update;

    if (action === 'claim') {
      if (!this.checkPermission(permissions, 'claimTask')) {
        return {
          success: false,
          message: 'Permission denied: You cannot claim tasks',
        };
      }

      try {
        const claimedTask = await this.store.claimTask(params.team_id, task_id, actualMemberId);
        if (!claimedTask) {
          return {
            success: false,
            message: `Task ${task_id} not found`,
          };
        }

        await this.broadcastTaskUpdate(params.team_id, actualMemberId, task_id, 'claimed', {
          title: claimedTask.title,
          assignee: claimedTask.assignee
        });

        return {
          success: true,
          message: `Task ${task_id} claimed successfully`,
          result: {
            task_id: claimedTask.taskId,
            status: claimedTask.status,
            assignee: claimedTask.assignee,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: errorMessage,
        };
      }
    }

    if (action === 'complete') {
      if (!this.checkPermission(permissions, 'completeTask')) {
        return {
          success: false,
          message: 'Permission denied: You cannot complete tasks',
        };
      }

      const existingTask = await this.store.getTask(params.team_id, task_id);
      if (!existingTask) {
        return { success: false, message: `Task ${task_id} not found` };
      }

      const task = await this.store.updateTask(params.team_id, task_id, {
        status: 'completed',
        result,
      }, existingTask.version);
      if (!task) {
        return { success: false, message: `Task ${task_id} update failed` };
      }

      await this.broadcastTaskUpdate(params.team_id, actualMemberId, task_id, 'completed', {
        title: task.title,
        result: task.result
      });

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
      const existingTask = await this.store.getTask(params.team_id, task_id);
      if (!existingTask) {
        return { success: false, message: `Task ${task_id} not found` };
      }

      const task = await this.store.updateTask(params.team_id, task_id, {
        status: 'pending',
        assignee: undefined,
      }, existingTask.version);
      if (!task) {
        return { success: false, message: `Task ${task_id} update failed` };
      }

      await this.broadcastTaskUpdate(params.team_id, actualMemberId, task_id, 'released', {
        title: task.title
      });

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

    const team = await this.store.getTeam(params.team_id);
    if (!team) {
      throw new Error(`Team ${params.team_id} not found`);
    }

    const memberId = process.env.XAGENT_MEMBER_ID || team.leadMemberId;
    const taskId = params.task_update?.task_id;
    if (!taskId) {
      throw new Error('task_id is required for deletion');
    }

    const existingTask = await this.store.getTask(params.team_id, taskId);
    if (!existingTask) {
      return { success: false, message: `Task ${taskId} not found` };
    }

    const deleted = await this.store.deleteTask(params.team_id, taskId, existingTask.version);
    if (!deleted) {
      return { success: false, message: `Task ${taskId} was modified by another member` };
    }

    console.log(colors.success(`✓ Task ${taskId} deleted`));

    await this.broadcastTaskUpdate(params.team_id, memberId, taskId, 'deleted', {
      title: existingTask.title
    });

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

    const result = await this.spawner.shutdownTeammate(params.team_id, memberId);

    if (result.success) {
      console.log(colors.textMuted(`${icons.check} Teammate ${memberId.slice(0, 8)} shut down${result.reason ? `: ${result.reason}` : ''}`));
    } else {
      console.log(colors.error(`${icons.cross} Failed to shutdown ${memberId.slice(0, 8)}: ${result.reason}`));
    }

    return {
      success: result.success,
      message: result.success 
        ? `Teammate ${memberId} shut down${result.reason ? `: ${result.reason}` : ''}`
        : `Failed to shutdown ${memberId}: ${result.reason}`,
      result: { member_id: memberId, reason: result.reason },
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

    // Auto-shutdown all active teammates (role !== 'lead')
    const activeTeammates = team.members.filter(
      (m) => m.status === 'active' && m.role !== 'lead'
    );
    const shutdownResults: { memberId: string; success: boolean; reason?: string }[] = [];

    for (const teammate of activeTeammates) {
      const result = await this.spawner.shutdownTeammate(params.team_id, teammate.memberId);
      shutdownResults.push({
        memberId: teammate.memberId,
        success: result.success,
        reason: result.reason,
      });
      const memberName = teammate.name || teammate.memberId.slice(0, 8);
      if (result.success) {
        console.log(colors.textMuted(`  ${icons.check} ${memberName}`));
      } else {
        console.log(colors.error(`  ${icons.cross} ${memberName}: ${result.reason}`));
      }
    }

    // Stop the message broker
    const broker = this.brokers.get(params.team_id);
    if (broker) {
      await broker.stop();
      this.brokers.delete(params.team_id);
      removeMessageBroker(params.team_id);
    }

    await this.store.deleteTeam(params.team_id);

    console.log(colors.success(`\n${icons.check} Team cleaned up (${shutdownResults.filter(r => r.success).length}/${activeTeammates.length} teammates shutdown)`));

    return {
      success: true,
      message: `Team ${params.team_id} cleaned up (${shutdownResults.filter(r => r.success).length}/${activeTeammates.length} teammates auto-shutdown)`,
      result: {
        team_id: params.team_id,
        auto_shutdown: shutdownResults,
      },
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

    const envMemberId = process.env.XAGENT_MEMBER_ID;
    const isTeamLead = !envMemberId;
    const yourRole = isTeamLead ? 'lead' : 'teammate';
    const yourMemberId = envMemberId || status.team.leadMemberId;

    return {
      success: true,
      message: `Team status retrieved`,
      result: {
        team_id: params.team_id,
        team_name: status.team.teamName,
        status: status.team.status,
        your_role: yourRole,
        your_member_id: yourMemberId,
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
