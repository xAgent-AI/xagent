# 🤖 xAgent CLI - Your Autonomous Life AI Assistant

<div align="center">

![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square&logo=opensourceinitiative)
![Node.js](https://img.shields.io/node/v/xagent-cli?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)
![Version](https://img.shields.io/npm/v/xagent-cli?logo=npm)
![Downloads](https://img.shields.io/npm/dt/xagent-cli)

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
  "selectedAuthType": "xagent",
  "apiKey": "your-xagent-key",
  "baseUrl": "https://apis.xagent.cn/v1",
  "modelName": "Qwen3-Coder",
  "executionMode": "smart",
  "language": "en"
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
