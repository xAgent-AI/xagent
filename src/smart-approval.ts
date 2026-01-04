import inquirer from 'inquirer';
import { AIClient, Message } from './ai-client.js';
import { getConfigManager } from './config.js';
import { getLogger } from './logger.js';
import { colors, icons } from './theme.js';

const logger = getLogger();

/**
 * 审核结果类型
 */
export enum ApprovalDecision {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REQUIRES_CONFIRMATION = 'requires_confirmation',
  AI_REVIEW = 'ai_review'
}

/**
 * 风险等级
 */
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

/**
 * 审核结果
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
 * 工具调用上下文
 */
export interface ToolCallContext {
  toolName: string;
  params: any;
  timestamp: number;
}

/**
 * 白名单检查器
 */
export class WhitelistChecker {
  private static readonly WHITELISTED_TOOLS: Set<string> = new Set([
    // 信息读取类工具
    'Read',
    'ListDirectory',
    'SearchCodebase',
    'Grep',
    'image_read',

    // 任务管理类工具
    'todo_write',
    'todo_read',
    'task',
    'exit_plan_mode',
    'web_search',

    // 文件编辑类工具
    'replace',
    'Write',

    // 其他安全工具
    'web_fetch',
    'ask_user_question',
    'save_memory',
    'xml_escape',
    'Skill'
  ]);

  /**
   * 检查工具是否在白名单中
   */
  check(toolName: string): boolean {
    return WhitelistChecker.WHITELISTED_TOOLS.has(toolName);
  }

  /**
   * 获取白名单工具列表
   */
  getWhitelistedTools(): string[] {
    return Array.from(WhitelistChecker.WHITELISTED_TOOLS);
  }
}

/**
 * 黑名单规则
 */
interface BlacklistRule {
  pattern: RegExp;
  category: string;
  riskLevel: RiskLevel;
  description: string;
}

/**
 * 黑名单检查器
 */
export class BlacklistChecker {
  private static readonly RULES: BlacklistRule[] = [
    // 系统破坏类
    {
      pattern: /rm\s+-rf\s+\/$/,
      category: '系统破坏',
      riskLevel: RiskLevel.CRITICAL,
      description: '删除根目录'
    },
    {
      pattern: /rm\s+-rf\s+(\/etc|\/usr|\/bin|\/sbin|\/lib|\/lib64)/,
      category: '系统破坏',
      riskLevel: RiskLevel.CRITICAL,
      description: '删除系统目录'
    },
    {
      pattern: /rm\s+-rf\s+.*\*/,
      category: '系统破坏',
      riskLevel: RiskLevel.HIGH,
      description: '批量删除文件'
    },
    {
      pattern: /(mkfs|format)\s+/,
      category: '系统破坏',
      riskLevel: RiskLevel.CRITICAL,
      description: '格式化磁盘'
    },
    {
      pattern: /dd\s+.*of=\/dev\/(sd[a-z]|nvme[0-9]n[0-9])/,
      category: '系统破坏',
      riskLevel: RiskLevel.CRITICAL,
      description: '覆盖磁盘数据'
    },

    // 权限提升类
    {
      pattern: /chmod\s+777\s+/,
      category: '权限提升',
      riskLevel: RiskLevel.HIGH,
      description: '设置文件权限为777'
    },
    {
      pattern: /chmod\s+[45][0-9]{3}\s+/,
      category: '权限提升',
      riskLevel: RiskLevel.HIGH,
      description: '设置SUID/SGID权限'
    },
    {
      pattern: /vi\s+\/etc\/sudoers/,
      category: '权限提升',
      riskLevel: RiskLevel.CRITICAL,
      description: '修改sudo权限'
    },
    {
      pattern: /echo.*>>.*\/etc\/sudoers/,
      category: '权限提升',
      riskLevel: RiskLevel.CRITICAL,
      description: '修改sudo权限'
    },

    // 数据窃取类
    {
      pattern: /cat\s+\/etc\/passwd/,
      category: '数据窃取',
      riskLevel: RiskLevel.HIGH,
      description: '读取密码文件'
    },
    {
      pattern: /cat\s+\/etc\/shadow/,
      category: '数据窃取',
      riskLevel: RiskLevel.CRITICAL,
      description: '读取shadow文件'
    },
    {
      pattern: /cat\s+.*\/\.ssh\/id_rsa/,
      category: '数据窃取',
      riskLevel: RiskLevel.CRITICAL,
      description: '读取SSH私钥'
    },
    {
      pattern: /grep\s+-[rRi].*password/,
      category: '数据窃取',
      riskLevel: RiskLevel.HIGH,
      description: '搜索密码信息'
    },
    {
      pattern: /(curl|wget).*\|(sh|bash|python|perl)/,
      category: '数据窃取',
      riskLevel: RiskLevel.CRITICAL,
      description: '远程代码执行'
    },

    // 网络攻击类
    {
      pattern: /nmap\s+-[sS].*/,
      category: '网络攻击',
      riskLevel: RiskLevel.MEDIUM,
      description: '网络扫描'
    },
    {
      pattern: /nc\s+.*-l/,
      category: '网络攻击',
      riskLevel: RiskLevel.HIGH,
      description: '创建网络监听'
    },
    {
      pattern: /iptables\s+-F/,
      category: '网络攻击',
      riskLevel: RiskLevel.HIGH,
      description: '清除防火墙规则'
    },

    // 资源耗尽类
    {
      pattern: /:\)\s*{\s*:\s*\|\s*:&\s*};/,
      category: '资源耗尽',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Fork炸弹'
    },
    {
      pattern: /while\s+true\s*;\s*do\s+.*done/,
      category: '资源耗尽',
      riskLevel: RiskLevel.HIGH,
      description: '无限循环'
    }
  ];

  /**
   * 检查工具调用是否匹配黑名单规则
   */
  check(context: ToolCallContext): { matched: boolean; rule?: BlacklistRule } {
    const { toolName, params } = context;

    // 对于 Bash 工具，检查命令内容
    if (toolName === 'Bash' && params.command) {
      const command = params.command as string;

      for (const rule of BlacklistChecker.RULES) {
        if (rule.pattern.test(command)) {
          return { matched: true, rule };
        }
      }
    }

    // 对于文件操作工具，检查路径
    if (['Write', 'DeleteFile', 'replace'].includes(toolName)) {
      const filePath = params.filePath || params.file_path || '';
      if (this.isSystemPath(filePath)) {
        return {
          matched: true,
          rule: {
            pattern: /system-path/,
            category: '系统破坏',
            riskLevel: RiskLevel.HIGH,
            description: '修改系统文件'
          }
        };
      }
    }

    return { matched: false };
  }

  /**
   * 检查是否为系统路径
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
   * 获取所有黑名单规则
   */
  getRules(): BlacklistRule[] {
    return [...BlacklistChecker.RULES];
  }
}

