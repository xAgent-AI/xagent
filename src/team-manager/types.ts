import { ExecutionMode } from '../types.js';

export type DisplayMode = 'auto' | 'tmux' | 'iterm2' | 'in-process';

export type TeamStatus = 'active' | 'completed' | 'cancelled';
export type MemberStatus = 'spawning' | 'active' | 'idle' | 'shutdown';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type TaskPriority = 'high' | 'medium' | 'low';
export type MessageType = 'direct' | 'broadcast' | 'task_update' | 'shutdown_request' | 'shutdown_response';
export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'acknowledged' | 'failed';
export type AckStatus = 'received' | 'processed';

export interface Team {
  teamId: string;
  teamName: string;
  createdAt: number;
  leadSessionId: string;
  members: TeamMember[];
  status: TeamStatus;
  workDir: string;
}

export interface TeamMember {
  memberId: string;
  name: string;
  role: string;
  model?: string;
  status: MemberStatus;
  processId?: number;
  lastActivity?: number;
  displayMode?: 'tmux' | 'iterm2' | 'in-process';
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
  result?: string;
}

export interface TeamMessage {
  messageId: string;
  teamId: string;
  fromMemberId: string;
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
  action: 'claim' | 'complete';
  result?: string;
}

export interface TeamToolParams {
  team_mode?: boolean;
  team_name?: string;
  teammates?: TeammateConfig[];
  team_action?: 'create' | 'message' | 'task_create' | 'task_update' | 'task_list' | 'shutdown' | 'cleanup';
  display_mode?: DisplayMode;
  team_id?: string;
  member_id?: string;
  message?: TeamMessagePayload;
  task_config?: TaskCreateConfig;
  task_update?: TaskUpdateConfig;
  task_filter?: 'all' | 'pending' | 'available' | 'in_progress' | 'completed';
  spawn_prompt?: string;
}

export interface TeamModeConfig {
  teamId: string;
  memberId: string;
  memberName: string;
  memberRole?: string;
  teamDir: string;
  tasksDir: string;
  spawnPrompt?: string;
}
