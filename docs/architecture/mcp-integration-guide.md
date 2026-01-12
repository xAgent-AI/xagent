# SKILL, Workflow and MCP Integration Guide

This document explains how to integrate external skills, workflows, and MCP servers with xAgent CLI.

## Overview

xAgent CLI supports extensibility through:
- **SKILL**: Reusable task modules
- **Workflow**: Predefined automation sequences
- **MCP (Model Context Protocol)**: External tool servers

## MCP Integration

### What is MCP?

MCP (Model Context Protocol) is an open standard that enables AI assistants to connect with external tools and data sources.

### Configuring MCP Servers

Add MCP servers to your settings file (`~/.xagent/settings.json`):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"],
      "args": ["/path/to/directory"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

### MCP Server Configuration

```typescript
interface MCPServerConfig {
  command?: string;           // Command for stdio transport
  args?: string[];            // Command arguments
  env?: Record<string, string>;  // Environment variables
  url?: string;               // URL for HTTP/SSE transport
  transport?: 'stdio' | 'sse' | 'http';
  authToken?: string;
  headers?: Record<string, string>;
  timeout?: number;
}
```

### Supported MCP Servers

| Server | Description |
|--------|-------------|
| filesystem | File system operations |
| github | GitHub API integration |
| postgres | PostgreSQL database |
| redis | Redis key-value store |
| puppeteer | Browser automation |

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

## SKILL System

### What are SKILLs?

SKILLs are reusable task modules that can be composed to create complex automation flows.

### SKILL Structure

```typescript
interface SkillConfig {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, SkillParameter>;
  execute: (input: Record<string, unknown>) => Promise<SkillResult>;
}
```

## Best Practices

1. **Security**: Review MCP server permissions before installing
2. **Versioning**: Use specific versions for reproducibility
3. **Testing**: Test workflows in a safe environment first
4. **Documentation**: Document custom SKILLs and workflows

## Related Documentation

- [Architecture Overview](./overview.md)
- [Tool System Design](./tool-system-design.md)
- [CLI Commands](../cli/commands.md)
