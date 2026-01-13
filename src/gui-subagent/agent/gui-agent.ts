/**
 * GUI Agent for xagent
 * Orchestrates browser/desktop automation with AI-powered action execution
 * Based on UI-TARS architecture with support for both browser and computer control
 *
 * This implementation is aligned with packages/ui-tars/sdk/src/GUIAgent.ts
 */

import type {
  ScreenContext,
  ScreenshotOutput,
  ExecuteParams,
  ExecuteOutput,
  PredictionParsed,
} from '../types/operator.js';
import type { Operator } from '../operator/base-operator.js';
import { sleep, asyncRetry } from '../utils.js';
import { actionParser } from '../action-parser/index.js';

const GUI_TOOL_NAME = 'gui_operate';

// UI-TARS Status Enum
export enum GUIAgentStatus {
  INIT = 'init',
  RUNNING = 'running',
  PAUSE = 'paused',
  END = 'end',
  ERROR = 'error',
  USER_STOPPED = 'user_stopped',
  CALL_USER = 'call_user',
}

export interface GUIAgentConfig<T extends Operator> {
  operator: T;
  model?: string;
  modelBaseUrl?: string;
  modelApiKey?: string;
  systemPrompt?: string;
  loopIntervalInMs?: number;
  maxLoopCount?: number;
  logger?: Console;
  signal?: AbortSignal;
  onData?: (data: GUIAgentData) => void;
  onError?: (error: Error) => void;
  showAIDebugInfo?: boolean;
  retry?: {
    screenshot?: {
      maxRetries?: number;
      onRetry?: (e: Error) => void;
    };
    model?: {
      maxRetries?: number;
      onRetry?: (e: Error) => void;
    };
    execute?: {
      maxRetries?: number;
      onRetry?: (e: Error) => void;
    };
  };
}

export interface GUIAgentData {
  status: GUIAgentStatus;
  conversations: Conversation[];
  error?: string;
  systemPrompt?: string;
}

export interface Conversation {
  from: 'human' | 'assistant';
  value: string;
  screenshotBase64?: string;
  screenshotContext?: {
    size: { width: number; height: number };
    mime?: string;
    scaleFactor: number;
  };
  actionType?: string;
  actionInputs?: Record<string, any>;
  timing?: {
    start: number;
    end: number;
    cost: number;
  };
  predictionParsed?: PredictionParsed[];
}

// UI-TARS constants (aligned with @ui-tars/shared/constants)
const MAX_LOOP_COUNT = 100;
const MAX_SNAPSHOT_ERR_CNT = 5;
const IMAGE_PLACEHOLDER = '{{IMG_PLACEHOLDER_0}}';

export class GUIAgent<T extends Operator> {
  private readonly operator: T;
  private readonly model: string;
  private readonly modelBaseUrl: string;
  private readonly modelApiKey: string;
  private readonly systemPrompt: string;
  private readonly loopIntervalInMs: number;
  private readonly maxLoopCount: number;
  private readonly logger: Console;
  private readonly signal?: AbortSignal;
  private readonly onData?: (data: GUIAgentData) => void;
  private readonly onError?: (error: Error) => void;
  private readonly showAIDebugInfo: boolean;
  private readonly retry?: GUIAgentConfig<T>['retry'];

  private isPaused = false;
  private resumePromise: Promise<void> | null = null;
  private resolveResume: (() => void) | null = null;
  private isStopped = false;

  constructor(config: GUIAgentConfig<T>) {
    this.operator = config.operator;
    this.model = config.model || '';
    this.modelBaseUrl = config.modelBaseUrl || '';
    this.modelApiKey = config.modelApiKey || '';
    this.loopIntervalInMs = config.loopIntervalInMs || 0;
    this.maxLoopCount = config.maxLoopCount || MAX_LOOP_COUNT;
    this.logger = config.logger || console;
    this.signal = config.signal;
    this.onData = config.onData;
    this.onError = config.onError;
    this.showAIDebugInfo = config.showAIDebugInfo ?? false;
    this.retry = config.retry;

    this.systemPrompt = config.systemPrompt || this.buildSystemPrompt();
  }

