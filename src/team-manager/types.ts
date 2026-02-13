import { ExecutionMode } from '../types.js';

export type DisplayMode = 'auto' | 'tmux' | 'iterm2' | 'in-process';

export type TeamStatus = 'active' | 'completed' | 'cancelled';
export type MemberStatus = 'spawning' | 'active' | 'idle' | 'shutdown';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type TaskPriority = 'high' | 'medium' | 'low';
export type MessageType = 'direct' | 'broadcast' | 'task_update' | 'shutdown_request' | 'shutdown_response';
export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'acknowledged' | 'failed';
export type AckStatus = 'received' | 'processed';

export type MemberRole = 'lead' | 'teammate';

export interface MemberPermissions {
  canCreateTask: boolean;
  canAssignTask: boolean;
  canClaimTask: boolean;
  canCompleteTask: boolean;
  canDeleteTask: boolean;
  canMessageAll: boolean;
  canMessageDirect: boolean;
  canShutdownTeam: boolean;
  canShutdownMember: boolean;
  canInviteMembers: boolean;
  canAccessSharedFiles: boolean;
}

export const LEAD_PERMISSIONS: MemberPermissions = {
  canCreateTask: true,
  canAssignTask: true,
  canClaimTask: true,
  canCompleteTask: true,
  canDeleteTask: true,
  canMessageAll: true,
  canMessageDirect: true,
  canShutdownTeam: true,
  canShutdownMember: true,
  canInviteMembers: true,
  canAccessSharedFiles: true,
};

export const TEAMMATE_PERMISSIONS: MemberPermissions = {
  canCreateTask: false,
  canAssignTask: false,
  canClaimTask: true,
  canCompleteTask: true,
  canDeleteTask: false,
  canMessageAll: false,
  canMessageDirect: true,
  canShutdownTeam: false,
  canShutdownMember: false,
  canInviteMembers: false,
  canAccessSharedFiles: false,
};

export interface Team {
  teamId: string;
  teamName: string;
  createdAt: number;
  leadSessionId: string;
  leadMemberId: string;
  members: TeamMember[];
  status: TeamStatus;
  workDir: string;
  sharedTaskList: TeamTask[];
}

export interface TeamMember {
  memberId: string;
  name: string;
  role: MemberRole;
  memberRole?: string;
  model?: string;
  status: MemberStatus;
  processId?: number;
  lastActivity?: number;
  displayMode?: 'tmux' | 'iterm2' | 'in-process';
  permissions: MemberPermissions;
}

export interface TeamTask {
  taskId: string;
  teamId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee?: string;
  dependencies: string[];
  priority: TaskPriority;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  result?: string;
}

export interface TeamMessage {
  messageId: string;
  teamId: string;
  fromMemberId: string;
  fromMemberName?: string;
  toMemberId: string | 'broadcast';
  content: string;
  timestamp: number;
  type: MessageType;
  read: boolean;
  requiresAck?: boolean;
}

export interface MessageAck {
  messageId: string;
  fromMemberId: string;
  status: AckStatus;
  timestamp: number;
  error?: string;
}

export interface MessageDeliveryInfo {
  messageId: string;
  status: MessageDeliveryStatus;
  sentAt: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string[];
  failedReason?: string;
}

export interface TeammateConfig {
  name: string;
  role: string;
  prompt: string;
  model?: string;
  allowedTools?: string[];
}

export interface TeamMessagePayload {
  to_member_id?: string | 'broadcast';
  content: string;
}

export interface TaskCreateConfig {
  title: string;
  description: string;
  assignee?: string;
  dependencies?: string[];
  priority?: TaskPriority;
}

export interface TaskUpdateConfig {
  task_id: string;
  action: 'claim' | 'complete' | 'release';
  result?: string;
}

export interface TeamToolParams {
  team_mode?: boolean;
  team_name?: string;
  teammates?: TeammateConfig[];
  team_action?: 'create' | 'spawn' | 'message' | 'task_create' | 'task_update' | 'task_list' | 'task_delete' | 'shutdown' | 'cleanup' | 'list_teams' | 'get_status';
  display_mode?: DisplayMode;
  team_id?: string;
  member_id?: string;
  message?: TeamMessagePayload;
  task_config?: TaskCreateConfig;
  task_update?: TaskUpdateConfig;
  task_filter?: 'all' | 'pending' | 'available' | 'in_progress' | 'completed';
  spawn_prompt?: string;
  is_team_lead?: boolean;
}

export interface TeamModeConfig {
  teamId: string;
  memberId: string;
  memberName: string;
  memberRole: MemberRole;
  specificRole?: string;
  teamDir: string;
  tasksDir: string;
  spawnPrompt?: string;
  permissions: MemberPermissions;
}

export interface TeamCreateResult {
  team_id: string;
  team_name: string;
  display_mode: DisplayMode;
  lead_id: string;
  members: Array<{
    id: string;
    name: string;
    role: string;
    display_mode: string;
  }>;
}

export interface TaskListResult {
  team_id: string;
  filter: string;
  total_count: number;
  tasks: Array<{
    task_id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignee?: string;
    dependencies: string[];
    created_at: number;
    updated_at: number;
    result?: string;
  }>;
}
