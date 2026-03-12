import { spawn, ChildProcess, execSync } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { TeamStore, getTeamStore } from './team-store.js';
import { TeamMember, DisplayMode, TeammateConfig } from './types.js';
import { colors, icons } from '../theme.js';

const generateId = () => crypto.randomUUID();

// Graceful shutdown timeout in milliseconds
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;

/**
 * Process tracking information for external spawns (tmux/iTerm2)
 */
interface ExternalProcessInfo {
  type: 'tmux' | 'iterm2';
  paneId?: string;
  windowId?: string;
  sessionId?: string;
  startedAt: number;
}

/**
 * Extended process tracking that includes both ChildProcess and external process info
 */
interface TrackedProcess {
  childProcess?: ChildProcess;
  external?: ExternalProcessInfo;
  memberId: string;
  teamId: string;
  config: TeammateConfig;
}

function getXagentCommand(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(currentFile), '../..');
  const cliPath = path.join(projectRoot, 'dist', 'cli.js');
  return cliPath;
}

/**
 * Check if CLI exists, throw descriptive error if not
 */
function validateCliPath(): void {
  const cliPath = getXagentCommand();
  
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      `xAgent CLI not found at ${cliPath}. ` +
      `Please ensure the project is built (run 'npm run build' or 'tsc').`
    );
  }
}

export class TeammateSpawner {
  private store: TeamStore;
  private activeProcesses: Map<string, TrackedProcess> = new Map();
  private tmuxSessionName: string | null = null;
  private warnedAboutWindows = false;

  // Output filtering configuration
  private static readonly IGNORED_PATTERNS = [
    /^╔[═]+╗$/,                           // Banner top border
    /^║[^║]+║$/,                          // Banner content
    /^╚[═]+╝$/,                           // Banner bottom border
    /^─+$/,                               // Separator lines
    /^✨ Welcome to XAGENT CLI!$/,        // Welcome message
    /^Type \/help to see available commands$/, // Help hint
    /^ℹ Current Mode:$/,                  // Mode info
    /^\s*✨\s*\w+/,                        // Mode indicator
    /^\s*🧠 (Local|Remote) Models:$/,     // Model info header
    /^\s*→ (LLM|VLM):/,                   // Model info lines
    /^📝 Registering MCP server/,          // MCP registration
    /^🧠 Connecting to \d+ MCP server/,   // MCP connection
    /^Connecting to MCP Server/,           // MCP connection detail
    /^Loaded \d+ tools from MCP Server/,   // MCP tools loaded
    /^MCP Server connected$/,              // MCP connected
    /^✓ \d+\/\d+ MCP server/,             // MCP summary
    /^\[MCP\] Registered \d+ tool/,       // MCP tools registered
    /^✔ Initialization complete$/,         // Init complete
  ];

  // Patterns that indicate important output (should always show)
  private static readonly IMPORTANT_PATTERNS = [
    /✅|✓|✔/,                              // Success markers
    /❌|✗|✖/,                              // Error markers
    /⚠|⚠️/,                               // Warning markers
    /🔍|🔎/,                              // Search/action markers
    /📝|📄/,                              // Document markers
    /Tool|tool/,                           // Tool execution
    /Error|error|ERROR/,                   // Errors
    /Task completed|completed/,            // Task completion
    /Found \d+/,                           // Search results
  ];

  constructor(store?: TeamStore) {
    this.store = store || getTeamStore();
    // Validate CLI on construction
    validateCliPath();
  }

  /**
   * Check if a line should be filtered out (not displayed)
   */
  private shouldFilterLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;