/**
 * AI 审核检查器
 */
export class AIApprovalChecker {
  private aiClient: AIClient | null = null;

  constructor() {
    this.initializeAIClient();
  }

  /**
   * 初始化 AI 客户端
   */
  private async initializeAIClient(): Promise<void> {
    try {
      const configManager = getConfigManager();
      const authConfig = configManager.getAuthConfig();

      if (authConfig.apiKey) {
        this.aiClient = new AIClient(authConfig);
      }
    } catch (error) {
      logger.error('Failed to initialize AI approval checker', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 使用 AI 进行智能审核
   */
  async check(context: ToolCallContext): Promise<{ approved: boolean; analysis: string; riskLevel: RiskLevel }> {
    if (!this.aiClient) {
      // 如果 AI 客户端未初始化，默认为中等风险，需要用户确认
      return {
        approved: false,
        analysis: 'AI 审核不可用，需要用户手动确认',
        riskLevel: RiskLevel.MEDIUM
      };
    }

    const prompt = this.buildApprovalPrompt(context);

    try {
      const messages: Message[] = [
        {
          role: 'system',
          content: `你是一个安全审核专家。你的任务是评估工具调用的安全性。

请从以下维度分析：
1. 操作是否有恶意意图
2. 是否可能造成数据泄露
3. 是否可能破坏系统完整性
4. 是否符合最佳实践

请以 JSON 格式返回结果：
{
  "approved": boolean,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "analysis": "详细的分析说明"
}`
        },
        {
          role: 'user',
          content: prompt
        }
      ];

      const response = await this.aiClient.chatCompletion(messages, {
        temperature: 0.3,
        maxTokens: 500
      });

      const content = typeof response.choices[0].message.content === 'string'
        ? response.choices[0].message.content
        : '{}';

      // 解析 AI 响应
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          approved: result.approved || false,
          analysis: result.analysis || '无详细分析',
          riskLevel: result.riskLevel || RiskLevel.MEDIUM
        };
      }

      // 如果无法解析，返回中等风险
      return {
        approved: false,
        analysis: '无法解析 AI 响应，需要手动确认',
        riskLevel: RiskLevel.MEDIUM
      };
    } catch (error: any) {
      logger.error('AI approval check failed', error instanceof Error ? error.message : String(error));
      return {
        approved: false,
        analysis: `AI 审核失败: ${error.message}，需要手动确认`,
        riskLevel: RiskLevel.MEDIUM
      };
    }
  }

  /**
   * 构建审核提示词
   */
  private buildApprovalPrompt(context: ToolCallContext): string {
    const { toolName, params } = context;

    let prompt = `工具名称: ${toolName}\n`;
    prompt += `参数: ${JSON.stringify(params, null, 2)}\n\n`;

    // 根据工具类型添加特定的分析指导
    if (toolName === 'Bash') {
      prompt += `这是一个 Shell 命令执行请求。请检查命令是否包含：\n- 危险的系统操作（如删除、格式化）\n- 权限提升操作\n- 数据窃取操作\n- 远程代码执行\n- 资源耗尽攻击`;
    } else if (['Write', 'replace', 'DeleteFile'].includes(toolName)) {
      prompt += `这是一个文件操作请求。请检查：\n- 目标路径是否为系统路径\n- 操作是否可能破坏系统文件\n- 是否涉及敏感配置文件`;
    } else if (toolName === 'web_fetch' || toolName === 'web_search') {
      prompt += `这是一个网络请求。请检查：\n- URL 是否为恶意网站\n- 是否可能泄露敏感信息\n- 是否可能执行远程代码`;
    }

    return prompt;
  }
}

/**
 * 智能审核引擎
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
   * 评估工具调用
   */
  async evaluate(context: ToolCallContext): Promise<ApprovalResult> {
    const startTime = Date.now();

    if (this.debugMode) {
      logger.debug(`[SmartApprovalEngine] Evaluating tool call: ${context.toolName}`);
    }

    // 第一层：白名单检查
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
        description: `工具 '${context.toolName}' 在白名单中，直接执行`,
        latency
      };
    }

    if (this.debugMode) {
      logger.debug(`[WhitelistChecker] Tool '${context.toolName}' not in whitelist`);
    }

    // 第二层：黑名单检查
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
        description: `检测到潜在风险操作: ${blacklistCheck.rule.description}`,
        latency
      };
    }

    if (this.debugMode) {
      logger.debug(`[BlacklistChecker] No blacklist rule matched`);
    }

    // 第三层：AI 智能审核
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
   * 请求用户确认
   */
  async requestConfirmation(result: ApprovalResult): Promise<boolean> {
    const separator = icons.separator.repeat(40);
    console.log('');
    console.log(colors.warning(`${icons.warning} [智能模式] 检测到潜在风险操作`));
    console.log(colors.border(separator));
    console.log('');
    console.log(colors.textMuted(`📊 风险等级: ${this.getRiskLevelDisplay(result.riskLevel)}`));
    console.log(colors.textMuted(`🔍 检测方式: ${this.getDetectionMethodDisplay(result.detectionMethod)}`));
    console.log('');

    if (result.aiAnalysis) {
      console.log(colors.textMuted(`🤖 AI分析:`));
      console.log(colors.textDim(`  ${result.aiAnalysis}`));
      console.log('');
    }

    console.log(colors.textMuted(`⚠️  风险描述: ${result.description}`));
    console.log('');
    console.log(colors.warning('检测到潜在风险，是否继续执行？'));

    try {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: '是否继续执行？',
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
   * 获取风险等级显示
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
   * 获取检测方式显示
   */
  private getDetectionMethodDisplay(method: string): string {
    const displays = {
      whitelist: '白名单规则',
      blacklist: '黑名单规则',
      ai_review: 'AI智能审核',
      manual: '手动审核'
    };
    return displays[method as keyof typeof displays] || method;
  }

  /**
   * 设置调试模式
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }
}

/**
 * 获取智能审核引擎实例
 */
let smartApprovalEngineInstance: SmartApprovalEngine | null = null;

export function getSmartApprovalEngine(debugMode: boolean = false): SmartApprovalEngine {
  if (!smartApprovalEngineInstance) {
    smartApprovalEngineInstance = new SmartApprovalEngine(debugMode);
  }
  return smartApprovalEngineInstance;
}