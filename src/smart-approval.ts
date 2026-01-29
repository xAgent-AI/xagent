import inquirer from 'inquirer';
import { AIClient, Message } from './ai-client.js';
import { getConfigManager } from './config.js';
import { AuthType } from './types.js';
import { getLogger } from './logger.js';
import { colors, icons } from './theme.js';

const logger = getLogger();

/**
 * Approval result type
 */
export enum ApprovalDecision {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REQUIRES_CONFIRMATION = 'requires_confirmation',
  AI_REVIEW = 'ai_review'
}

/**
 * Risk level
 */
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

/**
 * Approval result
 */
export interface ApprovalResult {
  decision: ApprovalDecision;
  riskLevel: RiskLevel;
  detectionMethod: 'whitelist' | 'blacklist' | 'ai_review' | 'manual';
  description: string;
  latency: number;
  aiAnalysis?: string;
}

/**
 * Tool call context
 */
export interface ToolCallContext {
  toolName: string;
  params: any;
  timestamp: number;
}

/**
 * Whitelist checker
 */
export class WhitelistChecker {
  private static readonly WHITELISTED_TOOLS: Set<string> = new Set([
    // Information reading tools
    'Read',
    'ListDirectory',
    'SearchFiles',
    'Grep',
    'image_read',

    // Task management tools
    'todo_write',
    'todo_read',
    'task',
    'exit_plan_mode',
    'web_search',

    // File editing tools
    'edit',
    'Write',
    'DeleteFile',

    // Other safe tools
    'web_fetch',
    'ask_user_question',
    'save_memory',
    'xml_escape',
    'Skill'
  ]);

  /**
   * Check if tool is in whitelist
   */
  check(toolName: string): boolean {
    return WhitelistChecker.WHITELISTED_TOOLS.has(toolName);
  }

  /**
   * Get list of whitelisted tools
   */
  getWhitelistedTools(): string[] {
    return Array.from(WhitelistChecker.WHITELISTED_TOOLS);
  }
}

/**
 * Blacklist rules
 */
interface BlacklistRule {
  pattern: RegExp;
  category: string;
  riskLevel: RiskLevel;
  description: string;
}

/**
 * Blacklist checker
 */
