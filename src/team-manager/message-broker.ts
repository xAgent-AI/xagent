import * as net from 'net';
import { EventEmitter } from 'events';
import { TeamMessage, MessageAck, MessageDeliveryInfo } from './types.js';
import crypto from 'crypto';

const generateId = () => crypto.randomUUID();

export interface MessageBrokerOptions {
  port?: number;
  host?: string;
  ackTimeout?: number;
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

  constructor(teamId: string, options: MessageBrokerOptions = {}) {
    super();
    this.teamId = teamId;
    this.port = options.port || 0;
    this.host = options.host || '127.0.0.1';
    this.ackTimeout = options.ackTimeout || 30000;
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
        resolve(this.port);
      });

      this.server.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
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
        } catch {
          // ignore parse errors
        }
      }
    });

    socket.on('close', () => {
      if (memberId) {
        this.clients.delete(memberId);
        this.emit('client:disconnected', { memberId });
      }
    });

    socket.on('error', () => {
      if (memberId) {
        this.clients.delete(memberId);
      }
    });
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
}

export class MessageClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private connected: boolean = false;
  private buffer: string = '';
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;

  constructor(
    private teamId: string,
    private memberId: string,
    private port: number,
    private host: string = '127.0.0.1'
  ) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();

      const connectHandler = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        
        this.socket?.write(JSON.stringify({
          type: 'register',
          memberId: this.memberId,
          teamId: this.teamId
        }) + '\n');

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

      this.socket.connect(this.port, this.host, connectHandler);
      this.socket.on('error', errorHandler);
      this.socket.on('close', () => this.handleDisconnect());
      this.socket.on('data', (data) => this.handleData(data));
    });
  }

  private handleDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;
    
    if (wasConnected) {
      this.emit('disconnected');
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => {
          this.connect().catch(() => {
            this.emit('reconnect:failed', { attempt: this.reconnectAttempts });
          });
        }, this.reconnectDelay * this.reconnectAttempts);
      }
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
      } catch {
        // ignore parse errors
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
      } catch {
        this.emit('send:failed', msg);
      }
    }
  }

  async disconnect(): Promise<void> {
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
}

let brokerInstances: Map<string, MessageBroker> = new Map();

export function getMessageBroker(teamId: string): MessageBroker {
  if (!brokerInstances.has(teamId)) {
    brokerInstances.set(teamId, new MessageBroker(teamId));
  }
  return brokerInstances.get(teamId)!;
}

export function removeMessageBroker(teamId: string): void {
  brokerInstances.delete(teamId);
}
