# 第三方模型配置指南

xAgent CLI 支持通过 OpenAI 兼容 API 连接各种第三方大语言模型提供商。本指南将详细介绍如何配置和使用这些模型。

## 目录

- [支持的模型提供商](#支持的模型提供商)
- [快速开始](#快速开始)
- [详细配置步骤](#详细配置步骤)
- [各提供商配置示例](#各提供商配置示例)
- [故障排查](#故障排查)
- [常见问题](#常见问题)

## 支持的模型提供商

xAgent CLI 内置支持以下第三方模型提供商：

| 提供商 | 模型名称 | 描述 |
|--------|----------|------|
| **智谱AI** | glm-4, glm-4-flash, glm-4-plus | GLM-4 系列模型 |
| **DeepSeek** | deepseek-chat, deepseek-coder | 深度求索系列模型 |
| **阿里通义千问** | qwen-max, qwen-plus, qwen-turbo | 阿里云通义千问系列 |
| **百度文心一言** | ernie-bot-4, ernie-bot-turbo | 百度智能云文心一言 |
| **月之暗面 (Kimi)** | moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k | 月之暗面 Kimi 系列 |

## 快速开始

### 1. 运行认证命令

```bash
xagent auth
```

### 2. 选择认证方式

在弹出的菜单中选择：
```
? 选择认证方式:
  使用xAgent账号登录 (推荐)
  使用xAgent API Key
❯ 使用第三方模型API (智谱GLM-4、DeepSeek等)
```

### 3. 选择模型提供商

```
? 选择第三方模型提供商:
❯ 智谱AI (GLM-4) - 智谱AI GLM-4系列模型
  DeepSeek - 深度求索 DeepSeek系列模型
  阿里通义千问 - 阿里云通义千问系列模型
  百度文心一言 - 百度智能云文心一言系列模型
  月之暗面 (Kimi) - 月之暗面 Kimi系列模型
  自定义 - 手动输入API配置
```

### 4. 输入 API Key

```
? 输入智谱AI (GLM-4)的API Key: ****************************
```

### 5. 确认模型名称

```
? 输入模型名称 (直接回车使用默认值 glm-4): glm-4
```

### 6. 等待验证

系统会自动验证你的 API Key 配置是否正确。

```
✅ 智谱AI (GLM-4)配置成功!
```

## 详细配置步骤

### 步骤 1: 获取 API Key

在使用第三方模型之前，你需要先在相应的平台上注册并获取 API Key。

#### 智谱AI (GLM-4)

1. 访问 [智谱AI开放平台](https://open.bigmodel.cn/)
2. 注册并登录账号
3. 进入 [API Keys 管理页面](https://open.bigmodel.cn/usercenter/apikeys)
4. 点击"创建新的 API Key"
5. 复制生成的 API Key

#### DeepSeek

1. 访问 [DeepSeek 开放平台](https://platform.deepseek.com/)
2. 注册并登录账号
3. 进入 [API Keys 页面](https://platform.deepseek.com/api_keys)
4. 点击"创建 API Key"
5. 复制生成的 API Key

#### 阿里通义千问

1. 访问 [阿里云百炼平台](https://bailian.console.aliyun.com/)
2. 注册并登录阿里云账号
3. 进入 [API-KEY 管理](https://dashscope.console.aliyun.com/apiKey)
4. 创建新的 API-KEY
5. 复制生成的 API Key

#### 百度文心一言

1. 访问 [百度智能云千帆平台](https://cloud.baidu.com/product/wenxinworkshop)
2. 注册并登录百度账号
3. 进入 [应用列表](https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application)
4. 创建应用并获取 API Key 和 Secret Key
5. 复制生成的 API Key

#### 月之暗面 (Kimi)

1. 访问 [Moonshot AI 平台](https://platform.moonshot.cn/)
2. 注册并登录账号
3. 进入 [API Keys 页面](https://platform.moonshot.cn/console/api-keys)
4. 点击"创建 API Key"
5. 复制生成的 API Key

### 步骤 2: 配置 xAgent CLI

按照[快速开始](#快速开始)中的步骤进行配置。

### 步骤 3: 验证配置

配置完成后，启动 xAgent CLI 进行测试：

```bash
xagent start
```

尝试发送一条简单的消息：

```
> 你好，请介绍一下你自己
```

如果模型能够正常回复，说明配置成功。

## 各提供商配置示例

### 智谱AI (GLM-4)

#### 配置文件方式

编辑 `~/.xagent/settings.json`：

```json
{
  "selectedAuthType": "openai-compatible",
  "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4/",
  "apiKey": "your-glm-api-key-here",
  "modelName": "glm-4"
}
```

#### 可用模型

- `glm-4` - GLM-4 标准版
- `glm-4-flash` - GLM-4 Flash（快速版）
- `glm-4-plus` - GLM-4 Plus（增强版）
- `glm-4-0520` - GLM-4 0520 版本
- `glm-4-air` - GLM-4 Air（轻量版）

#### 使用示例

```bash
xagent auth
# 选择: 使用第三方模型API (智谱GLM-4、DeepSeek等)
# 选择: 智谱AI (GLM-4) - 智谱AI GLM-4系列模型
# 输入API Key: (your GLM API key)
# 输入模型名称: glm-4-plus
```

### DeepSeek

#### 配置文件方式

编辑 `~/.xagent/settings.json`：

```json
{
  "selectedAuthType": "openai-compatible",
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "your-deepseek-api-key-here",
  "modelName": "deepseek-chat"
}
```

#### 可用模型

- `deepseek-chat` - DeepSeek Chat 通用对话模型
- `deepseek-coder` - DeepSeek Coder 代码生成模型

#### 使用示例

```bash
xagent auth
# 选择: 使用第三方模型API (智谱GLM-4、DeepSeek等)
# 选择: DeepSeek - 深度求索 DeepSeek系列模型
# 输入API Key: (your DeepSeek API key)
# 输入模型名称: deepseek-coder
```

### 阿里通义千问

#### 配置文件方式

编辑 `~/.xagent/settings.json`：

```json
{
  "selectedAuthType": "openai-compatible",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKey": "your-aliyun-api-key-here",
  "modelName": "qwen-max"
}
```

#### 可用模型

- `qwen-max` - 通义千问最强模型
- `qwen-plus` - 通义千问增强版
- `qwen-turbo` - 通义千问快速版
- `qwen-long` - 通义千问长文本版

#### 使用示例

```bash
xagent auth
# 选择: 使用第三方模型API (智谱GLM-4、DeepSeek等)
# 选择: 阿里通义千问 - 阿里云通义千问系列模型
# 输入API Key: (your Aliyun API key)
# 输入模型名称: qwen-max
```

### 百度文心一言

#### 配置文件方式

编辑 `~/.xagent/settings.json`：

```json
{
  "selectedAuthType": "openai-compatible",
  "baseUrl": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat",
  "apiKey": "your-baidu-api-key-here",
  "modelName": "ernie-bot-4"
}
```

#### 可用模型

- `ernie-bot-4` - 文心一言 4.0
- `ernie-bot-turbo` - 文心一言 Turbo
- `ernie-speed` - 文心一言 Speed

#### 使用示例

```bash
xagent auth
# 选择: 使用第三方模型API (智谱GLM-4、DeepSeek等)
# 选择: 百度文心一言 - 百度智能云文心一言系列模型
# 输入API Key: (your Baidu API key)
# 输入模型名称: ernie-bot-4
```

### 月之暗面 (Kimi)

#### 配置文件方式

编辑 `~/.xagent/settings.json`：

```json
{
  "selectedAuthType": "openai-compatible",
  "baseUrl": "https://api.moonshot.cn/v1",
  "apiKey": "your-moonshot-api-key-here",
  "modelName": "moonshot-v1-8k"
}
```

#### 可用模型

- `moonshot-v1-8k` - Kimi 8K 上下文
- `moonshot-v1-32k` - Kimi 32K 上下文
- `moonshot-v1-128k` - Kimi 128K 上下文

#### 使用示例

```bash
xagent auth
# 选择: 使用第三方模型API (智谱GLM-4、DeepSeek等)
# 选择: 月之暗面 (Kimi) - 月之暗面 Kimi系列模型
# 输入API Key: (your Moonshot API key)
# 输入模型名称: moonshot-v1-32k
```

## 自定义配置

如果 xAgent CLI 内置的提供商列表中没有你需要的模型，可以选择"自定义"选项进行手动配置。

### 配置步骤

1. 运行 `xagent auth`
2. 选择"使用第三方模型API (智谱GLM-4、DeepSeek等)"
3. 选择"自定义 - 手动输入API配置"
4. 输入以下信息：
   - API Base URL
   - 模型名称
   - API Key

### 配置文件方式

编辑 `~/.xagent/settings.json`：

```json
{
  "selectedAuthType": "openai-compatible",
  "baseUrl": "https://your-custom-api.com/v1",
  "apiKey": "your-custom-api-key-here",
  "modelName": "your-model-name"
}
```

### 注意事项

1. **API 兼容性**：确保你的 API 提供商支持 OpenAI 兼容的 Chat Completions API 格式
2. **请求格式**：xAgent CLI 使用标准的 OpenAI API 请求格式
3. **认证方式**：大多数第三方模型使用 Bearer Token 认证
4. **端点路径**：确认 API Base URL 是否包含正确的路径（如 `/v1`）

## 故障排查

### 问题 1: API Key 验证失败

**错误信息**：
```
❌ 智谱AI (GLM-4)配置验证失败，请检查API Key和网络连接。
```

**解决方案**：
1. 检查 API Key 是否正确复制
2. 确认 API Key 是否有效且未过期
3. 检查网络连接是否正常
4. 确认 API 服务是否正常运行

### 问题 2: 模型响应超时

**错误信息**：
```
Network error: No response received from server
```

**解决方案**：
1. 检查网络连接
2. 确认 API 服务是否正常
3. 尝试使用其他模型
4. 检查防火墙设置

### 问题 3: 模型名称错误

**错误信息**：
```
API Error: 400 - {"error":{"message":"Invalid model name"}}
```

**解决方案**：
1. 确认模型名称是否正确
2. 参考各提供商的官方文档获取正确的模型名称
3. 检查模型名称的大小写是否正确

### 问题 4: 配额不足

**错误信息**：
```
API Error: 429 - {"error":{"message":"Rate limit exceeded"}}
```

**解决方案**：
1. 检查 API 账户的配额是否充足
2. 等待一段时间后重试
3. 升级 API 账户套餐

## 常见问题

### Q1: 如何切换不同的第三方模型？

**A**: 重新运行 `xagent auth` 命令，选择新的模型提供商即可。

### Q2: 可以同时配置多个模型提供商吗？

**A**: 当前版本只支持配置一个模型提供商。如需切换，需要重新运行认证命令。

### Q3: 第三方模型的费用如何计算？

**A**: 费用由各第三方模型提供商独立计算，具体价格请参考各提供商的官方定价。

### Q4: 使用第三方模型会影响 xAgent 的功能吗？

**A**: 不会。xAgent 的所有功能（如工具调用、文件操作等）都可以正常使用，只是底层的大语言模型提供商不同。

### Q5: 如何查看当前配置的模型信息？

**A**: 可以查看配置文件 `~/.xagent/settings.json`，或者运行以下命令：

```bash
cat ~/.xagent/settings.json
```

### Q6: API Key 安全吗？

**A**: API Key 会安全地存储在本地配置文件中，不会上传到 xAgent 服务器。请妥善保管你的 API Key。

### Q7: 如何删除已配置的 API Key？

**A**: 编辑 `~/.xagent/settings.json` 文件，删除或清空 `apiKey` 字段，然后重新运行 `xagent auth` 进行配置。

### Q8: 支持流式输出吗？

**A**: 是的，xAgent CLI 支持流式输出，可以实时显示模型的回复。

## 技术支持

如果遇到问题，可以通过以下方式获取帮助：

1. 查看 [xAgent 官方文档](https://platform.xagent.cn/)
2. 提交 [GitHub Issue](https://github.com/xagent-ai/xagent-cli/issues)
3. 联系 xAgent 技术支持

## 更新日志

### v1.0.0 (2026-01-02)

- 新增第三方模型 API 支持
- 内置支持智谱AI、DeepSeek、通义千问、文心一言、Kimi 等主流模型
- 优化认证流程，提供预设配置选项
- 添加 API Key 安全输入（密码掩码）
- 完善配置验证机制

## 许可证

MIT License

---

**注意**: 使用第三方模型时，请遵守各提供商的使用条款和服务协议。
