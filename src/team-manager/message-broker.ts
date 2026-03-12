import * as net from 'net';
import { EventEmitter } from 'events';
import { TeamMessage, MessageAck, MessageDeliveryInfo } from './types.js';
import crypto from 'crypto';

const generateId = () => crypto.randomUUID();

export interface MessageBrokerOptions {
  port?: number;
  host?: string;
  ackTimeout?: number;
  maxDeliveryInfoAge?: number; // Max age for delivery info cleanup
}

export interface ConnectedClient {
  memberId: string;
  socket: net.Socket;
  joinedAt: number;
}

export interface PendingAck {
  message: TeamMessage;
  targetMemberId: string;
  sentAt: number;
  resolve: (info: MessageDeliveryInfo) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

// Default timeout for delivery info cleanup (5 minutes)
const DEFAULT_DELIVERY_INFO_MAX_AGE = 5 * 60 * 1000;
// Cleanup interval (1 minute)
const CLEANUP_INTERVAL = 60 * 1000;

export class MessageBroker extends EventEmitter {
  private server: net.Server | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private port: number;
  private host: string;
  private teamId: string;
  private isRunning: boolean = false;
  private pendingAcks: Map<string, PendingAck> = new Map();
  private ackTimeout: number;
  private deliveryInfo: Map<string, MessageDeliveryInfo> = new Map();
  private maxDeliveryInfoAge: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(teamId: string, options: MessageBrokerOptions = {}) {
    super();
    this.teamId = teamId;
    this.port = options.port || 0;
    this.host = options.host || '127.0.0.1';
    this.ackTimeout = options.ackTimeout || 30000;
    this.maxDeliveryInfoAge = options.maxDeliveryInfoAge || DEFAULT_DELIVERY_INFO_MAX_AGE;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address() as net.AddressInfo;
        this.port = address.port;
        this.isRunning = true;
        this.emit('started', { port: this.port, host: this.host });
        
        // Start cleanup timer
        this.startCleanupTimer();
        
        resolve(this.port);
      });

      this.server.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    // Stop cleanup timer
    this.stopCleanupTimer();

    // Clean up all pending ACKs
    for (const [key, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Broker shutting down'));
    }
    this.pendingAcks.clear();

    // Clean up delivery info
    this.deliveryInfo.clear();

    return new Promise((resolve) => {
      for (const [memberId, client] of this.clients) {
        try {
          client.socket.destroy();
        } catch {
          // ignore
        }
      }
      this.clients.clear();

      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          this.emit('stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Start periodic cleanup of stale delivery info
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleData();
    }, CLEANUP_INTERVAL);
  }

  /**
   * Stop cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clean up stale delivery info entries
   */
  private cleanupStaleData(): void {
    const now = Date.now();
    const staleThreshold = now - this.maxDeliveryInfoAge;

    // Clean up stale delivery info
    for (const [messageId, info] of this.deliveryInfo) {
      if (info.sentAt < staleThreshold) {
        this.deliveryInfo.delete(messageId);
      }
    }

    // Clean up orphaned pending ACKs (shouldn't happen, but safety check)
    for (const [key, pending] of this.pendingAcks) {
      if (pending.sentAt < staleThreshold) {
        clearTimeout(pending.timer);
        this.pendingAcks.delete(key);
        
        // Resolve with failed status instead of leaving hanging
        const info: MessageDeliveryInfo = {
          messageId: pending.message.messageId,
          status: 'failed',
          sentAt: pending.sentAt,
          failedReason: 'Stale entry cleaned up'
        };
        pending.resolve(info);
      }
    }
  }

  private handleConnection(socket: net.Socket): void {
    let memberId: string | null = null;
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      const messages = buffer.split('\n');
      buffer = messages.pop() || '';

      for (const msgStr of messages) {
        if (!msgStr.trim()) continue;

        try {
          const msg = JSON.parse(msgStr);

          if (msg.type === 'register' && msg.memberId) {
            memberId = msg.memberId;
            this.clients.set(memberId as string, {
              memberId: memberId as string,
              socket,
              joinedAt: Date.now()
            });
            this.emit('client:connected', { memberId });
            this.sendToSocket(socket, { type: 'registered', memberId });
          } else if (memberId) {
            this.handleMessage(memberId, msg);
          }
        } catch (parseError) {
          // Log parse errors for debugging but don't crash
          this.emit('parse-error', { data: msgStr, error: parseError });
        }
      }
    });