    // Check if line matches any ignored pattern
    for (const pattern of TeammateSpawner.IGNORED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Format a teammate output line with proper styling
   */
  private formatOutputLine(memberName: string, line: string): string {
    const trimmed = line.trim();
    
    // Use compact prefix format: [name] content
    const prefix = colors.primary(`[${memberName}]`);
    
    return `${prefix} ${trimmed}`;
  }

  /**
   * Format an error line with error styling
   */
  private formatErrorLine(memberName: string, line: string): string {
    const trimmed = line.trim();
    const prefix = colors.error(`[${memberName}]`);
    return `${prefix} ${trimmed}`;
  }

  private isTmuxAvailable(): boolean {
    if (process.platform === 'win32') {
      // this.warnWindowsUser('tmux');
      return false;
    }
    try {
      execSync('which tmux', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private isInsideTmux(): boolean {
    return !!process.env.TMUX;
  }

  private isIterm2Available(): boolean {
    if (process.platform !== 'darwin') {
      if (process.platform === 'win32') {
        // this.warnWindowsUser('iTerm2');
      }
      return false;
    }
    try {
      execSync('which it2', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  // /**
  //  * Display Windows compatibility warning (only once per session)
  //  */
  // private warnWindowsUser(feature: string): void {
  //   if (this.warnedAboutWindows) return;
  //   this.warnedAboutWindows = true;

  //   console.log(colors.warning(
  //     `\n[Windows] ${feature} is not available on Windows. ` +
  //     `Using 'in-process' mode for parallel agents.\n` +
  //     `Note: In-process mode runs teammates in the same terminal. ` +
  //     `For true terminal multiplexing on Windows, consider using Windows Terminal with multiple tabs.\n`
  //   ));
  // }

  async spawnTeammate(
    teamId: string,
    config: TeammateConfig,
    workDir: string,
    displayMode: DisplayMode = 'auto',
    brokerPort?: number,
    initialTaskId?: string,
    leadId?: string
  ): Promise<TeamMember> {
    // Validate required fields with clear error messages
    if (!config.name || config.name.trim() === '') {
      throw new Error(
        'Teammate name is required. ' +
        'Please provide a valid "name" field in the teammates config. ' +
        'Example: { name: "developer", role: "coder", prompt: "..." }'
      );
    }

    if (!config.role || config.role.trim() === '') {
      throw new Error(
        `Teammate role is required for "${config.name}". ` +
        'Please provide a valid "role" field in the teammates config.'
      );
    }

    if (!config.prompt || config.prompt.trim() === '') {
      throw new Error(
        `Teammate prompt is required for "${config.name}". ` +
        'Please provide a valid "prompt" field in the teammates config.'
      );
    }

    const memberId = generateId();
    const memberName = config.name.trim();

    const member: Omit<TeamMember, 'role' | 'permissions'> = {
      memberId,
      name: memberName,
      memberRole: config.role,
      model: config.model,
      status: 'spawning',
      displayMode: 'in-process'
    };

    const savedMember = await this.store.addMember(teamId, member);

    const actualMode = this.resolveDisplayMode(displayMode);

    let processInfo: { processId: number; external?: ExternalProcessInfo };

    try {
      switch (actualMode) {
        case 'tmux':
          processInfo = await this.spawnWithTmux(teamId, memberId, config, workDir, brokerPort, initialTaskId, leadId);
          break;
        case 'iterm2':
          processInfo = await this.spawnWithIterm2(teamId, memberId, config, workDir, brokerPort, initialTaskId, leadId);
          break;
        case 'in-process':
        default:
          processInfo = await this.spawnWithNode(teamId, memberId, config, workDir, brokerPort, initialTaskId, leadId);
          break;
      }
    } catch (error: any) {
      // Update member status on failure
      await this.store.updateMember(teamId, memberId, {
        status: 'shutdown',
        lastActivity: Date.now()
      });

      // Re-throw with more context
      throw new Error(
        `Failed to spawn teammate "${config.name}" in ${actualMode} mode: ${error.message}. ` +
        `Consider using a different displayMode or check system requirements.`
      );
    }

    savedMember.status = 'active';
    savedMember.processId = processInfo.processId;
    savedMember.displayMode = actualMode;
    await this.store.updateMember(teamId, memberId, {
      status: 'active',
      processId: savedMember.processId,
      displayMode: actualMode
    });

    return savedMember;
  }

  private resolveDisplayMode(mode: DisplayMode): 'tmux' | 'iterm2' | 'in-process' {
    if (mode === 'in-process') return 'in-process';

    if (mode === 'tmux' || mode === 'auto') {
      if (this.isTmuxAvailable()) {
        return 'tmux';
      }
    }

    if (mode === 'iterm2' || mode === 'auto') {
      if (this.isIterm2Available()) {
        return 'iterm2';
      }
    }

    return 'in-process';
  }

  private async spawnWithTmux(
    teamId: string,
    memberId: string,
    config: TeammateConfig,
    workDir: string,
    brokerPort?: number,
    initialTaskId?: string,
    leadId?: string
  ): Promise<{ processId: number; external?: ExternalProcessInfo }> {
    const paneName = `xagent-${config.name.replace(/\s+/g, '-')}`;
    const args = this.buildCommandArgs(teamId, memberId, config, brokerPort, false, undefined, initialTaskId, leadId);
    const cliPath = getXagentCommand();
    const cmd = `node "${cliPath}" ${args.join(' ')}`;

    let paneId: string | undefined;
    let windowId: string | undefined;
    const sessionId = this.tmuxSessionName || teamId;

    try {
      if (this.isInsideTmux()) {
        // Split current window and capture the new pane ID
        execSync(`tmux split-window -v -p 50 -P -F '#{pane_id}'`, { cwd: workDir, stdio: ['ignore', 'pipe', 'ignore'] });
        
        // Get the pane ID of the new pane
        paneId = execSync(`tmux display-message -p '#{pane_id}'`, { cwd: workDir, encoding: 'utf-8' }).trim();
        
        execSync(`tmux send-keys -t :.+ '${cmd}' Enter`, { cwd: workDir, stdio: 'ignore' });
        execSync(`tmux select-pane -T "${paneName}"`, { cwd: workDir, stdio: 'ignore' });
      } else {
        // Create or attach to session
        try {
          execSync(`tmux new-session -d -s ${teamId} -x 200 -y 50 -P -F '#{session_id}'`, { cwd: workDir, stdio: 'ignore' });
          this.tmuxSessionName = teamId;
        } catch {
          // Session might already exist, that's okay
        }

        // Create new window and get its ID
        windowId = execSync(
          `tmux new-window -t ${teamId} -n "${paneName}" -P -F '#{window_id}' "${cmd}"`,
          { cwd: workDir, encoding: 'utf-8' }
        ).trim();
        
        paneId = execSync(`tmux display-message -t ${windowId} -p '#{pane_id}'`, { encoding: 'utf-8' }).trim();
      }

      // Track the external process
      const external: ExternalProcessInfo = {
        type: 'tmux',
        paneId,
        windowId,
        sessionId,
        startedAt: Date.now()
      };

      // Store tracking info
      this.activeProcesses.set(memberId, {
        memberId,
        teamId,
        config,
        external
      });

      // Generate a unique process ID for tracking (using hash of pane info)
      const processId = this.generateProcessId('tmux', paneId || windowId || sessionId);

      return { processId, external };
    } catch (error: any) {
      console.log(colors.warning(`tmux spawn failed: ${error.message}, falling back to in-process`));
      return this.spawnWithNode(teamId, memberId, config, workDir, brokerPort, initialTaskId, leadId);
    }
  }

  private async spawnWithIterm2(
    teamId: string,
    memberId: string,
    config: TeammateConfig,
    workDir: string,
    brokerPort?: number,
    initialTaskId?: string,
    leadId?: string
  ): Promise<{ processId: number; external?: ExternalProcessInfo }> {
    const args = this.buildCommandArgs(teamId, memberId, config, brokerPort, false, undefined, initialTaskId, leadId);
    const cliPath = getXagentCommand();
    const cmd = `node "${cliPath}" ${args.join(' ')}`;

    try {
      // Split pane and get session ID
      const sessionId = execSync(`it2 splitpane -v --session-id`, {
        cwd: workDir,
        encoding: 'utf-8'
      }).trim();

      execSync(`it2 send "${cmd}"`, { cwd: workDir, stdio: 'ignore' });

      const external: ExternalProcessInfo = {
        type: 'iterm2',
        sessionId,
        startedAt: Date.now()
      };

      this.activeProcesses.set(memberId, {
        memberId,
        teamId,
        config,
        external
      });

      const processId = this.generateProcessId('iterm2', sessionId);

      return { processId, external };
    } catch (error: any) {
      console.log(colors.warning(`iTerm2 spawn failed: ${error.message}, falling back to in-process`));
      return this.spawnWithNode(teamId, memberId, config, workDir, brokerPort, initialTaskId, leadId);
    }
  }

  private async spawnWithNode(
    teamId: string,
    memberId: string,
    config: TeammateConfig,
    workDir: string,
    brokerPort?: number,
    initialTaskId?: string,
    leadId?: string
  ): Promise<{ processId: number; external?: ExternalProcessInfo }> {
    const args = this.buildCommandArgs(teamId, memberId, config, brokerPort, false, undefined, initialTaskId, leadId);
    const cliPath = getXagentCommand();

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      XAGENT_TEAM_MODE: 'true',
      XAGENT_TEAM_ID: teamId,
      XAGENT_MEMBER_ID: memberId,
      XAGENT_MEMBER_NAME: config.name,
      XAGENT_SPAWN_PROMPT: config.prompt,
    };

    if (brokerPort) {
      env.XAGENT_BROKER_PORT = String(brokerPort);
    }

    if (initialTaskId) {
      env.XAGENT_INITIAL_TASK_ID = initialTaskId;
    }

    if (leadId) {
      env.XAGENT_LEAD_ID = leadId;
    }

    let childProcess: ChildProcess;
    try {
      childProcess = spawn('node', [cliPath, ...args], {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });
    } catch (error: any) {
      throw new Error(
        `Failed to spawn Node.js process: ${error.message}. ` +
        `Ensure Node.js is installed and the CLI is built.`
      );
    }

    // Track the process
    this.activeProcesses.set(memberId, {
      childProcess,
      memberId,
      teamId,
      config
    });

    childProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!this.shouldFilterLine(line)) {
          console.log(this.formatOutputLine(config.name, line));
        }
      }
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.error(this.formatErrorLine(config.name, line));
        }
      }
    });

    childProcess.on('exit', async (code) => {
      this.activeProcesses.delete(memberId);
      await this.store.updateMember(teamId, memberId, {
        status: 'shutdown',
        lastActivity: Date.now()
      });
      console.log(colors.textMuted(`[${config.name}] ${icons.arrow} exited with code ${code}`));
    });

    childProcess.on('error', (error) => {
      console.error(colors.error(`[${config.name}] SPAWN ERROR: ${error.message}`));
      this.activeProcesses.delete(memberId);
    });

    return { processId: childProcess.pid || Date.now() };
  }

