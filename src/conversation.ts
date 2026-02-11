import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ChatMessage, Conversation } from './types.js';

// Unified output function that automatically chooses SDK or console based on mode
type OutputType = 'info' | 'error' | 'success' | 'warning';

let _sdkAdapter: any = null;
let _isSdkMode: boolean = false;

// Initialize SDK mode (call this when session is available)
export function initOutputMode(isSdkMode: boolean, adapter?: any): void {
  _isSdkMode = isSdkMode;
  _sdkAdapter = adapter;
}

// Unified output function
async function output(type: OutputType, message: string, context?: Record<string, any>): Promise<void> {
  // Try to use SDK adapter if available and in SDK mode
  if (_isSdkMode && _sdkAdapter) {
    try {
      switch (type) {
        case 'info':
          _sdkAdapter.outputInfo(message);
          break;
        case 'error':
          _sdkAdapter.outputError(message, context);
          break;
        case 'warning':
          _sdkAdapter.outputWarning(message);
          break;
        case 'success':
          _sdkAdapter.outputSuccess(message);
          break;
      }
      return; // SDK output successful, don't use console
    } catch {
      // Fall through to console on error
    }
  }

  // Console output
  switch (type) {
    case 'info':
      console.log(message);
      break;
    case 'error':
      console.error(message, context?.error || '');
      break;
    case 'warning':
      console.warn(message);
      break;
    case 'success':
      console.log(message);
      break;
  }
}

export class ConversationManager {
  private conversationsDir: string;
  private conversations: Map<string, Conversation> = new Map();
  private currentConversationId: string | null = null;

