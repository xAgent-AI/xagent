#!/usr/bin/env node

/**
 * SDK Output Adapter
 * 
 * This module provides output formatting for SDK mode.
 * It converts CLI-style output into JSON format for programmatic consumption.
 */

import { ChatMessage, SessionInput, SessionOutput } from './types.js';

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
   * Format and output a prompt.
   */
  outputPrompt(): void {
    this.output({
      type: 'input',
      subtype: 'prompt',
      timestamp: Date.now(),
      data: {
        prompt: '❯ '
      }
    });
  }

  /**
   * Format and output user input.
   */
  outputUserInput(content: string): void {
    this.output({
      type: 'input',
      subtype: 'user',
      timestamp: Date.now(),
      data: { content }
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
        reasoningContent: output.reasoningContent,
        toolCalls: output.toolCalls
      }
    };
  }
}