  /**
   * Generate a deterministic process ID for external processes
   */
  private generateProcessId(type: string, identifier: string): number {
    // Create a hash from type and identifier to get a consistent number
    const hash = crypto.createHash('md5').update(`${type}:${identifier}`).digest();
    return hash.readUInt32BE(0);
  }

  private buildCommandArgs(
    teamId: string,
    memberId: string,
    config: TeammateConfig,
    brokerPort?: number,
    isLead: boolean = false,
    isSdk?: boolean,
    initialTaskId?: string,
    leadId?: string
  ): string[] {
    const args = [
      'start',
      '--team-mode',
      '--team-id', teamId,
      '--member-id', memberId,
      '--member-name', config.name,
    ];

    const useSdk = isSdk ?? (process.env.XAGENT_SDK === 'true');
    if (useSdk) {
      args.push('--sdk');
    }

    if (isLead) {
      args.push('--is-team-lead');
    }

    if (config.model) {
      args.push('--model', config.model);
    }

    if (brokerPort) {
      args.push('--broker-port', String(brokerPort));
    }

    if (config.prompt) {
      args.push('--initial-prompt', config.prompt);
    }

    if (initialTaskId) {
      args.push('--initial-task-id', initialTaskId);
    }

    if (leadId) {
      args.push('--lead-id', leadId);
    }

    return args;
  }

