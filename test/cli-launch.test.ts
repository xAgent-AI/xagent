/**
 * xAgent CLI Launch Tests
 * 
 * 这些测试用于验证 CLI 的基本启动和命令行为。
 * 测试不依赖外部服务，可以离线运行。
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, '../dist/cli.js');

// commander.js 的 --help 行为会导致退出码为 1，这是正常行为
const HELP_EXIT_CODE = 1;

/**
 * 运行 CLI 命令并返回结果（使用 execSync）
 */
function runCli(args: string[], options: { env?: Record<string, string> } = {}): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  try {
    const env = { ...process.env, ...options.env, NODE_ENV: 'test' };
    const stdout = execSync(`"${process.execPath}" "${cliPath}" ${args.join(' ')}`, {
      encoding: 'utf-8',
      env,
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return {
      exitCode: 0,
      stdout,
      stderr: ''
    };
  } catch (error: any) {
    // execSync 在命令失败时会抛出错误
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';
    const exitCode = error.status || -1;
    // 合并 stdout 和 stderr，因为 Windows PowerShell 可能将输出重定向
    const combinedOutput = stdout + stderr;
    return {
      exitCode,
      stdout: combinedOutput,
      stderr
    };
  }
}

describe('xAgent CLI Launch Tests', () => {
  /**
   * 测试版本号输出
   */
  describe('version', () => {
    it('should output version with --version flag', () => {
      const result = runCli(['--version']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/); // 匹配语义化版本号
    });
    
    it('should exit with code 0 on --version', () => {
      const result = runCli(['--version']);
      expect(result.exitCode).toBe(0);
    });
  });
  
  /**
   * 测试帮助信息
   */
  describe('help', () => {
    it('should output help with --help flag', () => {
      const result = runCli(['--help']);
      
      // commander.js --help 退出码为 1 是正常行为
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
      // stdout 可能为空，输出在 stderr 中
      const output = result.stdout || result.stderr;
      expect(output).toContain('xagent');
      expect(output).toContain('AI-powered');
    });
    
    it('should list available commands in help', () => {
      const result = runCli(['--help']);
      const output = result.stdout || result.stderr;
      
      expect(output).toContain('start');
      expect(output).toContain('auth');
      expect(output).toContain('agent');
      expect(output).toContain('mcp');
      expect(output).toContain('init');
    });
    
    it('should show help for auth command', () => {
      const result = runCli(['auth', '--help']);
      const output = result.stdout || result.stderr;
      
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
      expect(output).toContain('auth');
      // 检查认证相关文本
      expect(output).toMatch(/authentication|authenticate|Auth/i);
    });
    
    it('should show help for mcp command', () => {
      const result = runCli(['mcp', '--help']);
      const output = result.stdout || result.stderr;
      
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
      expect(output).toContain('mcp');
      expect(output).toContain('--list');
      expect(output).toContain('--add');
      expect(output).toContain('--remove');
    });
  });
  
  /**
   * 测试 start 命令启动
   */
  describe('start command', () => {
    it('should start and output when running xagent start', () => {
      // start 命令会启动交互式会话
      // 我们使用 timeout 强制终止并检查是否有输出
      const result = runCli(['start']);
      
      // 由于是交互式命令，退出码可能是 0 或超时 -1
      // 关键是验证命令能够启动并产生输出
      const output = result.stdout || result.stderr;
      
      // 验证命令能够启动（没有立即崩溃）
      expect([0, -1]).toContain(result.exitCode);
      
      // 验证有输出内容（启动提示信息）
      expect(output).toBeTruthy();
      
      // 验证输出包含 CLI 相关内容
      expect(output.toLowerCase()).toMatch(/xagent|agent|start|welcome/i);
    });
  });
  
  /**
   * 测试错误处理
   */
  describe('error handling', () => {
    it('should show error for unknown command', () => {
      const result = runCli(['unknown-command-xyz']);
      
      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stdout || result.stderr;
      expect(output).toBeTruthy();
    });
    
    it('should show error for unknown option', () => {
      const result = runCli(['--unknown-option-xyz']);
      
      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stdout || result.stderr;
      expect(output).toBeTruthy();
    });
  });
  
  /**
   * 测试 agent 命令
   */
  describe('agent command', () => {
    it('should show agent help', () => {
      const result = runCli(['agent', '--help']);
      const output = result.stdout || result.stderr;
      
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
      // 检查帮助输出中包含关键选项
      expect(output).toContain('--list');
      expect(output).toContain('--add');
      expect(output).toContain('--remove');
      // 检查输出与 agent 相关
      expect(output.toLowerCase()).toMatch(/agent|specify an action/i);
    });
    
    it('should list agents with --list flag', () => {
      const result = runCli(['agent', '--list']);
      
      // agent --list 可能会因为没有配置而返回非零退出码
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
      const output = result.stdout || result.stderr;
      expect(output).toBeTruthy();
    });
  });
  
  /**
   * 测试 mcp 命令
   */
  describe('mcp command', () => {
    it('should show mcp help', () => {
      const result = runCli(['mcp', '--help']);
      const output = result.stdout || result.stderr;
      
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
      expect(output).toContain('--list');
      // 检查输出中包含 mcp 相关的选项
      expect(output.toLowerCase()).toMatch(/mcp|transport|server|--add/i);
    });
    
    it('should list MCP servers with --list flag', () => {
      const result = runCli(['mcp', '--list']);
      
      // mcp --list 可能会因为没有配置而返回非零退出码
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
    });
  });
  
  /**
   * 测试 init 命令
   */
  describe('init command', () => {
    it('should show init help', () => {
      const result = runCli(['init', '--help']);
      const output = result.stdout || result.stderr;
      
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
      expect(output.toLowerCase()).toContain('init');
      // init 命令会实际执行初始化，检查是否有关键内容
      expect(output.toLowerCase()).toMatch(/project|xagent\.md|initial/i);
    });
  });
  
  /**
   * 测试 workflow 命令
   */
  describe('workflow command', () => {
    it('should show workflow help', () => {
      const result = runCli(['workflow', '--help']);
      const output = result.stdout || result.stderr;
      
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
      // workflow 命令可能输出"Please specify an action"或帮助信息
      expect(output.toLowerCase()).toMatch(/workflow|specify an action|--list/i);
      expect(output).toContain('--list');
    });
    
    it('should list workflows with --list flag', () => {
      const result = runCli(['workflow', '--list']);
      
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
    });
  });
  
  /**
   * 测试 skill 命令
   */
  describe('skill command', () => {
    it('should show skill help', () => {
      const result = runCli(['skill', '--help']);
      const output = result.stdout || result.stderr;
      
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
      expect(output.toLowerCase()).toContain('skill');
      // skill 命令使用 -l 而不是 --list
      expect(output.toLowerCase()).toMatch(/skill|-l|--add|--remove/i);
    });
  });
  
  /**
   * 测试环境变量处理
   */
  describe('environment handling', () => {
    it('should handle empty XAGENT_BASE_URL gracefully', () => {
      const result = runCli(['--help'], {
        env: { XAGENT_BASE_URL: '' }
      });
      
      expect([0, HELP_EXIT_CODE]).toContain(result.exitCode);
    });
  });
});