    socket.on('close', () => {
      if (memberId) {
        this.clients.delete(memberId);
        this.emit('client:disconnected', { memberId });

        // Clean up pending ACKs for this member
        this.cleanupPendingAcksForMember(memberId);
      }
    });

    socket.on('error', (error) => {
      if (memberId) {
        this.clients.delete(memberId);
        this.emit('client:error', { memberId, error });

        // Clean up pending ACKs for this member
        this.cleanupPendingAcksForMember(memberId);
      }
    });
  }

  /**
   * Clean up pending ACKs for a disconnected member
   */
  private cleanupPendingAcksForMember(memberId: string): void {
    for (const [key, pending] of this.pendingAcks) {
      if (pending.targetMemberId === memberId) {
        clearTimeout(pending.timer);
        this.pendingAcks.delete(key);
        
        const info = this.deliveryInfo.get(pending.message.messageId);
        if (info) {
          info.status = 'failed';
          info.failedReason = `Client ${memberId} disconnected`;
        }
        
        pending.reject(new Error(`Client ${memberId} disconnected`));
      }
    }
  }

  private handleMessage(fromMemberId: string, msg: any): void {
    if (msg.type === 'ack') {
      this.handleAck(fromMemberId, msg);
    } else if (msg.type === 'direct' || msg.type === 'broadcast') {
      this.routeMessage(fromMemberId, msg);
    } else if (msg.type === 'task_update') {
      this.broadcast({
        messageId: generateId(),
        teamId: this.teamId,
        fromMemberId,
        toMemberId: 'broadcast',
        content: msg.content,
        timestamp: Date.now(),
        type: 'task_update',
        read: false
      }, fromMemberId);
    }
  }

  private handleAck(fromMemberId: string, ack: MessageAck): void {
    const pendingKey = `${ack.messageId}:${fromMemberId}`;
    const pending = this.pendingAcks.get(pendingKey);
    
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingAcks.delete(pendingKey);
      
      const info = this.deliveryInfo.get(ack.messageId);
      if (info) {
        info.status = 'acknowledged';
        info.acknowledgedAt = ack.timestamp;
        if (!info.acknowledgedBy) {
          info.acknowledgedBy = [];
        }
        info.acknowledgedBy.push(fromMemberId);
      }
      
      this.emit('message:acknowledged', { messageId: ack.messageId, fromMemberId, status: ack.status });
      pending.resolve(this.deliveryInfo.get(ack.messageId)!);
    }
  }

  private routeMessage(fromMemberId: string, msg: any): void {
    const message: TeamMessage = {
      messageId: generateId(),
      teamId: this.teamId,
      fromMemberId,
      toMemberId: msg.toMemberId || 'broadcast',
      content: msg.content,
      timestamp: Date.now(),
      type: msg.type || 'direct',
      read: false
    };

    if (msg.toMemberId === 'broadcast') {
      this.broadcast(message, fromMemberId);
    } else if (msg.toMemberId) {
      this.sendToMember(msg.toMemberId, message);
    }
  }

  private broadcast(message: TeamMessage, excludeMemberId?: string): void {
    const msgStr = JSON.stringify(message) + '\n';
    
    for (const [memberId, client] of this.clients) {
      if (memberId !== excludeMemberId) {
        try {
          client.socket.write(msgStr);
        } catch {
          // socket might be closed
        }
      }
    }
    
    this.emit('message:broadcast', message);
  }

  private sendToMember(memberId: string, message: TeamMessage, requiresAck: boolean = true): Promise<MessageDeliveryInfo> {
    return new Promise((resolve, reject) => {
      const client = this.clients.get(memberId);
      const info: MessageDeliveryInfo = {
        messageId: message.messageId,
        status: 'pending',
        sentAt: Date.now()
      };
      this.deliveryInfo.set(message.messageId, info);

      if (!client) {
        info.status = 'failed';
        info.failedReason = 'client not found';
        this.emit('message:failed', { memberId, message, reason: 'client not found' });
        reject(new Error(`Client ${memberId} not found`));
        return;
      }

      try {
        const msgWithAck = { ...message, requiresAck };
        client.socket.write(JSON.stringify(msgWithAck) + '\n');
        info.status = 'sent';
        this.emit('message:sent', { memberId, message });

        if (requiresAck) {
          const pendingKey = `${message.messageId}:${memberId}`;
          const timer = setTimeout(() => {
            // Clean up on timeout
            this.pendingAcks.delete(pendingKey);
            info.status = 'failed';
            info.failedReason = 'ack timeout';
            this.emit('message:timeout', { messageId: message.messageId, memberId });
            reject(new Error(`ACK timeout for message ${message.messageId} to ${memberId}`));
          }, this.ackTimeout);

          this.pendingAcks.set(pendingKey, {
            message,
            targetMemberId: memberId,
            sentAt: Date.now(),
            resolve,
            reject,
            timer
          });
        } else {
          resolve(info);
        }
      } catch (err) {
        info.status = 'failed';
        info.failedReason = String(err);
        this.emit('message:failed', { memberId, message, error: err });
        reject(err);
      }
    });
  }

  private sendToSocket(socket: net.Socket, msg: object): void {
    try {
      socket.write(JSON.stringify(msg) + '\n');
    } catch {
      // ignore
    }
  }

  sendMessage(fromMemberId: string, toMemberId: string | 'broadcast', content: string, type: TeamMessage['type'] = 'direct'): TeamMessage {
    const message: TeamMessage = {
      messageId: generateId(),
      teamId: this.teamId,
      fromMemberId,
      toMemberId,
      content,
      timestamp: Date.now(),
      type,
      read: false,
      requiresAck: true
    };

    if (toMemberId === 'broadcast') {
      this.broadcast(message, fromMemberId);
    } else {
      this.sendToMember(toMemberId, message);
    }

    return message;
  }

  async sendMessageWithAck(
    fromMemberId: string,
    toMemberId: string | 'broadcast',
    content: string,
    type: TeamMessage['type'] = 'direct'
  ): Promise<{ message: TeamMessage; deliveryInfo: MessageDeliveryInfo | MessageDeliveryInfo[] }> {
    const message: TeamMessage = {
      messageId: generateId(),
      teamId: this.teamId,
      fromMemberId,
      toMemberId,
      content,
      timestamp: Date.now(),
      type,
      read: false,
      requiresAck: true
    };

    if (toMemberId === 'broadcast') {
      const results = await this.broadcastWithAck(message, fromMemberId);
      return { message, deliveryInfo: results };
    } else {
      const info = await this.sendToMember(toMemberId, message, true);
      return { message, deliveryInfo: info };
    }
  }

  private async broadcastWithAck(message: TeamMessage, excludeMemberId?: string): Promise<MessageDeliveryInfo[]> {
    const promises: Promise<MessageDeliveryInfo>[] = [];
    
    for (const [memberId, client] of this.clients) {
      if (memberId !== excludeMemberId) {
        promises.push(this.sendToMember(memberId, { ...message }, true));
      }
    }
    
    return Promise.allSettled(promises).then(results =>
      results.map(r => r.status === 'fulfilled' ? r.value : {
        messageId: message.messageId,
        status: 'failed' as const,
        sentAt: Date.now(),
        failedReason: r.status === 'rejected' ? String(r.reason) : undefined
      })
    );
  }

  getDeliveryInfo(messageId: string): MessageDeliveryInfo | undefined {
    return this.deliveryInfo.get(messageId);
  }

  getPort(): number {
    return this.port;
  }

  getConnectedMembers(): string[] {
    return Array.from(this.clients.keys());
  }

  isClientConnected(memberId: string): boolean {
    return this.clients.has(memberId);
  }

  isConnected(): boolean {
    return this.isRunning;
  }

  /**
   * Get stats about the broker state
   */
  getStats(): {
    connectedClients: number;
    pendingAcks: number;
    deliveryInfoEntries: number;
  } {
    return {
      connectedClients: this.clients.size,
      pendingAcks: this.pendingAcks.size,
      deliveryInfoEntries: this.deliveryInfo.size
    };
  }
}

