/**
 * Postinstall script: Download and install ripgrep binary
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
const VERSION = '14.0.0';

async function downloadAndInstall() {
  const plat = platform();
  const archStr = arch();
  
  // Determine asset name
  let assetName;
  if (plat === 'win32') {
    assetName = archStr === 'arm64' 
      ? `ripgrep-${VERSION}-aarch64-pc-windows-msvc.zip`
      : `ripgrep-${VERSION}-x86_64-pc-windows-msvc.zip`;
  } else if (plat === 'darwin') {
    assetName = `ripgrep-${VERSION}-aarch64-apple-darwin.tar.gz`;
  } else {
    assetName = archStr === 'arm64'
      ? `ripgrep-${VERSION}-aarch64-unknown-linux-musl.tar.gz`
      : `ripgrep-${VERSION}-x86_64-unknown-linux-musl.tar.gz`;
  }

  const binaryName = plat === 'win32' ? 'rg.exe' : 'rg';
  const binaryPath = join(TOOLS_DIR, binaryName);
  const archivePath = join(TOOLS_DIR, assetName);
  const extractDir = join(TOOLS_DIR, 'extract');

  // Check if already installed
  if (existsSync(binaryPath)) {
    console.log('✓ ripgrep already installed');
    return;
  }

  // Create directory
  mkdirSync(TOOLS_DIR, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  try {
    console.log('⬇️  Downloading ripgrep...');
    
    const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${assetName}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    
    if (!response.body) {
      throw new Error('No response body');
    }
    
    // Download to file
    const fileStream = createWriteStream(archivePath);
    await finished(Readable.fromWeb(response.body).pipe(fileStream));
    console.log('✓ Downloaded');

    // Extract
    console.log('📦 Extracting...');
    
    if (plat === 'win32') {
      // Handle zip with JSZip
      const zipData = readFileSync(archivePath);
      const zip = await JSZip.loadAsync(zipData);
      
      // Find rg.exe in zip
      const rgFileName = Object.keys(zip.files).find(name => 
        name.toLowerCase().endsWith('rg.exe')
      );
      
      if (rgFileName) {
        const content = await zip.file(rgFileName).async('nodebuffer');
        const outStream = createWriteStream(binaryPath);
        outStream.write(content);
        outStream.end();
        chmodSync(binaryPath, 0o755);
        console.log(`✓ Installed to ${binaryPath}`);
      } else {
        throw new Error('rg.exe not found in archive');
      }
    } else {
      // Use tar on Unix
      const { spawnSync } = await import('child_process');
      spawnSync('tar', ['xzf', archivePath, '-C', extractDir], { stdio: 'inherit' });
      
      // Find and move
      const dirName = assetName.replace('.tar.gz', '');
      const extracted = join(extractDir, dirName, 'rg');
      
      if (existsSync(extracted)) {
        const { renameSync } = await import('fs');
        renameSync(extracted, binaryPath);
        chmodSync(binaryPath, 0o755);
        console.log(`✓ Installed to ${binaryPath}`);
      } else {
        throw new Error(`Binary not found: ${extracted}`);
      }
    }
  } catch (error) {
    console.log(`⚠️  Failed to install ripgrep: ${error.message}`);
    console.log('  Please install manually: https://github.com/BurntSushi/ripgrep');
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

downloadAndInstall().catch(console.error);
