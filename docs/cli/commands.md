# CLI Commands Reference

This document provides a complete reference for all xAgent CLI commands.

## Quick Reference

| Command | Description |
|---------|-------------|
| `xagent start` | Launch interactive session |
| `xagent auth` | Configure authentication |
| `xagent agent` | Manage SubAgents |
| `xagent mcp` | Manage MCP servers |
| `xagent workflow` | Manage workflows |
| `xagent init` | Initialize project |
| `xagent gui` | GUI automation |
| `xagent version` | Show version |

## Core Commands

### start

Launch an interactive xAgent session.

```bash
xagent start [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--mode <mode>` | Execution mode (yolo, accept_edits, plan, default, smart) |
| `--project <path>` | Project directory |
| `--theme <name>` | UI theme |

### auth

Configure authentication settings.

```bash
xagent auth [command]
```

**Subcommands:**
| Command | Description |
|---------|-------------|
| `login` | Login with xAgent account |
| `apikey` | Set API key |
| `logout` | Clear credentials |

### version

Display version information.

```bash
xagent version
```

### init

Initialize xAgent in the current directory.

```bash
xagent init
```

## SubAgent Management

### agent list

List all configured SubAgents.

```bash
xagent agent --list
```

### agent add

Add a new SubAgent.

```bash
xagent agent --add <name> --type <type> --system-prompt <prompt>
```

### agent remove

Remove a SubAgent.

```bash
xagent agent --remove <name>
```

## MCP Server Management

### mcp list

List all configured MCP servers.

```bash
xagent mcp --list
```

### mcp add

Add a new MCP server.

```bash
xagent mcp --add <name> --command <command> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--command` | Server command |
| `--args` | Command arguments |
| `--env` | Environment variables |
| `--url` | Server URL (for HTTP transport) |

### mcp remove

Remove an MCP server.

```bash
xagent mcp --remove <name>
```

## Workflow Management

### workflow list

List installed workflows.

```bash
xagent workflow --list
```

### workflow add

Install a workflow from the market.

```bash
xagent workflow --add <workflow-id>
```

### workflow remove

Remove an installed workflow.

```bash
xagent workflow --remove <workflow-id>
```

## GUI Automation

### gui start

Start GUI automation mode. The GUI subagent supports both local and remote VLM modes.

```bash
xagent gui [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--headless` | Run in headless mode (no visible window) |

### GUI Configuration

GUI subagent uses the following configuration options:

| Setting | Description |
|---------|-------------|
| `guiSubagentModel` | VLM model name for local mode |
| `guiSubagentBaseUrl` | VLM API base URL for local mode |
| `guiSubagentApiKey` | VLM API key for local mode |

**Local Mode**: When using `openai_compatible` auth type, configure `guiSubagentBaseUrl` and `guiSubagentModel` for local VLM calls.

**Remote Mode**: When using `oauth-xagent` auth type, the GUI subagent uses remote VLM service automatically.

### GUI Actions

Available GUI actions:
- `click`: Click on an element
- `double_click`: Double click
- `right_click`: Right click
- `drag`: Drag from one position to another
- `type`: Type text
- `hotkey`: Press keyboard shortcuts
- `scroll`: Scroll up/down/left/right
- `wait`: Wait for specified time
- `finished`: Complete the task |

## Global Options

| Option | Description |
|--------|-------------|
| `--help` | Show help |
| `--verbose` | Enable verbose logging |
| `--config <path>` | Config file path |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XAGENT_API_KEY` | API key for authentication |
| `XAGENT_BASE_URL` | Base URL for API |
| `XAGENT_CONFIG` | Config file path |
| `DEBUG` | Enable debug mode (e.g., `DEBUG=smart-approval`) |

## Configuration File

xAgent uses a JSON configuration file (`~/.xagent/settings.json`):

```json
{
  "theme": "default",
  "selectedAuthType": "openai_compatible",
  "apiKey": "your-api-key",
  "baseUrl": "https://api.example.com/v1",
  "modelName": "gpt-4o",
  "guiSubagentModel": "gpt-4o",
  "guiSubagentBaseUrl": "https://api.example.com/v1",
  "executionMode": "default",
  "approvalMode": "smart",
  "contextFileName": ["XAGENT.md", "IFLOW.md"],
  "language": "zh",
  "autoUpdate": true,
  "telemetryEnabled": false,
  "showToolDetails": false
}
```

## Related Documentation

- [Architecture Overview](../architecture/overview.md)
- [Tool System Design](../architecture/tool-system-design.md)
- [MCP Integration Guide](../architecture/mcp-integration-guide.md)
