import axios from 'axios';
import open from 'open';
import inquirer from 'inquirer';
import http from 'http';
import { AuthConfig, AuthType } from './types.js';
import { getLogger } from './logger.js';

const logger = getLogger();

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
    name: 'MiniMax-M2',
    baseUrl: 'https://api.minimax.chat/anthropic',
    defaultModel: 'MiniMax-M2',
    description: 'MiniMax-M2 (Anthropic-compatible format)',
    models: ['MiniMax-M2', 'MiniMax-M2-Stable']
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
  private authConfig: AuthConfig;

  constructor(authConfig: AuthConfig) {
    this.authConfig = authConfig;
  }

  async authenticate(): Promise<boolean> {
    switch (this.authConfig.type) {
      case AuthType.OAUTH_XAGENT:
        return await this.authenticateWithXAgent();
      case AuthType.API_KEY:
        return await this.authenticateWithApiKey();
      case AuthType.OPENAI_COMPATIBLE:
        return await this.authenticateWithOpenAICompatible();
      default:
        throw new Error(`Unknown auth type: ${this.authConfig.type}`);
    }
  }

  private async authenticateWithXAgent(): Promise<boolean> {
    logger.info('Authenticating with xAgent...', 'Please complete the authentication in your browser');
    try {
      const authUrl = 'https://xagent.cn/auth/cli';
      const callbackUrl = 'http://localhost:8080/callback';

      logger.info('Opening browser for authentication...');
      await open(`${authUrl}?callback=${encodeURIComponent(callbackUrl)}`);

      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Have you completed the authentication in your browser?',
          default: false
        }
      ]);

      const confirm = answers.confirm as boolean;

      if (!confirm) {
        logger.warn('Authentication cancelled.', 'Run /auth again to retry');
        return false;
      }

      this.authConfig.baseUrl = 'https://apis.xagent.cn/v1';
      this.authConfig.apiKey = await this.retrieveXAgentToken();
      
      logger.success('Successfully authenticated with xAgent!', 'You can now start using xAgent CLI');
      return true;
    } catch (error) {
      logger.error('xAgent authentication failed', 'Check your network connection and try again');
      return false;
    }
  }

  private async authenticateWithApiKey(): Promise<boolean> {
    logger.info('Authenticating with API Key...');

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'apiKey',
        message: 'Enter your xAgent API Key:',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'API Key cannot be empty';
          }
          return true;
        }
      }
    ]);

    const apiKey = answers.apiKey as string;

    this.authConfig.apiKey = apiKey.trim();
    this.authConfig.baseUrl = 'https://apis.xagent.cn/v1';

    const isValid = await this.validateApiKey();
    if (isValid) {
      logger.success('API Key verified successfully!', 'You can now start using xAgent CLI');
      return true;
    } else {
      logger.error('Invalid API Key, please try again.', 'Make sure you entered the correct API Key');
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
    } catch (error) {
      console.error('API Key validation failed:', error);
      return false;
    }
  }

  private async retrieveXAgentToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req: any, res: any) => {
        if (req.url.startsWith('/callback')) {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const token = url.searchParams.get('token');

          if (token) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>Authentication Successful!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </body>
              </html>
            `);
            server.close();
            resolve(token);
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>Authentication Failed</h1>');
            server.close();
            reject(new Error('No token received'));
          }
        }
      });

      server.listen(8080, () => {
        logger.info('Waiting for authentication callback on http://localhost:8080...', 'Complete the authentication in your browser');
      });

      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timeout'));
      }, 300000);
    });
  }

  getAuthConfig(): AuthConfig {
    return { ...this.authConfig };
  }

  updateAuthConfig(config: Partial<AuthConfig>): void {
    this.authConfig = { ...this.authConfig, ...config };
  }
}

export async function selectAuthType(): Promise<AuthType> {
  const { authType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'authType',
      message: 'Select authentication method:',
      choices: [
        { name: 'Login with xAgent account (recommended)', value: AuthType.OAUTH_XAGENT },
        { name: 'Use xAgent API Key', value: AuthType.API_KEY },
        { name: 'Use third-party model API (Zhipu GLM-4, DeepSeek, etc.)', value: AuthType.OPENAI_COMPATIBLE }
      ]
    }
  ]);

  return authType;
}