  constructor() {
    this.conversationsDir = path.join(os.homedir(), '.xagent', 'conversations');
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.conversationsDir, { recursive: true });
      await this.loadConversations();
    } catch (error) {
      await output('error', 'Failed to initialize conversation manager', { error: (error as Error).message });
    }
  }

  private async loadConversations(): Promise<void> {
    try {
      const files = await fs.readdir(this.conversationsDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.conversationsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const conversation: Conversation = JSON.parse(content);
          this.conversations.set(conversation.id, conversation);
        }
      }
    } catch (error) {
      await output('error', 'Failed to load conversations', { error: (error as Error).message });
    }
  }

  async createConversation(_title?: string): Promise<Conversation> {
    const conversationId = `conv_${Date.now()}`;
    const now = Date.now();

    const conversation: Conversation = {
      id: conversationId,
      messages: [],
      createdAt: now,
      updatedAt: now
    };

    this.conversations.set(conversationId, conversation);
    await this.saveConversation(conversation);

    this.currentConversationId = conversationId;

    return conversation;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const filePath = path.join(this.conversationsDir, `${conversation.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
  }

  async addMessage(message: ChatMessage, conversationId?: string): Promise<void> {
    const convId = conversationId || this.currentConversationId;

    if (!convId) {
      await this.createConversation();
      return this.addMessage(message, this.currentConversationId || undefined);
    }

    const conversation = this.conversations.get(convId);
    
    if (!conversation) {
      throw new Error(`Conversation not found: ${convId}`);
    }

    conversation.messages.push(message);
    conversation.updatedAt = Date.now();

    await this.saveConversation(conversation);
  }

  async updateLastMessage(content: string, conversationId?: string): Promise<void> {
    const convId = conversationId || this.currentConversationId;

    if (!convId) {
      throw new Error('No active conversation');
    }

    const conversation = this.conversations.get(convId);
    
    if (!conversation || conversation.messages.length === 0) {
      throw new Error('Conversation has no messages');
    }

    const lastMessage = conversation.messages[conversation.messages.length - 1];
    lastMessage.content = content;

    conversation.updatedAt = Date.now();

    await this.saveConversation(conversation);
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  getCurrentConversation(): Conversation | undefined {
    if (!this.currentConversationId) {
      return undefined;
    }
    return this.conversations.get(this.currentConversationId);
  }

  async setCurrentConversation(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    this.currentConversationId = conversationId;
    await output('success', `✅ Switched to conversation: ${conversationId}`);
  }

  listConversations(): Conversation[] {
    return Array.from(this.conversations.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const filePath = path.join(this.conversationsDir, `${conversationId}.json`);
    await fs.unlink(filePath);

    this.conversations.delete(conversationId);

    if (this.currentConversationId === conversationId) {
      this.currentConversationId = null;
    }

    await output('success', `✅ Deleted conversation: ${conversationId}`);
  }

  async clearCurrentConversation(): Promise<void> {
    if (!this.currentConversationId) {
      await this.createConversation();
      return;
    }

    const conversation = this.conversations.get(this.currentConversationId);
    
    if (!conversation) {
      throw new Error(`Conversation not found: ${this.currentConversationId}`);
    }

    conversation.messages = [];
    conversation.updatedAt = Date.now();

    await this.saveConversation(conversation);
  }

  async exportConversation(conversationId: string, outputPath: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const markdown = this.conversationToMarkdown(conversation);
    await fs.writeFile(outputPath, markdown, 'utf-8');

    await output('success', `✅ Exported conversation to: ${outputPath}`);
  }

  private conversationToMarkdown(conversation: Conversation): string {
    let markdown = `# Conversation Export\n\n`;
    markdown += `**ID:** ${conversation.id}\n`;
    markdown += `**Created:** ${new Date(conversation.createdAt).toLocaleString()}\n`;
    markdown += `**Updated:** ${new Date(conversation.updatedAt).toLocaleString()}\n`;
    markdown += `**Messages:** ${conversation.messages.length}\n\n`;
    markdown += `---\n\n`;

    for (const message of conversation.messages) {
      const role = message.role === 'user' ? '👤 User' : 
                     message.role === 'assistant' ? '🤖 Assistant' : 
                     message.role === 'system' ? '⚙️ System' : '🔧 Tool';
      
      markdown += `### ${role}\n\n`;
      markdown += `**Time:** ${new Date(message.timestamp).toLocaleString()}\n\n`;

      if (message.images && message.images.length > 0) {
        markdown += `**Images:** ${message.images.length}\n\n`;
      }

      markdown += `${message.content}\n\n`;
      markdown += `---\n\n`;
    }

    return markdown;
  }

  async importConversation(filePath: string): Promise<Conversation> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    const conversation: Conversation = {
      id: data.id || `imported_${Date.now()}`,
      messages: data.messages || [],
      createdAt: data.createdAt || Date.now(),
      updatedAt: data.updatedAt || Date.now()
    };

    this.conversations.set(conversation.id, conversation);
    await this.saveConversation(conversation);

    await output('success', `✅ Imported conversation: ${conversation.id}`);

    return conversation;
  }

  async searchConversations(query: string): Promise<Conversation[]> {
    const lowerQuery = query.toLowerCase();

    return this.listConversations().filter(conv => {
      const text = conv.messages.map(msg => msg.content).join(' ').toLowerCase();
      return text.includes(lowerQuery);
    });
  }

  getConversationStats(): { total: number; totalMessages: number; oldest: Date; newest: Date } {
    const conversations = this.listConversations();
    const totalMessages = conversations.reduce((sum, conv) => sum + conv.messages.length, 0);

    const timestamps = conversations.map(conv => conv.createdAt);
    const oldest = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date();
    const newest = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date();

    return {
      total: conversations.length,
      totalMessages,
      oldest,
      newest
    };
  }

  async cleanupOldConversations(days: number = 30): Promise<number> {
    const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
    const toDelete: string[] = [];

    for (const [id, conv] of this.conversations) {
      if (conv.updatedAt < cutoffDate) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      await this.deleteConversation(id);
    }

    return toDelete.length;
  }

  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }

  async setCurrentConversationId(id: string): Promise<void> {
    this.currentConversationId = id;
  }
}

let conversationManagerInstance: ConversationManager | null = null;

export function getConversationManager(): ConversationManager {
  if (!conversationManagerInstance) {
    conversationManagerInstance = new ConversationManager();
    conversationManagerInstance.initialize();
  }
  return conversationManagerInstance;
}
