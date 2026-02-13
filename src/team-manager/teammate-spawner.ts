import { spawn, ChildProcess, execSync } from 'child_process';
import crypto from 'crypto';
import { TeamStore, getTeamStore } from './team-store.js';
import { TeamMember, DisplayMode, TeammateConfig, TEAMMATE_PERMISSIONS } from './types.js';
import { colors } from '../theme.js';

const generateId = () => crypto.randomUUID();

export class TeammateSpawner {
  private store: TeamStore;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private tmuxSessionName: string | null = null;

  constructor(store?: TeamStore) {
    this.store = store || getTeamStore();
  }

  private isTmuxAvailable(): boolean {
    if (process.platform === 'win32') return false;
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
    if (process.platform !== 'darwin') return false;
    try {
      execSync('which it2', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async spawnTeammate(
    teamId: string,
    config: TeammateConfig,
    workDir: string,
    displayMode: DisplayMode = 'auto',
    brokerPort?: number
  ): Promise<TeamMember> {
    const memberId = generateId();

    const member: Omit<TeamMember, 'role' | 'permissions'> = {
      memberId,
      name: config.name,
      memberRole: config.role,
      model: config.model,
      status: 'spawning',
      displayMode: 'in-process'
    };

    const savedMember = await this.store.addMember(teamId, member);

    const actualMode = this.resolveDisplayMode(displayMode);

    let processId: number | undefined;

    switch (actualMode) {
      case 'tmux':
        processId = await this.spawnWithTmux(teamId, memberId, config, workDir, brokerPort);
        break;
      case 'iterm2':
        processId = await this.spawnWithIterm2(teamId, memberId, config, workDir, brokerPort);
        break;
      case 'in-process':
      default:
        processId = await this.spawnWithNode(teamId, memberId, config, workDir, brokerPort);
        break;
    }

    savedMember.status = 'active';
    savedMember.processId = processId;
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
    brokerPort?: number
  ): Promise<number> {
    const paneName = `xagent-${config.name.replace(/\s+/g, '-')}`;
    const args = this.buildCommandArgs(teamId, memberId, config, brokerPort, false, undefined);
    const cmd = `xagent ${args.join(' ')}`;

    try {
      if (this.isInsideTmux()) {
        execSync(`tmux split-window -v -p 50`, { cwd: workDir, stdio: 'ignore' });
        execSync(`tmux send-keys -t :.+ '${cmd}' Enter`, { cwd: workDir, stdio: 'ignore' });
        execSync(`tmux select-pane -T "${paneName}"`, { cwd: workDir, stdio: 'ignore' });
      } else {
        try {
          execSync(`tmux new-session -d -s ${teamId} -x 200 -y 50`, { cwd: workDir, stdio: 'ignore' });
          this.tmuxSessionName = teamId;
        } catch {
          // session might already exist
        }
        execSync(`tmux new-window -t ${teamId} -n "${paneName}" "${cmd}"`, { cwd: workDir, stdio: 'ignore' });
      }
    } catch (error: any) {
      console.log(colors.warning(`tmux spawn failed: ${error.message}, falling back to in-process`));
      return this.spawnWithNode(teamId, memberId, config, workDir, brokerPort);
    }

    return Date.now();
  }

  private async spawnWithIterm2(
    teamId: string,
    memberId: string,
    config: TeammateConfig,
    workDir: string,
    brokerPort?: number
  ): Promise<number> {
    const args = this.buildCommandArgs(teamId, memberId, config, brokerPort, false, undefined);
    const cmd = `xagent ${args.join(' ')}`;

    try {
      execSync(`it2 splitpane -v`, { cwd: workDir, stdio: 'ignore' });
      execSync(`it2 send "${cmd}"`, { cwd: workDir, stdio: 'ignore' });
    } catch (error: any) {
      console.log(colors.warning(`iTerm2 spawn failed: ${error.message}, falling back to in-process`));
      return this.spawnWithNode(teamId, memberId, config, workDir, brokerPort);
    }

    return Date.now();
  }

  private async spawnWithNode(
    teamId: string,
    memberId: string,
    config: TeammateConfig,
    workDir: string,
    brokerPort?: number
  ): Promise<number> {
    const args = this.buildCommandArgs(teamId, memberId, config, brokerPort, false, undefined);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      XAGENT_TEAM_MODE: 'true',
      XAGENT_TEAM_ID: teamId,
      XAGENT_MEMBER_ID: memberId,
      XAGENT_MEMBER_NAME: config.name,
      XAGENT_SPAWN_PROMPT: config.prompt,
      XAGENT_MEMBER_ROLE: config.role,
      XAGENT_IS_TEAM_LEAD: 'false',
    };

    if (brokerPort) {
      env.XAGENT_BROKER_PORT = String(brokerPort);
    }

    const teammateProcess = spawn('xagent', args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    });

    this.activeProcesses.set(memberId, teammateProcess);

    teammateProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`[${config.name}] ${line}`);
        }
      }
    });

    teammateProcess.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.error(`[${config.name} ERROR] ${line}`);
        }
      }
    });

    teammateProcess.on('exit', async (code) => {
      this.activeProcesses.delete(memberId);
      await this.store.updateMember(teamId, memberId, {
        status: 'shutdown',
        lastActivity: Date.now()
      });
      console.log(`[${config.name}] exited with code ${code}`);
    });

    return teammateProcess.pid || Date.now();
  }

  private buildCommandArgs(
    teamId: string,
    memberId: string,
    config: TeammateConfig,
    brokerPort?: number,
    isLead: boolean = false,
    isSdk?: boolean
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

    return args;
  }

  async shutdownTeammate(teamId: string, memberId: string): Promise<void> {
    const team = await this.store.getTeam(teamId);
    if (!team) return;

    const member = team.members.find(m => m.memberId === memberId);
    if (!member) return;

    if (member.displayMode === 'tmux') {
      try {
        if (this.isInsideTmux()) {
          execSync(`tmux kill-pane -t :.+`, { stdio: 'ignore' });
        } else if (this.tmuxSessionName) {
          execSync(`tmux kill-window -t ${this.tmuxSessionName}:${member.name}`, { stdio: 'ignore' });
        }
      } catch {
        // pane might already be closed
      }
    }

    const process = this.activeProcesses.get(memberId);
    if (process) {
      process.kill('SIGTERM');
      this.activeProcesses.delete(memberId);
    }

    await this.store.updateMember(teamId, memberId, { status: 'shutdown' });
  }

  async shutdownAllTeammates(teamId: string): Promise<void> {
    const team = await this.store.getTeam(teamId);
    if (!team) return;

    for (const member of team.members) {
      if (member.status === 'active' && member.role !== 'lead') {
        await this.shutdownTeammate(teamId, member.memberId);
      }
    }

    if (this.tmuxSessionName) {
      try {
        execSync(`tmux kill-session -t ${this.tmuxSessionName}`, { stdio: 'ignore' });
      } catch {
        // session might already be closed
      }
      this.tmuxSessionName = null;
    }
  }

  getActiveProcesses(): string[] {
    return Array.from(this.activeProcesses.keys());
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
