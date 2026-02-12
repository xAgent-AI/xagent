import * as net from 'net';
import { EventEmitter } from 'events';
import { TeamMessage } from './types.js';
import crypto from 'crypto';

const generateId = () => crypto.randomUUID();

export interface MessageBrokerOptions {
  port?: number;
  host?: string;
}

export interface ConnectedClient {
  memberId: string;
  socket: net.Socket;
  joinedAt: number;
}

export class MessageBroker extends EventEmitter {
  private server: net.Server | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private port: number;
  private host: string;
  private teamId: string;
  private isRunning: boolean = false;

  constructor(teamId: string, options: MessageBrokerOptions = {}) {
    super();
    this.teamId = teamId;
    this.port = options.port || 0;
    this.host = options.host || '127.0.0.1';
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
    if (msg.type === 'direct' || msg.type === 'broadcast') {
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

  private sendToMember(memberId: string, message: TeamMessage): void {
    const client = this.clients.get(memberId);
    if (client) {
      try {
        client.socket.write(JSON.stringify(message) + '\n');
        this.emit('message:sent', { memberId, message });
      } catch {
        this.emit('message:failed', { memberId, message });
      }
    } else {
      this.emit('message:failed', { memberId, message, reason: 'client not found' });
    }
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
      read: false
    };

    if (toMemberId === 'broadcast') {
      this.broadcast(message, fromMemberId);
    } else {
      this.sendToMember(toMemberId, message);
    }

    return message;
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
          this.emit('message', msg);
        }
      } catch {
        // ignore parse errors
      }
    }
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
