#!/usr/bin/env node

/**
 * SDK Output Adapter
 * 
 * This module provides output formatting for SDK mode.
 * It converts CLI-style output into JSON format for programmatic consumption.
 */

import { ChatMessage, SessionInput, SessionOutput } from './types.js';

// GUI Agent types (re-exported for SDK usage)
export type GUIAgentStatus = 'init' | 'running' | 'paused' | 'end' | 'error' | 'user_stopped' | 'call_llm';

export interface GUIAgentOutput {
  type: 'status' | 'conversation' | 'action' | 'screenshot' | 'error' | 'complete';
  timestamp: number;
  data: Record<string, unknown>;
}

export interface GUIAgentConversation {
  from: 'human' | 'assistant';
  value: string;
  screenshotBase64?: string;
  screenshotContext?: {
    size: { width: number; height: number };
    mime?: string;
    scaleFactor: number;
  };
  actionType?: string;
  actionInputs?: Record<string, unknown>;
  timing?: {
    start: number;
    end: number;
    cost: number;
  };
  predictionParsed?: Array<{
    action_type: string;
    [key: string]: unknown;
  }>;
}

export interface GUIAgentHandler {
  (output: GUIAgentOutput): void;
}

export interface SdkOutputMessage {
  type: 'output' | 'input' | 'system' | 'tool' | 'error' | 'thinking' | 'result';
  subtype?: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface SdkStreamEvent {
  event_type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export type OutputHandler = (message: SdkOutputMessage) => void;

export class SdkOutputAdapter {
  private outputHandler: OutputHandler;
  private indentLevel: number;

  constructor(outputHandler?: OutputHandler) {
    this.outputHandler = outputHandler || ((msg) => {
      process.stdout.write(JSON.stringify(msg) + '\n');
    });
    this.indentLevel = 0;
  }

  /**
   * Set indent level for output formatting.
   */
  setIndentLevel(level: number): void {
    this.indentLevel = level;
  }

  /**
   * Get current indent string.
   */
  getIndent(): string {
    return ' '.repeat(this.indentLevel);
  }

  /**
   * Format and output a welcome message.
   */
  outputWelcome(language: 'zh' | 'en', executionMode: string): void {
    const messages = {
      zh: {
        title: '🤖 XAGENT CLI',
        version: 'v1.0.0',
        subtitle: 'AI-powered command-line assistant',
        modeLabel: '当前模式',
        modeDescription: '智能审批与安全检查',
        help: '输入 /help 查看可用命令'
      },
      en: {
        title: '🤖 XAGENT CLI',
        version: 'v1.0.0',
        subtitle: 'AI-powered command-line assistant',
        modeLabel: 'Current Mode',
        modeDescription: 'Smart approval with intelligent security checks',
        help: 'Type /help to see available commands'
      }
    };

    const msg = messages[language];
    const config = this.getModeConfig(executionMode);

    this.output({
      type: 'system',
      subtype: 'welcome',
      timestamp: Date.now(),
      data: {
        title: msg.title,
        version: msg.version,
        subtitle: msg.subtitle,
        mode: {
          name: executionMode,
          icon: config.icon,
          description: msg.modeDescription
        },
        help: msg.help
      }
    });
  }

  /**
   * Format and output ready signal.
   * This is sent when the CLI is fully initialized and ready to accept requests.
   */
  outputReady(): void {
    this.output({
      type: 'system',
      subtype: 'ready',
      timestamp: Date.now(),
      data: {
        status: 'initialized',
        message: 'CLI is ready to accept requests'
      }
    });
  }

  /**
   * Format and output request done signal.
   * This is sent when a user request has been fully processed.
   */
  outputRequestDone(requestId: string, status: 'success' | 'cancelled' | 'error' = 'success'): void {
    this.output({
      type: 'result',
      subtype: 'request_done',
      timestamp: Date.now(),
      data: {
        requestId,
        status,
        message: status === 'success' ? 'Request completed successfully' : `Request ${status}`
      }
    });
  }

  /**
   * Format and output AI response.
   */
  outputAssistant(content: string, reasoningContent?: string): void {
    this.output({
      type: 'output',
      subtype: 'assistant',
      timestamp: Date.now(),
      data: {
        content,
        reasoningContent
      }
    });
  }

  /**
   * Format and output tool execution.
   */
  outputToolStart(toolName: string, params: Record<string, unknown>): void {
    this.output({
      type: 'tool',
      subtype: 'start',
      timestamp: Date.now(),
      data: {
        tool: toolName,
        params,
        status: 'running'
      }
    });
  }

  /**
   * Format and output tool result.
   */
  outputToolResult(toolName: string, result: unknown, duration?: number): void {
    this.output({
      type: 'tool',
      subtype: 'result',
      timestamp: Date.now(),
      data: {
        tool: toolName,
        result,
        duration,
        status: 'completed'
      }
    });
  }

  /**
   * Format and output tool error.
   */
  outputToolError(toolName: string, error: string): void {
    this.output({
      type: 'tool',
      subtype: 'error',
      timestamp: Date.now(),
      data: {
        tool: toolName,
        error,
        status: 'error'
      }
    });
  }

  /**
   * Format and output thinking content.
   */
  outputThinking(reasoningContent: string, displayMode: string = 'compact'): void {
    const maxLength = displayMode === 'full' ? undefined : 500;
    const truncated = maxLength && reasoningContent.length > maxLength;
    const displayContent = truncated ? reasoningContent.substring(0, maxLength) + '... (truncated)' : reasoningContent;

    this.output({
      type: 'thinking',
      subtype: displayMode,
      timestamp: Date.now(),
      data: {
        content: displayContent,
        originalLength: reasoningContent.length,
        truncated,
        displayMode
      }
    });
  }

  /**
   * Format and output system message.
   */
  outputSystem(subtype: string, data: Record<string, unknown>): void {
    this.output({
      type: 'system',
      subtype,
      timestamp: Date.now(),
      data
    });
  }

  /**
   * Format and output MCP loading status.
   */
  outputMCPLoading(count: number): void {
    this.output({
      type: 'system',
      subtype: 'mcp_loading',
      timestamp: Date.now(),
      data: { count }
    });
  }

  /**
   * Format and output MCP server registering status.
   */
  outputMCPRegistering(name: string, transport: string): void {
    this.output({
      type: 'system',
      subtype: 'mcp_registering',
      timestamp: Date.now(),
      data: { name, transport }
    });
  }

  /**
   * Format and output MCP connecting status.
   */
  outputMCPConnecting(count: number): void {
    this.output({
      type: 'system',
      subtype: 'mcp_connecting',
      timestamp: Date.now(),
      data: { count }
    });
  }

  /**
   * Format and output MCP connected result.
   */
  outputMCPConnected(total: number, connected: number, toolsAvailable: number): void {
    this.output({
      type: 'system',
      subtype: 'mcp_connected',
      timestamp: Date.now(),
      data: { total, connected, toolsAvailable }
    });
  }

  /**
   * Format and output MCP connection failed warning.
   */
  outputMCPConnectionFailed(message: string): void {
    this.output({
      type: 'system',
      subtype: 'mcp_connection_failed',
      timestamp: Date.now(),
      data: { message }
    });
  }

  /**
   * Format and output error message.
   */
  outputError(message: string, context?: Record<string, unknown>): void {
    this.output({
      type: 'error',
      subtype: 'general',
      timestamp: Date.now(),
      data: {
        message,
        ...context
      }
    });
  }

  /**
   * Format and output warning message.
   */
  outputWarning(message: string): void {
    this.output({
      type: 'system',
      subtype: 'warning',
      timestamp: Date.now(),
      data: { message }
    });
  }

  /**
   * Format and output success message.
   */
  outputSuccess(message: string): void {
    this.output({
      type: 'system',
      subtype: 'success',
      timestamp: Date.now(),
      data: { message }
    });
  }

  /**
   * Format and output info message.
   */
  outputInfo(message: string): void {
    this.output({
      type: 'system',
      subtype: 'info',
      timestamp: Date.now(),
      data: { message }
    });
  }

  /**
   * Format and output context compression notification.
   */
  outputContextCompression(reason: string, originalSize: number, compressedSize: number, reductionPercent: number): void {
    this.output({
      type: 'system',
      subtype: 'context_compression',
      timestamp: Date.now(),
      data: {
        reason,
        originalSize,
        compressedSize,
        reductionPercent
      }
    });
  }

  /**
   * Format and output context compression triggered.
   */
  outputContextCompressionTriggered(reason: string): void {
    this.output({
      type: 'system',
      subtype: 'context_compression_triggered',
      timestamp: Date.now(),
      data: { reason }
    });
  }

  /**
   * Format and output context compression result.
   */
  outputContextCompressionResult(
    originalSize: number,
    compressedSize: number,
    reductionPercent: number,
    originalMessageCount: number,
    compressedMessageCount: number
  ): void {
    this.output({
      type: 'system',
      subtype: 'context_compression_result',
      timestamp: Date.now(),
      data: {
        originalSize,
        compressedSize,
        reductionPercent,
        originalMessageCount,
        compressedMessageCount
      }
    });
  }

  /**
   * Format and output context compression summary.
   */
  outputContextCompressionSummary(
    summary: string,
    preview: string,
    isTruncated: boolean,
    totalLength: number
  ): void {
    this.output({
      type: 'system',
      subtype: 'context_compression_summary',
      timestamp: Date.now(),
      data: {
        summary,
        preview,
        isTruncated,
        totalLength
      }
    });
  }

  /**
   * Format and output session result.
   */
  outputResult(duration: number, numTurns: number, status: 'completed' | 'cancelled' | 'error'): void {
    this.output({
      type: 'result',
      timestamp: Date.now(),
      data: {
        duration_ms: duration,
        num_turns: numTurns,
        status
      }
    });
  }

  /**
   * Format and output progress/spinner.
   */
  outputProgress(text: string, status: 'start' | 'succeed' | 'fail' | 'update'): void {
    this.output({
      type: 'system',
      subtype: 'progress',
      timestamp: Date.now(),
      data: {
        text,
        status
      }
    });
  }

  /**
   * Format and output agent switch.
   */
  outputAgentSwitch(agentName: string, agentDescription?: string): void {
    this.output({
      type: 'system',
      subtype: 'agent_switch',
      timestamp: Date.now(),
      data: {
        agent: agentName,
        description: agentDescription
      }
    });
  }

  /**
   * Format and output command execution.
   */
  outputCommand(command: string, status: 'running' | 'completed' | 'error'): void {
    this.output({
      type: 'tool',
      subtype: 'command',
      timestamp: Date.now(),
      data: {
        command,
        status
      }
    });
  }

  // ==================== GUI Agent Output Methods ====================

  /**
   * Format and output GUI agent start.
   */
  outputGUIAgentStart(description: string, mode: 'local' | 'remote'): void {
    this.output({
      type: 'system',
      subtype: 'gui_agent_start',
      timestamp: Date.now(),
      data: {
        description,
        mode
      }
    });
  }

  /**
   * Format and output GUI agent status update.
   */
  outputGUIAgentStatus(status: GUIAgentStatus, iteration?: number, error?: string): void {
    this.output({
      type: 'system',
      subtype: `gui_status_${status}`,
      timestamp: Date.now(),
      data: {
        status,
        iteration,
        error
      }
    });
  }

  /**
   * Format and output GUI agent action/step.
   */
  outputGUIAgentAction(iteration: number, actionType: string, cost?: number): void {
    this.output({
      type: 'output',
      subtype: 'gui_action',
      timestamp: Date.now(),
      data: {
        iteration,
        actionType,
        cost
      }
    });
  }

  /**
   * Format and output GUI agent conversation (screenshot).
   */
  outputGUIConversation(data: {
    iteration: number;
    from: 'human' | 'assistant';
    actionType?: string;
    indentLevel?: number;
    timing?: { start: number; end: number; cost: number };
  }): void {
    this.output({
      type: 'output',
      subtype: 'gui_conversation',
      timestamp: Date.now(),
      data
    });
  }

  /**
   * Format and output GUI agent completion.
   */
  outputGUIAgentComplete(description: string, iterations: number): void {
    this.output({
      type: 'system',
      subtype: 'gui_complete',
      timestamp: Date.now(),
      data: {
        description,
        iterations,
        message: `GUI task completed in ${iterations} iterations`
      }
    });
  }

  /**
   * Format and output GUI agent cancellation.
   */
  outputGUIAgentCancelled(description: string): void {
    this.output({
      type: 'system',
      subtype: 'gui_cancelled',
      timestamp: Date.now(),
      data: {
        description,
        message: 'GUI task cancelled by user'
      }
    });
  }

  /**
   * Format and output GUI agent error.
   */
  outputGUIAgentError(description: string, error: string): void {
    this.output({
      type: 'error',
      subtype: 'gui_error',
      timestamp: Date.now(),
      data: {
        description,
        error
      }
    });
  }

  /**
   * Create a GUI Agent output handler that maps GUIAgentOutput to SDK format.
   * This handler can be passed directly to GUIAgent.
   */
  createGUIAgentHandler(): GUIAgentHandler {
    return (output: GUIAgentOutput) => {
      switch (output.type) {
        case 'action':
          this.output({
            type: 'system',
            subtype: 'gui_action',
            timestamp: output.timestamp,
            data: output.data
          });
          break;
        case 'status':
          this.outputGUIAgentStatus(
            output.data.status as GUIAgentStatus,
            output.data.iteration as number | undefined,
            output.data.error as string | undefined
          );
          break;
        case 'conversation':
          this.outputGUIConversation({
            iteration: output.data.iteration as number,
            from: output.data.from as 'human' | 'assistant',
            actionType: output.data.actionType as string | undefined,
            indentLevel: output.data.indentLevel as number | undefined,
            timing: output.data.timing as { start: number; end: number; cost: number } | undefined
          });
          break;
        case 'complete':
          this.output({
            type: 'system',
            subtype: 'gui_complete',
            timestamp: output.timestamp,
            data: output.data
          });
          break;
        case 'error':
          this.output({
            type: 'error',
            subtype: 'gui_error',
            timestamp: output.timestamp,
            data: output.data
          });
          break;
        case 'screenshot':
          this.output({
            type: 'output',
            subtype: 'gui_screenshot',
            timestamp: output.timestamp,
            data: output.data
          });
          break;
      }
    };
  }

  /**
   * Output a raw message.
   */
  output(message: SdkOutputMessage): void {
    this.outputHandler(message);
  }

  /**
   * Get mode configuration.
   */
  private getModeConfig(mode: string): { color: string; icon: string; description: string } {
    const modeConfigs: Record<string, { color: string; icon: string; description: string }> = {
      yolo: {
        color: 'red',
        icon: '🔥',
        description: 'Execute commands without confirmation'
      },
      accept_edits: {
        color: 'yellow',
        icon: '✅',
        description: 'Accept all edits automatically'
      },
      plan: {
        color: 'blue',
        icon: '🧠',
        description: 'Plan before executing'
      },
      default: {
        color: 'green',
        icon: '⚡',
        description: 'Safe execution with confirmations'
      },
      smart: {
        color: 'cyan',
        icon: '✨',
        description: 'Smart approval with intelligent security checks'
      }
    };

    return modeConfigs[mode.toLowerCase()] || modeConfigs.default;
  }

  /**
   * Convert a SessionInput to SDK format.
   */
  static formatSessionInput(input: SessionInput): SdkOutputMessage {
    return {
      type: 'input',
      timestamp: input.timestamp,
      data: {
        inputType: input.type,
        content: input.content,
        rawInput: input.rawInput,
        filePath: input.filePath
      }
    };
  }

  /**
   * Convert a SessionOutput to SDK format.
   */
  static formatSessionOutput(output: SessionOutput): SdkOutputMessage {
    return {
      type: 'output',
      timestamp: output.timestamp,
      data: {
        role: output.role,
        content: output.content,
        toolName: output.toolName,
        toolParams: output.toolParams,
        toolResult: output.toolResult,
        duration: output.duration,
        reasoning_content: output.reasoning_content,
        tool_calls: output.tool_calls
      }
    };
  }
}
