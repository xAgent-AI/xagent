import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TOOLS_DIR = path.join(os.homedir(), '.xagent', 'bin');

interface RgResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Get ripgrep executable path
 * Returns null if not found and download fails
 */
export async function getRipgrepPath(): Promise<string | null> {
  const binaryName = os.platform() === 'win32' ? 'rg.exe' : 'rg';
  const localPath = path.join(TOOLS_DIR, binaryName);

  // Check local installation
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // Check system PATH
  try {
    const { stdout } = await execCommand(os.platform() === 'win32' ? 'where' : 'which', ['rg']);
    if (stdout.trim()) {
      return stdout.trim().split('\n')[0];
    }
  } catch {
    // rg not in PATH
  }

  return null;
}

/**
 * Execute a command and return stdout, stderr, exitCode
 */
function execCommand(cmd: string, args: string[]): Promise<RgResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });

    child.on('error', (error) => {
      resolve({ stdout, stderr, exitCode: null });
    });
  });
}

/**
 * Search files using ripgrep
 */
export async function ripgrep(params: {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}): Promise<string> {
  const rgPath = await getRipgrepPath();

  if (!rgPath) {
    throw new Error('ripgrep (rg) not found. Please install ripgrep or add it to PATH');
  }

  const searchPath = params.path || '.';
  const args: string[] = ['--color=never', '--line-number'];

  if (params.ignoreCase) {
    args.push('--ignore-case');
  }

  if (params.literal) {
    args.push('--fixed-strings');
  }

  if (params.glob) {
    args.push('--glob', params.glob);
  }

  if (params.context && params.context > 0) {
    args.push('--context', String(params.context));
  }

  args.push(params.pattern, searchPath);

  const { stdout, stderr, exitCode } = await execCommand(rgPath, args);

  if (exitCode !== 0 && exitCode !== 1) {
    const errorMsg = stderr.trim() || `ripgrep exited with code ${exitCode}`;
    throw new Error(errorMsg);
  }

  return stdout || 'No matches found';
}