  private buildSystemPrompt(): string {
    return `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
\`
Thought: ...
Action: ...
\`

## Action Space
click(point='<point>x1 y1</point>')
left_double(point='<point>x1 y1</point>')
right_single(point='<point>x1 y1</point>')
drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')
hotkey(key='ctrl c') # Split keys with a space and use lowercase. Also, do not use more than 3 keys in one hotkey action.
type(content='xxx') # Use escape characters \', \", and \n in content part to ensure we can parse the content in normal python string format. If you want to submit your input, use \n at the end of content. 
scroll(point='<point>x1 y1</point>', direction='down or up or right or left') # Show more information on the \`direction\` side.
wait() #Sleep for 5s and take a screenshot to check for any changes.
finished(content='xxx') # Use escape characters \', \", and \n in content part to ensure we can parse the content in normal python string format.

## Note
- Use {language} in \`Thought\` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in \`Thought\` part.

## User Instruction
{instruction}`;
  }



  async initialize(): Promise<void> {
    await this.operator.doInitialize();
  }

  /**
   * Run the GUI agent with a single instruction (UI-TARS style)
   * All operations are determined by the GUI model
   */
  async run(instruction: string): Promise<GUIAgentData> {
    await this.initialize();

    const currentTime = Date.now();
    const data: GUIAgentData = {
      status: GUIAgentStatus.INIT,
      conversations: [
        {
          from: 'human',
          value: instruction,
          timing: {
            start: currentTime,
            end: currentTime,
            cost: 0,
          },
        },
      ],
    };

    if (this.showAIDebugInfo) {
      this.logger.info('[GUIAgent] run:', {
        systemPrompt: this.systemPrompt,
        model: this.model,
        maxLoopCount: this.maxLoopCount,
      });
    }

    let loopCnt = 0;
    let snapshotErrCnt = 0;

    // Start running agent
    data.status = GUIAgentStatus.RUNNING;
    data.systemPrompt = this.systemPrompt;
    await this.onData?.({ ...data, conversations: [] });

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (this.showAIDebugInfo) {
          this.logger.info('[GUIAgent] loopCnt:', loopCnt);
        }

        // Check pause status
        if (this.isPaused && this.resumePromise) {
          data.status = GUIAgentStatus.PAUSE;
          await this.onData?.({ ...data, conversations: [] });
          await this.resumePromise;
          data.status = GUIAgentStatus.RUNNING;
          await this.onData?.({ ...data, conversations: [] });
        }

        // Check stop or aborted status
        if (
          this.isStopped ||
          data.status !== GUIAgentStatus.RUNNING ||
          this.signal?.aborted
        ) {
          if (this.signal?.aborted) {
            data.status = GUIAgentStatus.USER_STOPPED;
          }
          break;
        }

        // Check loop limit
        if (loopCnt >= this.maxLoopCount) {
          data.status = GUIAgentStatus.ERROR;
          data.error = `Has reached max loop count: ${loopCnt}`;
          break;
        }

        // Check screenshot error limit
        if (snapshotErrCnt >= MAX_SNAPSHOT_ERR_CNT) {
          data.status = GUIAgentStatus.ERROR;
          data.error = 'Too many screenshot failures';
          break;
        }

        loopCnt += 1;
        const start = Date.now();

        // Take screenshot with retry
        let snapshot: ScreenshotOutput;
        try {
          snapshot = await asyncRetry(
            () => this.operator.doScreenshot(),
            {
              retries: this.retry?.screenshot?.maxRetries ?? 0,
              minTimeout: 5000,
              onRetry: this.retry?.screenshot?.onRetry,
            }
          );
        } catch (screenshotError) {
          this.logger.error('[GUIAgent] screenshot error', screenshotError);
          loopCnt -= 1;
          snapshotErrCnt += 1;
          await sleep(1000);
          continue;
        }

        // Validate screenshot
        const isValidImage = !!(snapshot?.base64);
        if (!isValidImage) {
          loopCnt -= 1;
          snapshotErrCnt += 1;
          await sleep(1000);
          continue;
        }

        const end = Date.now();

        // Get screen context
        const screenContext = await this.operator.getScreenContext();

        // Add screenshot to conversation
        data.conversations.push({
          from: 'human',
          value: IMAGE_PLACEHOLDER,
          screenshotBase64: snapshot.base64,
          screenshotContext: {
            size: {
              width: screenContext.width,
              height: screenContext.height,
            },
            scaleFactor: snapshot.scaleFactor ?? screenContext.scaleFactor,
          },
          timing: {
            start,
            end,
            cost: end - start,
          },
        });

        await this.onData?.({
          ...data,
          conversations: data.conversations.slice(-1),
        });

        // Build messages for model
        const messages = this.buildModelMessages(data.conversations, data.systemPrompt);

        // Invoke model with retry
        let prediction: string;
        let parsedPredictions: PredictionParsed[];
        try {
          const modelResult: { prediction: string; parsedPredictions: PredictionParsed[] } = await asyncRetry(
            async (bail) => {
              try {
                const result = await this.callModelAPI(messages, screenContext);
                return result;
              } catch (error: unknown) {
                if (
                  error instanceof Error &&
                  (error.name === 'AbortError' ||
                    error.message?.includes('aborted'))
                ) {
                  bail(error as Error);
                  return { prediction: '', parsedPredictions: [] };
                }
                throw error;
              }
            },
            {
              retries: this.retry?.model?.maxRetries ?? 0,
              minTimeout: 1000 * 30,
              onRetry: this.retry?.model?.onRetry,
            }
          );
          prediction = modelResult.prediction;
          parsedPredictions = modelResult.parsedPredictions;
        } catch (modelError) {
          // Silently handle model errors - will be caught by upstream
          data.status = GUIAgentStatus.ERROR;
          data.error = 'Model invocation failed: ' + (modelError instanceof Error ? modelError.message : String(modelError));
          break;
        }

        if (!prediction) {
          this.logger.error('[GUIAgent] Response Empty:', prediction);
          continue;
        }

        if (this.showAIDebugInfo) {
          this.logger.info('[GUIAgent] Response:', prediction);
          this.logger.info('[GUIAgent] Parsed Predictions:', JSON.stringify(parsedPredictions));
        }

        const predictionSummary = this.getSummary(prediction);

        data.conversations.push({
          from: 'assistant',
          value: predictionSummary,
          timing: {
            start,
            end: Date.now(),
            cost: Date.now() - start,
          },
          screenshotContext: {
            size: {
              width: screenContext.width,
              height: screenContext.height,
            },
            scaleFactor: snapshot.scaleFactor ?? screenContext.scaleFactor,
          },
          predictionParsed: parsedPredictions,
        });

        await this.onData?.({
          ...data,
          conversations: data.conversations.slice(-1),
        });

        // Execute actions
        for (const parsedPrediction of parsedPredictions) {
          const actionType = parsedPrediction.action_type;

          if (this.showAIDebugInfo) {
            this.logger.info('[GUIAgent] Action:', actionType);
          }

          // Handle internal action spaces
          if (actionType === 'error_env') {
            data.status = GUIAgentStatus.ERROR;
            data.error = 'Environment error';
            break;
          } else if (actionType === 'max_loop') {
            data.status = GUIAgentStatus.ERROR;
            data.error = 'Reached max loop';
            break;
          }

          // Execute action with retry
          if (!this.signal?.aborted && !this.isStopped) {
            try {
              await asyncRetry(
                () =>
                  this.operator.doExecute({
                    prediction,
                    parsedPrediction,
                    screenWidth: screenContext.width,
                    screenHeight: screenContext.height,
                    scaleFactor: snapshot.scaleFactor ?? screenContext.scaleFactor,
                    factors: [1000, 1000], // Default factors
                  }),
                {
                  retries: this.retry?.execute?.maxRetries ?? 0,
                  minTimeout: 5000,
                  onRetry: this.retry?.execute?.onRetry,
                }
              );
            } catch (executeError) {
              this.logger.error('[GUIAgent] execute error', executeError);
              data.status = GUIAgentStatus.ERROR;
              data.error = 'Action execution failed';
              break;
            }
          }

          // Handle special action types
          if (actionType === 'call_user') {
            data.status = GUIAgentStatus.CALL_USER;
            break;
          } else if (actionType === 'finished') {
            data.status = GUIAgentStatus.END;
            break;
          }
        }

        // Wait between iterations
        if (this.loopIntervalInMs > 0) {
          await sleep(this.loopIntervalInMs);
        }
      }
    } catch (error) {
      this.logger.error('[GUIAgent] Catch error', error);
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.message?.includes('aborted'))
      ) {
        data.status = GUIAgentStatus.USER_STOPPED;
      } else {
        data.status = GUIAgentStatus.ERROR;
        data.error = error instanceof Error ? error.message : 'Unknown error';
      }
    } finally {
      await this.onData?.({ ...data, conversations: [] });

      if (data.status === GUIAgentStatus.ERROR) {
        this.onError?.(
          new Error(data.error || 'Unknown error occurred')
        );
      }

      if (this.showAIDebugInfo) {
        this.logger.info('[GUIAgent] Final status:', {
          status: data.status,
          loopCnt,
          totalConversations: data.conversations.length,
        });
      }
    }

    return data;
  }

  /**
   * Build messages for the model API
   */
  private buildModelMessages(conversations: Conversation[], systemPrompt: string): any[] {
    const messages: any[] = [];

    // System prompt
    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    // Add conversation history
    for (const conv of conversations) {
      if (conv.from === 'human' && conv.screenshotBase64) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: conv.value },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${conv.screenshotBase64}`,
                detail: 'high',
              },
            },
          ],
        });
      } else if (conv.from === 'assistant') {
        messages.push({
          role: 'assistant',
          content: conv.value,
        });
      } else {
        messages.push({
          role: 'user',
          content: conv.value,
        });
      }
    }

    return messages;
  }

  /**
   * Call the model API with debug logging
   */
  private async callModelAPI(
    messages: any[],
    screenContext: ScreenContext
  ): Promise<{ prediction: string; parsedPredictions: PredictionParsed[] }> {
    const baseUrl = this.modelBaseUrl || process.env.MODEL_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = this.modelApiKey || process.env.MODEL_API_KEY || '';

    const requestBody = {
      model: this.model,
      messages,
      max_tokens: 1024,
      temperature: 0.1,
    };

    // Debug output for model input
    if (this.showAIDebugInfo) {
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║               GUI MODEL REQUEST DEBUG                   ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`📦 Model: ${this.model}`);
      console.log(`🌐 Base URL: ${baseUrl}`);
      console.log(`💬 Messages: ${messages.length}`);

      // Show system prompt if present
      const systemMsg = messages.find((m: any) => m.role === 'system');
      if (systemMsg) {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🟫 SYSTEM                                                     │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        const systemContent = typeof systemMsg.content === 'string'
          ? systemMsg.content
          : JSON.stringify(systemMsg.content);
        const lines = systemContent.split('\n').slice(0, 15);
        for (const line of lines) {
          console.log('│ ' + line.slice(0, 62));
        }
        if (systemContent.split('\n').length > 15) {
          console.log('│ ... (truncated)');
        }
        console.log('└─────────────────────────────────────────────────────────────┘');
      }

      // Show conversation messages
      const roleColors: Record<string, string> = {
        user: '👤 USER',
        assistant: '🤖 ASSISTANT',
      };

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === 'system') continue;

        const roleLabel = roleColors[msg.role] || `● ${msg.role.toUpperCase()}`;
        console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
        console.log(`│ ${roleLabel} (${i + 1})                                           │`);
        console.log('├─────────────────────────────────────────────────────────────┤');

        if (typeof msg.content === 'string') {
          const lines = msg.content.split('\n').slice(0, 20);
          for (const line of lines) {
            console.log('│ ' + line.slice(0, 62));
          }
          if (msg.content.split('\n').length > 20) {
            console.log('│ ... (truncated)');
          }
        } else if (Array.isArray(msg.content)) {
          const hasImage = msg.content.some((c: any) => c.type === 'image_url');
          console.log('│ 📎 Content blocks: ' + msg.content.length);
          if (hasImage) {
            const imageBlock = msg.content.find((c: any) => c.type === 'image_url');
            const imageSize = imageBlock?.image_url?.url?.length || 0;
            console.log('│ 🖼️  Image size: ' + (imageSize / 1024).toFixed(2) + ' KB');
          }
          const textBlock = msg.content.find((c: any) => c.type === 'text');
          if (textBlock?.text) {
            const lines = textBlock.text.split('\n').slice(0, 10);
            for (const line of lines) {
              console.log('│ ' + line.slice(0, 62));
            }
          }
        }
        console.log('└─────────────────────────────────────────────────────────────┘');
      }

      console.log('\n📤 Sending request to model API...\n');
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Model API error: ${error}`);
    }

    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: any };
    const content = result.choices?.[0]?.message?.content || '';

    // Debug output for model response
    if (this.showAIDebugInfo) {
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║               GUI MODEL RESPONSE DEBUG                  ║');
      console.log('╚══════════════════════════════════════════════════════════╝');

      if (result.usage) {
        console.log(`📊 Tokens: ${result.usage.prompt_tokens} (prompt) + ${result.usage.completion_tokens} (completion) = ${result.usage.total_tokens} (total)`);
      }

      console.log('\n┌─────────────────────────────────────────────────────────────┐');
      console.log('│ 🤖 ASSISTANT                                                 │');
      console.log('├─────────────────────────────────────────────────────────────┤');
      console.log('│ 💬 CONTENT:');
      console.log('│ ───────────────────────────────────────────────────────────');

      const lines = content.split('\n').slice(0, 30);
      for (const line of lines) {
        console.log('│ ' + line.slice(0, 62));
      }
      if (content.split('\n').length > 30) {
        console.log(`│ ... (${content.split('\n').length - 30} more lines)`);
      }
      console.log('│ ───────────────────────────────────────────────────────────');
      console.log('└─────────────────────────────────────────────────────────────┘');

      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║                    RESPONSE ENDED                        ║');
      console.log('╚══════════════════════════════════════════════════════════╝\n');
    }

    const { parsed: parsedPredictions } = actionParser({
      prediction: content,
      factor: [1000, 1000],
      screenContext: {
        width: screenContext.width,
        height: screenContext.height,
      },
    });

    return {
      prediction: content,
      parsedPredictions,
    };
  }

  /**
   * Get summary from prediction text
   */
  private getSummary(prediction: string): string {
    // Extract the action part as summary
    const actionMatch = prediction.match(/Action[:：]\s*([\s\S]+)$/i);
    if (actionMatch) {
      return actionMatch[1].trim();
    }
    return prediction.slice(0, 200);
  }

  pause(): void {
    this.isPaused = true;
    this.resumePromise = new Promise((resolve) => {
      this.resolveResume = resolve;
    });
  }

  resume(): void {
    if (this.resolveResume) {
      this.resolveResume();
      this.resumePromise = null;
      this.resolveResume = null;
    }
    this.isPaused = false;
  }

  stop(): void {
    this.isStopped = true;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up GUI Agent...');
    await this.operator.cleanup();
  }
}

export { GUIAgentStatus as StatusEnum };