  /**
   * Gracefully shutdown a teammate with a timeout for task completion.
   */
  async shutdownTeammate(
    teamId: string,
    memberId: string,
    options?: { force?: boolean; timeout?: number }
  ): Promise<{ success: boolean; reason?: string }> {
    const { force = false, timeout = GRACEFUL_SHUTDOWN_TIMEOUT_MS } = options || {};

    const team = await this.store.getTeam(teamId);
    if (!team) {
      return { success: false, reason: `Team ${teamId} not found` };
    }

    const member = team.members.find(m => m.memberId === memberId);
    if (!member) {
      return { success: false, reason: `Member ${memberId} not found` };
    }

    if (member.status !== 'active') {
      return { success: true, reason: `Member already ${member.status}` };
    }

    const tracked = this.activeProcesses.get(memberId);

    // Handle tmux processes
    if (member.displayMode === 'tmux' && tracked?.external) {
      return this.shutdownTmuxProcess(teamId, memberId, tracked.external, force, timeout);
    }

    // Handle iTerm2 processes
    if (member.displayMode === 'iterm2' && tracked?.external) {
      return this.shutdownIterm2Process(teamId, memberId, tracked.external, force, timeout);
    }

    // Handle in-process (ChildProcess)
    if (tracked?.childProcess) {
      return this.shutdownChildProcess(teamId, memberId, tracked.childProcess, force, timeout);
    }

    // No tracked process, just update status
    await this.store.updateMember(teamId, memberId, { status: 'shutdown' });
    return { success: true, reason: 'No active process found' };
  }

