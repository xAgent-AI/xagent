import fs from 'fs';
import path from 'path';
import os from 'os';
import { Settings, AuthType, ExecutionMode, MCPServerConfig, CheckpointConfig, ThinkingConfig, CompressionConfig, LogLevel } from './types.js';
import { getLogger } from './logger.js';

const logger = getLogger();

const DEFAULT_SETTINGS: Settings = {
  theme: 'Default',
  selectedAuthType: AuthType.OAUTH_XAGENT,
  apiKey: '',
  // LLM API - for main conversation and task processing (OpenAI compatible format)
  baseUrl: 'https://www.xagent-colife.net:3000/v1',
  modelName: 'Qwen3-Coder',
  // xAgent API - for token validation and other backend calls (without /v1)
  xagentApiBaseUrl: 'https://www.xagent-colife.net:3000',
  // VLM API - for GUI automation (browser/desktop operations)
  guiSubagentModel: 'Qwen3-Coder',
  guiSubagentBaseUrl: 'https://www.xagent-colife.net:3000/v3',
  guiSubagentApiKey: '',
  searchApiKey: '',
  skillsPath: '',  // Will be auto-detected if not set
  workspacePath: '',  // Will be auto-detected if not set
  executionMode: ExecutionMode.SMART,
  approvalMode: ExecutionMode.SMART,
  checkpointing: {
    enabled: false,
    autoCreate: true,
    maxCheckpoints: 10
  },
  thinking: {
    enabled: true,
    mode: 'normal',
    displayMode: 'compact'
  },
  contextCompression: {
    enabled: true,
    maxMessages: 30,
    maxContextSize: 1500000,
    preserveRecentMessages: 0,
    enableSummary: true
  },
  contextFileName: 'XAGENT.md',
  mcpServers: {},
  mcpToolPreferences: {},
  language: 'zh',
  autoUpdate: true,
  telemetryEnabled: true,
  showToolDetails: false,
  showAIDebugInfo: false,
  loggerLevel: LogLevel.INFO
};

export class ConfigManager {
  private globalConfigPath: string;
  private projectConfigPath: string;
  private settings: Settings;

