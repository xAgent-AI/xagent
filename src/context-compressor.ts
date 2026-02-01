import { ChatMessage, CompressionConfig } from './types.js';
import { AIClient, Message } from './ai-client.js';
import { AuthConfig } from './types.js';
import { getCancellationManager } from './cancellation.js';

/**
 * Model context window sizes (in tokens)
 * Add models here as needed
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-4-turbo': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-5': 200000,

  // Anthropic Claude
  'claude-sonnet-4-20250514': 200000,
  'claude-sonnet-4': 200000,
  'claude-opus-4': 200000,
  'claude-3-5-sonnet': 200000,
  'claude-3-opus': 200000,

  // Google
  'gemini-pro': 32768,
  'gemini-ultra': 1000000,

  // DeepSeek
  'deepseek-chat': 128000,
  'deepseek-coder': 128000,
  'deepseek-reasoner': 128000,

  // Qwen (Tongyi Qianwen)
  'qwen-max': 32768,
  'qwen-plus': 64000,
  'qwen-turbo': 8000,
  'qwen-long': 100000,
  'qwen-vl-max': 128000,
  'Qwen3-Coder': 32768,

  // Zhipu AI (GLM)
  'glm-4': 128000,
  'glm-4-plus': 128000,
  'glm-4-air': 128000,
  'glm-4.7': 128000,

  // MiniMax
  'MiniMax-M2': 1000000,
  'MiniMax-M2.1': 1000000,

  // Moonshot (Kimi)
  'moonshot-v1-8k': 8192,
  'moonshot-v1-32k': 32768,
  'moonshot-v1-128k': 131072,

  // Doubao
  'doubao-seed-1-8-251228': 256000,
  'doubao-1-5-ui-tars-250428': 256000,

  // Default fallback
  'default': 200000
};

/**
 * Get the context window for a model
 */
export function getModelContextWindow(modelName?: string): number {
  if (!modelName) return MODEL_CONTEXT_WINDOWS['default'];

  // Try exact match first
  if (MODEL_CONTEXT_WINDOWS[modelName]) {
    return MODEL_CONTEXT_WINDOWS[modelName];
  }

  // Try case-insensitive match
  const lowerName = modelName.toLowerCase();
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  // Try partial match (e.g., "claude" matches "claude-sonnet-4")
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
      return value;
    }
  }

  return MODEL_CONTEXT_WINDOWS['default'];
}

export interface CompressionResult {
  compressedMessages: ChatMessage[];
  wasCompressed: boolean;
  originalMessageCount: number;
  compressedMessageCount: number;
  originalSize: number;
  compressedSize: number;
  compressionMethod: 'summary' | 'truncate' | 'none';
  tokensBefore?: number;
  details?: CompactionDetails;
}

export interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}

export interface FileOperations {
  read: Set<string>;
  modified: Set<string>;
}

export interface DetailedCompressionResult extends CompressionResult {
  fileOperations?: FileOperations;
}

export interface CutPointResult {
  firstKeptEntryIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
}

export interface CompactionPreparation {
  firstKeptEntryIndex: number;
  messagesToSummarize: ChatMessage[];
  turnPrefixMessages: ChatMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: FileOperations;
}

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context

### Key Files & Code
- [File path]: [Brief description of key content/structure]
- [File path]: [Brief description of key content/structure]

### Execution Results
- **Files**: [What files were read, written, or edited and key findings]
- **Commands**: [Key commands run and their outputs]
- **Search/Analysis**: [Key findings from code search or analysis]

### Project Context
- [Architecture patterns identified]
- [Important configurations]
- [Dependencies or libraries relevant to the task]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context

### Key Files & Code
- [Preserve existing file info, add new files read]
- [Include brief descriptions of key code structures]

### Execution Results
- **Files**: [Preserve file list, add new files read/written/edited]
- **Commands**: [Preserve outputs, add new command results]
- **Search/Analysis**: [Preserve findings, add new search results]

