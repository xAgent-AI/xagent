import { ChatMessage, CompressionConfig } from './types.js';
import { AIClient, Message } from './ai-client.js';
import { AuthConfig } from './types.js';

export interface CompressionResult {
  compressedMessages: ChatMessage[];
  wasCompressed: boolean;
  originalMessageCount: number;
  compressedMessageCount: number;
  originalSize: number;
  compressedSize: number;
  compressionMethod: 'summary' | 'truncate' | 'none';
}

export class ContextCompressor {
  private aiClient: AIClient | null = null;
  private defaultConfig: CompressionConfig = {
    enabled: true,
    maxMessages: 50,
    maxContextSize: 150000,
    preserveRecentMessages: 0,
    enableSummary: true
  };

  constructor(authConfig?: AuthConfig) {
    if (authConfig) {
      this.aiClient = new AIClient(authConfig);
    }
  }

  setAIClient(aiClient: AIClient): void {
    this.aiClient = aiClient;
  }

  /**
   * 检查是否需要进行压缩
   */
  needsCompression(
    messages: ChatMessage[],
    config?: Partial<CompressionConfig>
  ): { needsCompression: boolean; reason: string } {
    const cfg = { ...this.defaultConfig, ...config };
    const userMessageCount = messages.filter(m => m.role === 'user').length;
    const contextSize = this.calculateContextSize(messages);

    if (userMessageCount > cfg.maxMessages) {
      return {
        needsCompression: true,
        reason: `User message count (${userMessageCount}) exceeds maximum (${cfg.maxMessages})`
      };
    }

    if (contextSize > cfg.maxContextSize) {
      return {
        needsCompression: true,
        reason: `Context size (${contextSize} chars) exceeds maximum (${cfg.maxContextSize} chars)`
      };
    }

    return { needsCompression: false, reason: '' };
  }

  /**
   * 计算上下文大小（字符数）
   */
  calculateContextSize(messages: ChatMessage[]): number {
    return messages.reduce((total, msg) => {
      return total + msg.content.length + (msg.role.length + 10);
    }, 0);
  }

  /**
   * 压缩对话历史
   */
  async compressContext(
    messages: ChatMessage[],
    systemPrompt: string,
    config?: Partial<CompressionConfig>
  ): Promise<CompressionResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const originalMessageCount = messages.length;
    const originalSize = this.calculateContextSize(messages);

    // 分离系统消息、用户消息和助手消息
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    // 如果消息数量和大小都在限制内，不需要压缩
    const { needsCompression } = this.needsCompression(nonSystemMessages, config);
    if (!needsCompression) {
      return {
        compressedMessages: messages,
        wasCompressed: false,
        originalMessageCount,
        compressedMessageCount: messages.length,
        originalSize,
        compressedSize: originalSize,
        compressionMethod: 'none'
      };
    }

    // 使用 AI 生成摘要压缩全部历史对话
    const compressedMessages = await this.summarizeAllMessages(
      nonSystemMessages,
      systemPrompt,
      cfg
    );

    // 注意：不再保留原始的 systemMessages，因为 generateResponse 会自动添加系统提示
    // 压缩后的消息只包含摘要（role: assistant），避免重复的 system 消息导致 API 报错
    const finalMessages = [...compressedMessages];

