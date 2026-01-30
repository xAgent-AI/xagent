import { spawn } from 'child_process';
import fs, { existsSync, mkdirSync, chmodSync, readFileSync, unlinkSync, rmSync, createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';

const TOOLS_DIR = path.join(os.homedir(), '.xagent', 'bin');
const RG_VERSION = '14.0.0';
const FD_VERSION = '8.7.0';

interface CmdResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// ============== ripgrep (rg) ==============

interface RgConfig {
  name: string;
  repo: string;
  binaryName: string;
  tagPrefix: string;
  getAssetName: (version: string, plat: string, arch: string) => string | null;
}

const RG_CONFIG: RgConfig = {
  name: 'ripgrep',
  repo: 'BurntSushi/ripgrep',
  binaryName: 'rg',
  tagPrefix: '',
  getAssetName: (version, plat, arch) => {
    if (plat === 'darwin') {
      const archStr = arch === 'arm64' ? 'aarch64' : 'x86_64';
      return `ripgrep-${version}-${archStr}-apple-darwin.tar.gz`;
    } else if (plat === 'linux') {
      return arch === 'arm64'
        ? `ripgrep-${version}-aarch64-unknown-linux-musl.tar.gz`
        : `ripgrep-${version}-x86_64-unknown-linux-musl.tar.gz`;
    } else if (plat === 'win32') {
      const archStr = arch === 'arm64' ? 'aarch64' : 'x86_64';
      return `ripgrep-${version}-${archStr}-pc-windows-msvc.zip`;
    }
    return null;
  }
};

// ============== fd ==============

interface FdConfig {
  name: string;
  repo: string;
  binaryName: string;
  tagPrefix: string;
  getAssetName: (version: string, plat: string, arch: string) => string | null;
}

const FD_CONFIG: FdConfig = {
  name: 'fd',
  repo: 'sharkdp/fd',
  binaryName: 'fd',
  tagPrefix: 'v',
  getAssetName: (version, plat, arch) => {
    if (plat === 'darwin') {
      const archStr = arch === 'arm64' ? 'aarch64' : 'x86_64';
      return `fd-v${version}-${archStr}-apple-darwin.tar.gz`;
    } else if (plat === 'linux') {
      const archStr = arch === 'arm64' ? 'aarch64' : 'x86_64';
      return `fd-v${version}-${archStr}-unknown-linux-gnu.tar.gz`;
    } else if (plat === 'win32') {
      const archStr = arch === 'arm64' ? 'aarch64' : 'x86_64';
      return `fd-v${version}-${archStr}-pc-windows-msvc.zip`;
    }
    return null;
  }
};

/**
 * Execute a command and return stdout, stderr, exitCode
 */
function execCommand(cmd: string, args: string[]): Promise<CmdResult> {
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
 * Download file from URL
 */
async function downloadFile(url: string, dest: string): Promise<void> {
  const { exec } = await import('child_process');
  const { finished } = await import('stream/promises');
  const { Readable } = await import('stream');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
  if (!response.body) throw new Error('No response body');

  const fileStream = (fs as any).createWriteStream(dest);
  await finished(Readable.fromWeb(response.body).pipe(fileStream));
}

/**
 * Get tool path from local or system PATH
 */
async function getToolPath(config: RgConfig | FdConfig): Promise<string | null> {
  const binaryName = os.platform() === 'win32' ? `${config.binaryName}.exe` : config.binaryName;
  const localPath = path.join(TOOLS_DIR, binaryName);

  // Check local installation
  if (existsSync(localPath)) {
    return localPath;
  }

  // Check system PATH
  try {
    const checkCmd = os.platform() === 'win32' ? 'where' : 'which';
    const result = await execCommand(checkCmd, [config.binaryName]);
    const { stdout } = result;
    if (stdout.trim()) {
      return stdout.trim().split('\n')[0];
    }
  } catch {
    // Tool not in PATH
  }

  return null;
}

/**
 * Download and install a tool
 */
async function downloadTool(config: RgConfig | FdConfig, version: string): Promise<string | null> {
  const plat = os.platform();
  const archStr = os.arch();

  const assetName = config.getAssetName(version, plat, archStr);
  if (!assetName) {
    console.log(`⚠️  ${config.name}: Unsupported platform ${plat}/${archStr}`);
    return null;
  }

  mkdirSync(TOOLS_DIR, { recursive: true });

  const binaryName = plat === 'win32' ? `${config.binaryName}.exe` : config.binaryName;
  const binaryPath = path.join(TOOLS_DIR, binaryName);
  const archivePath = path.join(TOOLS_DIR, assetName);
  const extractDir = path.join(TOOLS_DIR, 'extract_tmp');

  // Skip if already installed
  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  try {
    console.log(`⬇️  Downloading ${config.name}...`);

    const url = `https://github.com/${config.repo}/releases/download/${config.tagPrefix}${version}/${assetName}`;
    await downloadFile(url, archivePath);
    console.log(`✓ Downloaded ${config.name}`);

    // Create extract directory
    mkdirSync(extractDir, { recursive: true });

    if (assetName.endsWith('.zip')) {
      // Handle zip with JSZip
      const JSZip = (await import('jszip')).default;
      const zipData = readFileSync(archivePath);
      const zip = await JSZip.loadAsync(zipData);

      const fileName = Object.keys(zip.files).find(n =>
        n.toLowerCase().endsWith(config.binaryName) ||
        n.toLowerCase().endsWith(`${config.binaryName}.exe`)
      );

      if (fileName) {
        const fileEntry = zip.file(fileName);
        if (fileEntry) {
          const content = await fileEntry.async('nodebuffer');
          const fileStream = createWriteStream(binaryPath);
          fileStream.write(content);
          fileStream.end();
          chmodSync(binaryPath, 0o755);
        } else {
          throw new Error(`${config.binaryName} not found in archive`);
        }
      } else {
        throw new Error(`${config.binaryName} not found in archive`);
      }
    } else {
      // Handle tar.gz
      const { spawnSync } = await import('child_process');
      spawnSync('tar', ['xzf', archivePath, '-C', extractDir], { stdio: 'pipe' });

      const dirName = assetName.replace(/\.(tar\.gz|zip)$/, '');
      const extracted = path.join(extractDir, dirName, config.binaryName);

      if (existsSync(extracted)) {
        const { renameSync } = await import('fs');
        renameSync(extracted, binaryPath);
        chmodSync(binaryPath, 0o755);
      } else {
        throw new Error(`${config.binaryName} not found in archive`);
      }
    }

    console.log(`✓ Installed ${config.name} to ${binaryPath}`);
    return binaryPath;
  } catch (error) {
    console.log(`⚠️  Failed to install ${config.name}: ${error}`);
    return null;
  } finally {
    // Cleanup
    try {
      if (existsSync(archivePath)) unlinkSync(archivePath);
      if (existsSync(extractDir)) rmSync(extractDir, { recursive: true });
    } catch {}
  }
}

// ============== Public API ==============

/**
 * Get ripgrep executable path, download if needed
 */
export async function getRipgrepPath(): Promise<string | null> {
  const rgPath = getToolPath(RG_CONFIG);
  if (rgPath) return rgPath;

  return downloadTool(RG_CONFIG, RG_VERSION);
}

/**
 * Get fd executable path, download if needed
 */
export async function getFdPath(): Promise<string | null> {
  const fdPath = getToolPath(FD_CONFIG);
  if (fdPath) return fdPath;

  return downloadTool(FD_CONFIG, FD_VERSION);
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

/**
 * Find files using fd
 */
export async function fdFind(params: {
  pattern: string;
  path?: string;
  limit?: number;
}): Promise<string> {
  const fdPath = await getFdPath();

  if (!fdPath) {
    throw new Error('fd not found. Please install fd or add it to PATH');
  }

  const searchPath = params.path || '.';
  const limit = params.limit || 1000;

  // Find all .gitignore files to pass to fd
  const gitignoreFiles: string[] = [];
  const rootGitignore = path.join(searchPath, '.gitignore');
  if (existsSync(rootGitignore)) {
    gitignoreFiles.push(rootGitignore);
  }

  try {
    const nestedGitignores = globSync('**/.gitignore', {
      cwd: searchPath,
      dot: true,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
    gitignoreFiles.push(...nestedGitignores);
  } catch {
    // Ignore glob errors
  }

  const args: string[] = [
    '--glob',
    '--color=never',
    '--hidden',
    '--max-results', String(limit),
  ];

  // Add .gitignore files
  for (const gitignorePath of gitignoreFiles) {
    args.push('--ignore-file', gitignorePath);
  }

  args.push(params.pattern, searchPath);

  const { stdout, stderr, exitCode } = await execCommand(fdPath, args);

  if (exitCode !== 0 && exitCode !== 1) {
    const errorMsg = stderr.trim() || `fd exited with code ${exitCode}`;
    throw new Error(errorMsg);
  }

  return stdout || 'No files found';
}