### Project Context
- [Preserve architecture info, add new patterns discovered]
- [Preserve configs, add new relevant dependencies]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Critical Context

### Key Files & Code
- [File path]: [Brief description of key content/structure]

### Execution Results
- **Files**: [What files were read, written, or edited in this prefix]
- **Commands**: [Key commands run and outputs]

### Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

export class ContextCompressor {
  private aiClient: AIClient | null = null;
  private defaultConfig: CompressionConfig = {
    enabled: true
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
   * Check if compression is needed based on token budget and model context window
   * @param messages - Conversation messages
   * @param config - Compression config
   * @param modelName - Optional model name to determine context window
   */
  needsCompression(
    messages: ChatMessage[],
    config?: Partial<CompressionConfig>,
    modelName?: string
  ): { needsCompression: boolean; reason: string; tokenCount: number } {
    const cfg = { ...this.defaultConfig, ...config };
    const tokenCount = this.estimateContextTokens(messages);
    const messageCount = messages.length;

    // Get model context window
    const contextWindow = getModelContextWindow(modelName);

    // Calculate threshold: 50% of context window reserved for new conversation
    const reserveTokens = Math.floor(contextWindow * 0.50);
    const threshold = contextWindow - reserveTokens;

    if (tokenCount > threshold) {
      return {
        needsCompression: true,
        reason: `Token count (${tokenCount}) exceeds ${modelName ? `${modelName}` : ''} context budget (${threshold}, contextWindow: ${contextWindow})`,
        tokenCount
      };
    }

    return { needsCompression: false, reason: '', tokenCount };
  }

  /**
   * Estimate token count for a single message using message-type-aware heuristic
   */
  estimateMessageTokens(message: ChatMessage): number {
    let chars = 0;

    switch (message.role) {
      case 'user':
      case 'system':
      case 'tool': {
        chars = message.content.length;
        break;
      }
      case 'assistant': {
        if (message.reasoningContent) {
          chars += message.reasoningContent.length;
        }
        const toolCalls = message.toolCalls as any[] | undefined;
        if (toolCalls && toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            chars += JSON.stringify(toolCall).length;
          }
        }
        chars += message.content.length;
        break;
      }
    }

    return Math.ceil(chars / 4);
  }