export class BlacklistChecker {
  private static readonly RULES: BlacklistRule[] = [
    // System destruction
    {
      pattern: /rm\s+-rf\s+\/$/,
      category: 'System destruction',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Delete root directory'
    },
    {
      pattern: /rm\s+-rf\s+(\/etc|\/usr|\/bin|\/sbin|\/lib|\/lib64)/,
      category: 'System destruction',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Delete system directories'
    },
    {
      pattern: /rm\s+-rf\s+.*\*/,
      category: 'System destruction',
      riskLevel: RiskLevel.HIGH,
      description: 'Batch delete files'
    },
    {
      pattern: /(mkfs|format)\s+/,
      category: 'System destruction',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Format disk'
    },
    {
      pattern: /dd\s+.*of=\/dev\/(sd[a-z]|nvme[0-9]n[0-9])/,
      category: 'System destruction',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Overwrite disk data'
    },

    // Privilege escalation
    {
      pattern: /chmod\s+777\s+/,
      category: 'Privilege escalation',
      riskLevel: RiskLevel.HIGH,
      description: 'Set file permissions to 777'
    },
    {
      pattern: /chmod\s+[45][0-9]{3}\s+/,
      category: 'Privilege escalation',
      riskLevel: RiskLevel.HIGH,
      description: 'Set SUID/SGID permissions'
    },
    {
      pattern: /vi\s+\/etc\/sudoers/,
      category: 'Privilege escalation',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Modify sudo permissions'
    },
    {
      pattern: /echo.*>>.*\/etc\/sudoers/,
      category: 'Privilege escalation',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Modify sudo permissions'
    },

    // Data theft
    {
      pattern: /cat\s+\/etc\/passwd/,
      category: 'Data theft',
      riskLevel: RiskLevel.HIGH,
      description: 'Read password file'
    },
    {
      pattern: /cat\s+\/etc\/shadow/,
      category: 'Data theft',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Read shadow file'
    },
    {
      pattern: /cat\s+.*\/\.ssh\/id_rsa/,
      category: 'Data theft',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Read SSH private key'
    },
    {
      pattern: /grep\s+-[rRi].*password/,
      category: 'Data theft',
      riskLevel: RiskLevel.HIGH,
      description: 'Search for password information'
    },
    {
      pattern: /(curl|wget).*\|(sh|bash|python|perl)/,
      category: 'Data theft',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Remote code execution'
    },

    // Network attacks
    {
      pattern: /nmap\s+-[sS].*/,
      category: 'Network attacks',
      riskLevel: RiskLevel.MEDIUM,
      description: 'Network scanning'
    },
    {
      pattern: /nc\s+.*-l/,
      category: 'Network attacks',
      riskLevel: RiskLevel.HIGH,
      description: 'Create network listener'
    },
    {
      pattern: /iptables\s+-F/,
      category: 'Network attacks',
      riskLevel: RiskLevel.HIGH,
      description: 'Clear firewall rules'
    },

    // Resource exhaustion
    {
      pattern: /:\)\s*{\s*:\s*\|\s*:&\s*};/,
      category: 'Resource exhaustion',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Fork bomb'
    },
    {
      pattern: /while\s+true\s*;\s*do\s+.*done/,
      category: 'Resource exhaustion',
      riskLevel: RiskLevel.HIGH,
      description: 'Infinite loop'
    }
  ];

  /**
   * Check if tool call matches blacklist rules
   */
  check(context: ToolCallContext): { matched: boolean; rule?: BlacklistRule } {
    const { toolName, params } = context;

    // For Bash tool, check command content
    if (toolName === 'Bash' && params.command) {
      const command = params.command as string;

      for (const rule of BlacklistChecker.RULES) {
        if (rule.pattern.test(command)) {
          return { matched: true, rule };
        }
      }
    }

    // For file operation tools, check path
    if (['Write', 'DeleteFile', 'edit'].includes(toolName)) {
      const filePath = params.filePath || params.file_path || '';
      if (this.isSystemPath(filePath)) {
        return {
          matched: true,
          rule: {
            pattern: /system-path/,
            category: 'System destruction',
            riskLevel: RiskLevel.HIGH,
            description: 'Modify system files'
          }
        };
      }
    }

    return { matched: false };
  }

  /**
   * Check if it's a system path
   */
  private isSystemPath(filePath: string): boolean {
    const systemPaths = [
      '/etc',
      '/usr',
      '/bin',
      '/sbin',
      '/lib',
      '/lib64',
      '/boot',
      '/sys',
      '/proc',
      '/dev'
    ];

    const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/');
    return systemPaths.some(sysPath => normalizedPath.startsWith(sysPath));
  }

  /**
   * Get all blacklist rules
   */
  getRules(): BlacklistRule[] {
    return [...BlacklistChecker.RULES];
  }
}

/**
 * AI approval checker
 */
export class AIApprovalChecker {
  private aiClient: AIClient | null = null;
  private isRemoteMode: boolean = false;

  constructor() {
    this.initializeAIClient();
  }

