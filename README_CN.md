# 🤖 xAgent CLI - 你的自主生活智能助手

<div align="center">

![许可](https://img.shields.io/badge/License-MIT-yellow?style=flat-square&logo=opensourceinitiative)
![Node.js](https://img.shields.io/node/v/%40xagent-ai%2Fcli?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)
![版本](https://img.shields.io/npm/v/%40xagent-ai%2Fcli?logo=npm)
![下载量](https://img.shields.io/npm/dt/%40xagent-ai%2Fcli)

</div>

<div align="center">

![xAgent CLI 截图](./assets/xagent-cli.png)

**[官网](http://www.xagent-colife.net)** | **[English](README.md)** | **[中文](README_CN.md)**

</div>

---

<div align="center">

### 🚀 AI 助手的未来已经到来

**xAgent CLI** 不仅仅是一个 AI 编程助手 — 它是一个**面向个人 PC 和自主生活的智能代理**，彻底改变你与数字生活的互动方式。

</div>

---

## ✨ 为什么选择 xAgent CLI?

| 🎯 | 全能 AI 助手 |
|------|------------------------|
| 🏠 | **生活自动化** - 从文件整理到智能日程管理 |
| 💻 | **专业开发** - 代码编写、调试、部署一体化 |
| 👥 | **多智能体团队** - 与专业 AI 队友协作完成任务 |
| 🌐 | **多模型支持** - 免费使用 Kimi K2、Qwen3 Coder、DeepSeek v3 |
| 🔧 | **GUI 自动化** - 精确的鼠标键盘控制 |
| 🔒 | **灵活安全** - 5 种执行模式，从 YOLO 到 DEFAULT |

---

## ⚡ 快速开始

```bash
# 安装
npm i -g @xagent-ai/cli

# 启动
xagent start
```

**就这么简单！** 几秒钟内开始自动化你的数字生活。

---

## 📊 功能对比

| 功能特性 | xAgent CLI | Claude Code | Gemini CLI |
|:--------|:----------:|:-----------:|:----------:|
| **生活自动化** | ✅ | ❌ | ❌ |
| **PC 智能管理** | ✅ | ❌ | ❌ |
| **多智能体团队** | ✅ | ✅ | ❌ |
| Todo 任务规划 | ✅ | ✅ | ❌ |
| SubAgent 系统 | ✅ | ✅ | ❌ |
| 计划模式 | ✅ | ✅ | ❌ |
| 任务工具集 | ✅ | ✅ | ❌ |
| 对话历史恢复 | ✅ | ✅ | ❌ |
| 上下文自动压缩 | ✅ | ✅ | ✅ |
| 网络搜索 | ✅ | ❌ | ⚠️ |
| 思考模式 | ✅ | ✅ | ❌ |
| 工作流系统 | ✅ | ❌ | ❌ |

---

## 🎯 xAgent 能做什么？

### 🏠 生活助手
```text
> 整理桌面，按类型自动分类
> 设置每日云端备份
> 下午3点提醒开会
> 找出占用磁盘空间的大文件
```

### 💼 效率办公
```text
> 批量重命名文件（日期格式）
> 下载网页所有 PDF
> 分析 Excel 数据，生成图表
> 翻译文档，保留原格式
```

### 👨‍💻 开发助手
```text
> 分析项目架构
> 找出并修复 bug
> 创建带认证的 RESTful API
> 自动审查 PR
```

### 👥 多智能体团队
```text
> 创建一个团队，包含开发者和评审员来实现用户认证
> 生成一个测试队友来测试登录流程，同时我开发仪表盘
> 让3个队友并行工作：编码、测试和编写文档
```

### 🔄 自动化专家
```text
> 下载股票行情，发送邮件提醒
> 自动更新项目依赖
> 监控网站，宕机时告警
```

---

## 🛠️ 执行模式

| 模式 | 权限 | 适用场景 |
|------|-------------|----------|
| 🟢 **YOLO** | 完全控制 | AI 完全自主 |
| 🟡 **ACCEPT_EDITS** | 仅文件 | 安全编码 |
| 🔵 **PLAN** | 先计划后执行 | 复杂任务 |
| ⚪ **DEFAULT** | 需授权确认 | 安全优先 |
| 🟣 **SMART** | 智能模式 | 日常使用（推荐） |

---

## 🔑 免费使用

xAgent 提供**完全免费**的多种认证方式：

| 方式 | 说明 |
|--------|-------------|
| 🔐 **xAgent 账号** | 浏览器登录（推荐） |
| 🔑 **API Key** | 服务器环境 |
| 🌐 **第三方 API** | GLM-5、DeepSeek、通义千问、月之暗面等 |

---

## 🏗️ 技术栈

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-22+-green?style=for-the-badge&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript)
![React](https://img.shields.io/badge/React-Ink-purple?style=for-the-badge&logo=react)
![esbuild](https://img.shields.io/badge/esbuild-orange?style=for-the-badge)
![Vitest](https://img.shields.io/badge/Vitest-测试?style=for-the-badge&logo=vitest)

</div>

---

## 📦 项目结构

```
@xagent-ai/cli/
├── src/
│   ├── tools/              # 12+ 内置工具
│   ├── agents/             # SubAgent 系统
│   ├── gui-subagent/       # GUI 自动化
│   ├── workflow/           # 工作流引擎
│   ├── checkpoint/         # 状态持久化
│   └── mcp/                # MCP 集成
├── dist/                   # 编译输出
├── docs/                   # 文档
├── test/                   # 测试套件
└── package.json
```

---

## 🧪 测试与质量

```bash
npm test          # 单元测试
npm run lint      # ESLint
npm run format    # Prettier
npm run typecheck # TypeScript
```

---

## ⚙️ 配置说明

通过编辑 `~/.xagent/settings.json` 自定义 xAgent：

```json
{
  "theme": "Default",
  "selectedAuthType": "openai_compatible",
  "apiKey": "your-api-key",
  "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
  "modelName": "glm-5",
  "guiSubagentModel": "doubao-1-5-ui-tars-250428",
  "guiSubagentBaseUrl": "https://ark.cn-beijing.volces.com/api/v3",
  "guiSubagentApiKey": "your-api-key",
  "searchApiKey": "",
  "executionMode": "smart",
  "approvalMode": "smart",
  "checkpointing": {
    "enabled": false,
    "autoCreate": true,
    "maxCheckpoints": 10
  },
  "thinking": {
    "enabled": true,
    "mode": "normal",
    "displayMode": "compact"
  },
  "contextCompression": {
    "enabled": true,
    "maxMessages": 30,
    "maxContextSize": 1500000,
    "preserveRecentMessages": 0,
    "enableSummary": true
  },
  "contextFileName": "XAGENT.md",
  "mcpServers": {},
  "language": "zh",
  "autoUpdate": true,
  "telemetryEnabled": true,
  "showToolDetails": false,
  "showAIDebugInfo": false,
  "loggerLevel": "info",
  "contextCompress": {
    "enabled": false,
    "autoTrigger": false,
    "messageThreshold": 50,
    "tokenThreshold": 100000,
    "strategy": "summary",
    "preserveRecent": 5
  },
  "type": "openai_compatible"
}
```

---

## ⌨️ 斜杠命令

在交互模式下（`xagent start`）使用斜杠命令管理 xAgent 功能：

| 命令 | 说明 |
|---------|-------------|
| `/help` | 显示帮助信息 |
| `/init` | 初始化项目上下文 |
| `/clear` | 清除对话历史 |
| `/exit` | 退出程序 |
| `/auth` | 配置认证信息 |
| `/mode [模式]` | 切换审批模式 |
| `/agents [list\|online\|install\|remove]` | 管理 SubAgent |
| `/mcp [list\|add\|remove\|refresh]` | 管理 MCP 服务器 |
| `/skill [list\|add\|remove]` | 管理技能 |
| `/model` | 配置 LLM/VLM 模型 |
| `/memory [show\|clear]` | 管理项目记忆 |
| `/restore` | 从检查点恢复 |
| `/tools [verbose\|simple]` | 管理工具显示 |
| `/stats` | 显示会话统计 |
| `/theme` | 切换 UI 主题 |
| `/about` | 显示版本信息 |
| `/update` | 检查更新 |

### MCP 服务器管理

```bash
/mcp list              # 列出所有 MCP 服务器
/mcp add               # 添加 MCP 服务器（交互式）
/mcp remove <name>     # 移除 MCP 服务器
/mcp refresh           # 刷新 MCP 连接
```

### 技能管理

```bash
/skill list            # 列出已安装的技能
/skill add ./my-skill  # 从本地路径安装
/skill add owner/repo  # 从 GitHub 安装
/skill remove <name>   # 移除技能
```

> 💡 **提示：** 所有功能也可通过 CLI 命令使用。运行 `xagent --help` 查看详情。

---

## 📚 文档

- 📖 [架构设计](docs/architecture/overview.md)
- 🔧 [工具系统](docs/architecture/tool-system-design.md)
- 🔌 [SKILL, Worflow和MCP 集成](docs/architecture/mcp-integration-guide.md)
- 💻 [CLI 命令](docs/cli/commands.md)
- 🤝 [贡献指南](CONTRIBUTING.md)
- 🔑 [第三方模型](docs/third-party-models.md)

---

## 🤝 贡献

欢迎贡献代码！参与方式：

1. 🍴 Fork 本仓库
2. 🌿 创建特性分支
3. ✅ 确保测试通过
4. 📝 提交 PR

---

## 📄 许可证

MIT License - 详见 [LICENSE](./LICENSE)

---

## 🙏 致谢

<div align="center">

❤️ 基于 [Ink](https://github.com/vadimdemedes/ink) 构建 • 由 [xAgent 平台](https://platform.xagent.cn/) 支持

</div>

---

<div align="center">

### 🌟 给我们点个 Star！

**用 AI 点亮你的数字生活**

</div>