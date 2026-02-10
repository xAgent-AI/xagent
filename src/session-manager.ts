import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Session, SessionInput, SessionOutput } from './types.js';

export class SessionManager {
  private sessionsDir: string;
  private sessions: Map<string, Session> = new Map();
  private currentSessionId: string | null = null;
  private currentConversationId: string | null = null;

  constructor(projectRoot?: string) {
    const resolvedProjectRoot = path.resolve(projectRoot || process.cwd());
    const projectName = path.basename(resolvedProjectRoot);
    // Get relative path part（从用户目录开始的相对路径）
    const homeDir = os.homedir();
    let relativePath = path.relative(homeDir, resolvedProjectRoot);
    // 如果项目不在用户目录下，使用完整路径
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      relativePath = resolvedProjectRoot;
    }
    // Replace path separator with underscore，remove illegal characters
    const pathSegment = relativePath.replace(/[:\\/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
    // Build project-specific directory structure：路径信息_项目名
    this.sessionsDir = path.join(homeDir, '.xagent', 'sessions', `${pathSegment}_${projectName}`);
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
      await this.loadSessions();
    } catch (error) {
      console.error('Failed to initialize session manager:', error);
    }
  }

  private async loadSessions(): Promise<void> {
    try {
      const files = await fs.readdir(this.sessionsDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.sessionsDir, file);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            // Skip empty or invalid JSON files
            if (!content || content.trim() === '') {
              continue;
            }
            const session: Session = JSON.parse(content);
            if (session && session.id) {
              this.sessions.set(session.id, session);
            }
          } catch (parseError) {
            // Skip files that can't be parsed (corrupted or empty)
            console.warn(`Skipping invalid session file: ${file}`);
          }
        }
      }
    } catch (error) {
      // Directory might not exist yet, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to load sessions:', error);
      }
    }
  }

  async createSession(conversationId: string, agent?: string, executionMode?: string): Promise<Session> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const session: Session = {
      id: sessionId,
      conversationId,
      startTime: now,
      inputs: [],
      outputs: [],
      agent,
      executionMode,
      status: 'active'
    };

    this.sessions.set(sessionId, session);
    this.currentSessionId = sessionId;
    this.currentConversationId = conversationId;

    await this.saveSession(session);

    return session;
  }

  async saveSession(session: Session): Promise<void> {
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  async addInput(input: SessionInput, sessionId?: string): Promise<void> {
    const sessId = sessionId || this.currentSessionId;

    if (!sessId) {
      return;
    }

    const session = this.sessions.get(sessId);

    if (!session) {
      return;
    }

    session.inputs.push(input);
    await this.saveSession(session);
  }

  async addOutput(output: SessionOutput, sessionId?: string): Promise<void> {
    const sessId = sessionId || this.currentSessionId;

    if (!sessId) {
      return;
    }

    const session = this.sessions.get(sessId);

    if (!session) {
      return;
    }

    session.outputs.push(output);
    await this.saveSession(session);
  }

  async endSession(sessionId?: string, status: 'completed' | 'cancelled' = 'completed'): Promise<void> {
    const sessId = sessionId || this.currentSessionId;

    if (!sessId) {
      return;
    }

    const session = this.sessions.get(sessId);

    if (!session) {
      return;
    }

    session.endTime = Date.now();
    session.status = status;

    await this.saveSession(session);

    if (this.currentSessionId === sessId) {
      this.currentSessionId = null;
    }
  }

  async completeCurrentSession(): Promise<void> {
    await this.endSession(undefined, 'completed');
  }

  async cancelCurrentSession(): Promise<void> {
    await this.endSession(undefined, 'cancelled');
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getCurrentSession(): Session | undefined {
    if (!this.currentSessionId) {
      return undefined;
    }
    return this.sessions.get(this.currentSessionId);
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  async setCurrentSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.currentSessionId = sessionId;
    this.currentConversationId = session.conversationId;
  }

  listSessions(): Session[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.startTime - a.startTime);
  }

  listSessionsByConversation(conversationId: string): Session[] {
    return this.listSessions().filter(s => s.conversationId === conversationId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);

    try {
      await fs.unlink(filePath);
    } catch {
      // File might not exist, that's okay
    }

    this.sessions.delete(sessionId);

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
  }

  async clearSessions(): Promise<void> {
    for (const sessionId of this.sessions.keys()) {
      await this.deleteSession(sessionId);
    }
  }

  getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    cancelledSessions: number;
    totalInputs: number;
    totalOutputs: number;
  } {
    const sessions = this.listSessions();

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'active').length,
      completedSessions: sessions.filter(s => s.status === 'completed').length,
      cancelledSessions: sessions.filter(s => s.status === 'cancelled').length,
      totalInputs: sessions.reduce((sum, s) => sum + s.inputs.length, 0),
      totalOutputs: sessions.reduce((sum, s) => sum + s.outputs.length, 0)
    };
  }

  async searchSessions(query: string): Promise<Session[]> {
    const lowerQuery = query.toLowerCase();

    return this.listSessions().filter(session => {
      const inputText = session.inputs.map(i => i.content).join(' ').toLowerCase();
      const outputText = session.outputs.map(o => o.content).join(' ').toLowerCase();

      return inputText.includes(lowerQuery) || outputText.includes(lowerQuery);
    });
  }

  async getSessionByInputIndex(conversationId: string, inputIndex: number): Promise<Session | undefined> {
    const sessions = this.listSessionsByConversation(conversationId);

    for (const session of sessions) {
      if (inputIndex >= 0 && inputIndex < session.inputs.length) {
        return session;
      }
    }

    return undefined;
  }

  async cleanupOldSessions(days: number = 30): Promise<number> {
    const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
    const toDelete: string[] = [];

    for (const [id, session] of this.sessions) {
      if (session.startTime < cutoffDate) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      await this.deleteSession(id);
    }

    return toDelete.length;
  }

  setCurrentConversationId(conversationId: string): void {
    this.currentConversationId = conversationId;
  }

  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }
}

let sessionManagerInstance: SessionManager | null = null;
let currentProjectRoot: string | null = null;

export function getSessionManager(projectRoot?: string): SessionManager {
  const root = projectRoot || process.cwd();

  if (!sessionManagerInstance || currentProjectRoot !== root) {
    sessionManagerInstance = new SessionManager(root);
    sessionManagerInstance.initialize();
    currentProjectRoot = root;
  }
  return sessionManagerInstance;
}

export async function getOrCreateSession(
  conversationId: string,
  agent?: string,
  executionMode?: string,
  projectRoot?: string
): Promise<Session> {
  const manager = getSessionManager(projectRoot);
  const currentSession = manager.getCurrentSession();

  if (currentSession && currentSession.status === 'active') {
    return currentSession;
  }

  return manager.createSession(conversationId, agent, executionMode);
}
