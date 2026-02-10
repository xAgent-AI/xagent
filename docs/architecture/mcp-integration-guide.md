# SKILL, Workflow and MCP Integration Guide

This document explains how to integrate external skills, workflows, and MCP servers with xAgent CLI.

## Overview

xAgent CLI supports extensibility through:
- **SKILL**: Reusable task modules
- **Workflow**: Predefined automation sequences
- **MCP (Model Context Protocol)**: External tool servers

---

## MCP Integration

### What is MCP?

MCP (Model Context Protocol) is an open standard that enables AI assistants to connect with external tools and data sources. xAgent uses MCP to integrate additional tools beyond its built-in set.

### Configuring MCP Servers

Add MCP servers to your settings file (`~/.xagent/settings.json`):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"],
      "transport": "stdio"
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "transport": "stdio"
    },
    "custom-server": {
      "url": "http://localhost:3000/mcp",
      "transport": "http"
    }
  }
}
```

### MCP Server Configuration

```typescript
interface MCPServerConfig {
  command?: string;           // Command for stdio transport
  args?: string[];           // Command arguments
  env?: Record<string, string>;  // Environment variables
  cwd?: string;              // Working directory
  url?: string;              // URL for HTTP/SSE transport
  transport?: 'stdio' | 'sse' | 'http';
  authToken?: string;        // Bearer token for authentication
  headers?: Record<string, string>;  // Custom headers
  timeout?: number;          // Tool call timeout in ms (default: 30000)
}
```

### MCP Tool Naming

MCP tools are automatically registered with the ToolRegistry and available to agents. To distinguish MCP tools from built-in tools, MCP tool names use a prefix pattern:

```
{serverName}__{toolName}
```

For example:
- `filesystem__read_file`
- `github__create_issue`

The prefix is derived from the server name in your configuration (the key in `mcpServers`).

### Adding MCP Servers

#### Interactive Mode (Recommended)

```bash
xagent start
# Then use:
/mcp add
```

#### CLI Command (Non-interactive)

xAgent CLI supports adding MCP servers via command line without interactive prompts:

```bash
# Add with stdio transport
xagent mcp --add <name> -t stdio -c <command> --args <args>

# Add with HTTP transport
xagent mcp --add <name> -t http -u <url> [-k <token>] [--header <key:value>]
```

**Options:**

| Short | Long | Description |
|-------|------|-------------|
| `-a` | `--add [name]` | Server name (auto-generated if not provided) |
| `-t` | `--transport <type>` | Transport type: `stdio` or `http` |
| `-c` | `--command <cmd>` | Command for stdio transport |
| | | `--args <args>` | Arguments for stdio transport (comma-separated) |
| `-u` | `--url <url>` | URL for HTTP transport |
| `-k` | `--token <token>` | Bearer authentication token |
| | | `--header <key:value>` | Custom header (can be used multiple times) |
| `-y` | `--yes` | Skip confirmation prompt |

**Examples:**

```bash
# GitHub MCP server (stdio)
xagent mcp --add github -t stdio -c "npx" --args "-y,@modelcontextprotocol/server-github"

# Filesystem MCP server (stdio)
xagent mcp --add filesystem -t stdio -c "npx" --args "-y,@modelcontextprotocol/server-filesystem,/path/to/dir"

# Custom HTTP server with auth
xagent mcp --add custom -t http -u "https://localhost:3000/mcp" -k "bearer-token"

# Custom headers
xagent mcp --add custom -t http -u "https://example.com/mcp" --header "X-Custom-Header:value"

# Skip confirmation
xagent mcp --add github -t stdio -c "npx" --args "-y,@modelcontextprotocol/server-github" -y
```

**Transport Types:**

- **stdio**: Spawns the MCP server as a subprocess. Used for local servers like `@modelcontextprotocol/server-github`, `@modelcontextprotocol/server-filesystem`.
- **http**: Streamable HTTP transport. Used for remote MCP servers.

**Complete Interactive Flow Example:**

```
> /mcp add
? Enter MCP server name: github
? Select transport type: Stdio (stdin/stdout)
? Enter command (for stdio transport): npx
? Enter arguments (comma-separated, for stdio transport): -y, @modelcontextprotocol/server-github
✅ MCP server 'github' added and connected successfully
```

**For HTTP/SSE Transport:**

```
> /mcp add
? Enter MCP server name: custom-api
? Select transport type: HTTP (POST)
? Enter server URL (for HTTP/SSE/HTTP transport): https://api.example.com/mcp
? Enter authentication token (optional):
? Enter custom headers as JSON (optional): {"X-Custom-Header": "value"}
✅ MCP server 'custom-api' added and connected successfully
```

#### Manual Configuration

Edit `~/.xagent/settings.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "transport": "stdio"
    }
  }
}
```

Restart your session after editing.

### Managing MCP Servers

```bash
# List all configured MCP servers
xagent mcp --list

# Remove an MCP server
xagent mcp --remove <name>
```

---

## Workflow System

### What are Workflows?

Workflows are predefined sequences of actions that automate complex tasks. They can be installed from the Workflow Market.

### Installing Workflows

```bash
xagent workflow --add <workflow-id>
```

### Workflow Structure

```typescript
interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  agents: AgentConfig[];
  commands: Record<string, string>;
  mcpServers: Record<string, MCPServerConfig>;
  xagentMd: string;
  files: Record<string, string>;
}
```

### Managing Workflows

```bash
# List installed workflows
xagent workflow --list

# Remove a workflow
xagent workflow --remove <workflow-id>
```

---

## Skill Integration

### What are Skills?

Skills are reusable task modules that extend xAgent's capabilities. Each skill is defined by a `SKILL.md` file and can be invoked during conversations.

### Installing Skills

xAgent supports installing skills from various sources:

```bash
# Install from local directory
xagent skill --add ./my-skill

# Install from GitHub repository
xagent skill --add owner/repo

# Install from GitHub URL
xagent skill --add https://github.com/owner/repo

# Install from specific path in repo
xagent skill --add https://github.com/owner/repo/tree/main/skills/my-skill

# Install skill with @ syntax
xagent skill --add owner/repo@skill-name

# Install from direct SKILL.md URL
xagent skill --add https://example.com/skill.md
```

### Managing Skills

```bash
# List all installed skills
xagent skill --list

# Remove a user-installed skill
xagent skill --remove <skill-name>
```

**Note:** Built-in skills `find-skills` cannot be removed.

### Invoking Skills

Skills are invoked using the `InvokeSkill` tool:

```
InvokeSkill(skillId="docx", taskDescription="Create a document with title 'Report'")
```

### Configuring Skill Paths

By default, user skills are stored in `~/.xagent/skills`. You can customize this path in your settings(`~/.xagent/settings.json`):

```json
{
  "userSkillsPath": "/path/to/your/skills"
}
```

---

## Best Practices

1. **Security**: Review MCP server permissions before installing
2. **Versioning**: Use specific versions for reproducibility
3. **Testing**: Test workflows and skills in a safe environment first
4. **Documentation**: Document custom SKILLs and workflows

---

## Related Documentation

- [Architecture Overview](./overview.md)
- [Tool System Design](./tool-system-design.md)
- [CLI Commands](../cli/commands.md)
- [Smart Mode Documentation](../smart-mode.md)
