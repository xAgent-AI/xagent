/**
 * GUI Agent for xagent
 * Orchestrates desktop automation with AI-powered action execution
 * Based on UI-TARS architecture with computer control only
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
import { colors } from '../../theme.js';

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
const MAX_STEP_RETRIES = 3; // Max retries for a single action step before giving up
const IMAGE_PLACEHOLDER = '{{IMG_PLACEHOLDER_0}}';

export class GUIAgent<T extends Operator> {
  private operator: T;
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
    return `You are a GUI AGENT. You control the computer through GUI actions only.

## CRITICAL: THIS IS A GUI AUTOMATION TASK
- You MUST use GUI actions to complete tasks
- NEVER use command line, bash, code execution, or any non-GUI methods
- If you think about using commands like "cd", "ls", "dir", "type", "cat", etc. - STOP! You must use GUI actions instead

## Task Types and How to Handle:

### 1. File/Folder Operations (e.g., "打开我的电脑进入下载目录")
- Find and double-click file explorer/computer icon on desktop or taskbar
- Navigate through folders using double-click
- Example: "打开我的电脑进入下载目录"
  - Step 1: Find "此电脑" (This PC) or "我的电脑" icon → double_click
  - Step 2: Find and double-click the drive containing Downloads (usually C:)
  - Step 3: Double-click "Downloads" folder

### 2. Open Application (e.g., "打开微信", "打开记事本")
- Find the application icon on desktop, start menu, or taskbar
- Use double_click to launch the application

### 3. Open Website (e.g., "打开百度", "访问 https://google.com")
- Use the "open_url" action with the URL
- The system will automatically open your default browser and navigate to the URL
- Example: open_url(url='https://www.baidu.com')
- Do NOT try to click browser icons or use keyboard shortcuts

### 4. Type Text (e.g., "在搜索框输入 hello")
- Click on the input field first
- Then use type action to input text

## Output Format
\`
Thought: ... (in user's language, plan your next action)
Action: ...
\`

## Action Space
click(start_box='[x1, y1, x2, y2]') # Single click
left_double(start_box='[x1, y1, x2, y2]') # Double click to open
right_single(start_box='[x1, y1, x2, y2]') # Right click
drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]') # Drag
hotkey(key='') # e.g., 'ctrl c', 'alt tab' (max 3 keys)
type(content='') # Use "\\n" at the end to submit
scroll(start_box='[x1, y1, x2, y2]', direction='down or up or right or left')
open_url(url='https://xxx') # Open website in default browser
wait() # Sleep 5s and take screenshot
finished() # Task completed
call_user() # Need user's help

## Note
- Use the same language as user's instruction in Thought section
- Always describe what element you're targeting in Thought
- Double-click is used for opening files/folders/applications
- Single click is used for selecting or focusing

`;
  }



  async initialize(): Promise<void> {
    await this.operator.doInitialize();
  }

  /**
   * Run the GUI agent with a single instruction (UI-TARS style)
   * All operations are determined by the GUI model
   */
  async run(instruction: string): Promise<GUIAgentData> {
    const data: GUIAgentData = {
      status: GUIAgentStatus.INIT,
      conversations: [
        {
          from: 'human',
          value: instruction,
          timing: {
            start: Date.now(),
            end: Date.now(),
            cost: 0,
          },
        },
      ],
    };

    // Initialize operator for initial screenshot
    try {
      await this.operator.doInitialize();
    } catch (initError) {
      const errorMsg = initError instanceof Error ? initError.message : 'Unknown error';
      this.logger.error(`[GUIAgent] Failed to initialize operator: ${errorMsg}`);

      // Check if it's an RDP-related issue
      if (errorMsg.includes('screen') || errorMsg.includes('capture') || errorMsg.includes('display')) {
        data.status = GUIAgentStatus.ERROR;
        data.error = 'Failed to initialize screen capture. This may be caused by:\n' +
          '  1. Remote Desktop session disconnected or minimized\n' +
          '  2. Display driver issues\n' +
          'Suggestion: Ensure your display is active and try again.';
      } else {
        data.status = GUIAgentStatus.ERROR;
        data.error = `Failed to initialize operator: ${errorMsg}`;
      }
      return data;
    }

    const currentTime = Date.now();

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
          data.error = 'Screenshot failed too many times. Stopping task.';
          break;
        }

        loopCnt += 1;
        const start = Date.now();

        // Take screenshot (single attempt - no retry to avoid infinite loops)
        let snapshot: ScreenshotOutput;
        try {
          snapshot = await this.operator.doScreenshot();
        } catch (screenshotError) {
          const errorMsg = screenshotError instanceof Error ? screenshotError.message : 'Unknown error';
          this.logger.warn(`[GUIAgent] Screenshot exception: ${errorMsg}`);
          snapshotErrCnt += 1;
          data.status = GUIAgentStatus.ERROR;
          data.error = `Screenshot failed ${snapshotErrCnt} times. Stopping task.`;
          this.logger.error(`[GUIAgent] ${data.error}`);
          await sleep(1000);
          break;
        }

        // Check if screenshot returned failure status
        if (snapshot.status === 'failed') {
          const errorMsg = snapshot.errorMessage || 'Unknown error';
          this.logger.warn(`[GUIAgent] Screenshot failed: ${errorMsg}`);
          snapshotErrCnt += 1;
          data.status = GUIAgentStatus.ERROR;
          data.error = `Screenshot failed ${snapshotErrCnt} times. Stopping task.`;
          this.logger.error(`[GUIAgent] ${data.error}`);
          await sleep(1000);
          break;
        }

        // Check abort immediately after screenshot
        if (this.signal?.aborted) {
          data.status = GUIAgentStatus.USER_STOPPED;
          break;
        }

        // Validate screenshot
        const isValidImage = !!(snapshot?.base64);
        if (!isValidImage) {
          snapshotErrCnt += 1;
          data.status = GUIAgentStatus.ERROR;
          data.error = `Screenshot failed ${snapshotErrCnt} times. Stopping task.`;
          this.logger.error(`[GUIAgent] ${data.error}`);
          await sleep(1000);
          break;
        }

        // Reset error counter on successful screenshot
        snapshotErrCnt = 0;

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

        // Check abort before model call
        if (this.signal?.aborted) {
          data.status = GUIAgentStatus.USER_STOPPED;
          break;
        }

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
          // Handle multimodal model API errors with specific error messages
          data.status = GUIAgentStatus.ERROR;
          const errorMsg = modelError instanceof Error ? modelError.message : String(modelError);

          // Provide specific error message based on error type
          if (errorMsg.includes('401') || errorMsg.includes('authentication') || errorMsg.includes('API key') || errorMsg.includes('api_key') || errorMsg.includes('Unauthorized') || errorMsg.includes('invalid_api_key')) {
            data.error = '[Multimodal Model Authentication Failed] The guiSubagentApiKey configuration is invalid.\n' +
              'Error details: HTTP 401 - API key is invalid or expired\n' +
              'Suggested action: Please check the guiSubagentApiKey configuration in ~/.xagent/settings.json and ensure a valid API key is set';
          } else if (errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('too many requests')) {
            data.error = '[Multimodal Model Rate Limit Exceeded] API requests exceed rate limit.\n' +
              'Error details: HTTP 429 - Too Many Requests\n' +
              'Suggested action: Please retry later, or check your API account quota settings. Wait a few minutes before retrying';
          } else if (errorMsg.includes('network') || errorMsg.includes('fetch') || errorMsg.includes('connection') || errorMsg.includes('ECONNREFUSED')) {
            data.error = '[Multimodal Model Network Error] Cannot connect to API service.\n' +
              'Error details: Network connection failed. Possible causes:\n' +
              '  1. Network connection is lost\n' +
              '  2. The guiSubagentBaseUrl configuration is incorrect\n' +
              '  3. API service endpoint is unreachable\n' +
              'Suggested action: Please check the guiSubagentBaseUrl configuration in ~/.xagent/settings.json and ensure network connectivity';
          } else if (errorMsg.includes('404') || errorMsg.includes('not found') || errorMsg.includes('model not found') || errorMsg.includes('InvalidEndpointOrModel.NotFound')) {
            // Extract model name
            const modelMatch = errorMsg.match(/model[:\s]+([^\s,"]+)|"model[:"]+([^",}]+)/i);
            const modelName = modelMatch ? (modelMatch[1] || modelMatch[2]) : 'Unknown';
            data.error = '[Multimodal Model Configuration Error] The model specified in guiSubagentModel does not exist or is not accessible.\n' +
              'Error details: HTTP 404 - Model or Endpoint not found\n' +
              'Configured model name: ' + modelName + '\n' +
              'Suggested action: Please check the guiSubagentModel configuration in ~/.xagent/settings.json, remove or replace with a valid model name';
          } else {
            data.error = '[Multimodal Model API Call Failed]\n' +
              'Error details: ' + errorMsg + '\n' +
              'Please check the following configuration items:\n' +
              '  - guiSubagentApiKey: API key\n' +
              '  - guiSubagentBaseUrl: API service URL\n' +
              '  - guiSubagentModel: Model name\n' +
              'Config file location: ~/.xagent/settings.json';
          }
          break;
        }

        // Check abort immediately after model call
        if (this.signal?.aborted) {
          data.status = GUIAgentStatus.USER_STOPPED;
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

        // Check if we need to switch operator based on first action
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
            let stepRetryCount = 0;
            let stepSuccess = false;
            let lastErrorMsg = '';

            this.logger.info(`[GUIAgent] Executing action: ${actionType}, loopCnt: ${loopCnt}`);

            while (stepRetryCount < MAX_STEP_RETRIES && !stepSuccess) {
              try {
                const executeResult = await this.operator.doExecute({
                  prediction,
                  parsedPrediction,
                  screenWidth: screenContext.width,
                  screenHeight: screenContext.height,
                  scaleFactor: snapshot.scaleFactor ?? screenContext.scaleFactor,
                  factors: [1000, 1000], // Default factors
                });

                if (executeResult.status === 'end') {
                  // 'finished' action or explicit end
                  stepSuccess = true;
                  break;
                }

                // Any other status (success, failed, etc.) is considered success
                stepSuccess = true;
                break;
              } catch (executeError) {
                stepRetryCount++;
                lastErrorMsg = executeError instanceof Error ? executeError.message : 'Unknown error';
                this.logger.warn(`[GUIAgent] Action failed ${stepRetryCount}/${MAX_STEP_RETRIES}: ${lastErrorMsg}`);

                if (stepRetryCount < MAX_STEP_RETRIES) {
                  await sleep(1000);
                  // Take new screenshot for retry
                  const retrySnapshot = await this.operator.doScreenshot();
                  if (retrySnapshot?.base64) {
                    data.conversations.push({
                      from: 'human',
                      value: IMAGE_PLACEHOLDER,
                      screenshotBase64: retrySnapshot.base64,
                      screenshotContext: {
                        size: {
                          width: screenContext.width,
                          height: screenContext.height,
                        },
                        scaleFactor: retrySnapshot.scaleFactor ?? screenContext.scaleFactor,
                      },
                    });
                  }
                }
              }
            }

            if (!stepSuccess) {
              // All retries exhausted
              this.logger.error(`[GUIAgent] Action failed after ${MAX_STEP_RETRIES} attempts: ${lastErrorMsg}`);
              data.status = GUIAgentStatus.ERROR;
              data.error = `Action failed after ${MAX_STEP_RETRIES} attempts: ${lastErrorMsg}`;
              break;
            }
          }

          // Check abort immediately after action execution
          if (this.signal?.aborted) {
            data.status = GUIAgentStatus.USER_STOPPED;
            break;
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

        // Check abort after action loop
        if (this.signal?.aborted) {
          data.status = GUIAgentStatus.USER_STOPPED;
          break;
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
      // Save final status
      const finalStatus = data.status;
      const finalError = data.error;

      // Output error immediately if task failed
      if (finalStatus === GUIAgentStatus.ERROR && finalError) {
        console.log(`\n${colors.error('✖')} ${finalError}\n`);
      }

      // Call onData callback if set
      // Note: Use Promise.resolve().then() to avoid modifying data in callback
      const onDataCallback = this.onData;
      if (onDataCallback) {
        Promise.resolve().then(() => onDataCallback({ ...data, conversations: [] }));
      }

      // Call onError callback if status is error
      if (finalStatus === GUIAgentStatus.ERROR && this.onError) {
        this.onError(new Error(finalError || 'Unknown error occurred'));
      }

      if (this.showAIDebugInfo) {
        this.logger.info('[GUIAgent] Final status:', {
          status: finalStatus,
          loopCnt,
          totalConversations: data.conversations.length,
        });
      }

      // Ensure the returned status is correct (reassign)
      this.logger.info(`[GUIAgent] Finally: finalStatus=${finalStatus}, finalError=${finalError}, data.status=${data.status}, data.error=${data.error}`);
      console.log(`\n${colors.error('✖')} ${finalError}\n`);
      data.status = finalStatus;
      data.error = finalError;
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

      

          let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: this.signal,
      });
    } catch (fetchError) {
      throw fetchError;
    }

    // Handle non-200 responses
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Model API error: ${errorText}`);
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

    // Cleanup cancellation listener if attached
    const cancelHandler = (this as any)._cancelHandler;
    const cancellationManager = (this as any)._cancellationManager;
    if (cancelHandler && cancellationManager) {
      cancellationManager.off('cancelled', cancelHandler);
      (this as any)._cancelHandler = undefined;
      (this as any)._cancellationManager = undefined;
    }
  }
}

export { GUIAgentStatus as StatusEnum };

