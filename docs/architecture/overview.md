# Architecture Overview

This document provides a high-level overview of the xAgent CLI architecture.

## Core Philosophy

xAgent CLI is designed as an intelligent agent for personal PCs and autonomous living. It transforms how users interact with their digital life through AI-powered automation.

## System Architecture

### Layered Architecture

```
┌─────────────────────────────────────────────────┐
│                  CLI Interface                  │
│           (Ink/React Components)                │
├─────────────────────────────────────────────────┤
│                   Session Layer                 │
│            (Session Management)                 │
├─────────────────────────────────────────────────┤
│                  Agent System                   │
│            (SubAgent Orchestration)             │
├─────────────────────────────────────────────────┤
│                  Tool Layer                     │
│            (Built-in + MCP Tools)               │
├─────────────────────────────────────────────────┤
│                 AI Client Layer                 │
│         (Multi-Model Support)                   │
├─────────────────────────────────────────────────┤
│              Storage & Config                   │
│         (Checkpoint, Settings)                  │
└─────────────────────────────────────────────────┘
```

## Key Components

### 1. CLI Interface
- Built with Ink (React for CLI)
- Interactive terminal UI
- Theme support

### 2. Session Management
- Conversation history
- Checkpoint persistence
- Context compression

### 3. Agent System
- Main agent for general tasks
- Specialized SubAgents:
  - Plan Agent
  - Explore Agent
  - Frontend Tester
  - Code Reviewer
  - GUI SubAgent

### 4. Tool System
- Built-in tools (12+)
- MCP integration
- Dynamic tool loading

### 5. AI Client
- Multi-model support
- API abstraction layer
- Token optimization

## Execution Flow

```
User Input → Input Processor → Agent Decision
                                    ↓
                              Tool Selection
                                    ↓
                              Tool Execution
                                    ↓
                              Response Output
                                    ↓
                              Checkpoint Save
```

## Security Model

xAgent implements five execution modes:
- **YOLO**: Full control without restrictions
- **ACCEPT_EDITS**: File-only modifications
- **PLAN**: Plan before execution
- **DEFAULT**: Approval required for actions
- **SMART**: Intelligent mode with learning

## Related Documentation

- [Tool System Design](./tool-system-design.md)
- [MCP Integration Guide](./mcp-integration-guide.md)
- [CLI Commands](../cli/commands.md)
