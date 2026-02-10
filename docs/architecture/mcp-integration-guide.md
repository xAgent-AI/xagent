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
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"]
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

### MCP Tool Synchronization

MCP tools are automatically registered with the ToolRegistry and available to agents. MCP tool names use a suffix pattern to avoid conflicts:

```
{original_name}_mcp{server_number}
```

For example: `github__create_issue_mcp0`

## Remote Mode MCP Sync

When using Remote Mode (OAuth authentication), MCP tools are synchronized to the remote server:

1. MCP server connects and discovers tools
2. Tool definitions are sent to remote server
3. Remote LLM can call MCP tools through the remote client
4. Tool execution results are synced back

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

SKILLs are reusable task modules that can be composed to create complex automation flows. SKILLs are invoked through the `InvokeSkill` tool.

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

### Available Skills

xAgent includes several built-in skills:

| Skill | Category | Description |
|-------|----------|-------------|
| docx | Document Processing | Create and edit Word documents |
| pptx | Document Processing | Create PowerPoint presentations |
| xlsx | Document Processing | Create and edit Excel spreadsheets |
| pdf | Document Processing | PDF processing and manipulation |
| mcp-builder | Development | Build custom MCP servers |
| skill-creator | Development | Create new skills |
| webapp-testing | Testing | Web application testing |
| frontend-design | Design | Frontend design and implementation |
| theme-factory | Design | Color theme generation |
| algorithmic-art | Creative | Generate algorithmic art |

### Invoking Skills

Skills are invoked using the `InvokeSkill` tool:

```
InvokeSkill(skillId="docx", taskDescription="Create a document with title 'Report' and content 'Hello World'")
```

## Skill System Files

Skills are defined in the `skills/` directory with the following structure:

```
skills/
├── skills/
│   ├── {skill-name}/
│   │   ├── SKILL.md          # Skill definition
│   │   ├── LICENSE.txt
│   │   └── scripts/          # Implementation scripts
│   └── ...
├── spec/
│   └── agent-skills-spec.md  # Skill specification
└── template/
    └── SKILL.md              # Skill template
```

## Best Practices

1. **Security**: Review MCP server permissions before installing
2. **Versioning**: Use specific versions for reproducibility
3. **Testing**: Test workflows and skills in a safe environment first
4. **Documentation**: Document custom SKILLs and workflows
5. **Skill Selection**: Use InvokeSkill tool for specialized tasks

## Related Documentation

- [Architecture Overview](./overview.md)
- [Tool System Design](./tool-system-design.md)
- [CLI Commands](../cli/commands.md)
- [Smart Mode Documentation](../smart-mode.md)