  /**
   * Estimate total token count for a conversation
   */
  estimateContextTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.estimateMessageTokens(msg);
    }
    return total;
  }

  /**
   * Find valid cut points: indices of messages that can be cut at
   * Never cut at tool results (they must follow their tool call)
   */
  findValidCutPoints(messages: ChatMessage[], startIndex: number, endIndex: number): number[] {
    const cutPoints: number[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      const msg = messages[i];
      switch (msg.role) {
        case 'user':
        case 'assistant':
        case 'system':
          cutPoints.push(i);
          break;
        case 'tool':
          // Tool results cannot be cut at (they must follow their tool call)
          break;
      }
    }
    return cutPoints;
  }

  /**
   * Find the user message that starts the turn containing the given index
   */
  findTurnStartIndex(messages: ChatMessage[], entryIndex: number, startIndex: number): number {
    for (let i = entryIndex; i >= startIndex; i--) {
      const role = messages[i].role;
      if (role === 'user') {
        return i;
      }
    }
    return -1;
  }

  /**
   * Find the cut point that keeps approximately keepRecentTokens
   * Walks backwards from newest, accumulating estimated message sizes
   */
  findCutPoint(
    messages: ChatMessage[],
    startIndex: number,
    endIndex: number,
    keepRecentTokens: number
  ): CutPointResult {
    const cutPoints = this.findValidCutPoints(messages, startIndex, endIndex);

    if (cutPoints.length === 0) {
      return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
    }

    // Walk backwards from newest, accumulating estimated message sizes
    let accumulatedTokens = 0;
    let cutIndex = cutPoints[cutPoints.length - 1]; // Start with the last cut point

    for (let i = endIndex - 1; i >= startIndex; i--) {
      const messageTokens = this.estimateMessageTokens(messages[i]);
      accumulatedTokens += messageTokens;

      if (accumulatedTokens >= keepRecentTokens) {
        // Find the closest valid cut point at or after this entry
        // Search from the END of cutPoints array (closest to i)
        for (let c = cutPoints.length - 1; c >= 0; c--) {
          if (cutPoints[c] >= i) {
            cutIndex = cutPoints[c];
          } else {
            // Since cutPoints is sorted ascending, no need to continue
            break;
          }
        }
        break;
      }
    }

    // Determine if this is a split turn
    const isUserMessage = messages[cutIndex].role === 'user';
    const turnStartIndex = isUserMessage ? -1 : this.findTurnStartIndex(messages, cutIndex, startIndex);

    return {
      firstKeptEntryIndex: cutIndex,
      turnStartIndex,
      isSplitTurn: !isUserMessage && turnStartIndex !== -1
    };
  }

  /**
   * Extract file operations from messages by analyzing tool calls
   */
  extractFileOperations(messages: ChatMessage[]): FileOperations {
    const fileOps: FileOperations = {
      read: new Set<string>(),
      modified: new Set<string>()
    };

    let totalToolCalls = 0;
    let matchedToolCalls = 0;

    // Normalize tool name (handle both API format and internal format)
    const isReadTool = (name: string) => name === 'read_file' || name === 'Read';
    const isWriteTool = (name: string) => name === 'write_file' || name === 'Write';
    const isEditTool = (name: string) => name === 'Edit';
    const isDeleteTool = (name: string) => name === 'DeleteFile';

    const getFilePath = (args: any): string => {
      return args.filePath || args.absolute_path || args.path || '';
    };

    for (const msg of messages) {
      // Case 1: assistant with toolCalls field
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          totalToolCalls++;
          const toolName = toolCall.function?.name || '';
          let args = {};

          try {
            args = JSON.parse(toolCall.function?.arguments || '{}');
          } catch {
            continue;
          }

          const filePath = getFilePath(args);
          if (!filePath) continue;

          if (isReadTool(toolName)) {
            fileOps.read.add(filePath);
            matchedToolCalls++;
          } else if (isWriteTool(toolName) || isEditTool(toolName) || isDeleteTool(toolName)) {
            fileOps.modified.add(filePath);
            matchedToolCalls++;
          }
        }
      }

      // Case 2: tool role with JSON content (like {"name":"Read","parameters":...})
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        try {
          const content = JSON.parse(msg.content);
          totalToolCalls++;
          const toolName = content.name || '';
          const args = content.parameters || {};

          const filePath = getFilePath(args);
          if (!filePath) continue;

          if (isReadTool(toolName)) {
            fileOps.read.add(filePath);
            matchedToolCalls++;
          } else if (isWriteTool(toolName) || isEditTool(toolName) || isDeleteTool(toolName)) {
            fileOps.modified.add(filePath);
            matchedToolCalls++;
          }
        } catch {
          // Not JSON, skip
        }
      }
    }

    return fileOps;
  }

  /**
   * Merge file operations from previous compaction
   */
  mergeFileOps(ops1: FileOperations, ops2: FileOperations): FileOperations {
    return {
      read: new Set([...ops1.read, ...ops2.read]),
      modified: new Set([...ops1.modified, ...ops2.modified])
    };
  }

  /**
   * Format file operations for inclusion in summary
   */
  formatFileOperations(fileOps: FileOperations): string {
    const readFiles = Array.from(fileOps.read);
    const modifiedFiles = Array.from(fileOps.modified);

    if (readFiles.length === 0 && modifiedFiles.length === 0) {
      return '';
    }

    let formatted = '\n\n## File Operations\n\n';

    if (readFiles.length > 0) {
      formatted += '### Files read_file\n';
      for (const file of readFiles) {
        formatted += `- ${file}\n`;
      }
    }

    if (modifiedFiles.length > 0) {
      formatted += '\n### Files Modified\n';
      for (const file of modifiedFiles) {
        formatted += `- ${file}\n`;
      }
    }

    return formatted;
  }

  /**
   * Prepare compaction - calculate cut point and extract messages to summarize
   */
  prepareCompaction(
    messages: ChatMessage[],
    keepRecentTokens: number
  ): CompactionPreparation | undefined {
    if (messages.length === 0) {
      return undefined;
    }

    // Check if last message already contains a compression summary
    const lastMsg = messages[messages.length - 1];
    const isAlreadyCompressed = lastMsg.role === 'user' &&
      lastMsg.content.includes('[Previous conversation summarized');

    if (isAlreadyCompressed) {
      return undefined;
    }

    const startIndex = 0;
    const endIndex = messages.length;

    // Find cut point
    const cutPoint = this.findCutPoint(messages, startIndex, endIndex, keepRecentTokens);

        // Extract messages to summarize

        const historyEnd = cutPoint.firstKeptEntryIndex;

    

        const messagesToSummarize: ChatMessage[] = [];

        for (let i = startIndex; i < historyEnd; i++) {

          messagesToSummarize.push(messages[i]);

        }

    

        // Extract turn prefix messages if splitting (disabled for simplicity)

        const turnPrefixMessages: ChatMessage[] = [];
    if (cutPoint.isSplitTurn) {
      for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
        turnPrefixMessages.push(messages[i]);
      }
    }

    // Get previous summary if exists (look for embedded summary in user messages)
    let previousSummary: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && msg.content.includes('[Previous conversation summarized')) {
        // Extract the summary part from the content
        const match = msg.content.match(/\[Previous conversation summarized.*?\]\n(.+?)(?=\n\n---\n\n|\n\n\[)/s);
        if (match) {
          previousSummary = match[1];
        } else {
          previousSummary = msg.content;
        }
        break;
      }
    }

    // Extract file operations
    const fileOps = this.extractFileOperations(messagesToSummarize);

    // Also extract from turn prefix
    if (cutPoint.isSplitTurn) {
      const prefixOps = this.extractFileOperations(turnPrefixMessages);
      return {
        firstKeptEntryIndex: cutPoint.firstKeptEntryIndex,
        messagesToSummarize,
        turnPrefixMessages,
        isSplitTurn: cutPoint.isSplitTurn,
        tokensBefore: this.estimateContextTokens(messagesToSummarize),
        previousSummary,
        fileOps: this.mergeFileOps(fileOps, prefixOps)
      };
    }

    return {
      firstKeptEntryIndex: cutPoint.firstKeptEntryIndex,
      messagesToSummarize,
      turnPrefixMessages,
      isSplitTurn: cutPoint.isSplitTurn,
      tokensBefore: this.estimateContextTokens(messagesToSummarize),
      previousSummary,
      fileOps
    };
  }

  /**
   * Generate summary using AI
   */
  async generateSummary(
    messages: ChatMessage[],
    systemPrompt: string,
    reserveTokens: number,
    previousSummary?: string,
    customInstructions?: string
  ): Promise<string> {
    if (!this.aiClient) {
      throw new Error('AI client not initialized for summarization');
    }

    // Serialize conversation
    const conversationText = messages
      .map((m, idx) => {
        const role = m.role === 'user' ? 'User' :
          m.role === 'assistant' ? 'Assistant' :
            m.role === 'tool' ? 'Tool' : m.role;
        return `[${idx + 1}] ${role}:\n${m.content}`;
      })
      .join('\n\n' + '='.repeat(50) + '\n\n');

    // Select prompt based on whether we have previous summary
    let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
    if (customInstructions) {
      basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
    }

    // Build prompt
    let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
    if (previousSummary) {
      promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
    }
    promptText += basePrompt;

    const maxTokens = Math.floor(0.8 * reserveTokens);

    const summaryMessage: Message = {
      role: 'user',
      content: promptText
    };

    const aiPromise = this.aiClient.chatCompletion([summaryMessage], {
      maxTokens,
      temperature: 0.3
    });

    try {
      const response = await getCancellationManager().withCancellation(
        aiPromise,
        'context-compression-summary'
      );

      const summary = response.choices[0]?.message?.content || '';
      return typeof summary === 'string' ? summary : JSON.stringify(summary);
    } catch (error: any) {
      if (error.message === 'Operation cancelled by user') {
        throw error;
      }
      console.error('Failed to generate summary:', error);
      const userCount = messages.filter(m => m.role === 'user').length;
      const toolCount = messages.filter(m => m.role === 'tool').length;
      return `[Summary of ${messages.length} messages: ${userCount} user exchanges, ${toolCount} tool calls. Key topics discussed but details unavailable due to summarization error.]`;
    }
  }

  /**
   * Generate turn prefix summary when splitting a turn
   */
  async generateTurnPrefixSummary(
    messages: ChatMessage[],
    reserveTokens: number
  ): Promise<string> {
    if (!this.aiClient) {
      throw new Error('AI client not initialized for summarization');
    }

    const conversationText = messages
      .map((m, idx) => {
        const role = m.role === 'user' ? 'User' :
          m.role === 'assistant' ? 'Assistant' :
            m.role === 'tool' ? 'Tool' : m.role;
        return `[${idx + 1}] ${role}:\n${m.content}`;
      })
      .join('\n\n' + '='.repeat(50) + '\n\n');

    const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
    const maxTokens = Math.floor(0.5 * reserveTokens);

    const summaryMessage: Message = {
      role: 'user',
      content: promptText
    };

    const aiPromise = this.aiClient.chatCompletion([summaryMessage], {
      maxTokens,
      temperature: 0.3
    });

    try {
      const response = await getCancellationManager().withCancellation(
        aiPromise,
        'context-compression-turn-prefix'
      );

      const content = response.choices[0]?.message?.content || '';
      return typeof content === 'string' ? content : JSON.stringify(content);
    } catch (error: any) {
      if (error.message === 'Operation cancelled by user') {
        throw error;
      }
      console.error('Failed to generate turn prefix summary:', error);
      return '[Turn prefix summary unavailable]';
    }
  }

  /**
   * Main compression function with incremental compaction support
   */
  async compressContext(
    messages: ChatMessage[],
    systemPrompt: string,
    config?: Partial<CompressionConfig>,
    previousSummary?: string,
    modelName?: string
  ): Promise<CompressionResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const originalMessageCount = messages.length;
    const originalSize = messages.reduce((total, msg) => total + msg.content.length, 0);
    const originalTokens = this.estimateContextTokens(messages);
    const contextWindow = getModelContextWindow(modelName);

    // Check if compression is needed
    const { needsCompression } = this.needsCompression(messages, config, modelName);
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

    // Prepare compaction
    // Reserve 50% of context window for new conversation, 15% for summary
    const reserveTokens = Math.floor(contextWindow * 0.50);
    const summaryReserveTokens = Math.max(800, Math.floor((contextWindow - reserveTokens) * 0.15));
    const keepRecentTokens = contextWindow - reserveTokens - summaryReserveTokens;
    const preparation = this.prepareCompaction(messages, Math.max(0, keepRecentTokens));

    if (!preparation) {
      // Already compressed or no valid cut point
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

    const {
      firstKeptEntryIndex,
      messagesToSummarize,
      turnPrefixMessages,
      isSplitTurn,
      tokensBefore,
      fileOps
    } = preparation;

    // Generate summary
    let summary: string;

    if (isSplitTurn && turnPrefixMessages.length > 0) {
      // Generate both summaries in parallel
      const [historyResult, turnPrefixResult] = await Promise.all([
        messagesToSummarize.length > 0
          ? this.generateSummary(messagesToSummarize, systemPrompt, summaryReserveTokens, previousSummary)
          : Promise.resolve('No prior history.'),
        this.generateTurnPrefixSummary(turnPrefixMessages, summaryReserveTokens)
      ]);
      summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`;
    } else {
      summary = await this.generateSummary(
        messagesToSummarize,
        systemPrompt,
        summaryReserveTokens,
        previousSummary
      );
    }

    // Add file operations to summary
    summary += this.formatFileOperations(fileOps);

    // Build compressed messages: summary + kept messages
    // Summary is inserted as prefix in first user message to maintain valid message order
    const compressedMessages: ChatMessage[] = [];

    if (messagesToSummarize.length > 0) {
      // Find first user message in kept messages
      let firstKeptUserMsg: ChatMessage | null = null;
      let firstKeptUserIndex = -1;
      for (let i = firstKeptEntryIndex; i < messages.length; i++) {
        if (messages[i].role === 'user') {
          firstKeptUserMsg = messages[i];
          firstKeptUserIndex = i;
          break;
        }
      }

      if (firstKeptUserMsg) {
        // Prepend summary to first user message content
        const summaryPrefix = `[Previous conversation summarized (${messagesToSummarize.length} messages):]\n${summary}\n\n---\n\n`;
        compressedMessages.push({
          role: 'user',
          content: summaryPrefix + firstKeptUserMsg.content,
          timestamp: firstKeptUserMsg.timestamp,
          images: firstKeptUserMsg.images
        });

        // Add remaining kept messages (skip the modified first user message)
        for (let i = firstKeptUserIndex + 1; i < messages.length; i++) {
          const msg = messages[i];
          compressedMessages.push({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            images: msg.images,
            reasoningContent: msg.reasoningContent,
            toolCalls: msg.toolCalls,
            tool_call_id: msg.tool_call_id
          });
        }
      } else {
        // No user message in kept messages (rare case)
        // Insert summary as a user message, then add all kept messages
        // This ensures valid message order: user → assistant → tool → tool...
        compressedMessages.push({
          role: 'user',
          content: `[Conversation Summary - ${messagesToSummarize.length} messages compressed]\n\n${summary}`,
          timestamp: Date.now()
        });

        // Add all kept messages (they may start with assistant or tool)
        for (let i = firstKeptEntryIndex; i < messages.length; i++) {
          const msg = messages[i];
          compressedMessages.push({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            images: msg.images,
            reasoningContent: msg.reasoningContent,
            toolCalls: msg.toolCalls,
            tool_call_id: msg.tool_call_id
          });
        }
      }
    } else {
      // No messages to summarize, just keep all messages
      for (let i = firstKeptEntryIndex; i < messages.length; i++) {
        const msg = messages[i];
        compressedMessages.push({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          images: msg.images,
          reasoningContent: msg.reasoningContent,
          toolCalls: msg.toolCalls,
          tool_call_id: msg.tool_call_id
        });
      }
    }

    const compressedSize = compressedMessages.reduce((total, msg) => total + msg.content.length, 0);
    const compressedTokens = this.estimateContextTokens(compressedMessages);
    const reductionPercent = Math.round((1 - compressedSize / originalSize) * 100);

    return {
      compressedMessages,
      wasCompressed: true,
      originalMessageCount,
      compressedMessageCount: compressedMessages.length,
      originalSize,
      compressedSize,
      compressionMethod: 'summary',
      tokensBefore,
      details: {
        readFiles: Array.from(fileOps.read),
        modifiedFiles: Array.from(fileOps.modified)
      }
    };
  }

  /**
   * Create compressed message copy for saving
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
      tokensBefore: compressionResult.tokensBefore,
      details: compressionResult.details,
      messages: compressionResult.compressedMessages
    };
  }
}

let compressorInstance: ContextCompressor | null = null;

export function getContextCompressor(authConfig?: AuthConfig): ContextCompressor {
  if (!compressorInstance) {
    compressorInstance = new ContextCompressor(authConfig);
  }
  return compressorInstance;
}
