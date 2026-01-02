import axios from 'axios';
import open from 'open';
import inquirer from 'inquirer';
import http from 'http';
import { AuthConfig, AuthType } from './types.js';

interface ThirdPartyProvider {
  name: string;
  baseUrl: string;
  defaultModel: string;
  description: string;
}

const THIRD_PARTY_PROVIDERS: ThirdPartyProvider[] = [
  {
    name: '智谱AI (GLM-4)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    defaultModel: 'glm-4',
    description: '智谱AI GLM-4系列模型'
  },
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    description: '深度求索 DeepSeek系列模型'
  },
  {
    name: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    description: '阿里云通义千问系列模型'
  },
  {
    name: '百度文心一言',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
    defaultModel: 'ernie-bot-4',
    description: '百度智能云文心一言系列模型'
  },
  {
    name: '月之暗面 (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    description: '月之暗面 Kimi系列模型'
  },
  {
    name: '自定义',
    baseUrl: '',
    defaultModel: '',
    description: '手动输入API配置'
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
    console.log('Authenticating with xAgent...');
    try {
      const authUrl = 'https://xagent.cn/auth/cli';
      const callbackUrl = 'http://localhost:8080/callback';

      console.log('Opening browser for authentication...');
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
        console.log('Authentication cancelled.');
        return false;
      }

      this.authConfig.baseUrl = 'https://apis.xagent.cn/v1';
      this.authConfig.apiKey = await this.retrieveXAgentToken();
      
      console.log('✅ Successfully authenticated with xAgent!');
      return true;
    } catch (error) {
      console.error('❌ xAgent authentication failed:', error);
      return false;
    }
  }

  private async authenticateWithApiKey(): Promise<boolean> {
    console.log('使用API Key认证...');

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'apiKey',
        message: '输入你的xAgent API Key:',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'API Key不能为空';
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
      console.log('✅ API Key验证成功!');
      return true;
    } else {
      console.error('❌ API Key无效，请重试。');
      return false;
    }
  }

  private async authenticateWithOpenAICompatible(): Promise<boolean> {
    console.log('配置第三方模型API...\n');

    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: '选择第三方模型提供商:',
        choices: THIRD_PARTY_PROVIDERS.map(p => ({
          name: `${p.name} - ${p.description}`,
          value: p
        }))
      }
    ]);

    const selectedProvider = provider as ThirdPartyProvider;

    let baseUrl = selectedProvider.baseUrl;
    let modelName = selectedProvider.defaultModel;

    if (selectedProvider.name === '自定义') {
      const customAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'baseUrl',
          message: '输入API Base URL:',
          default: 'https://api.openai.com/v1',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'Base URL不能为空';
            }
            return true;
          }
        },
        {
          type: 'input',
          name: 'modelName',
          message: '输入模型名称:',
          default: 'gpt-4',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return '模型名称不能为空';
            }
            return true;
          }
        }
      ]);

      baseUrl = (customAnswers.baseUrl as string).trim();
      modelName = (customAnswers.modelName as string).trim();
    } else {
      console.log(`\n已选择: ${selectedProvider.name}`);
      console.log(`API地址: ${baseUrl}`);
      console.log(`默认模型: ${modelName}\n`);

      const { confirmModel } = await inquirer.prompt([
        {
          type: 'input',
          name: 'modelName',
          message: `输入模型名称 (直接回车使用默认值 ${modelName}):`,
          default: modelName,
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return '模型名称不能为空';
            }
            return true;
          }
        }
      ]);

      modelName = (confirmModel as string).trim();
    }

    const { apiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: `输入${selectedProvider.name}的API Key:`,
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'API Key不能为空';
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
      console.log(`✅ ${selectedProvider.name}配置成功!`);
      return true;
    } else {
      console.error(`❌ ${selectedProvider.name}配置验证失败，请检查API Key和网络连接。`);
      return false;
    }
  }

  private async validateApiKey(): Promise<boolean> {
    try {
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
        console.log('Waiting for authentication callback on http://localhost:8080...');
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
      message: '选择认证方式:',
      choices: [
        { name: '使用xAgent账号登录 (推荐)', value: AuthType.OAUTH_XAGENT },
        { name: '使用xAgent API Key', value: AuthType.API_KEY },
        { name: '使用第三方模型API (智谱GLM-4、DeepSeek等)', value: AuthType.OPENAI_COMPATIBLE }
      ]
    }
  ]);

  return authType;
}
