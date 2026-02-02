import { existsSync } from 'fs';
import { spawn, spawnSync } from 'child_process';

/**
 * Find bash executable on PATH (Windows).
 */
function findBashOnPath(): string | null {
	try {
		const result = spawnSync('where', ['bash.exe'], { encoding: 'utf-8', timeout: 5000 });
		if (result.status === 0 && result.stdout) {
			const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
			if (firstMatch && existsSync(firstMatch)) {
				return firstMatch;
			}
		}
	} catch {
		// Ignore errors
	}
	return null;
}

interface ShellConfig {
	/** Path to the shell executable */
	shell: string;
	/** Arguments to pass to the shell */
	args: string[];
}

let cachedShellConfig: ShellConfig | null = null;

/**
 * Get shell configuration based on platform.
 * Resolution order:
 * 1. On Windows: PowerShell (preferred), then Git Bash as fallback
 * 2. On Unix: /bin/bash
 *
 * @returns ShellConfig with shell path and args
 */
export function getShellConfig(): ShellConfig {
	if (cachedShellConfig) {
		return cachedShellConfig;
	}

	if (process.platform === 'win32') {
		// On Windows, prefer PowerShell for better compatibility and output handling
		// Use -NoProfile to avoid profile script interference
		// -Encoding UTF8 ensures proper output encoding
		// -Command executes the command string as PowerShell script
		cachedShellConfig = {
			shell: 'powershell',
			args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command']
		};
		return cachedShellConfig;
	}

	// Unix: prefer bash over sh
	if (existsSync('/bin/bash')) {
		cachedShellConfig = { shell: '/bin/bash', args: ['-c'] };
	} else {
		cachedShellConfig = { shell: 'sh', args: ['-c'] };
	}
	return cachedShellConfig;
}

/**
 * Get a shell command string with proper quoting for the platform.
 * @param command The command to execute
 * @returns A properly quoted command string
 */
export function quoteShellCommand(command: string): string {
	if (process.platform === 'win32') {
		// For PowerShell -Command, the command string is passed directly
		// PowerShell will parse and execute it as a script
		// No additional quoting needed - just return the command as-is
		return command;
	} else {
		// For bash/sh, use single quotes
		return `'${command.replace(/'/g, "'\\''")}'`;
	}
}

/**
 * Kill a process and all its children (cross-platform).
 * @param pid Process ID to kill
 */
export function killProcessTree(pid: number): void {
	if (process.platform === 'win32') {
		// Use taskkill on Windows to kill process tree
		try {
			spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
				stdio: 'ignore',
				detached: true,
			});
		} catch {
			// Ignore errors if taskkill fails
		}
	} else {
		// Use SIGKILL on Unix/Linux/Mac
		try {
			process.kill(-pid, 'SIGKILL');
		} catch {
			// Fallback to killing just the child if process group kill fails
			try {
				process.kill(pid, 'SIGKILL');
			} catch {
				// Process already dead
			}
		}
	}
}
