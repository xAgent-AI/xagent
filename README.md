# 🤖 xAgent CLI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/xagent-cli-reproduction.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

![xAgent CLI Screenshot](./assets/xagent-cli.jpg)

**English** | [中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Français](README_FR.md) | [Deutsch](README_DE.md) | [Español](README_ES.md) | [Русский](README_RU.md)

xAgent CLI is a powerful AI assistant that runs directly in your terminal. It seamlessly analyzes code repositories, executes coding tasks, understands context-specific needs, and boosts productivity by automating everything from simple file operations to complex workflows.

[More Tutorials](https://platform.xagent.cn/)

## ✨ Key Features

1. **Free AI Models**: Access powerful and free AI models through xAgent open platform, including Kimi K2, Qwen3 Coder, DeepSeek v3, and more
2. **Flexible Integration**: Keep your favorite development tools while integrating into existing systems for automation
3. **Natural Language Interaction**: Say goodbye to complex commands, drive AI with everyday conversation, from code development to life assistance
4. **Open Platform**: Install SubAgents and MCP with one click from xAgent Open Market, quickly expand intelligent agents and build your own AI team

## Feature Comparison

| Feature | xAgent CLI | Claude Code | Gemini CLI |
|---------|-----------|-------------|------------|
| Todo Planning | ✅ | ✅ | ❌ |
| SubAgent | ✅ | ✅ | ❌ |
| Custom Commands | ✅ | ✅ | ✅ |
| Plan Mode | ✅ | ✅ | ❌ |
| Task Tools | ✅ | ✅ | ❌ |
| VS Code Plugin | ✅ | ✅ | ✅ |
| JetBrains Plugin | ✅ | ✅ | ❌ |
| Conversation Recovery | ✅ | ✅ | ❌ |
| Built-in Open Market | ✅ | ❌ | ❌ |
| Memory Auto-compression | ✅ | ✅ | ✅ |
| Multimodal Capability | ✅ | ⚠️ (Limited in China) | ⚠️ (Limited in China) |
| Search | ✅ | ❌ | ⚠️ (Requires VPN) |
| Free | ✅ | ❌ | ⚠️ (Limited Usage) |
| Hook | ✅ | ✅ | ❌ |
| Output Style | ✅ | ✅ | ❌ |
| Thinking | ✅ | ✅ | ❌ |
| Workflow | ✅ | ❌ | ❌ |
| SDK | ✅ | ✅ | ❌ |
| ACP | ✅ | ✅ | ✅ |

## ⭐ Key Features

* Support 4 running modes: yolo (model has maximum permissions, can perform any operation), accepting edits (model only has file modification permissions), plan mode (plan first, then execute), default (model has no permissions)
* Upgraded subAgent functionality: Transform CLI from general assistant to expert team, providing more professional and accurate advice. Use /agent to see more pre-configured agents
* Upgraded task tool: Effectively compress context length, allowing CLI to complete your tasks more thoroughly. Auto-compression when context reaches 70%
* Integrated with xAgent Open Market: Quickly install useful MCP tools, Subagents, custom instructions and workflows
* Free multimodal model usage: You can also paste images in CLI now (Ctrl+V to paste images)
* Support for conversation history saving and rollback (xagent --resume and /chat commands)
* Support for more useful terminal commands (xagent -h to see more commands)
* VSCode plugin support
* Auto-upgrade: xAgent CLI automatically detects if current version is latest

## 📥 Installation

### System requirements

- Operating Systems: macOS 10.15+, Ubuntu 20.04+/Debian 10+, or Windows 10+ (with WSL 1, WSL 2, or Git for Windows)
- Hardware: 4GB+ RAM
- Software: Node.js 22+
- Network: Internet connection required for authentication and AI processing
- Shell: Works best in Bash, Zsh or Fish

### Installation Commands

**MAC/Linux/Ubuntu Users**:

* One-click installation command (Recommended)
```shell
bash -c "$(curl -fsSL https://cloud.xagent.cn/xagent-cli/install.sh)"
```

* Using Node.js installation
```shell
npm i -g @xagent-ai/xagent-cli
```

This command automatically installs all necessary dependencies for your terminal.

**Windows Users**:

1. Go to https://nodejs.org/en/download to download the latest Node.js installer
2. Run the installer to install Node.js
3. Restart your terminal: CMD or PowerShell
4. Run `npm install -g @xagent-ai/xagent-cli` to install xAgent CLI
5. Run `xagent` to start xAgent CLI

If you are in China Mainland, you can use the following command to install xAgent CLI:
1. Go to https://cloud.xagent.cn/xagent-cli/nvm-setup.exe to download the latest nvm installer
2. Run the installer to install nvm
3. **Restart your terminal: CMD or PowerShell**
4. Run `nvm node_mirror https://npmmirror.com/mirrors/node/` and `nvm npm_mirror https://npmmirror.com/mirrors/npm/`
5. Run `nvm install 22` to install Node.js 22
6. Run `nvm use 22` to use Node.js 22
7. Run `npm install -g @xagent-ai/xagent-cli` to install xAgent CLI
8. Run `xagent` to start xAgent CLI

## 🗑️ Uninstall

```shell
npm uninstall -g @xagent-ai/xagent-cli
```

## 🔑 Authentication

xAgent offers three authentication options:

1. **Recommended**: Use xAgent's native authentication
2. **Alternative**: Use xAgent API Key
3. **Third-party Models**: Connect via OpenAI-compatible APIs (智谱GLM-4、DeepSeek、通义千问、文心一言、Kimi等)

![xAgent CLI Login](./assets/login.jpg)

### Option 1: xAgent Native Authentication (Recommended)

Choose option 1 to login directly, which will open xAgent account authentication in a web page. After completing authentication, you can use it for free.

![xAgent CLI Web Login](./assets/web-login.jpg)

### Option 2: xAgent API Key

If you are in an environment like a server where you cannot open a web page, please use option 2 to login.

To get your API key:
1. Register for an xAgent account
2. Go to your profile settings or click [this direct link](https://xagent.cn/?open=setting)
3. Click "Reset" in the pop-up dialog to generate a new API key

![xAgent Profile Settings](./assets/profile-settings.jpg)

After generating your key, paste it into the terminal prompt to complete setup.

### Option 3: Third-party Model APIs

xAgent CLI supports connecting to various third-party LLM providers through OpenAI-compatible APIs. Supported providers include:

- **智谱AI (GLM-4)**: GLM-4, GLM-4 Flash, GLM-4 Plus
- **DeepSeek**: deepseek-chat, deepseek-coder
- **阿里通义千问**: qwen-max, qwen-plus, qwen-turbo
- **百度文心一言**: ernie-bot-4, ernie-bot-turbo
- **月之暗面 (Kimi)**: moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k

#### Configuration Steps:

1. Run `xagent auth` command
2. Select "使用第三方模型API (智谱GLM-4、DeepSeek等)" option
3. Choose your preferred provider from the list
4. Enter your API Key (will be masked for security)
5. Confirm or modify the model name
6. Wait for validation to complete

#### Example Configuration for 智谱GLM-4:

```bash
xagent auth
# 选择: 使用第三方模型API (智谱GLM-4、DeepSeek等)
# 选择: 智谱AI (GLM-4) - 智谱AI GLM-4系列模型
# 输入API Key: (your GLM API key)
# 输入模型名称: glm-4 (直接回车使用默认值)
```

#### Getting API Keys:

- **智谱AI**: https://open.bigmodel.cn/usercenter/apikeys
- **DeepSeek**: https://platform.deepseek.com/api_keys
- **阿里云**: https://dashscope.console.aliyun.com/apiKey
- **百度智能云**: https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application
- **月之暗面**: https://platform.moonshot.cn/console/api-keys

#### Custom Configuration:

If your provider is not in the preset list, select "自定义" and manually enter:
- API Base URL
- Model Name
- API Key

For detailed configuration examples, see [Third-party Model Configuration Guide](./docs/third-party-models.md).

## 🚀 Getting Started

To launch xAgent CLI, navigate to your workspace in terminal and type:

```shell
xagent
```

### Starting New Projects

For new projects, simply describe what you want to create:

```shell
cd new-project/
xagent
> Create a web-based Minecraft game using HTML
```

### Working with Existing Projects

For existing codebases, begin with the `/init` command to help xAgent understand your project:

```shell
cd project1/
xagent
> /init
> Analyze requirements according to the PRD document in requirement.md file, and output a technical document, then implement the solution.
```

The `/init` command scans your codebase, learns its structure, and creates an XAGENT.md file with comprehensive documentation.

For a complete list of slash commands and usage instructions, see [here](./i18/en/commands.md).

## 💡 Common Use Cases

xAgent CLI extends beyond coding to handle a wide range of tasks:

### 📊 Information & Planning

```text
> Help me find the best-rated restaurants in Los Angeles and create a 3-day food tour itinerary.
```

```text
> Search for the latest iPhone price comparisons and find the most cost-effective purchase option.
```

### 📁 File Management

```text
> Organize files on my desktop by file type into separate folders.
```

```text
> Batch download all images from this webpage and rename them by date.
```

### 📈 Data Analysis

```text
> Analyze sales data in this Excel spreadsheet and generate a simple chart.
```

```text
> Extract customer information from these CSV files and merge them into a unified table.
```

### 👨‍💻 Development Support

```text
> Analyze main architectural components and module dependencies of this system.
```

```text
> I'm getting a null pointer exception after my request, please help me find the cause of the problem.
```

### ⚙️ Workflow Automation

```text
> Create a script to periodically backup my important files to cloud storage.
```

```text
> Write a program that downloads stock prices daily and sends me email notifications.
```

*Note: Advanced automation tasks can leverage MCP servers to integrate your local system tools with enterprise collaboration suites.*

## 🔧 Switch to customized model

xAgent CLI can connect to any OpenAI-compatible API. Edit the settings file in `~/.xagent/settings.json` to change the model you use.

Here is a settings demo file:

```json
{
    "theme": "Default",
    "selectedAuthType": "xagent",
    "apiKey": "your xagent key",
    "baseUrl": "https://apis.xagent.cn/v1",
    "modelName": "Qwen3-Coder",
    "searchApiKey": "your xagent key"
}
```

## 🔄 GitHub Actions

You can also use xAgent CLI in your GitHub Actions workflows with the community-maintained action: [xagent-cli-action](https://github.com/xagent-ai/xagent-cli-action)

## 👥 Community Communication

If you encounter problems in use, you can directly raise Issues on the GitHub page.

You can also scan the following WeChat group to join the community group for communication and discussion.

### WeChat Group

![WeChat group](./assets/xagent-wechat.jpg)

## 📄 License

xAgent CLI is open-source under [MIT License](./LICENSE).

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository and create a feature branch
2. Ensure your changes pass existing tests and linting rules
3. Add tests for new functionality
4. Update documentation if needed
5. Submit a pull request with a clear description of changes

### Code Style

- Use TypeScript with strict mode
- Follow existing ESLint and Prettier configuration
- Write meaningful commit messages (conventional commits are appreciated but not required)
- Keep bundle size in mind when adding dependencies

## 📚 Documentation

- **[Architecture](./docs/architecture/overview.md)**: High-level design and component interactions
- **[Tool System](./docs/architecture/tool-system-design.md)**: How tools are implemented and scheduled
- **[MCP Integration](./docs/architecture/mcp-integration-guide.md)**: Integrating Model Context Protocol servers
- **[CLI Commands](./docs/cli/commands.md)**: User-facing command reference
- **[Contributing Guide](./CONTRIBUTING.md)**: Detailed contribution instructions

## 🏛️ Technology Stack

- **Runtime**: Node.js ≥22
- **Language**: TypeScript with strict mode
- **UI Framework**: React via [Ink](https://github.com/vadimdemedes/ink) for terminal rendering
- **Build Tool**: esbuild for bundling, tsc for type checking
- **Package Manager**: npm (workspaces)
- **Testing**: Vitest for unit tests, custom integration test runner
- **Linting/Formatting**: ESLint, Prettier

## 📊 Project Structure

```
xagent-cli/
├── src/                      # Source code
│   ├── tools/             # Tool implementations
│   ├── agents/            # Agent management
│   ├── config/            # Configuration handling
│   ├── auth/              # Authentication service
│   ├── session/           # Interactive session
│   ├── memory/            # Memory management
│   ├── workflow/          # Workflow system
│   ├── checkpoint/         # Checkpoint system
│   ├── slash-commands/    # Slash command handlers
│   └── tests/             # Unit tests
├── dist/                     # Compiled JavaScript (generated)
├── docs/                     # Documentation
├── assets/                   # Images and static assets
└── package.json              # Project configuration
```

## 🔌 Core Components

### Tool System
- **File Operations**: Read, Write, Delete, Create Directory, Search Codebase
- **Search**: Grep (text search), Web Search, Web Fetch
- **Execution**: Bash (shell commands), with background task support
- **Management**: Todo List, Memory, Checkpoint

### Agent System
- **General Purpose**: All-around assistant for general tasks
- **Plan Agent**: Specialized in planning and breaking down complex tasks
- **Explore Agent**: Code exploration and analysis
- **Frontend Tester**: UI/UX testing and validation

### Integration
- **MCP Protocol**: Native support for Model Context Protocol servers
- **VS Code**: Plugin for IDE integration
- **JetBrains**: Plugin for JetBrains IDEs

## 🧪 Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

Integration tests verify tool interactions and sandbox behavior. They can run with different sandbox backends:

```bash
# No sandbox
npm run test:integration:sandbox:none

# With Docker sandbox
npm run test:integration:sandbox:docker

# With Podman sandbox
npm run test:integration:sandbox:podman
```

### End-to-End Tests

```bash
npm run test:e2e
```

### Linting and Formatting

```bash
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run format        # Prettier formatting
npm run typecheck     # TypeScript type checking
```

## 🚀 Quick Start Guide

1. **Install xAgent CLI**
   ```bash
   npm install -g @xagent-ai/xagent-cli
   ```

2. **Authenticate**
   ```bash
   xagent auth
   ```

3. **Start Session**
   ```bash
   cd your-project
   xagent
   ```

4. **Initialize Project**
   ```bash
   xagent
   > /init
   ```

5. **Start Coding**
   ```bash
   xagent
   > Create a REST API with Express.js
   ```

## 💡 Tips and Best Practices

- Use `/init` to help xAgent understand your project structure
- Use `/agent` to switch between specialized agents for different tasks
- Enable plan mode for complex multi-step tasks
- Use conversation history to resume previous sessions
- Leverage MCP servers to integrate external tools
- Use checkpoint to save important states before major changes

## 📞 Roadmap

- [ ] Enhanced multimodal support
- [ ] More built-in agents
- [ ] Improved workflow system
- [ ] Better error handling and recovery
- [ ] Performance optimizations
- [ ] More language support

## 📞 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for a list of changes in each version.

## 🙏 Acknowledgments

- Built with [Ink](https://github.com/vadimdemedes/ink) for terminal UI
- Powered by [xAgent Platform](https://platform.xagent.cn/)
- Uses [Vitest](https://vitest.dev/) for testing
- Icons from [Heroicons](https://heroicons.com/)

## 📞 Support

- **Documentation**: https://platform.xagent.cn/docs/
- **GitHub Issues**: https://github.com/xagent-ai/xagent-cli/issues
- **Discussions**: https://github.com/xagent-ai/xagent-cli/discussions
- **WeChat Group**: Scan the QR code above to join

---

Made with ❤️ by the xAgent Team
