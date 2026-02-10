# CLI Commands Reference

This document provides a complete reference for all xAgent CLI commands.

## Quick Reference

| Command | Description |
|---------|-------------|
| `xagent start` | Launch interactive session |
| `xagent auth` | Configure authentication |
| `xagent agent` | Manage SubAgents |
| `xagent mcp` | Manage MCP servers |
| `xagent skill` | Manage skills |
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
| `--approval-mode <mode>` | Execution mode (yolo, accept_edits, plan, default, smart) |

### auth

Configure authentication settings.

```bash
xagent auth
```

This is an interactive command that guides you through:
1. Selecting authentication type
2. Entering API credentials
3. Fetching default models (for remote authentication)

**Authentication Types:**
| Type | Description |
|------|-------------|
| `oauth-xagent` | xAgent account login (recommended) |
| `openai_compatible` | Third-party API (DeepSeek, Qwen, Kimi, etc.) |

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
xagent agent --add <name>
```

**Note:** Agent creation wizard is not implemented. Use `/agents install` in interactive mode to add agents.

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
xagent mcp --add [name] [options]
```

**Options:**

| Short | Long | Description |
|-------|------|-------------|
| `-t` | `--transport <type>` | Transport type: `stdio` or `http` |
| `-c` | `--command <cmd>` | Command for stdio transport |
| | | `--args <args>` | Arguments (comma-separated) |
| `-u` | `--url <url>` | URL for HTTP transport |
| `-k` | `--token <token>` | Bearer authentication token |
| | | `--header <key:value>` | Custom header (can be used multiple times) |
| `-y` | `--yes` | Skip confirmation |

**Interactive Mode:**

```bash
xagent mcp --add
# or with name
xagent mcp --add my-server
```

**Non-interactive Examples:**

```bash
# Stdio transport (GitHub MCP)
xagent mcp --add github -t stdio -c "npx" --args "-y,@modelcontextprotocol/server-github"

# Filesystem MCP
xagent mcp --add filesystem -t stdio -c "npx" --args "-y,@modelcontextprotocol/server-filesystem,/path/to/dir"

# HTTP transport
xagent mcp --add custom -t http -u "https://example.com/mcp"

# HTTP with auth
xagent mcp --add custom -t http -u "https://example.com/mcp" -k "bearer-token"

# Custom headers
xagent mcp --add custom -t http -u "https://example.com/mcp" --header "X-Custom-Header:value"
```

### mcp remove

Remove an MCP server.

```bash
xagent mcp --remove <name>
```

## Skill Management

### skill list

List all installed skills.

```bash
xagent skill --list
```

### skill add

Install a skill from local path or remote URL. Auto-detects source type.

```bash
xagent skill --add <source>
```

**Supported Source Formats:**
| Format | Example |
|--------|---------|
| Local path | `./my-skill` or `C:\path\to\skill` |
| GitHub shorthand | `owner/repo` |
| GitHub URL | `https://github.com/owner/repo` |
| GitHub with branch | `https://github.com/owner/repo/tree/main` |
| GitHub with path | `https://github.com/owner/repo/tree/main/path/to/skill` |
| GitHub shorthand with skill | `owner/repo@skill-name` |
| Direct SKILL.md URL | `https://example.com/skill.md` |

**Examples:**
```bash
# Install from local directory
xagent skill --add ./my-skill

# Install from GitHub repository
xagent skill --add vercel-labs/agent-skills

# Install from GitHub URL
xagent skill --add https://github.com/vercel-labs/agent-skills

# Install from specific path in repo
xagent skill --add https://github.com/owner/repo/tree/main/skills/my-skill

# Install skill with @ syntax
xagent skill --add owner/repo@find-skills

# Install from direct SKILL.md URL
xagent skill --add https://raw.githubusercontent.com/owner/repo/main/skill.md
```

### skill remove

Remove an installed skill.

```bash
xagent skill --remove <skill-id>
```

**Note:** Built-in skills `find-skills` cannot be removed.

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

The GUI subagent can perform various computer automation actions. Actions use coordinate-based targeting with bounding boxes.

**Common Action Types:**

| Action | Description |
|--------|-------------|
| `click` / `left_click` | Click on an element at coordinates |
| `double_click` | Double click |
| `right_click` | Right click |
| `middle_click` | Middle click |
| `drag` | Drag from one position to another |
| `scroll` | Scroll in a direction (up/down/left/right) |
| `type` | Type text |
| `press` / `hotkey` | Press keyboard keys |
| `wait` | Wait for specified time |
| `open_app` | Open an application |
| `open_url` | Open a URL |
| `finished` | Complete the task |

**Action Format Example:**
```
click(start_box='[x1, y1, x2, y2]')
type(content='text to type')
scroll(start_box='[x1, y1, x2, y2]', direction='down')
drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]')
```

## Global Options

| Option | Description |
|--------|-------------|
| `--help` | Show help |
| `--verbose` | Enable verbose logging |

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