  constructor(projectRoot?: string) {
    this.globalConfigPath = path.join(os.homedir(), '.xagent', 'settings.json');
    this.projectConfigPath = projectRoot 
      ? path.join(projectRoot, '.xagent', 'settings.json')
      : '';
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async load(): Promise<Settings> {
    logger.debug('[CONFIG] ========== load() 开始 ==========');
    logger.debug('[CONFIG] globalConfigPath:', this.globalConfigPath);
    logger.debug('[CONFIG] projectConfigPath:', this.projectConfigPath);
    logger.debug('[CONFIG] 检查文件是否存在...');

    try {
      const globalConfig = this.readConfigFile(this.globalConfigPath);
      logger.debug('[CONFIG] globalConfig 读取成功:', JSON.stringify(globalConfig, null, 2));

      this.settings = { ...DEFAULT_SETTINGS, ...globalConfig };
      logger.debug('[CONFIG] 合并后的 settings:', JSON.stringify(this.settings, null, 2));

      if (this.projectConfigPath) {
        const projectConfig = this.readConfigFile(this.projectConfigPath);
        logger.debug('[CONFIG] projectConfig 读取成功:', JSON.stringify(projectConfig, null, 2));
        this.settings = { ...this.settings, ...projectConfig };
      }

      logger.debug('[CONFIG] 最终 settings.apiKey:', this.settings.apiKey ? this.settings.apiKey.substring(0, 30) + '...' : 'empty');
      logger.debug('[CONFIG] 最终 settings.refreshToken:', this.settings.refreshToken ? 'exists' : 'empty');
      logger.debug('[CONFIG] ========== load() 结束 ==========');

      return this.settings;
    } catch (error) {
      logger.debug('[CONFIG] load() 捕获到错误:', error instanceof Error ? error.message : String(error));
      logger.debug('[CONFIG] ========== load() 结束 (使用默认值) ==========');
      return { ...DEFAULT_SETTINGS };
    }
  }

  async save(scope: 'global' | 'project' = 'global'): Promise<void> {
    const configPath = scope === 'global' ? this.globalConfigPath : this.projectConfigPath;
    if (!configPath) {
      throw new Error('Project config path not set');
    }

    const configDir = path.dirname(configPath);
    fs.mkdirSync(configDir, { recursive: true });

    const configToSave = scope === 'global'
      ? this.settings
      : { mcpServers: this.settings.mcpServers };

    fs.writeFileSync(
      configPath,
      JSON.stringify(configToSave, null, 2),
      'utf-8'
    );
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.settings[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
  }

  getAuthConfig() {
    const result = {
      type: this.settings.selectedAuthType,
      apiKey: this.settings.apiKey,
      refreshToken: this.settings.refreshToken,
      baseUrl: this.settings.baseUrl,
      xagentApiBaseUrl: this.settings.xagentApiBaseUrl,
      modelName: this.settings.modelName,
      searchApiKey: this.settings.searchApiKey,
      showAIDebugInfo: this.settings.showAIDebugInfo
    };

    logger.debug('[CONFIG] getAuthConfig() 返回:');
    logger.debug('  - type:', result.type);
    logger.debug('  - apiKey:', result.apiKey ? result.apiKey.substring(0, 30) + '...' : 'empty');
    logger.debug('  - refreshToken:', result.refreshToken ? 'exists' : 'empty');
    logger.debug('  - baseUrl:', result.baseUrl);
    logger.debug('  - xagentApiBaseUrl:', result.xagentApiBaseUrl);

    return result;
  }

  async setAuthConfig(config: Partial<Settings> & { xagentApiBaseUrl?: string }): Promise<void> {
    // Extract xagentApiBaseUrl separately since it's not in Settings
    const { xagentApiBaseUrl, type, ...otherConfig } = config as any;
    
    // Map 'type' to 'selectedAuthType' (AuthConfig uses 'type', Settings uses 'selectedAuthType')
    if (type !== undefined) {
      this.settings.selectedAuthType = type;
    }
    
    Object.assign(this.settings, otherConfig);
    if (xagentApiBaseUrl !== undefined) {
      this.settings.xagentApiBaseUrl = xagentApiBaseUrl;
    }
    await this.save('global');
  }

  getExecutionMode(): ExecutionMode {
    return this.settings.executionMode;
  }

  setExecutionMode(mode: ExecutionMode): void {
    this.settings.executionMode = mode;
  }

  getApprovalMode(): ExecutionMode {
    return this.settings.approvalMode || ExecutionMode.DEFAULT;
  }

  setApprovalMode(mode: ExecutionMode): void {
    this.settings.approvalMode = mode;
  }

  getMcpServers(): Record<string, MCPServerConfig> {
    return this.settings.mcpServers;
  }

  addMcpServer(name: string, config: MCPServerConfig): void {
    this.settings.mcpServers[name] = config;
  }

  removeMcpServer(name: string): void {
    delete this.settings.mcpServers[name];
  }

  getCheckpointingConfig(): CheckpointConfig {
    return this.settings.checkpointing;
  }

  setCheckpointingConfig(config: Partial<CheckpointConfig>): void {
    this.settings.checkpointing = { ...this.settings.checkpointing, ...config };
  }

  getThinkingConfig(): ThinkingConfig {
    return this.settings.thinking;
  }

  setThinkingConfig(config: Partial<ThinkingConfig>): void {
    this.settings.thinking = { ...this.settings.thinking, ...config };
  }

  getContextCompressionConfig(): CompressionConfig {
    return this.settings.contextCompression;
  }

  setContextCompressionConfig(config: Partial<CompressionConfig>): void {
    this.settings.contextCompression = { ...this.settings.contextCompression, ...config };
  }

  getContextFileName(): string | string[] {
    return this.settings.contextFileName;
  }

  getLanguage(): 'zh' | 'en' {
    return this.settings.language;
  }

  setLanguage(language: 'zh' | 'en'): void {
    this.settings.language = language;
  }

  getLoggerLevel(): LogLevel {
    return this.settings.loggerLevel;
  }

  setLoggerLevel(level: LogLevel): void {
    this.settings.loggerLevel = level;
  }
  
  getSkillsPath(): string | undefined {
    return this.settings.skillsPath;
  }

  setSkillsPath(path: string): void {
    this.settings.skillsPath = path;
  }

  private readConfigFile(filePath: string): Partial<Settings> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(`Error reading config file ${filePath}`, 'Check file permissions and format');
      }
      return {};
    }
  }

  getWorkspacePath(): string | undefined {
    if (this.settings.workspacePath) {
      return this.settings.workspacePath;
    }
    // Auto-detect: ~/.xagent/workspace
    const detectedPath = path.join(os.homedir(), '.xagent', 'workspace');
    
    // Ensure directory exists
    try {
      if (!fs.existsSync(detectedPath)) {
        fs.mkdirSync(detectedPath, { recursive: true });
      }
    } catch {
      // Ignore errors - caller will handle missing path
    }
    
    return detectedPath;
  }

  setWorkspacePath(path: string): void {
    this.settings.workspacePath = path;
  }

  getSettings(): Settings | undefined {
    return this.settings;
  }

  async resetToDefaults(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS };
    await this.save('global');
  }
}

let configManagerInstance: ConfigManager | null = null;

export function getConfigManager(projectRoot?: string): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager(projectRoot);
  }
  return configManagerInstance;
}