  private async shutdownTmuxProcess(
    teamId: string,
    memberId: string,
    external: ExternalProcessInfo,
    force: boolean,
    timeout: number
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      if (!force) {
        // Send graceful shutdown signal via message
        // The teammate should handle this and exit cleanly
        console.log(colors.info(`[Shutdown] Sending graceful shutdown signal to tmux pane...`));
        
        // Try to send Ctrl+C to the pane for graceful shutdown
        if (external.paneId) {
          execSync(`tmux send-keys -t ${external.paneId} C-c`, { stdio: 'ignore' });
          
          // Wait for process to exit or timeout
          const startTime = Date.now();
          while (Date.now() - startTime < timeout) {
            try {
              // Check if pane still exists
              execSync(`tmux list-panes -t ${external.paneId}`, { stdio: 'ignore' });
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch {
              // Pane no longer exists
              this.activeProcesses.delete(memberId);
              await this.store.updateMember(teamId, memberId, { status: 'shutdown' });
              return { success: true, reason: 'Graceful shutdown completed' };
            }
          }
        }
      }

      // Force kill the pane
      if (external.paneId) {
        execSync(`tmux kill-pane -t ${external.paneId}`, { stdio: 'ignore' });
      } else if (external.windowId && this.tmuxSessionName) {
        execSync(`tmux kill-window -t ${this.tmuxSessionName}:${external.windowId}`, { stdio: 'ignore' });
      }

      this.activeProcesses.delete(memberId);
      await this.store.updateMember(teamId, memberId, { status: 'shutdown' });
      return { success: true, reason: force ? 'Force killed' : 'Timeout, force killed' };
    } catch (error: any) {
      // Pane might already be closed
      this.activeProcesses.delete(memberId);
      await this.store.updateMember(teamId, memberId, { status: 'shutdown' });
      return { success: true, reason: `Process cleanup: ${error.message}` };
    }
  }