export class MessageClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private connected: boolean = false;
  private buffer: string = '';
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  constructor(
    private teamId: string,
    private memberId: string,
    private port: number,
    private host: string = '127.0.0.1'
  ) {
    super();
  }

  async connect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();

      const connectHandler = () => {
        this.connected = true;
        this.reconnectAttempts = 0;

        // Disable idle timeout after connection - we want persistent connections
        // for real-time team communication
        this.socket?.setTimeout(0);

        const registerMsg = JSON.stringify({
          type: 'register',
          memberId: this.memberId,
          teamId: this.teamId
        }) + '\n';

        this.socket?.write(registerMsg);

        this.emit('connected');
        resolve();
      };

      const errorHandler = (err: Error) => {
        if (!this.connected) {
          reject(err);
        } else {
          this.emit('error', err);
          this.handleDisconnect();
        }
      };

      // Set initial connection timeout (10 seconds to establish connection)
      this.socket.setTimeout(10000);

      this.socket.connect(this.port, this.host, connectHandler);
      this.socket.on('error', errorHandler);
      this.socket.on('close', () => this.handleDisconnect());
      // Remove timeout handler since we disable timeout after connection
      this.socket.on('timeout', () => {
        // This should only fire during initial connection phase
        // After connection, timeout is disabled (setTimeout(0))
        if (!this.connected) {
          this.socket?.destroy();
          reject(new Error('Connection timeout'));
        }
      });
      this.socket.on('data', (data) => this.handleData(data));
    });
  }

  private handleDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;
    
    if (wasConnected) {
      this.emit('disconnected');
    }
    
    // Don't reconnect if we're shutting down
    if (this.isShuttingDown) {
      return;
    }
    
    // Attempt reconnection
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      
      // Clear any existing reconnect timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
      
      const delay = this.reconnectDelay * this.reconnectAttempts;
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch(() => {
          this.emit('reconnect:failed', { attempt: this.reconnectAttempts });
        });
      }, delay);
      
      this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });
    } else {
      this.emit('reconnect:exhausted', { attempts: this.reconnectAttempts });
    }
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString();
    
    const messages = this.buffer.split('\n');
    this.buffer = messages.pop() || '';

    for (const msgStr of messages) {
      if (!msgStr.trim()) continue;
      
      try {
        const msg = JSON.parse(msgStr);
        
        if (msg.type === 'registered') {
          this.emit('registered', msg);
        } else {
          if (msg.requiresAck && msg.messageId) {
            this.sendAck(msg.messageId, 'received');
          }
          this.emit('message', msg);
        }
      } catch (parseError) {
        this.emit('parse-error', { data: msgStr, error: parseError });
      }
    }
  }

  private sendAck(messageId: string, status: 'received' | 'processed', error?: string): void {
    const ack: MessageAck = {
      messageId,
      fromMemberId: this.memberId,
      status,
      timestamp: Date.now(),
      error
    };
    this.send({ type: 'ack', ...ack });
  }

  acknowledgeMessage(messageId: string, status: 'received' | 'processed' = 'processed', error?: string): void {
    this.sendAck(messageId, status, error);
  }

  sendDirect(toMemberId: string, content: string): void {
    this.send({
      type: 'direct',
      toMemberId,
      content
    });
  }

  broadcast(content: string): void {
    this.send({
      type: 'broadcast',
      toMemberId: 'broadcast',
      content
    });
  }

  sendTaskUpdate(taskId: string, action: string, content: string): void {
    this.send({
      type: 'task_update',
      taskId,
      action,
      content
    });
  }

  private send(msg: object): void {
    if (this.socket && this.connected) {
      try {
        this.socket.write(JSON.stringify(msg) + '\n');
      } catch (error) {
        this.emit('send:failed', { message: msg, error });
      }
    } else {
      this.emit('send:failed', { message: msg, error: new Error('Not connected') });
    }
  }

  async disconnect(): Promise<void> {
    this.isShuttingDown = true;
    
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    return new Promise((resolve) => {
      if (this.socket) {
        this.socket.destroy();
        this.socket = null;
      }
      this.connected = false;
      resolve();
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Reset reconnection attempts (useful after successful operation)
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}

let brokerInstances: Map<string, MessageBroker> = new Map();
let teammateClientInstance: MessageClient | null = null;

export function getMessageBroker(teamId: string): MessageBroker {
  if (!brokerInstances.has(teamId)) {
    brokerInstances.set(teamId, new MessageBroker(teamId));
  }
  return brokerInstances.get(teamId)!;
}

export function removeMessageBroker(teamId: string): void {
  const broker = brokerInstances.get(teamId);
  if (broker) {
    broker.stop().catch(() => {});
  }
  brokerInstances.delete(teamId);
}

/**
 * Set the persistent MessageClient for teammate process
 * This is called once during teammate initialization
 */
export function setTeammateClient(client: MessageClient): void {
  teammateClientInstance = client;
}

/**
 * Get the persistent MessageClient for teammate process
 * Returns null if not a teammate process or not initialized
 */
export function getTeammateClient(): MessageClient | null {
  return teammateClientInstance;
}

/**
 * Clear the persistent MessageClient for teammate process
 * Called during cleanup to properly disconnect
 */
export function clearTeammateClient(): void {
  if (teammateClientInstance) {
    teammateClientInstance.disconnect().catch(() => {});
    teammateClientInstance = null;
  }
}