  /**
   * Initialize AI client(s)
   */
  private async initializeAIClient(): Promise<void> {
    try {
      const configManager = getConfigManager();
      const authConfig = configManager.getAuthConfig();

      // Check if Remote mode (OAuth XAGENT)
      this.isRemoteMode = authConfig.type === AuthType.OAUTH_XAGENT;

      // Remote mode: AI review handled by remote LLM, no local AIClient needed
      // Local mode: use local AIClient
      if (!this.isRemoteMode && authConfig.apiKey) {
        this.aiClient = new AIClient(authConfig);
      }
    } catch (error) {
      logger.error('Failed to initialize AI approval checker', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Use AI for intelligent review
   */
  async check(context: ToolCallContext): Promise<{ approved: boolean; analysis: string; riskLevel: RiskLevel }> {
    // In Remote mode, the remote LLM has already approved the tool_calls
    // Local AI review approves directly, no need to repeat
    if (this.isRemoteMode) {
      return {
        approved: true,
        analysis: 'Remote mode: tool approval handled by remote LLM',
        riskLevel: RiskLevel.LOW
      };
    }

    if (!this.aiClient) {
      // If AI client is not initialized, default to medium risk, requires user confirmation
      return {
        approved: false,
        analysis: 'AI review not available (no local LLM configured), requires manual user confirmation',
        riskLevel: RiskLevel.MEDIUM
      };
    }

    const prompt = this.buildApprovalPrompt(context);

    try {
      const messages: Message[] = [
        {
          role: 'system',
          content: `You are a security review expert. Your task is to evaluate the security of tool calls.

Please analyze from the following dimensions:
1. Whether the operation has malicious intent
2. Whether it may cause data leakage
3. Whether it may compromise system integrity
4. Whether it follows best practices

Please return results in JSON format:
{
  "approved": boolean,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "analysis": "Detailed analysis description"
}`
        },
        {
          role: 'user',
          content: prompt
        }
      ];

      const response = await this.aiClient.chatCompletion(messages, {
        temperature: 0.3,
        // maxTokens: 500
      });

      const content = typeof response.choices[0].message.content === 'string'
        ? response.choices[0].message.content
        : '{}';

      // Parse AI response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          approved: result.approved || false,
          analysis: result.analysis || 'No detailed analysis',
          riskLevel: result.riskLevel || RiskLevel.MEDIUM
        };
      }

      // If unable to parse, return medium risk
      return {
        approved: false,
        analysis: 'Unable to parse AI response, requires manual confirmation',
        riskLevel: RiskLevel.MEDIUM
      };
    } catch (error: any) {
      logger.error('AI approval check failed', error instanceof Error ? error.message : String(error));

      // In Remote mode, remote LLM already approved, local failure means auto-approve
      const configManager = getConfigManager();
      const authConfig = configManager.getAuthConfig();
      const isRemoteMode = authConfig.type === AuthType.OAUTH_XAGENT;

      if (isRemoteMode) {
        return {
          approved: true,
          analysis: 'Remote mode: approved (remote LLM handled approval)',
          riskLevel: RiskLevel.LOW
        };
      }

      return {
        approved: false,
        analysis: `AI review failed: ${error.message}, requires manual confirmation`,
        riskLevel: RiskLevel.MEDIUM
      };
    }
  }

  /**
   * Build review prompt
   */
  private buildApprovalPrompt(context: ToolCallContext): string {
    const { toolName, params } = context;

    let prompt = `Tool name: ${toolName}\n`;
    prompt += `Parameters: ${JSON.stringify(params, null, 2)}\n\n`;

    // Add specific analysis guidance based on tool type
    if (toolName === 'Bash') {
      prompt += `This is a Shell command execution request. Please check if the command contains:\n- Dangerous system operations (such as deletion, formatting)\n- Privilege escalation operations\n- Data theft operations\n- Remote code execution\n- Resource exhaustion attacks`;
    } else if (['Write', 'edit', 'DeleteFile'].includes(toolName)) {
      prompt += `This is a file operation request. Please check:\n- Whether the target path is a system path\n- Whether the operation may damage system files\n- Whether it involves sensitive configuration files`;
    } else if (toolName === 'web_fetch' || toolName === 'web_search') {
      prompt += `This is a network request. Please check:\n- Whether the URL is a malicious website\n- Whether it may leak sensitive information\n- Whether it may execute remote code`;
    }

    return prompt;
  }
}

/**
 * Smart approval engine
 */
export class SmartApprovalEngine {
  private whitelistChecker: WhitelistChecker;
  private blacklistChecker: BlacklistChecker;
  private aiChecker: AIApprovalChecker;
  private debugMode: boolean;

  constructor(debugMode: boolean = false) {
    this.whitelistChecker = new WhitelistChecker();
    this.blacklistChecker = new BlacklistChecker();
    this.aiChecker = new AIApprovalChecker();
    this.debugMode = debugMode;
  }

