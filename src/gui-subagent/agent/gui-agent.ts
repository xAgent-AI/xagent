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
  PredictionParsed,
} from '../types/operator.js';
import type { Operator } from '../operator/base-operator.js';
import { sleep, asyncRetry } from '../utils.js';
import { actionParser } from '../action-parser/index.js';
import { colors, icons} from '../../theme.js';
import { getLogger } from '../../logger.js';

/**
 * Helper function to truncate long text
 */
function _truncateText(text: string, maxLength: number = 200): string {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

/**
 * Helper function to indent multiline text
 */
function _indentMultiline(text: string, indent: string): string {
  return text.split('\n').map(line => indent + line).join('\n');
}

const guiLogger = getLogger();

// UI-TARS Status Enum
export enum GUIAgentStatus {
  INIT = 'init',
  RUNNING = 'running',
  PAUSE = 'paused',
  END = 'end',
  ERROR = 'error',
  USER_STOPPED = 'user_stopped',
  CALL_LLM = 'call_llm',
}

/**
 * Remote VLM Caller callback function type
 * Inject this function externally to handle VLM calls, GUI Agent doesn't need to know VLM implementation details
 * Receives full messages array (same as local mode) for consistent behavior
 * @param messages - Full messages array
 * @param systemPrompt - System prompt (for reference)
 * @param taskId - Task identifier for backend tracking
 * @param isFirstVlmCallRef - Reference object to track and update first VLM call state
 */
export type RemoteVlmCaller = (messages: any[], systemPrompt: string, taskId: string, isFirstVlmCallRef: { current: boolean }) => Promise<string>;

export interface GUIAgentConfig<T extends Operator> {
  operator: T;
  model?: string;
  modelBaseUrl?: string;
  modelApiKey?: string;
  /**
   * Task identifier for VLM state tracking (begin vs continue)
   */
  taskId?: string;
  /**
   * Shared ref object to track first VLM call across createGUISubAgent calls
   * Must be passed from outside to properly track VLM status across loop iterations
   */
  isFirstVlmCallRef?: { current: boolean };
  /**
   * Externally injected VLM caller function
   * If this function is provided, GUI Agent will use it to call VLM
   * instead of directly calling modelBaseUrl/modelApiKey
   * This allows GUI Agent to work with remote services without exposing any configuration
   */
  remoteVlmCaller?: RemoteVlmCaller;
  /**
   * Whether to use local mode
   * If true, use model/modelBaseUrl/modelApiKey for VLM calls
   * If false, use remoteVlmCaller for remote VLM calls
   */
  isLocalMode: boolean;
  systemPrompt?: string;
  loopIntervalInMs?: number;
  maxLoopCount?: number;
  logger?: any;
  signal?: AbortSignal;
  onData?: (data: GUIAgentData) => void;
  onError?: (error: Error) => void;
  showAIDebugInfo?: boolean;
  /**
   * SDK mode output handler
   * If provided, GUI Agent will output in SDK format instead of console.log
   */
  sdkOutputHandler?: (output: GUIAgentOutput) => void;
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

/**
 * SDK output format for GUI Agent
 */
export interface GUIAgentOutput {
  type: 'status' | 'conversation' | 'action' | 'screenshot' | 'error' | 'complete';
  timestamp: number;
  data: Record<string, unknown>;
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
  private readonly taskId: string;
  private readonly isFirstVlmCallRef?: { current: boolean };
  private readonly remoteVlmCaller?: RemoteVlmCaller;
  private readonly isLocalMode: boolean;
  private readonly systemPrompt: string;
  private readonly loopIntervalInMs: number;
  private readonly maxLoopCount: number;
  private readonly logger: Console;
  private readonly signal?: AbortSignal;
  private readonly onData?: (data: GUIAgentData) => void;
  private readonly onError?: (error: Error) => void;
  private readonly showAIDebugInfo: boolean;
  private readonly indentLevel: number;
  private readonly retry?: GUIAgentConfig<T>['retry'];
  private readonly sdkOutputHandler?: (output: GUIAgentOutput) => void;

  private isPaused = false;
  private resumePromise: Promise<void> | null = null;
  private resolveResume: (() => void) | null = null;
  private isStopped = false;
  private isFirstVlmCall = true;

  constructor(config: GUIAgentConfig<T>) {
    this.operator = config.operator;
    this.model = config.model || '';
    this.modelBaseUrl = config.modelBaseUrl || '';
    this.modelApiKey = config.modelApiKey || '';
    this.taskId = config.taskId || crypto.randomUUID();
    this.isFirstVlmCallRef = config.isFirstVlmCallRef;
    this.remoteVlmCaller = config.remoteVlmCaller;
    this.isLocalMode = config.isLocalMode;
    this.loopIntervalInMs = config.loopIntervalInMs || 0;
    this.maxLoopCount = config.maxLoopCount || MAX_LOOP_COUNT;
    this.logger = config.logger || guiLogger;
    this.signal = config.signal;
    this.onData = config.onData;
    this.onError = config.onError;
    this.showAIDebugInfo = config.showAIDebugInfo ?? false;
    this.indentLevel = config.indentLevel ?? 1;
    this.retry = config.retry;
    this.sdkOutputHandler = config.sdkOutputHandler;

    this.systemPrompt = config.systemPrompt || this.buildSystemPrompt();
  }

  /**
   * Output in SDK mode or console.log in normal mode
   */
  private output(type: GUIAgentOutput['type'], data: Record<string, unknown>): void {
    if (this.sdkOutputHandler) {
      this.sdkOutputHandler({
        type,
        timestamp: Date.now(),
        data
      });
    } else {
      // Normal mode - use console.log with colors (colors already imported at top)
      switch (type) {
        case 'status':
          if (data.status === 'running') {
            console.log(`${colors.info(`${icons.loading} Step ${data.iteration}: Running...`)}`);
          } else if (data.status === 'error' && data.error) {
            console.log(`${colors.error(`${icons.cross} ${data.error}`)}`);
          } else if (data.status === 'call_user') {
            console.log(`${colors.warning(`${icons.warning} Needs user input`)}`);
          } else if (data.status === 'user_stopped') {
            console.log(`${colors.warning(`${icons.warning} Stopped`)}`);
          }
          break;
        case 'conversation':
          const indent = '  '.repeat((data.indentLevel as number) || 1);
          const iteration = data.iteration as number;
          const from = data.from as 'human' | 'assistant';
          if (from === 'assistant') {
            const actionType = (data.actionType as string) || 'action';
            const timing = data.timing as { cost: number } | undefined;
            console.log(`${indent}${colors.primaryBright(`[${iteration}]`)} ${colors.textMuted(actionType)}${timing ? colors.textDim(` (${timing.cost}ms)`) : ''}`);
          } else if (from === 'human' && this.showAIDebugInfo) {
            const timing = data.timing as { cost: number } | undefined;
            console.log(`${indent}${colors.textMuted(`${icons.loading} screenshot${timing ? ` (${timing.cost}ms)` : ''}`)}`);
          }
          break;
        case 'action':
          console.log(`${colors.primaryBright(`${icons.rocket} GUI Agent started`)}`);
          break;
        case 'complete':
          console.log(`${colors.success(`${icons.check} GUI task completed in ${data.iterations} iterations`)}`);
          break;
        case 'error':
          if (data.error) {
            console.log(`\n${colors.error('✖')} ${data.error}\n`);
          }
          break;
      }
    }
  }

  /**
   * Display conversation results with formatting similar to session.ts (simplified)
   */
  private displayConversationResult(conversation: Conversation, iteration: number, indentLevel: number = 1): void {
    const indent = '  '.repeat(indentLevel);
    const innerIndent = '  '.repeat(indentLevel + 1);

    if (conversation.from === 'assistant') {
      // Display assistant response (action)
      const content = conversation.value || '';
      const timing = conversation.timing;

      // Simplified: show step number and action
      const actionSummary = content.replace(/Thought:[\s\S]*?Action:\s*/i, '').trim();
      const actionType = conversation.predictionParsed?.[0]?.action_type;

      // Only output if actionType has a specific value (not empty/default)
      if (actionType) {
        this.output('conversation', {
          from: 'assistant',
          iteration,
          indentLevel,
          actionType,
          timing
        });
      }
    } else if (conversation.from === 'human' && conversation.screenshotBase64) {
      // Show minimal indicator for screenshot
      if (this.showAIDebugInfo) {
        const timing = conversation.timing;

        this.output('conversation', {
          from: 'human',
          iteration,
          indentLevel,
          timing
        });

        // 注意：output() 方法中已包含 console.log 输出，不需要重复输出
      }
    }
  }

  /**
   * Display status message
   */
  private displayStatus(data: GUIAgentData, iteration: number, indentLevel: number = 1): void {
    const indent = '  '.repeat(indentLevel);
    const status = data.status;

    // SDK 模式输出
    this.output('status', {
      status: status as string,
      iteration,
      indentLevel,
      error: data.error
    });

    if (this.sdkOutputHandler) {
      return;
    }

    // 普通模式输出
    switch (status) {
      case GUIAgentStatus.RUNNING:
        console.log(`${indent}${colors.info(`${icons.loading} Step ${iteration}: Running...`)}`);
        break;
      case GUIAgentStatus.END:
        // Handled by caller
        break;
      case GUIAgentStatus.ERROR:
        if (data.error) {
          console.log(`${indent}${colors.error(`${icons.cross} ${data.error}`)}`);
        }
        break;
      case GUIAgentStatus.USER_STOPPED:
        console.log(`${indent}${colors.warning(`${icons.warning} Stopped`)}`);
        break;
      default:
        break;
    }
  }

  private buildSystemPrompt(): string {
    /* eslint-disable no-useless-escape */
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
open_url(url='https://xxx') # Open URL in browser
wait() #Sleep for 5s and take a screenshot to check for any changes.
finished(content='xxx') # Use escape characters \', \", and \n in content part to ensure we can parse the content in normal python string format.




## Note
- Use {language} in \`Thought\` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in \`Thought\` part.

`;
    /* eslint-enable no-useless-escape */
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

    const _currentTime = Date.now();

    if (this.showAIDebugInfo) {
      this.logger.debug('[GUIAgent] run:', {
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
    this.output('action', {});
    if (!this.sdkOutputHandler) {
      console.log('');
    }
    await this.onData?.({ ...data, conversations: [] });

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (this.showAIDebugInfo) {
          this.logger.debug('[GUIAgent] loopCnt:', loopCnt);
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

        // Display screenshot notification
        const latestScreenshot = data.conversations[data.conversations.length - 1];
        if (latestScreenshot && latestScreenshot.from === 'human' && latestScreenshot.screenshotBase64) {
          this.displayConversationResult(latestScreenshot, loopCnt, this.indentLevel);
        }

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
                const result = await this.callModelAPI(messages, screenContext, this.remoteVlmCaller!);
                return result;
              } catch (error: unknown) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                // 捕获各种 abort 相关的错误
                if (
                  error instanceof Error &&
                  (error.name === 'AbortError' ||
                    errorMsg.includes('aborted') ||
                    errorMsg.includes('canceled') ||
                    errorMsg.includes('cancelled') ||
                    errorMsg === 'Operation was canceled' ||
                    errorMsg === 'The operation was canceled' ||
                    errorMsg === 'This operation was aborted')
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
          // 首先检查是否是取消/abort 错误
          const errorMsg = modelError instanceof Error ? modelError.message : String(modelError);
          const isAbortError = 
            modelError instanceof Error && (
              modelError.name === 'AbortError' ||
              errorMsg.includes('aborted') ||
              errorMsg.includes('canceled') ||
              errorMsg.includes('cancelled') ||
              errorMsg === 'Operation was canceled' ||
              errorMsg === 'The operation was canceled' ||
              errorMsg === 'This operation was aborted'
            );
          
          if (isAbortError || this.signal?.aborted) {
            data.status = GUIAgentStatus.USER_STOPPED;
            data.conversations = data.conversations || [];
            return data;
          }

          // Handle multimodal model API errors with specific error messages
          data.status = GUIAgentStatus.ERROR;
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
          this.logger.warn('[GUIAgent] Warning: Empty response from model, retrying...');
          continue;
        }

        if (this.showAIDebugInfo) {
          this.logger.debug('[GUIAgent] Response:', prediction);
          this.logger.debug('[GUIAgent] Parsed Predictions:', JSON.stringify(parsedPredictions));
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

        // Display assistant response
        const latestAssistant = data.conversations[data.conversations.length - 1];
        if (latestAssistant && latestAssistant.from === 'assistant') {
          this.displayConversationResult(latestAssistant, loopCnt, this.indentLevel);
        }

        // Check if we need to switch operator based on first action
        // Execute actions
        for (const parsedPrediction of parsedPredictions) {
          const actionType = parsedPrediction.action_type;

          if (this.showAIDebugInfo) {
            this.logger.debug('[GUIAgent] Action:', actionType);
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

            this.logger.debug(`[GUIAgent] Executing action: ${actionType}, loopCnt: ${loopCnt}`);

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
                } else if (executeResult.status === 'needs_input') {
                  // Empty action - return to main agent for re-calling LLM
                  this.logger.debug(`[GUIAgent] Empty action received, returning to main agent for LLM decision`);
                  data.status = GUIAgentStatus.CALL_LLM;
                  data.error = 'Empty action - main agent should re-call LLM to decide next step';
                  stepSuccess = true;
                  return data; // Return immediately with all results to main agent
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
          if (actionType === 'finished') {
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
      const indent = '  '.repeat(this.indentLevel);

      // Output error immediately if task failed
      if (finalStatus === GUIAgentStatus.ERROR && finalError) {
        this.output('error', { error: finalError });
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
        this.logger.debug('[GUIAgent] Final status:', {
          status: finalStatus,
          loopCnt,
          totalConversations: data.conversations.length,
        });
      }

      // Ensure the returned status is correct (reassign)
      this.logger.debug(`[GUIAgent] Finally: finalStatus=${finalStatus}, finalError=${finalError}, data.status=${data.status}, data.error=${data.error}`);

      // Log final status (only visible when showAIDebugInfo is enabled)
      this.logger.debug(`[GUIAgent] Final status: ${finalStatus}${finalError ? `, Error: ${finalError}` : ''}, Steps: ${loopCnt}`);

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
   * Extract image and prompt from messages for remote VLM calls
   */
  private extractImageAndPrompt(messages: any[]): { image: string; prompt: string } {
    const lastUserMessage = messages[messages.length - 1];
    let image = '';
    let prompt = '';

    if (lastUserMessage && Array.isArray(lastUserMessage.content)) {
      const imageBlock = lastUserMessage.content.find((c: any) => c.type === 'image_url');
      const textBlock = lastUserMessage.content.find((c: any) => c.type === 'text');

      if (imageBlock) {
        const imageUrl = imageBlock.image_url?.url || '';
        if (imageUrl.startsWith('data:image')) {
          image = imageUrl.split(',')[1] || '';
        } else {
          image = imageUrl;
        }
      }
      prompt = textBlock?.text || '';
    }

    return { image, prompt };
  }

  /**
   * Debug output for model request
   */
  private debugRequest(messages: any[], remoteVlmCaller?: RemoteVlmCaller): void {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║               GUI MODEL REQUEST DEBUG                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`📦 Model: ${remoteVlmCaller ? ((remoteVlmCaller as any).info?.model || 'remote') : this.model}`);
    console.log(`🌐 Base URL: ${remoteVlmCaller ? ((remoteVlmCaller as any).info?.baseUrl || 'remote') : (this.modelBaseUrl || process.env.MODEL_BASE_URL || 'https://api.openai.com/v1')}`);
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

  /**
   * Debug output for model response
   */
  private debugResponse(content: string, usage?: any): void {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║               GUI MODEL RESPONSE DEBUG                  ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    if (usage) {
      console.log(`📊 Tokens: ${usage.prompt_tokens} (prompt) + ${usage.completion_tokens} (completion) = ${usage.total_tokens} (total)`);
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

  /**
   * Call local VLM API
   */
  private async callLocalVLM(
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
      this.debugRequest(messages);
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: this.signal,
    });

    // Handle non-200 responses
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Model API error: ${errorText}`);
    }

    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: any };
    const content = result.choices?.[0]?.message?.content || '';

    // Debug output for model response
    if (this.showAIDebugInfo) {
      this.debugResponse(content, result.usage);
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
   * Call the model API with debug logging
   * Local mode: use model/modelBaseUrl/modelApiKey directly
   * Remote mode: use remoteVlmCaller for VLM calls (now with full messages for consistent behavior)
   */
  private async callModelAPI(
    messages: any[],
    screenContext: ScreenContext,
    remoteVlmCaller: RemoteVlmCaller
  ): Promise<{ prediction: string; parsedPredictions: PredictionParsed[] }> {
    // === LOCAL 模式 ===
    if (this.isLocalMode) {
      return this.callLocalVLM(messages, screenContext);
    }

    // === REMOTE 模式 ===
    else {
      // Debug output for model input
      if (this.showAIDebugInfo) {
        this.debugRequest(messages, remoteVlmCaller);
      }

      // Use shared ref from config for tracking first VLM call across createGUISubAgent calls
      // If no shared ref provided, fall back to local tracking
      const isFirstVlmCallRef = this.isFirstVlmCallRef || { current: this.isFirstVlmCall };

      // Pass taskId and isFirstVlmCallRef for proper status tracking
      const prediction = await remoteVlmCaller(messages, this.systemPrompt, this.taskId, isFirstVlmCallRef);
      // Mark subsequent calls as continue (update both local state and shared ref)
      this.isFirstVlmCall = false;
      isFirstVlmCallRef.current = false;

      // Debug output for model response
      if (this.showAIDebugInfo) {
        this.debugResponse(prediction);
      }

      const { parsed: parsedPredictions } = actionParser({
        prediction,
        factor: [1000, 1000],
        screenContext: {
          width: screenContext.width,
          height: screenContext.height,
        },
      });

      return {
        prediction,
        parsedPredictions,
      };
    }
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
    this.logger.debug('Cleaning up GUI Agent...');    
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

