/**
 * Build-time initialization script for skills path
 * Run this script during build to auto-detect and save skills path to config
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const skillsPath = path.join(projectRoot, 'skills', 'skills');

// Check if skills folder exists
if (!fs.existsSync(skillsPath)) {
  console.warn(`⚠️  Skills folder not found at: ${skillsPath}`);
  console.warn('   Skipping skills path initialization...');
  process.exit(0);
}

// Determine config file path (~/.xagent/settings.json)
const configDir = path.join(process.env.HOME || process.env.USERPROFILE, '.xagent');
const configFile = path.join(configDir, 'settings.json');

// Ensure config directory exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Read existing config or create new one
let config = {};
if (fs.existsSync(configFile)) {
  try {
    const content = fs.readFileSync(configFile, 'utf-8');
    config = JSON.parse(content);
  } catch (e) {
    console.warn('⚠️  Failed to read existing config, creating new one...');
  }
}

// Update skillsPath
config.skillsPath = skillsPath;

// Determine and update workspacePath (default: ~/.xagent/workspace)
const workspacePath = path.join(process.env.HOME || process.env.USERPROFILE, '.xagent', 'workspace');
config.workspacePath = workspacePath;

// Ensure workspace directory exists
if (!fs.existsSync(workspacePath)) {
  fs.mkdirSync(workspacePath, { recursive: true });
  console.log(`✅ Workspace directory created: ${workspacePath}`);
}

// Write back to config file
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

console.log(`✅ Skills path initialized: ${skillsPath}`);
console.log(`✅ Workspace path initialized: ${workspacePath}`);
console.log(`   Config saved to: ${configFile}`);