    return {
      compressedMessages: finalMessages,
      wasCompressed: true,
      originalMessageCount,
      compressedMessageCount: finalMessages.length,
      originalSize,
      compressedSize: this.calculateContextSize(finalMessages),
      compressionMethod: 'summary'
    };
  }

  /**
   * 使用 AI 生成摘要来压缩全部对话历史
   */
  private async summarizeAllMessages(
    messages: ChatMessage[],
    systemPrompt: string,
    config: CompressionConfig
  ): Promise<ChatMessage[]> {
    // 生成完整对话的摘要
    const summary = await this.generateSummary(messages, systemPrompt);

    // 构建压缩后的对话：只有摘要作为 system 消息
    const compressed: ChatMessage[] = [];

    // 添加摘要作为 assistant 消息，避免与系统提示重复导致 API 报错
    compressed.push({
      role: 'assistant',
      content: `[Conversation Summary - ${messages.length} messages compressed]\n\n${summary}`,
      timestamp: Date.now()
    });

    return compressed;
  }

  /**
   * Generate conversation summary
   */
  private async generateSummary(
    messages: ChatMessage[],
    systemPrompt: string
  ): Promise<string> {
    if (!this.aiClient) {
      throw new Error('AI client not initialized for summarization');
    }

    // Extract all conversation content
    const conversationText = messages
      .map((m, idx) => {
        const role = m.role === 'user' ? 'User' : 
                     m.role === 'assistant' ? 'Assistant' : 
                     m.role === 'tool' ? 'Tool' : m.role;
        return `[${idx + 1}] ${role}:\n${m.content}`;
      })
      .join('\n\n' + '='.repeat(50) + '\n\n');

    const summaryPrompt = `You are an expert at summarizing conversations. Please create a comprehensive summary of the following conversation.

## Instructions
1. Analyze ALL messages in the conversation
2. Create a detailed summary that captures:
   - Complete context and background
   - All topics discussed
   - All decisions made
   - All files created, modified, or analyzed
   - All code changes and implementations
   - All problems solved
   - Current state and progress
   - Any pending or ongoing tasks
3. Be extremely thorough - this summary will replace the entire conversation history
4. Include specific details like file paths, code snippets, command outputs, etc.

## Conversation to summarize
${conversationText}

## Output Format
Provide a detailed, comprehensive summary in the following format:

### Conversation Summary

#### Overview
[Brief description of what this conversation was about]

#### Background & Context
[Complete background information]

#### Topics Discussed
- [Topic 1: detailed description]
- [Topic 2: detailed description]
- [All topics with full details]

#### Key Decisions
- [Decision 1: details and rationale]
- [All decisions made during the conversation]

#### File Operations
- Created: [file paths]
- Modified: [file paths]
- Analyzed: [file paths]
- Deleted: [file paths]

#### Code Changes
- [Specific code changes with details]
- [All implementations]

#### Problems & Solutions
- Problem: [description]
  Solution: [how it was solved]
- [All problems and solutions]

#### Current State
[What is the current status of the project/work]

#### Pending Tasks
- [Any ongoing or pending work]

#### Important Details
[Any other crucial information]

Please provide the comprehensive summary possible. Do not omit any important information.`;

    try {
      const summaryMessage: Message = {
        role: 'user',
        content: summaryPrompt
      };

      const response = await this.aiClient.chatCompletion([summaryMessage], {
        maxTokens: 8192,
        temperature: 0.3
      });

      const summary = response.choices[0]?.message?.content || '';
      return typeof summary === 'string' ? summary : JSON.stringify(summary);
    } catch (error) {
      console.error('Failed to generate summary:', error);
      const userCount = messages.filter(m => m.role === 'user').length;
      const toolCount = messages.filter(m => m.role === 'tool').length;
      return `[Summary of ${messages.length} messages: ${userCount} user exchanges, ${toolCount} tool calls. Key topics discussed but details unavailable due to summarization error.]`;
    }
  }

  /**
   * 创建压缩后的消息副本（用于保存）
   */
  createCompressedSnapshot(
    messages: ChatMessage[],
    compressionResult: CompressionResult
  ): object {
    return {
      timestamp: Date.now(),
      originalMessageCount: compressionResult.originalMessageCount,
      compressedMessageCount: compressionResult.compressedMessageCount,
      originalSize: compressionResult.originalSize,
      compressedSize: compressionResult.compressedSize,
      compressionMethod: compressionResult.compressionMethod,
      messages: compressionResult.compressedMessages
    };
  }

  /**
   * 估算 token 数量（粗略估计）
   */
  estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 2 + otherChars / 4);
  }
}

let compressorInstance: ContextCompressor | null = null;

export function getContextCompressor(authConfig?: AuthConfig): ContextCompressor {
  if (!compressorInstance) {
    compressorInstance = new ContextCompressor(authConfig);
  }
  return compressorInstance;
}