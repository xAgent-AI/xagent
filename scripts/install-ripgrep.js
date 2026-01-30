/**
 * Postinstall script: Download and install ripgrep and fd
 * Run automatically after npm install
 */
import { createWriteStream, existsSync, mkdirSync, chmodSync, readFileSync, unlinkSync, rmSync } from 'fs';
import { arch, platform, homedir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import JSZip from 'jszip';

const HOME_DIR = homedir();
const TOOLS_DIR = join(HOME_DIR, '.xagent', 'bin');
const RG_VERSION = '14.0.0';
const FD_VERSION = '10.3.0';

const TOOLS = [
  {
    name: 'ripgrep',
    repo: 'BurntSushi/ripgrep',
    binaryName: 'rg',
    tagPrefix: '',
    version: RG_VERSION,
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
  },
  {
    name: 'fd',
    repo: 'sharkdp/fd',
    binaryName: 'fd',
    tagPrefix: 'v',
    version: FD_VERSION,
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
  }
];

async function downloadFile(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
  if (!response.body) throw new Error('No response body');

  const fileStream = createWriteStream(dest);
  await finished(Readable.fromWeb(response.body).pipe(fileStream));
}

async function installTool(config) {
  const plat = platform();
  const archStr = arch();

  // Special handling for fd on Windows: use winget
  if (config.name === 'fd' && plat === 'win32') {
    return installFdViaWinget();
  }

  const assetName = config.getAssetName(config.version, plat, archStr);
  if (!assetName) {
    console.log(`⚠️  ${config.name}: Unsupported platform ${plat}/${archStr}`);
    return false;
  }

  const binaryName = plat === 'win32' ? `${config.binaryName}.exe` : config.binaryName;
  const binaryPath = join(TOOLS_DIR, binaryName);
  const archivePath = join(TOOLS_DIR, assetName);
  const extractDir = join(TOOLS_DIR, 'extract_tmp');

  // Check if already installed
  if (existsSync(binaryPath)) {
    console.log(`✓ ${config.name} already installed`);
    return true;
  }

  // Create directory
  mkdirSync(TOOLS_DIR, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  try {
    console.log(`⬇️  Downloading ${config.name}...`);

    const url = `https://github.com/${config.repo}/releases/download/${config.tagPrefix}${config.version}/${assetName}`;
    await downloadFile(url, archivePath);
    console.log(`✓ Downloaded ${config.name}`);

    console.log('📦 Extracting...');

    if (assetName.endsWith('.zip')) {
      // Handle zip with JSZip
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
          // Wait for file stream to finish
          await new Promise((resolve, reject) => {
            const fileStream = createWriteStream(binaryPath);
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
            fileStream.end(content);
          });
          chmodSync(binaryPath, 0o755);
          console.log(`✓ Installed ${config.name} to ${binaryPath}`);
        } else {
          throw new Error(`${config.binaryName} not found in archive`);
        }
      } else {
        throw new Error(`${config.binaryName} not found in archive`);
      }
    } else {
      // Use tar on Unix
      const { spawnSync } = await import('child_process');
      spawnSync('tar', ['xzf', archivePath, '-C', extractDir], { stdio: 'pipe' });

      const dirName = assetName.replace(/\.(tar\.gz|zip)$/, '');
      const extracted = join(extractDir, dirName, config.binaryName);

      if (existsSync(extracted)) {
        const { renameSync } = await import('fs');
        renameSync(extracted, binaryPath);
        chmodSync(binaryPath, 0o755);
        console.log(`✓ Installed ${config.name} to ${binaryPath}`);
      } else {
        throw new Error(`${config.binaryName} not found in archive`);
      }
    }

    return true;
  } catch (error) {
    console.log(`⚠️  Failed to install ${config.name}: ${error}`);
    return false;
  } finally {
    // Cleanup
    try {
      if (existsSync(archivePath)) {
        unlinkSync(archivePath);
      }
      if (existsSync(extractDir)) {
        rmSync(extractDir, { recursive: true });
      }
    } catch {}
  }
}

async function installFdViaWinget() {
  const { spawnSync } = await import('child_process');
  
  // Check if fd is already installed via winget
  const fdPath = join(TOOLS_DIR, 'fd.exe');
  if (existsSync(fdPath)) {
    console.log(`✓ fd already installed`);
    return true;
  }

  try {
    console.log(`⬇️  Installing fd via winget...`);
    
    // Install fd using winget
    const result = spawnSync('winget', ['install', '-e', '--id', 'sharkdp.fd'], {
      stdio: 'pipe',
      encoding: 'utf-8'
    });

    if (result.status !== 0) {
      console.log(`⚠️  winget install failed, trying alternative...`);
      // Try without -e flag
      const result2 = spawnSync('winget', ['install', 'sharkdp.fd'], {
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      if (result2.status !== 0) {
        throw new Error('winget install failed');
      }
    }

    // Copy fd.exe from WinGet package to our tools directory
    const wingetFdPath = join(
      process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
      'Microsoft/WinGet/Packages/sharkdp.fd_Microsoft.Winget.Source_8wekyb3d8bbwe',
      `fd-v10.3.0-x86_64-pc-windows-msvc`,
      'fd.exe'
    );

    if (existsSync(wingetFdPath)) {
      mkdirSync(TOOLS_DIR, { recursive: true });
      const { copyFileSync } = await import('fs');
      copyFileSync(wingetFdPath, fdPath);
      console.log(`✓ Installed fd to ${fdPath}`);
      return true;
    } else {
      throw new Error('fd.exe not found in winget package');
    }
  } catch (error) {
    console.log(`⚠️  Failed to install fd: ${error}`);
    return false;
  }
}

async function installAllTools() {
  console.log('🔧 Installing tools...\n');

  for (const config of TOOLS) {
    const success = await installTool(config);
    if (!success) {
      console.log(`  Please install ${config.name} manually or add it to PATH`);
    }
    console.log('');
  }

  console.log('✨ Installation complete!');
}

installAllTools().catch(console.error);