  /**
   * Evaluate tool call
   */
  async evaluate(context: ToolCallContext): Promise<ApprovalResult> {
    const startTime = Date.now();

    if (this.debugMode) {
      logger.debug(`[SmartApprovalEngine] Evaluating tool call: ${context.toolName}`);
    }

    // First layer: Whitelist check
    const whitelistCheck = this.whitelistChecker.check(context.toolName);
    if (whitelistCheck) {
      const latency = Date.now() - startTime;
      if (this.debugMode) {
        logger.debug(`[WhitelistChecker] Tool '${context.toolName}' in whitelist, latency: ${latency}ms`);
      }

      return {
        decision: ApprovalDecision.APPROVED,
        riskLevel: RiskLevel.LOW,
        detectionMethod: 'whitelist',
        description: `Tool '${context.toolName}' is in the whitelist, executing directly`,
        latency
      };
    }

    if (this.debugMode) {
      logger.debug(`[WhitelistChecker] Tool '${context.toolName}' not in whitelist`);
    }

    // Second layer: Blacklist check
    const blacklistCheck = this.blacklistChecker.check(context);
    if (blacklistCheck.matched && blacklistCheck.rule) {
      const latency = Date.now() - startTime;
      if (this.debugMode) {
        logger.debug(`[BlacklistChecker] Matched rule: ${blacklistCheck.rule.description}, Risk: ${blacklistCheck.rule.riskLevel}, latency: ${latency}ms`);
      }

      return {
        decision: ApprovalDecision.REQUIRES_CONFIRMATION,
        riskLevel: blacklistCheck.rule.riskLevel,
        detectionMethod: 'blacklist',
        description: `Detected potentially risky operation: ${blacklistCheck.rule.description}`,
        latency
      };
    }

    if (this.debugMode) {
      logger.debug(`[BlacklistChecker] No blacklist rule matched`);
    }

    // Third layer: AI intelligent review
    const aiCheck = await this.aiChecker.check(context);
    const latency = Date.now() - startTime;

    if (this.debugMode) {
      logger.debug(`[AIApprovalChecker] AI review result: approved=${aiCheck.approved}, risk=${aiCheck.riskLevel}, latency: ${latency}ms`);
    }

    return {
      decision: aiCheck.approved ? ApprovalDecision.APPROVED : ApprovalDecision.REQUIRES_CONFIRMATION,
      riskLevel: aiCheck.riskLevel,
      detectionMethod: 'ai_review',
      description: aiCheck.analysis,
      latency,
      aiAnalysis: aiCheck.analysis
    };
  }

  /**
   * Request user confirmation
   */
  async requestConfirmation(result: ApprovalResult): Promise<boolean> {
    const separator = icons.separator.repeat(40);
    console.log('');
    console.log(colors.warning(`${icons.warning} [Smart Mode] Detected potentially risky operation`));
    console.log(colors.border(separator));
    console.log('');
    console.log(colors.textMuted(`📊 Risk Level: ${this.getRiskLevelDisplay(result.riskLevel)}`));
    console.log(colors.textMuted(`🔍 Detection Method: ${this.getDetectionMethodDisplay(result.detectionMethod)}`));
    console.log('');

    if (result.aiAnalysis) {
      console.log(colors.textMuted(`🤖 AI Analysis:`));
      console.log(colors.textDim(`  ${result.aiAnalysis}`));
      console.log('');
    }

    console.log(colors.textMuted(`⚠️  Risk Description: ${result.description}`));
    console.log('');
    console.log(colors.warning('Potentially risky operation detected, continue execution?'));

    try {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: 'Continue execution?',
          default: false
        }
      ]);

      return confirmed;
    } catch (error) {
      logger.error('Failed to get user confirmation', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Get risk level display
   */
  private getRiskLevelDisplay(riskLevel: RiskLevel): string {
    const displays = {
      [RiskLevel.LOW]: colors.success('LOW'),
      [RiskLevel.MEDIUM]: colors.warning('MEDIUM'),
      [RiskLevel.HIGH]: colors.error('HIGH'),
      [RiskLevel.CRITICAL]: colors.error('CRITICAL')
    };
    return displays[riskLevel];
  }

  /**
   * Get detection method display
   */
  private getDetectionMethodDisplay(method: string): string {
    const displays = {
      whitelist: 'Whitelist rules',
      blacklist: 'Blacklist rules',
      ai_review: 'AI intelligent review',
      manual: 'Manual review'
    };
    return displays[method as keyof typeof displays] || method;
  }

  /**
   * Set debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }
}

/**
 * Get smart approval engine instance
 */
let smartApprovalEngineInstance: SmartApprovalEngine | null = null;

export function getSmartApprovalEngine(debugMode: boolean = false): SmartApprovalEngine {
  if (!smartApprovalEngineInstance) {
    smartApprovalEngineInstance = new SmartApprovalEngine(debugMode);
  }
  return smartApprovalEngineInstance;
}