  private async shutdownIterm2Process(
    teamId: string,
    memberId: string,
    external: ExternalProcessInfo,
    force: boolean,
    timeout: number
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      if (!force && external.sessionId) {
        // iTerm2 doesn't have great graceful shutdown support
        // We'll try sending Ctrl+C via the session
        console.log(colors.info(`[Shutdown] Sending graceful shutdown signal to iTerm2 session...`));
        execSync(`it2 send --session ${external.sessionId} \\x03`, { stdio: 'ignore' });
        
        // Wait briefly for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, Math.min(timeout, 5000)));
      }

      // iTerm2 panes can't be killed programmatically easily
      // The user will need to close the pane manually
      console.log(colors.warning(
        `[Shutdown] iTerm2 pane for member ${memberId} should be closed manually. ` +
        `The process has been marked as shutdown.`
      ));

      this.activeProcesses.delete(memberId);
      await this.store.updateMember(teamId, memberId, { status: 'shutdown' });
      return { success: true, reason: 'iTerm2 session marked as shutdown (close manually)' };
    } catch (error: any) {
      this.activeProcesses.delete(memberId);
      await this.store.updateMember(teamId, memberId, { status: 'shutdown' });
      return { success: true, reason: `Process cleanup: ${error.message}` };
    }
  }

  private async shutdownChildProcess(
    teamId: string,
    memberId: string,
    childProcess: ChildProcess,
    force: boolean,
    timeout: number
  ): Promise<{ success: boolean; reason?: string }> {
    return new Promise((resolve) => {
      const cleanup = () => {
        this.activeProcesses.delete(memberId);
        this.store.updateMember(teamId, memberId, { status: 'shutdown' }).catch(() => {});
      };

      // Set up timeout for force kill
      const timeoutId = setTimeout(() => {
        console.log(colors.warning(`[Shutdown] Timeout reached, force killing process ${childProcess.pid}`));
        childProcess.kill('SIGKILL');
        cleanup();
        resolve({ success: true, reason: 'Timeout, force killed with SIGKILL' });
      }, timeout);

      // Handle process exit
      childProcess.once('exit', (code) => {
        clearTimeout(timeoutId);
        cleanup();
        resolve({ success: true, reason: `Process exited with code ${code}` });
      });

      if (force) {
        // Force kill immediately
        childProcess.kill('SIGKILL');
      } else {
        // Send SIGTERM for graceful shutdown
        console.log(colors.info(`[Shutdown] Sending SIGTERM to process ${childProcess.pid}`));
        childProcess.kill('SIGTERM');
      }
    });
  }

  async shutdownAllTeammates(teamId: string): Promise<{ success: boolean; results: Map<string, { success: boolean; reason?: string }> }> {
    const team = await this.store.getTeam(teamId);
    if (!team) {
      return { success: false, results: new Map() };
    }

    const results = new Map<string, { success: boolean; reason?: string }>();

    for (const member of team.members) {
      if (member.status === 'active' && member.role !== 'lead') {
        const result = await this.shutdownTeammate(teamId, member.memberId);
        results.set(member.memberId, result);
      }
    }

    // Clean up tmux session
    if (this.tmuxSessionName) {
      try {
        execSync(`tmux kill-session -t ${this.tmuxSessionName}`, { stdio: 'ignore' });
      } catch {
        // Session might already be closed
      }
      this.tmuxSessionName = null;
    }

    return {
      success: Array.from(results.values()).every(r => r.success),
      results
    };
  }

  getActiveProcesses(): string[] {
    return Array.from(this.activeProcesses.keys());
  }

  /**
   * Get detailed info about a tracked process
   */
  getProcessInfo(memberId: string): TrackedProcess | undefined {
    return this.activeProcesses.get(memberId);
  }

  isDisplayModeAvailable(mode: DisplayMode): boolean {
    switch (mode) {
      case 'tmux':
        return this.isTmuxAvailable();
      case 'iterm2':
        return this.isIterm2Available();
      case 'in-process':
        return true;
      case 'auto':
        return true;
      default:
        return false;
    }
  }
}

let teammateSpawnerInstance: TeammateSpawner | null = null;

export function getTeammateSpawner(store?: TeamStore): TeammateSpawner {
  if (!teammateSpawnerInstance) {
    teammateSpawnerInstance = new TeammateSpawner(store);
  }
  return teammateSpawnerInstance;
}