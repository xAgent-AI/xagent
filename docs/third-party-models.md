# Third-Party Model Configuration Guide

xAgent CLI supports connecting to various third-party LLM providers through OpenAI-compatible APIs. This guide details how to configure and use these models.

## Table of Contents

- [Supported Model Providers](#supported-model-providers)
- [Quick Start](#quick-start)
- [Detailed Configuration Steps](#detailed-configuration-steps)
- [Configuration Examples by Provider](#configuration-examples-by-provider)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

## Supported Model Providers

xAgent CLI has built-in support for the following third-party model providers:

| Provider | Model Names | Description |
|----------|-------------|-------------|
| **Zhipu AI (ChatGLM)** | glm-5, glm-4, glm-4-flash, glm-4-plus | GLM-5 Series Models |
| **DeepSeek** | deepseek-chat, deepseek-coder | DeepSeek Series Models |
| **Alibaba Qwen** | qwen-max, qwen-plus, qwen-turbo | Alibaba Cloud Qwen Series |
| **Baidu Wenxin Yiyu** | ernie-bot-4, ernie-bot-turbo | Baidu Intelligence Cloud Wenxin Series |
| **Moonshot AI (Kimi)** | moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k | Moonshot Kimi Series |

## Quick Start

### 1. Run Authentication Command

```bash
xagent auth
```

### 2. Select Authentication Method

In the menu that appears, select:

? Select authentication method:
  Use xAgent account (recommended)
  Use xAgent API Key
❯ Use third-party model API (Zhipu GLM-5, DeepSeek, etc.)

### 3. Select Model Provider

? Select third-party model provider:
❯ Zhipu AI (GLM-5) - Zhipu AI GLM-5 Series Models
  DeepSeek - DeepSeek Series Models
  Alibaba Qwen - Alibaba Cloud Qwen Series Models
  Baidu Wenxin Yiyu - Baidu Intelligence Cloud Wenxin Series Models
  Moonshot AI (Kimi) - Moonshot Kimi Series Models
  Custom - Manually enter API configuration

### 4. Enter API Key

? Enter Zhipu AI (GLM-5) API Key: ****************************

### 5. Confirm Model Name

? Enter model name (press Enter for default: glm-4): glm-4

### 6. Wait for Verification

The system will automatically verify your API Key configuration.

✅ Zhipu AI (GLM-5) configuration successful!

## Detailed Configuration Steps

### Step 1: Obtain API Key

Before using third-party models, you need to register and obtain an API Key on the respective platform.

#### Zhipu AI (ChatGLM)

1. Visit [Zhipu AI Open Platform](https://open.bigmodel.cn/)
2. Register and log in to your account
3. Go to [API Keys Management Page](https://open.bigmodel.cn/usercenter/apikeys)
4. Click "Create New API Key"
5. Copy the generated API Key

#### DeepSeek

1. Visit [DeepSeek Open Platform](https://platform.deepseek.com/)
2. Register and log in to your account
3. Go to [API Keys Page](https://platform.deepseek.com/api_keys)
4. Click "Create API Key"
5. Copy the generated API Key

#### Alibaba Qwen

1. Visit [Alibaba Cloud Bailian Platform](https://bailian.console.aliyun.com/)
2. Register and log in to your Alibaba Cloud account
3. Go to [API-KEY Management](https://dashscope.console.aliyun.com/apiKey)
4. Create a new API-KEY
5. Copy the generated API Key

#### Baidu Wenxin Yiyu

1. Visit [Baidu Intelligence Cloud Qianfan Platform](https://cloud.baidu.com/product/wenxinworkshop)
2. Register and log in to your Baidu account
3. Go to [Application List](https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application)
4. Create an application and obtain API Key and Secret Key
5. Copy the generated API Key

#### Moonshot AI (Kimi)

1. Visit [Moonshot AI Platform](https://platform.moonshot.cn/)
2. Register and log in to your account
3. Go to [API Keys Page](https://platform.moonshot.cn/console/api-keys)
4. Click "Create API Key"
5. Copy the generated API Key

### Step 2: Configure xAgent CLI

Follow the steps in [Quick Start](#quick-start) to configure.

### Step 3: Verify Configuration

After configuration, start xAgent CLI to test:

```bash
xagent start
```

Try sending a simple message:

```
> Hello, please introduce yourself
```

If the model responds normally, the configuration is successful.

## Configuration Examples by Provider

### Zhipu AI (ChatGLM)

#### Configuration File Method

Edit `~/.xagent/settings.json`:

```json
{
  "selectedAuthType": "openai_compatible",
  "apiKey": "your-glm-api-key",
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "modelName": "glm-5"
}
```

#### Available Models

- `glm-5` - GLM-5 Standard
- `glm-4` - GLM-4 Standard
- `glm-4-flash` - GLM-4 Flash (Fast Version)
- `glm-4-plus` - GLM-4 Plus (Enhanced Version)
- `glm-4-0520` - GLM-4 0520 Version
- `glm-4-air` - GLM-4 Air (Lightweight Version)

#### Usage Example

```bash
$ xagent auth
# Select: Use third-party model API (Zhipu GLM-5, DeepSeek, etc.)
# Select: Zhipu AI (GLM-5) - Zhipu AI GLM-5 Series Models
# Enter API Key: (your GLM API key)
# Enter model name: glm-5
```

### DeepSeek

#### Configuration File Method

Edit `~/.xagent/settings.json`:

```json
{
  "selectedAuthType": "openai_compatible",
  "apiKey": "your-deepseek-api-key",
  "baseUrl": "https://api.deepseek.com",
  "modelName": "deepseek-chat"
}
```

#### Available Models

- `deepseek-chat` - DeepSeek Chat General Dialogue Model
- `deepseek-coder` - DeepSeek Coder Code Generation Model

#### Usage Example

```bash
$ xagent auth
# Select: Use third-party model API (Zhipu GLM-5, DeepSeek, etc.)
# Select: DeepSeek - DeepSeek Series Models
# Enter API Key: (your DeepSeek API key)
# Enter model name: deepseek-coder
```

### Alibaba Qwen

#### Configuration File Method

Edit `~/.xagent/settings.json`:

```json
{
  "selectedAuthType": "openai_compatible",
  "apiKey": "your-aliyun-api-key",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "modelName": "qwen-max"
}
```

#### Available Models

- `qwen-max` - Qwen Most Powerful Model
- `qwen-plus` - Qwen Enhanced Version
- `qwen-turbo` - Qwen Fast Version
- `qwen-long` - Qwen Long Text Version

#### Usage Example

```bash
$ xagent auth
# Select: Use third-party model API (Zhipu GLM-5, DeepSeek, etc.)
# Select: Alibaba Qwen - Alibaba Cloud Qwen Series Models
# Enter API Key: (your Aliyun API key)
# Enter model name: qwen-max
```

### Baidu Wenxin Yiyu

#### Configuration File Method

Edit `~/.xagent/settings.json`:

```json
{
  "selectedAuthType": "openai_compatible",
  "apiKey": "your-baidu-api-key",
  "baseUrl": "https://wenxin.baidu.com/moduleApi/paapi/",
  "modelName": "ernie-bot-4"
}
```

#### Available Models

- `ernie-bot-4` - Wenxin Yiyu 4.0
- `ernie-bot-turbo` - Wenxin Yiyu Turbo
- `ernie-speed` - Wenxin Yiyu Speed

#### Usage Example

```bash
$ xagent auth
# Select: Use third-party model API (Zhipu GLM-5, DeepSeek, etc.)
# Select: Baidu Wenxin Yiyu - Baidu Intelligence Cloud Wenxin Series Models
# Enter API Key: (your Baidu API key)
# Enter model name: ernie-bot-4
```

### Moonshot AI (Kimi)

#### Configuration File Method

Edit `~/.xagent/settings.json`:

```json
{
  "selectedAuthType": "openai_compatible",
  "apiKey": "your-moonshot-api-key",
  "baseUrl": "https://api.moonshot.cn/v1",
  "modelName": "moonshot-v1-32k"
}
```

#### Available Models

- `moonshot-v1-8k` - Kimi 8K Context
- `moonshot-v1-32k` - Kimi 32K Context
- `moonshot-v1-128k` - Kimi 128K Context

#### Usage Example

```bash
$ xagent auth
# Select: Use third-party model API (Zhipu GLM-5, DeepSeek, etc.)
# Select: Moonshot AI (Kimi) - Moonshot Kimi Series Models
# Enter API Key: (your Moonshot API key)
# Enter model name: moonshot-v1-32k
```

## Custom Configuration

If the model you need is not in the built-in provider list, you can choose "Custom" option for manual configuration.

### Configuration Steps

1. Run `xagent auth`
2. Select "Use third-party model API (Zhipu GLM-5, DeepSeek, etc.)"
3. Select "Custom - Manually enter API configuration"
4. Enter the following information:
   - Model Name
   - Base URL
   - API Key

### Configuration File Method

Edit `~/.xagent/settings.json`:

```json
{
  "selectedAuthType": "openai_compatible",
  "apiKey": "your-custom-api-key",
  "baseUrl": "https://your-custom-api-endpoint/v1",
  "modelName": "your-model-name"
}
```

### Notes

1. **API Compatibility**: Ensure your API provider supports OpenAI-compatible Chat Completions API format
2. **Request Format**: xAgent CLI uses standard OpenAI API request format
3. **Authentication Method**: Most third-party models use Bearer Token authentication
4. **Endpoint Path**: Confirm if the API Base URL contains the correct path (e.g., `/v1`)

## Troubleshooting

### Issue 1: API Key Validation Failed

**Error Message**:

```
❌ Zhipu AI (GLM-5) configuration validation failed. Please check API Key and network connection.
```

**Solutions**:
1. Check if API Key is copied correctly
2. Confirm if API Key is valid and not expired
3. Check if network connection is normal
4. Confirm if API service is running properly

### Issue 2: Model Response Timeout

**Error Message**:

```
Request timeout, please check network connection or try again
```

**Solutions**:
1. Check network connection
2. Confirm if API service is normal
3. Try using a different model
4. Check firewall settings

### Issue 3: Incorrect Model Name

**Error Message**:

```
Model not found, please check model name
```

**Solutions**:
1. Confirm if model name is correct
2. Refer to official documentation of each provider for correct model names
3. Check if model name case is correct

### Issue 4: Insufficient Quota

**Error Message**:

```
API quota exceeded, please upgrade your plan or try again later
```

**Solutions**:
1. Check if API account quota is sufficient
2. Wait and try again later
3. Upgrade API account plan

## FAQ

### Q1: How to switch between different third-party models?

**A**: Re-run the `xagent auth` command and select the new model provider.

### Q2: Can I configure multiple model providers at the same time?

**A**: The current version only supports configuring one model provider. To switch, you need to re-run the authentication command.

### Q3: How are third-party model fees calculated?

**A**: Fees are calculated independently by each third-party model provider. Please refer to the official pricing of each provider for specific prices.

### Q4: Will using third-party models affect xAgent's functionality?

**A**: No. All xAgent features (such as tool calls, file operations, etc.) can be used normally, just with a different underlying LLM provider.

### Q5: How to view the currently configured model information?

**A**: You can view the configuration file `~/.xagent/settings.json`, or run the following command:

```bash
cat ~/.xagent/settings.json
```

### Q6: Is my API Key secure?

**A**: API Key is securely stored in the local configuration file and will not be uploaded to the xAgent server. Please keep your API Key safe.

### Q7: How to delete a configured API Key?

**A**: Edit the `~/.xagent/settings.json` file, delete or clear the `apiKey` field, then re-run `xagent auth` to reconfigure.

### Q8: Does it support streaming output?

**A**: Yes, xAgent CLI supports streaming output and can display model responses in real-time.

## Technical Support

If you encounter issues, you can get help through:

1. View [xAgent Official Documentation](https://platform.xagent.cn/)
2. Submit [GitHub Issue](https://github.com/xagent-ai/xagent-cli/issues)
3. Contact xAgent Technical Support

## Changelog

- Added third-party model API support
- Built-in support for Zhipu AI, DeepSeek, Qwen, Wenxin Yiyu, Kimi and other mainstream models
- Optimized authentication flow with preset configuration options
- Added secure API Key input (password mask)
- Improved configuration verification mechanism

## License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

**Note**: When using third-party models, please comply with the terms of service and agreements of each provider.