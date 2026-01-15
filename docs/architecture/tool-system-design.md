# Tool System Design

This document describes the tool system architecture and design principles.

## Overview

xAgent CLI provides a rich set of built-in tools plus support for external tools via MCP (Model Context Protocol). Tools are the primary way agents interact with the filesystem, execute commands, and perform actions.

## Tool Categories

### File Operations
| Tool | Description | Permissions Required |
|------|-------------|---------------------|
| `read_file` | Read file contents | All modes |
| `write_file` | Create or overwrite files | YOLO, ACCEPT_EDITS, SMART |
| `replace` | Replace text in files | YOLO, ACCEPT_EDITS, SMART |
| `DeleteFile` | Delete files | YOLO |

### Search Tools
| Tool | Description | Permissions Required |
|------|-------------|---------------------|
| `Grep` | Search text patterns | All modes |
| `SearchCodebase` | Find files by pattern | All modes |
| `web_search` | Search the web | YOLO, ACCEPT_EDITS, PLAN, SMART |
| `web_fetch` | Fetch web content | YOLO, ACCEPT_EDITS, PLAN, SMART |

### Execution Tools
| Tool | Description | Permissions Required |
|------|-------------|---------------------|
| `Bash` | Execute shell commands | YOLO, ACCEPT_EDITS, SMART |
| `ListDirectory` | List directory contents | All modes |
| `CreateDirectory` | Create directories | YOLO, ACCEPT_EDITS, SMART |

### Task Management
| Tool | Description | Permissions Required |
|------|-------------|---------------------|
| `todo_write` | Create/manage task lists | All modes |
| `todo_read` | Read task lists | All modes |
| `task` | Launch SubAgents | YOLO, ACCEPT_EDITS, PLAN, SMART |

### GUI Automation


## Tool Interface

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
  validate?: (args: Record<string, unknown>) => boolean;
}
```

## Tool Registry

The ToolRegistry manages tool registration and retrieval:

```typescript
class ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  getToolsForMode(mode: ExecutionMode): Tool[];
}
```

## Tool Execution Flow

```
Tool Call → Validation → Permission Check
                              ↓
                    Execution → Result Formatting
                              ↓
                    Response Generation
```

## Adding Custom Tools

1. Implement the Tool interface
2. Register with ToolRegistry
3. Add TypeScript types
4. Write unit tests

## Related Documentation

- [Architecture Overview](./overview.md)
- [MCP Integration Guide](./mcp-integration-guide.md)
