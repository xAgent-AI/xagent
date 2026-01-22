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
│      (Session + Conversation Management)        │
├─────────────────────────────────────────────────┤
│                  Agent System                   │
│            (SubAgent Orchestration)             │
├─────────────────────────────────────────────────┤
│                  Tool Layer                     │
│      (Built-in + MCP + Skill Tools)             │
├─────────────────────────────────────────────────┤
│                 AI Client Layer                 │
│      (Local + Remote AI Clients)                │
├─────────────────────────────────────────────────┤
│              Storage & Config                   │
│         (Checkpoint, Settings, Memory)          │
└─────────────────────────────────────────────────┘
```

## Key Components

### 1. CLI Interface
- Built with Ink (React for CLI)
- Interactive terminal UI
- Theme support
- Cancellation support (ESC key)

### 2. Session Management
- `InteractiveSession` - Main session handler
- `SessionManager` - Session state management
- `ConversationManager` - Conversation history
- `CheckpointManager` - State persistence
- `ContextCompressor` - Context optimization

### 3. Agent System
- `AgentManager` - Agent configuration and loading
- Main agent for general tasks
- Specialized SubAgents:
  - Plan Agent - Task planning and decomposition
  - Explore Agent - Codebase exploration
  - Frontend Tester - Frontend testing
  - Code Reviewer - Code quality review
  - Frontend/Backend Developer - Specialized development
  - GUI SubAgent - Browser/desktop automation

### 4. Tool System
- `ToolRegistry` - Tool registration and management
- Built-in tools (20+)
- MCP integration with dynamic tool loading
- Skill invocation system (`InvokeSkill` tool)
- Smart Mode approval system

### 5. AI Client Layer
- `AIClient` - Local AI client for OpenAI-compatible APIs
- `RemoteAIClient` - Remote AI client for xAgent web service
- Multi-model support
- Token optimization

### 6. GUI SubAgent
- `ComputerOperator` - Desktop control (mouse, keyboard, screenshots)
- `GUIAgent` - LLM-driven automation agent
- Support for local and remote VLM modes
- Action parsing and execution

### 7. Authentication & Config
- `AuthService` - OAuth and API key authentication
- `ConfigManager` - Global and project settings
- Support for multiple auth types:
  - `oauth-xagent` - xAgent native authentication
  - `api_key` - Direct API key
  - `openai_compatible` - Third-party OpenAI-compatible APIs

## Execution Flow

```
User Input → Slash Command Parser
                  ↓
            Input Processor
                  ↓
            Agent Decision
                  ↓
      ┌───────────┴───────────┐
      ↓                       ↓
  Local Mode             Remote Mode
  (API Key)              (OAuth)
      ↓                       ↓
  Tool Selection         Sync to Remote
      ↓                       ↓
  Tool Execution         Remote Approval
      ↓                       ↓
  Smart Approval         Tool Execution
  (if SMART mode)            ↓
      ↓                  Sync Results
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
- **SMART**: Intelligent mode with three-layer approval (whitelist, blacklist, AI review)

## Smart Mode Architecture

Smart Mode uses a three-layer approval system:

```
┌─────────────────────────────────────────┐
│         Tool Call Request               │
└─────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│      Layer 1: Whitelist Check           │
│   (Safe tools → Auto-approved)          │
└─────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│      Layer 2: Blacklist Check           │
│   (Dangerous → User confirmation)       │
└─────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│      Layer 3: AI Review                 │
│   (Unknown → AI risk assessment)        │
└─────────────────────────────────────────┘
```

## Remote Mode Support

xAgent supports two operating modes:

### Local Mode
- Uses local API key for AI calls
- All tool execution happens locally
- Full Smart Mode approval functionality
- Suitable for self-hosted LLMs

### Remote Mode (OAuth)
- Uses xAgent web service for AI calls
- Tools are synced to remote server
- Approval handled by remote LLM
- Requires authentication with xAgent account

## Related Documentation

- [Tool System Design](./tool-system-design.md)
- [MCP Integration Guide](./mcp-integration-guide.md)
- [CLI Commands](../cli/commands.md)
- [Smart Mode Documentation](../smart-mode.md)
