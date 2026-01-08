# 🤖 xAgent CLI - Your Autonomous Life AI Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/xagent-cli-reproduction.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

![xAgent CLI Screenshot](./assets/xagent-cli.png)

**[English](README.md)** | [中文](README_CN.md) 

---

## 🚀 X Future Agent - Built for Your Digital Life

**xAgent CLI** is more than an AI coding assistant—it's an **intelligent agent for personal PCs and autonomous living**. It understands your daily needs, from code development to life management, enhancing every aspect of your digital life.

🎯 **Vision**: To become the most helpful AI companion on everyone's PC, making life smarter and easier.

---

## ✨ Key Features

### 🤖 X Future Agent - Autonomous Life Intelligence

xAgent represents the future evolution of AI assistants:

- **Life Automation**: Automatically handle daily tasks like file organization, data backup, and schedule management
- **Smart Device Management**: Deep integration with your personal PC for truly intelligent interactions
- **Context Awareness**: Remembers your preferences and habits for personalized service
- **Proactive Assistance**: Offers help at the right moment, not just passive responses

### 🖥️ Smart Use of Your Personal PC

```text
> Organize files on my desktop, categorize them by type into different folders
> Set up a script to automatically backup important files to cloud storage daily
> Monitor my computer resources and alert me when CPU usage is too high
> Batch process these images, resize them, and rename them by date
```

### 💻 Professional Development Capabilities

- **Smart Coding Assistant**: Code writing, debugging, and optimization
- **Multi-Model Support**: Free access to powerful models like Kimi K2, Qwen3 Coder, DeepSeek v3
- **SubAgent Team**: Specialized AI agents for different scenarios
- **Workflow Automation**: Install workflows from the market for complex tasks

### 🔧 Flexible Integration

- **MCP Protocol Support**: Seamless integration with various tools and services
- **Open Market**: One-click installation of SubAgents, MCP tools, and workflows
- **Natural Language Interaction**: Say goodbye to complex commands, drive AI with everyday conversation
- **Cross-Platform**: Works on Windows, macOS, and Linux

---

## 📊 Feature Comparison

| Feature | xAgent CLI | Claude Code | Gemini CLI |
|---------|-----------|-------------|------------|
| **Life Automation** | ✅ | ❌ | ❌ |
| **Personal PC Smart Management** | ✅ | ❌ | ❌ |
| Todo Planning | ✅ | ✅ | ❌ |
| SubAgent | ✅ | ✅ | ❌ |
| Custom Commands | ✅ | ✅ | ✅ |
| Plan Mode | ✅ | ✅ | ❌ |
| Task Tools | ✅ | ✅ | ❌ |
| VS Code Plugin | ✅ | ✅ | ✅ |
| JetBrains Plugin | ✅ | ✅ | ❌ |
| Conversation Recovery | ✅ | ✅ | ❌ |
| Built-in Open Market | ✅ | ❌ | ❌ |
| Context Auto-compression | ✅ | ✅ | ✅ |
| Multimodal Capability | ✅ | ⚠️ (Limited in China) | ⚠️ (Limited in China) |
| Web Search | ✅ | ❌ | ⚠️ (Requires VPN) |
| **Free to Use** | ✅ | ❌ | ⚠️ (Limited Usage) |
| Hook | ✅ | ✅ | ❌ |
| Thinking Mode | ✅ | ✅ | ❌ |
| Workflow System | ✅ | ❌ | ❌ |

---

## 🎯 Typical Use Cases

### 🏠 Life Assistant Scenarios

```text
> Organize my desktop, move images to Pictures and documents to Documents
> Set up weekly automatic backup of my work files to cloud storage
> Remind me of an important meeting at 3 PM today
> Analyze my spending records and generate a monthly expense report
> Find the 10 largest files taking up disk space on my computer
```

### 💼 Productivity Scenarios

```text
> Batch rename these files with date + project name format
> Download all PDF documents from this webpage and organize them into folders
> Analyze this Excel data and generate a visualization chart
> Translate this document while preserving the original format
```

### 👨‍💻 Development Scenarios

```text
> Analyze the architecture and module dependencies of this project
> Find the root cause of this bug and fix it
> Create a RESTful API with user authentication and database connection
> Code review this PR and check for potential issues
```

### 🔄 Automation Workflows

```text
> Create a script that downloads stock prices daily and sends email notifications
> Set up automatic dependency updates for my projects every morning
> Monitor website status and send alerts when it's down
```

---

## 📥 Installation

### System Requirements

- **Operating Systems**: macOS 10.15+, Ubuntu 20.04+/Debian 10+, Windows 10+
- **Hardware**: 4GB+ RAM
- **Software**: Node.js 22+
- **Network**: Internet connection required for authentication and AI processing

### Installation Commands

**Mac/Linux/Ubuntu**:
```shell
bash -c "$(curl -fsSL https://cloud.xagent.cn/xagent-cli/install.sh)"
```

Or using Node.js:
```shell
npm i -g @xagent-ai/xagent-cli
```

