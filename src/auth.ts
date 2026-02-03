import axios from 'axios';
import open from 'open';
import inquirer from 'inquirer';
import https from 'https';
import { AuthConfig, AuthType } from './types.js';
import { getLogger } from './logger.js';

const logger = getLogger();

// Debug: Log environment variable at module load time
logger.debug('[AUTH-MODULE] XAGENT_BASE_URL:', process.env.XAGENT_BASE_URL || '(not set)');

// Extended AuthConfig for xAgent with additional fields
interface XAgentAuthConfig extends AuthConfig {
  xagentApiBaseUrl?: string;
  remote_llmProvider?: string;   // Remote mode LLM Provider ID
  remote_vlmProvider?: string;   // Remote mode VLM Provider ID
}

interface VLMProviderInfo {
  name: string;
  provider: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
}

const VLM_PROVIDERS: VLMProviderInfo[] = [
  {
    name: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: ['gpt-5', 'gpt-4o', 'gpt-4o-mini', 'gpt-5-mini']
  },
  {
    name: 'Volcengine (Doubao)',
    provider: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-8-251228',
    models: ['doubao-seed-1-8-251228', 'doubao-1-5-ui-tars-250428', 'seed1.5-vl']
  },
  {
    name: 'Anthropic',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-sonnet-4', 'claude-opus-4']
  }
];

interface ThirdPartyProvider {
  name: string;
  baseUrl: string;
  defaultModel: string;
  description: string;
  models?: string[];
}

const THIRD_PARTY_PROVIDERS: ThirdPartyProvider[] = [
  {
    name: 'Zhipu AI (GLM-4)',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/',
    defaultModel: 'glm-4.7',
    description: 'Zhipu AI GLM-4 series models',
    models: ['glm-4.7', 'glm-4', 'glm-4-plus', 'glm-4-0520', 'glm-4-air', 'glm-4-airx', 'glm-4-flash', 'glm-4.7-plus']
  },
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    description: 'DeepSeek DeepSeek series models',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']
  },
  {
    name: 'Alibaba Tongyi Qianwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    description: 'Alibaba Cloud Tongyi Qianwen series models',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'qwen-vl-max', 'qwen-vl-plus']
  },
  {
    name: 'Baidu Wenxin Yiyan',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
    defaultModel: 'ernie-bot-4',
    description: 'Baidu Intelligent Cloud Wenxin Yiyan series models',
    models: ['ernie-bot-4', 'ernie-bot-turbo', 'ernie-speed', 'ernie-speed-128k', 'ernie-lite-8k']
  },
  {
    name: 'Moonshot AI (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    description: 'Moonshot AI Kimi series models',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  },
  {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/anthropic',
    defaultModel: 'MiniMax-M2.1',
    description: 'MiniMax (Anthropic-compatible format)',
    models: ['MiniMax-M2.1', 'MiniMax-M2.1-lightning', 'MiniMax-M2', 'MiniMax-M2-Stable']
  },
  {
    name: '01.AI (Yi)',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    defaultModel: 'yi-large',
    description: '01.AI Yi series models',
    models: ['yi-large', 'yi-large-turbo', 'yi-medium', 'yi-spark', 'yi-vision']
  },
  {
    name: 'Baichuan Intelligence (Baichuan)',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    defaultModel: 'Baichuan4',
    description: 'Baichuan Intelligence Baichuan series models',
    models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k', 'Baichuan-Text-Embedding']
  },
  {
    name: 'Tencent Hunyuan',
    baseUrl: 'https://hunyuan.cloud.tencent.com/hyllm/v1',
    defaultModel: 'hunyuan-pro',
    description: 'Tencent Hunyuan series models',
    models: ['hunyuan-pro', 'hunyuan-standard', 'hunyuan-lite', 'hunyuan-vision']
  },
  {
    name: 'iFlytek (SparkDesk)',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    defaultModel: 'spark-pro',
    description: 'iFlytek Spark cognitive large model',
    models: ['spark-pro', 'spark-ultra', 'spark-max', 'spark-lite']
  },
  {
    name: 'Custom',
    baseUrl: '',
    defaultModel: '',
    description: 'Manually enter API configuration',
    models: []
  }
];

export class AuthService {
  private authConfig: XAgentAuthConfig;

  constructor(authConfig: XAgentAuthConfig) {
    this.authConfig = authConfig;
  }

  async authenticate(): Promise<boolean> {
    let result: boolean;
    switch (this.authConfig.type) {
      case AuthType.OAUTH_XAGENT:
        result = await this.authenticateWithXAgent();
        break;
      case AuthType.OPENAI_COMPATIBLE:
        result = await this.authenticateWithOpenAICompatible();
        break;
      default:
        throw new Error(`Unknown auth type: ${this.authConfig.type}`);
    }

    return result;
  }

