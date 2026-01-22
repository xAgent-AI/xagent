# Tool System Design

This document describes the tool system architecture and design principles.

## Overview

xAgent CLI provides a rich set of built-in tools plus support for external tools via MCP (Model Context Protocol). Tools are the primary way agents interact with the filesystem, execute commands, and perform actions.

## Tool Categories

### File Operations
| Tool | Description | Permissions Required |
|------|-------------|---------------------|
| `Read` | Read file contents | YOLO, ACCEPT_EDITS, PLAN, SMART |
| `Write` | Create or overwrite files | YOLO, ACCEPT_EDITS, SMART |
| `replace` | Replace text in files | YOLO, ACCEPT_EDITS, SMART |
| `DeleteFile` | Delete files | YOLO, ACCEPT_EDITS, SMART |

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
| Tool | Description | Permissions Required |
|------|-------------|---------------------|
| `gui_operate` | GUI browser automation | YOLO, ACCEPT_EDITS, SMART |
| `gui_screenshot` | Take browser screenshot | YOLO, ACCEPT_EDITS, SMART |
| `gui_cleanup` | Cleanup GUI instances | YOLO, ACCEPT_EDITS, SMART |

### Skill Invocation
| Tool | Description | Permissions Required |
|------|-------------|---------------------|
| `InvokeSkill` | Invoke specialized skills | YOLO, ACCEPT_EDITS, PLAN, SMART |

### Additional Tools
| Tool | Description | Permissions Required |
|------|-------------|---------------------|
| `image_read` | Analyze image content | All modes |
| `save_memory` | Remember user preferences | All modes |
| `ask_user_question` | Ask user for clarification | All modes |
| `xml_escape` | Escape XML/HTML content | All modes |
| `exit_plan_mode` | Exit plan mode | PLAN |


## Tool Interface

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
  validate?: (args: Record<string, unknown>) => boolean;
  allowedModes?: ExecutionMode[];
}
```

## Tool Registry

The ToolRegistry manages tool registration and retrieval:

```typescript
class ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  getAll(): Tool[];
  getToolsForMode(mode: ExecutionMode): Tool[];
  registerMCPTools(mcpTools: any[]): void;
}
```

## Tool Execution Flow

```
Tool Call → Permission Check (by mode)
                    ↓
              Whitelist Check (Smart Mode)
                    ↓
              Blacklist Check (Smart Mode)
                    ↓
              AI Review (Smart Mode)
                    ↓
              Execution → Result Formatting
                    ↓
              Response Generation
```

## Smart Mode Integration

In Smart Mode, tools go through a three-layer approval system:

1. **Whitelist Check**: Safe tools (Read, ListDirectory, Grep, etc.) are approved automatically
2. **Blacklist Check**: Dangerous operations are flagged for user confirmation
3. **AI Review**: Unknown tools are analyzed by AI for risk assessment

## Adding Custom Tools

1. Implement the Tool interface in tools.ts
2. Register with ToolRegistry in getToolRegistry()
3. Add TypeScript types if needed
4. Write unit tests
5. Update system-prompt-generator.ts with tool schema

## Remote Mode Support

Tools can operate in two modes:

- **Local Mode**: Tools are executed locally with local AI client
- **Remote Mode**: Tools are synced to remote server, approval handled by remote LLM

## Related Documentation

- [Architecture Overview](./overview.md)
- [MCP Integration Guide](./mcp-integration-guide.md)
- [Smart Mode Documentation](../smart-mode.md)