**Windows Users**:
1. Download and install [Node.js 22+](https://nodejs.org/en/download)
2. Restart your terminal (CMD or PowerShell)
3. Run `npm install -g @xagent-ai/xagent-cli`
4. Run `xagent` to start

**China Users** (using mirror):
```shell
# Download nvm
curl -o nvm-setup.exe https://cloud.xagent.cn/xagent-cli/nvm-setup.exe
# Install and configure Node.js 22
nvm node_mirror https://npmmirror.com/mirrors/node/
nvm npm_mirror https://npmmirror.com/mirrors/npm/
nvm install 22 && nvm use 22
npm install -g @xagent-ai/xagent-cli
```

### Uninstall

```shell
npm uninstall -g @xagent-ai/xagent-cli
```

---

## 🔑 Authentication

xAgent offers three authentication options:

### Option 1: xAgent Native Authentication (Recommended)

Select option 1 to log in directly, which opens the authentication page in your browser. After completion, you can use it for free.

### Option 2: xAgent API Key

For server environments where you cannot open a web browser.

1. Register for an xAgent account
2. Visit [Account Settings](https://xagent.cn/?open=setting)
3. Click "Reset" to generate a new API Key
4. Paste the key in the terminal to complete setup

### Option 3: Third-Party Model APIs

Connect to GLM-4, DeepSeek, Qwen, Ernie Bot, Kimi, and more:

```bash
xagent auth
# Select third-party model API
# Select provider and enter API Key
```

Supported providers:
- **Zhipu AI (GLM-4)**: https://open.bigmodel.cn/usercenter/apikeys
- **DeepSeek**: https://platform.deepseek.com/api_keys
- **Alibaba Cloud**: https://dashscope.console.aliyun.com/apiKey
- **Baidu**: https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application
- **Moonshot (Kimi)**: https://platform.moonshot.cn/console/api-keys

---

## 🚀 Getting Started

### Launch xAgent

```shell
xagent
```

### New Project Development

```shell
cd new-project/
xagent
> Create a personal blog website using React
```

### Existing Projects

```shell
cd existing-project/
xagent
> /init  # Scan project structure and create documentation
> Analyze requirements according to the PRD and output a technical solution
```

### Using SubAgents

```shell
xagent
> /agent   # View available agents
> /agent plan-agent  # Switch to plan expert agent
```

---

## 🛠️ Execution Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **YOLO** | Maximum permissions, can perform any operation | Fully trust AI |
| **ACCEPT_EDITS** | File modification only | Safe coding scenarios |
| **PLAN** | Plan first, then execute | Complex task planning |
| **DEFAULT** | No permissions by default | Requires explicit approval |
| **SMART** | Intelligent mode | Recommended for daily use |

---

## 📦 Open Market

Install powerful extensions with one click:

```bash
# View SubAgents in the market
xagent agent --list

# Install a SubAgent
xagent agent --add <name>

# View MCP servers
xagent mcp --list

# Install a workflow
xagent workflow --add <workflow-id>
```

---

## 🔧 Custom Configuration

Edit `~/.xagent/settings.json` to customize:

```json
{
    "theme": "Default",
    "selectedAuthType": "xagent",
    "apiKey": "your xagent key",
    "baseUrl": "https://apis.xagent.cn/v1",
    "modelName": "Qwen3-Coder",
    "executionMode": "smart",
    "language": "en"
}
```

---

## 🏗️ Technology Stack

- **Runtime**: Node.js ≥22
- **Language**: TypeScript (strict mode)
- **UI Framework**: React via Ink (terminal rendering)
- **Build Tools**: esbuild + tsc
- **Package Manager**: npm
- **Testing Framework**: Vitest
- **Code Quality**: ESLint + Prettier

### Core Components

```
xagent-cli/
├── src/
│   ├── tools/              # Tool implementations (file ops, search, exec)
│   ├── agents/             # Agent management (specialized AI team)
│   ├── config/             # Configuration management
│   ├── auth/               # Authentication service
│   ├── session/            # Interactive session
│   ├── memory/             # Memory management
│   ├── workflow/           # Workflow system
│   ├── checkpoint/         # Checkpoint system
│   ├── slash-commands/     # Slash commands
│   ├── gui-subagent/       # GUI automation agent
│   └── tests/              # Unit tests
├── dist/                   # Compiled output
├── docs/                   # Documentation
├── assets/                 # Static assets
└── package.json
```

---

## 🧪 Testing & Quality

```bash
# Unit tests
npm test

# ESLint check
npm run lint

# ESLint auto-fix
npm run lint:fix

# Code formatting
npm run format

# Type checking
npm run typecheck
```

---

## 📚 Documentation

- **[Architecture](docs/architecture/overview.md)**: High-level design and component interactions
- **[Tool System](docs/architecture/tool-system-design.md)**: Tool implementation and scheduling
- **[MCP Integration](docs/architecture/mcp-integration-guide.md)**: Model Context Protocol server integration
- **[CLI Commands](docs/cli/commands.md)**: Command reference
- **[Contributing Guide](CONTRIBUTING.md)**: Detailed contribution instructions
- **[Third-Party Models](docs/third-party-models.md)**: External model API configuration

---

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository and create a feature branch
2. Ensure changes pass existing tests and linting
3. Add tests for new functionality
4. Update documentation if needed
5. Submit a PR with a clear description

### Code Standards

- Use TypeScript strict mode
- Follow ESLint and Prettier configurations
- Write meaningful commit messages
- Consider bundle size when adding dependencies

---

## 📄 License

MIT License - See [LICENSE](./LICENSE)

---

## 🙏 Acknowledgments

- Built with [Ink](https://github.com/vadimdemedes/ink) for terminal UI
- Powered by [xAgent Platform](https://platform.xagent.cn/)
- Uses [Vitest](https://vitest.dev/) for testing
- Icons from [Heroicons](https://heroicons.com/)

---

## 📞 Support

- **Documentation**: https://platform.xagent.cn/docs/
- **GitHub Issues**: https://github.com/xagent-ai/xagent-cli/issues
- **Discussions**: https://github.com/xagent-ai/xagent-cli/discussions
- **WeChat Group**: Scan the QR code below to join

![WeChat group](./assets/xagent-wechat.png)

---

<div align="center">

**Empowering Your Digital Life with AI**

Made with ❤️ by the xAgent Team

</div>