  private async authenticateWithXAgent(): Promise<boolean> {
    logger.info('Authenticating with xAgent...', 'Please complete the authentication in your browser');

    try {
      // 1. Start HTTP server to receive callback
      const token = await this.retrieveXAgentToken();

      // 2. 调用后端验证用户
      const xagentApiBaseUrl = this.authConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      const response = await axios.get(`${xagentApiBaseUrl}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
        httpsAgent
      });

      // 3. Set authentication configuration
      this.authConfig.baseUrl = `${xagentApiBaseUrl}/v1`;
      this.authConfig.xagentApiBaseUrl = xagentApiBaseUrl;
      this.authConfig.apiKey = token;
    this.authConfig.type = AuthType.OAUTH_XAGENT;

      logger.success('Successfully authenticated with xAgent!');
      return true;
    } catch (error: any) {
      logger.error('Authentication failed', error.message || 'Unknown error');
      logger.debug('Full error:', JSON.stringify(error.response?.data || error.message));
      return false;
    }
  }

  private async authenticateWithOpenAICompatible(): Promise<boolean> {
    logger.info('Configuring third-party model API...\n');

    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Select third-party model provider:',
        choices: THIRD_PARTY_PROVIDERS.map(p => ({
          name: `${p.name} - ${p.description}`,
          value: p
        }))
      }
    ]);

    const selectedProvider = provider as ThirdPartyProvider;

    let baseUrl = selectedProvider.baseUrl;
    let modelName = selectedProvider.defaultModel;

    if (selectedProvider.name === 'Custom') {
      const customAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'baseUrl',
          message: 'Enter API Base URL:',
          default: 'https://api.openai.com/v1',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'Base URL cannot be empty';
            }
            return true;
          }
        },
        {
          type: 'input',
          name: 'modelName',
          message: 'Enter model name:',
          default: 'gpt-4',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'Model name cannot be empty';
            }
            return true;
          }
        }
      ]);

      baseUrl = (customAnswers.baseUrl as string).trim();
      modelName = (customAnswers.modelName as string).trim();
    } else {
      logger.info(`\nSelected: ${selectedProvider.name}`);
      logger.info(`API URL: ${baseUrl}`);

      if (selectedProvider.models && selectedProvider.models.length > 0) {
        logger.info(`Available models: ${selectedProvider.models.join(', ')}`);

        const { selectedModel } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedModel',
            message: 'Select model:',
            choices: selectedProvider.models.map(model => ({
              name: model === selectedProvider.defaultModel ? `${model} (default)` : model,
              value: model
            }))
          }
        ]);

        modelName = selectedModel;
      } else {
        logger.info(`Default model: ${modelName}\n`);

        const { confirmModel } = await inquirer.prompt([
          {
            type: 'input',
            name: 'modelName',
            message: `Enter model name (press Enter to use default value ${modelName}):`,
            default: modelName,
            validate: (input: string) => {
              if (!input || input.trim().length === 0) {
                return 'Model name cannot be empty';
              }
              return true;
            }
          }
        ]);

        modelName = (confirmModel as string).trim();
      }
    }

    const { apiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: `Enter ${selectedProvider.name} API Key:`,
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'API Key cannot be empty';
          }
          return true;
        }
      }
    ]);

    this.authConfig.baseUrl = baseUrl;
    this.authConfig.apiKey = (apiKey as string).trim();
    this.authConfig.modelName = modelName;
    this.authConfig.type = AuthType.OPENAI_COMPATIBLE;

    const isValid = await this.validateApiKey();
    if (isValid) {
      logger.success(`${selectedProvider.name} configured successfully!`, `Model: ${modelName}, API: ${baseUrl}`);
      logger.info(`   Model: ${modelName}`);
      logger.info(`   API URL: ${baseUrl}`);
      return true;
    } else {
      logger.error(`${selectedProvider.name} configuration verification failed, please check API Key and network connection.`, 'Verify your API Key and network connection');
      return false;
    }
  }

  private async validateApiKey(): Promise<boolean> {
    try {
      // Check if it's MiniMax-M2 (uses Anthropic format)
      if ((this.authConfig.baseUrl?.includes('minimax.chat') || 
           this.authConfig.baseUrl?.includes('minimaxi.com')) &&
          this.authConfig.baseUrl?.includes('anthropic')) {
        // MiniMax-M2 uses Anthropic format with x-api-key header
        const response = await axios.post(
          `${this.authConfig.baseUrl}/v1/messages`,
          {
            model: 'MiniMax-M2',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }]
          },
          {
            headers: {
              'x-api-key': this.authConfig.apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );
        return response.status === 200;
      }

      // Standard OpenAI compatible API
      const response = await axios.get(
        `${this.authConfig.baseUrl}/models`,
        {
          headers: {
            'Authorization': `Bearer ${this.authConfig.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      return response.status === 200;
    } catch (error: any) {
      // Provide user-friendly error messages without exposing stack traces
      if (error.response) {
        const status = error.response.status;
        
        if (status === 401) {
          logger.error('API Key verification failed: Invalid or expired API Key', `Verify your API Key is correct and has not expired`);
        } else if (status === 403) {
          logger.error('API Key verification failed: Access denied', `Check if your API Key has permission to access`);
        } else if (status === 404) {
          logger.error('API request failed: API endpoint not found', `Verify your API Base URL is correct`);
        } else if (status === 429) {
          logger.error('API rate limit exceeded', `Please wait before retrying`);
        } else {
          logger.error(`API Key verification failed (HTTP ${status})`, `Verify your API Key and network connection`);
        }
      } else if (error.code === 'ECONNREFUSED') {
        logger.error('Failed to connect to API server', `Verify your API Base URL and network connection`);
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        logger.error('API request timed out', `Check your network connection and try again`);
      } else {
        logger.error('API Key verification failed', `Verify your API Key and network connection`);
      }
      return false;
    }
  }

  private async retrieveXAgentToken(): Promise<string> {
    // Debug: Log environment variable at method call time
    logger.debug('[AUTH-METHOD] XAGENT_BASE_URL:', process.env.XAGENT_BASE_URL || '(not set)');
    
    // Use xagentApiBaseUrl from config, fallback to default
    const webBaseUrl = this.authConfig.xagentApiBaseUrl || 'https://www.xagent-colife.net';
    logger.debug('[AUTH] authConfig.xagentApiBaseUrl:', this.authConfig.xagentApiBaseUrl);
    logger.debug('[AUTH] webBaseUrl:', webBaseUrl);

    // Determine if we're in local development mode
    const isLocalDev = webBaseUrl.includes('localhost') || webBaseUrl.includes('127.0.0.1');

    // Use frontend URL for login - both local dev and production use frontend routing
    // Local dev: frontend runs on port 3000
    // Production: frontend is served via nginx reverse proxy at the same domain
    let loginUrl: string;
    let callbackUrl: string;

    // Always use frontend URL for login page
    const frontendUrl = isLocalDev
      ? (process.env.FRONTEND_URL || 'http://localhost:3000')
      : webBaseUrl;

    callbackUrl = `${webBaseUrl}/callback`;
    loginUrl = `${frontendUrl}/login?callback=${encodeURIComponent(callbackUrl)}`;

    // 如果已有保存的token，通过URL参数传给Web页面
    const existingToken = this.authConfig.apiKey;
    const existingRefreshToken = this.authConfig.refreshToken;

    // 构建登录URL - 如果已有token也传给Web
    if (existingToken) {
      loginUrl += `&existingToken=${encodeURIComponent(existingToken)}`;
      if (existingRefreshToken) {
        loginUrl += `&existingRefreshToken=${encodeURIComponent(existingRefreshToken)}`;
      }
    }

    logger.debug('[AUTH] Opening login URL:', loginUrl);

    // Open browser for login, then poll server for token
    await open(loginUrl);
    logger.info('Waiting for authentication...', 'Please complete login in your browser');

    // Poll server to get token
    return new Promise((resolve, reject) => {
      const pollInterval = 2000; // Poll every 2 seconds
      const maxWaitTime = 30 * 60 * 1000; // 30 minutes timeout
      const startTime = Date.now();

      const poll = async () => {
        if (Date.now() - startTime > maxWaitTime) {
          logger.warn('Authentication timeout after 30 minutes');
          reject(new Error('Authentication timeout'));
          return;
        }

        try {
          // Create HTTPS agent that ignores certificate errors (for IP-based access)
          const httpsAgent = new https.Agent({ rejectUnauthorized: false });
          
          const response = await axios.get(`${webBaseUrl}/api/cli/get-token`, {
            timeout: 10000,
            httpsAgent
          });

          if (response.data.token) {
            logger.success('Authentication successful! Received token');
            logger.debug('[CLI-Auth] Token stored, key:', response.data.token.substring(0, 20) + '...');
            // Save refresh token if provided
            if (response.data.refreshToken) {
              this.authConfig.refreshToken = response.data.refreshToken;
            }
            resolve(response.data.token);
            return;
          }
        } catch (error: any) {
          if (error.response?.status === 404) {
            // Token not ready yet, continue polling
          } else {
            console.error('[CLI-Auth] Polling error:', error.message);
          }
        }

        // Continue polling
        setTimeout(poll, pollInterval);
      };

      // Start polling
      setTimeout(poll, pollInterval);
    });
  }

  getAuthConfig(): AuthConfig {
    return { ...this.authConfig, type: this.authConfig.type };
  }

  updateAuthConfig(config: Partial<AuthConfig>): void {
    this.authConfig = { ...this.authConfig, ...config };
  }

  /**
   * Configure and validate VLM for GUI Agent
   * Returns { model, baseUrl, apiKey } if successful, null if failed or cancelled
   */
  async configureAndValidateVLM(): Promise<{ model: string; baseUrl: string; apiKey: string } | null> {
    logger.info('\n🔧 Configuring VLM for GUI Agent...', 'Vision-Language Model for browser/desktop automation\n');

    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Select VLM provider for GUI automation:',
        choices: VLM_PROVIDERS.map(p => ({
          name: `${p.name}`,
          value: p
        }))
      }
    ]);

