import fs from 'fs';
import path from 'path';
import os from 'os';
import { Settings, AuthType, ExecutionMode, MCPServerConfig, CheckpointConfig, ThinkingConfig, CompressionConfig } from './types.js';
import { getLogger } from './logger.js';

const logger = getLogger();

const DEFAULT_SETTINGS: Settings = {
  theme: 'Default',
  selectedAuthType: AuthType.OAUTH_XAGENT,
  apiKey: '',
  baseUrl: 'https://apis.xagent.cn/v1',
  modelName: 'Qwen3-Coder',
  guiSubagentModel: 'Qwen3-Coder',
  guiSubagentBaseUrl: 'https://apis.xagent.cn/v1',
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
  language: 'zh',
  autoUpdate: true,
  telemetryEnabled: true,
  showToolDetails: false
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
    try {
      const globalConfig = this.readConfigFile(this.globalConfigPath);
      this.settings = { ...DEFAULT_SETTINGS, ...globalConfig };

      if (this.projectConfigPath) {
        const projectConfig = this.readConfigFile(this.projectConfigPath);
        this.settings = { ...this.settings, ...projectConfig };
      }

      return this.settings;
    } catch (error) {
      logger.error('Failed to load config', 'Check if config files exist and are valid');
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
    return {
      type: this.settings.selectedAuthType,
      apiKey: this.settings.apiKey,
      baseUrl: this.settings.baseUrl,
      modelName: this.settings.modelName,
      searchApiKey: this.settings.searchApiKey
    };
  }

  async setAuthConfig(config: Partial<Settings>): Promise<void> {
    Object.assign(this.settings, config);
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
    return this.settings.workspacePath;
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
