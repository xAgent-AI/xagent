import axios from 'axios';
import { confirm } from '@clack/prompts';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  downloadUrl?: string;
}

export class UpdateManager {
  private packageVersion: string;
  private registryUrl: string;
  private checkInterval: number;

  constructor() {
    this.packageVersion = packageJson.version;
    this.registryUrl = 'https://registry.npmjs.org/@xagent-ai/xagent-cli';
    this.checkInterval = 24 * 60 * 60 * 1000;
  }

  async checkForUpdates(): Promise<VersionInfo> {
    try {
      const response = await axios.get(this.registryUrl, {
        timeout: 10000,
      });

      const latestVersion = response.data['dist-tags'].latest;
      const updateAvailable = this.compareVersions(this.packageVersion, latestVersion) < 0;

      const versionInfo: VersionInfo = {
        currentVersion: this.packageVersion,
        latestVersion,
        updateAvailable,
        releaseNotes: response.data.versions[latestVersion]?.description,
        downloadUrl: `https://www.npmjs.com/package/@xagent-ai/xagent-cli/v/${latestVersion}`,
      };

      return versionInfo;
    } catch (error) {
      console.error('Failed to check for updates:', error);

      return {
        currentVersion: this.packageVersion,
        latestVersion: this.packageVersion,
        updateAvailable: false,
      };
    }
  }

  private compareVersions(v1: string, v2: string): number {
    const normalize = (v: string) => {
      const parts = v.replace(/^v/, '').split('-')[0].split('.');
      return parts.map((p) => parseInt(p, 10) || 0);
    };

    const v1Parts = normalize(v1);
    const v2Parts = normalize(v2);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;

      if (v1Part < v2Part) {
        return -1;
      } else if (v1Part > v2Part) {
        return 1;
      }
    }

    return 0;
  }

  async autoUpdate(): Promise<boolean> {
    const versionInfo = await this.checkForUpdates();

    if (!versionInfo.updateAvailable) {
      console.log('✅ You are using the latest version');
      return false;
    }

    console.log(
      `📦 Update available: ${versionInfo.currentVersion} → ${versionInfo.latestVersion}`
    );

    if (versionInfo.releaseNotes) {
      console.log('\nRelease Notes:');
      console.log(versionInfo.releaseNotes);
    }

    console.log(`\nDownload: ${versionInfo.downloadUrl}`);

    const { shouldUpdate } = await this.promptUpdate(versionInfo);

    if (shouldUpdate) {
      return await this.performUpdate();
    }

    return false;
  }

  private async promptUpdate(versionInfo: VersionInfo): Promise<{ shouldUpdate: boolean }> {
    const shouldUpdate = await confirm({
      message: 'Do you want to update now?',
    });

    return { shouldUpdate: shouldUpdate === true };
  }

  private async performUpdate(): Promise<boolean> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');

    const execAsync = promisify(exec);

    try {
      console.log('Updating xAgent CLI...');

      await execAsync('npm install -g @xagent-ai/xagent-cli@latest', {
        timeout: 120000,
      });

      console.log('✅ Update successful! Please restart xAgent CLI.');
      return true;
    } catch (error: any) {
      console.error('❌ Update failed:', error.message);

      const tryManual = await confirm({
        message: 'Would you like to try manual update?',
      });

      if (tryManual === true) {
        console.log('\nManual update instructions:');
        console.log('1. Run: npm uninstall -g @xagent-ai/xagent-cli');
        console.log('2. Run: npm install -g @xagent-ai/xagent-cli@latest');
        console.log('3. Restart: xagent\n');
      }

      return false;
    }
  }

  async checkAndNotify(): Promise<void> {
    const versionInfo = await this.checkForUpdates();

    if (versionInfo.updateAvailable) {
      console.log(`\n📦 A new version is available: ${versionInfo.latestVersion}`);
      console.log(`Current version: ${versionInfo.currentVersion}`);
      console.log(`Update with: npm install -g @xagent-ai/xagent-cli@latest\n`);
    }
  }

  getCurrentVersion(): string {
    return this.packageVersion;
  }

  async getReleaseNotes(version?: string): Promise<string> {
    const targetVersion = version || this.packageVersion;

    try {
      const response = await axios.get(this.registryUrl, {
        timeout: 10000,
      });

      const versionData = response.data.versions[targetVersion];

      if (versionData && versionData.description) {
        return versionData.description;
      }

      return 'No release notes available.';
    } catch (error) {
      console.error('Failed to fetch release notes:', error);
      return 'Failed to fetch release notes.';
    }
  }

  async checkUpdateOnStartup(): Promise<void> {
    const lastCheck = await this.getLastCheckTime();
    const now = Date.now();

    if (now - lastCheck < this.checkInterval) {
      return;
    }

    await this.checkAndNotify();
    await this.saveLastCheckTime(now);
  }

  private async getLastCheckTime(): Promise<number> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const filePath = path.join(os.homedir(), '.xagent', 'last-update-check');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return parseInt(content, 10) || 0;
    } catch {
      return 0;
    }
  }

  private async saveLastCheckTime(timestamp: number): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const dirPath = path.join(os.homedir(), '.xagent');
    const filePath = path.join(dirPath, 'last-update-check');

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, timestamp.toString(), 'utf-8');
  }

  async forceCheckUpdate(): Promise<VersionInfo> {
    return await this.checkForUpdates();
  }

  async enableAutoUpdate(enabled: boolean): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const { getConfigManager } = await import('./config.js');

    const configManager = getConfigManager();
    configManager.set('autoUpdate', enabled);
    configManager.save('global');

    console.log(`✅ Auto-update ${enabled ? 'enabled' : 'disabled'}`);
  }

  async isAutoUpdateEnabled(): Promise<boolean> {
    const { getConfigManager } = await import('./config.js');
    const configManager = getConfigManager();
    return configManager.get('autoUpdate');
  }
}

let updateManagerInstance: UpdateManager | null = null;

export function getUpdateManager(): UpdateManager {
  if (!updateManagerInstance) {
    updateManagerInstance = new UpdateManager();
  }
  return updateManagerInstance;
}

export async function checkUpdatesOnStartup(): Promise<void> {
  const updateManager = getUpdateManager();

  if (await updateManager.isAutoUpdateEnabled()) {
    await updateManager.checkUpdateOnStartup();
  }
}