    const selectedProvider = provider as VLMProviderInfo;

    logger.info(`\nSelected: ${selectedProvider.name}`);
    logger.info(`API URL: ${selectedProvider.baseUrl}`);
    logger.info(`Available models: ${selectedProvider.models.join(', ')}`);

    const { selectedModel } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedModel',
        message: 'Select VLM model:',
        choices: selectedProvider.models.map(model => ({
          name: model === selectedProvider.defaultModel ? `${model} (default)` : model,
          value: model
        }))
      }
    ]);

    const { baseUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Enter VLM API Base URL:',
        default: selectedProvider.baseUrl,
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'Base URL cannot be empty';
          }
          return true;
        }
      }
    ]);

    const { apiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: `Enter ${selectedProvider.name} API Key:`,
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'API Key cannot be empty';
          }
          return true;
        }
      }
    ]);

    const vlmConfig = {
      model: selectedModel as string,
      baseUrl: (baseUrl as string).trim(),
      apiKey: (apiKey as string).trim()
    };

    const isValid = await this.validateVLMApiKey(vlmConfig.baseUrl, vlmConfig.apiKey);
    if (isValid) {
      logger.success(`${selectedProvider.name} VLM configured successfully!`, `Model: ${vlmConfig.model}`);
      return vlmConfig;
    } else {
      return null;
    }
  }

  private async validateVLMApiKey(baseUrl: string, apiKey: string): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Anthropic uses x-api-key header
      if (baseUrl.includes('anthropic.com')) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await axios.get(
        `${baseUrl}/models`,
        { headers, timeout: 10000 }
      );
      return response.status === 200;
    } catch (error: any) {
      // Provide user-friendly error messages without exposing stack traces
      // Distinguish between API Key errors and Base URL errors
      
      // Check if we received an HTTP response from server
      if (error.response) {
        const status = error.response.status;
        
        // Server responded but with error - API Key or permissions issue
        if (status === 401 || status === 403) {
          logger.error('VLM API authentication failed: Invalid API Key', `Verify your API Key is correct and has not expired`);
        } else if (status === 429) {
          logger.error('VLM API rate limit exceeded', `Please wait before retrying`);
        } else if (status === 404) {
          // 404 with valid response means base URL is valid but endpoint doesn't exist
          logger.error('VLM API error: API endpoint not found (404)', `Verify your API Base URL is correct`);
        } else {
          logger.error(`VLM API request failed (HTTP ${status})`, `Verify your API Base URL and API Key`);
        }
        return false;
      }
      
      // No HTTP response - server not reached or URL invalid
      // These indicate Base URL issues
      const networkErrors = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'EPROTO', 'ERR_INVALID_URL'];
      
      if (networkErrors.includes(error.code) || 
          error.message?.includes('Invalid URL') ||
          error.message?.includes('getaddrinfo') ||
          error.message?.includes('socket hang up')) {
        logger.error('VLM API connection failed: Unable to reach the server', `Verify your API Base URL is correct and accessible`);
        return false;
      }
      
      // Fallback for unknown errors
      logger.error('VLM API request failed', `Verify your API Base URL and API Key`);
      return false;
    }
  }
}

export async function selectAuthType(): Promise<AuthType> {
  const { authType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'authType',
      message: 'Select authentication method:',
      choices: [
        { name: 'Log in with xAgent – Start your free trial', value: AuthType.OAUTH_XAGENT },
        { name: 'Use third-party model APIs (e.g., Zhipu GLM-4.7, MiniMax)', value: AuthType.OPENAI_COMPATIBLE }
      ]
    }
  ]);

  return authType;
}
