# 🤖 xAgent CLI - Your Autonomous Life AI Assistant

<div align="center">

![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square&logo=opensourceinitiative)
![Node.js](https://img.shields.io/node/v/xagent-cli?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)
![Version](https://img.shields.io/npm/v/%40xagent-ai%2Fcli?logo=npm)
![Downloads](https://img.shields.io/npm/dt/%40xagent-ai%2Fcli)

</div>

<div align="center">

![xAgent CLI Screenshot](./assets/xagent-cli.png)

**[English](README.md)** | **[中文](README_CN.md)**

</div>

---

<div align="center">

### 🚀 The Future of AI Assistants is Here

**xAgent CLI** is not just another AI coding assistant — it's an **intelligent agent for personal PCs and autonomous living** that transforms how you interact with your digital life.

</div>

---

## ✨ Why xAgent CLI?

| 🎯 | Universal AI Companion |
|------|------------------------|
| 🏠 | **Life Automation** - From file organization to smart scheduling |
| 💻 | **Professional Development** - Code, debug, and deploy with AI |
| 🌐 | **Multi-Model Support** - Free access to Kimi K2, Qwen3 Coder, DeepSeek v3 |
| 🔧 | **GUI Automation** - Precise mouse/keyboard control for any task |
| 🔒 | **Flexible Security** - 5 execution modes from YOLO to DEFAULT |

---

## ⚡ Quick Start

```bash
# Install
npm i -g xagent-cli

# Launch
xagent
```

**That's it!** Start automating your digital life in seconds.

---

## 📊 Feature Comparison

| Feature | xAgent CLI | Claude Code | Gemini CLI |
|:--------|:----------:|:-----------:|:----------:|
| **Life Automation** | ✅ | ❌ | ❌ |
| **PC Smart Management** | ✅ | ❌ | ❌ |
| Todo Planning | ✅ | ✅ | ❌ |
| SubAgent System | ✅ | ✅ | ❌ |
| Plan Mode | ✅ | ✅ | ❌ |
| Task Tools | ✅ | ✅ | ❌ |
| Conversation Recovery | ✅ | ✅ | ❌ |
| Context Auto-compression | ✅ | ✅ | ✅ |
| Web Search | ✅ | ❌ | ⚠️ |
| Thinking Mode | ✅ | ✅ | ❌ |
| Workflow System | ✅ | ❌ | ❌ |

---

## 🎯 What Can xAgent Do?

### 🏠 Life Assistant
```text
> Organize my desktop, categorize files by type
> Set up daily backup to cloud storage
> Remind me of meetings at 3 PM
> Find largest files eating disk space
```

### 💼 Productivity Booster
```text
> Batch rename files with date format
> Download all PDFs from a webpage
> Analyze Excel data, generate charts
> Translate documents preserving format
```

### 👨‍💻 Developer Companion
```text
> Analyze project architecture
> Find and fix bug root causes
> Create RESTful APIs with auth
> Code review PRs automatically
```

### 🔄 Automation Expert
```text
> Download stock prices, send email alerts
> Auto-update project dependencies
> Monitor websites, alert on downtime
```

---

## 🛠️ Execution Modes

| Mode | Permissions | Best For |
|------|-------------|----------|
| 🟢 **YOLO** | Full control | Complete AI autonomy |
| 🟡 **ACCEPT_EDITS** | File only | Safe coding |
| 🔵 **PLAN** | Plan → Execute | Complex tasks |
| ⚪ **DEFAULT** | Approval required | Security-first |
| 🟣 **SMART** | Intelligent | Daily use (recommended) |

---

## 🔑 Free to Use

xAgent offers **completely free** access with multiple authentication options:

| Method | Description |
|--------|-------------|
| 🔐 **xAgent Account** | Browser-based login (recommended) |
| 🔑 **API Key** | Server environments |
| 🌐 **Third-Party APIs** | GLM-4, DeepSeek, Qwen, Kimi, and more |

---

## 🏗️ Technology Stack

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-22+-green?style=for-the-badge&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript)
![React](https://img.shields.io/badge/React-Ink-purple?style=for-the-badge&logo=react)
![esbuild](https://img.shields.io/badge/esbuild-orange?style=for-the-badge)
![Vitest](https://img.shields.io/badge/Vitest-testing?style=for-the-badge&logo=vitest)

</div>

---

## 📦 Project Structure

```
xagent-cli/
├── src/
│   ├── tools/              # 12+ built-in tools
│   ├── agents/             # SubAgent system
│   ├── gui-subagent/       # GUI automation
│   ├── workflow/           # Workflow engine
│   ├── checkpoint/         # State persistence
│   └── mcp/                # MCP integration
├── dist/                   # Compiled output
├── docs/                   # Documentation
├── test/                   # Test suite
└── package.json
```

---

## 🧪 Testing & Quality

```bash
npm test          # Unit tests
npm run lint      # ESLint
npm run format    # Prettier
npm run typecheck # TypeScript
```

---

## ⚙️ Configuration

Customize xAgent by editing `~/.xagent/settings.json`:

```json
{
  "theme": "Default",
  "selectedAuthType": "openai_compatible",
  "apiKey": "your-api-key",
  "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
  "modelName": "glm-4.7",
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
  "language": "en",
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

## 📚 Documentation

- 📖 [Architecture](docs/architecture/overview.md)
- 🔧 [Tool System](docs/architecture/tool-system-design.md)
- 🔌 [SKILL, Worflow and MCP Integration](docs/architecture/mcp-integration-guide.md)
- 💻 [CLI Commands](docs/cli/commands.md)
- 🤝 [Contributing](CONTRIBUTING.md)
- 🔑 [Third-Party Models](docs/third-party-models.md)

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. 🍴 Fork the repository
2. 🌿 Create a feature branch
3. ✅ Ensure tests pass
4. 📝 Submit a PR

---

## 📄 License

MIT License - See [LICENSE](./LICENSE)

---

## 🙏 Acknowledgments

<div align="center">

Built with ❤️ using [Ink](https://github.com/vadimdemedes/ink) • Powered by [xAgent Platform](https://platform.xagent.cn/)

</div>

---

<div align="center">

### 🌟 Star us on GitHub!

**Empowering Your Digital Life with AI**

</div>
