#!/usr/bin/env node

/**
 * SDK Session (InteractiveSession-based)
 * 
 * This module implements SDK mode using the same execution logic as normal mode,
 * but with stdin/stdout JSON communication for programmatic access.
 */

import { InteractiveSession } from './session.js';
import { SdkOutputAdapter } from './sdk-output-adapter.js';
import { getConfigManager } from './config.js';
import { ExecutionMode } from './types.js';

/**
 * Start SDK session using InteractiveSession with SDK output adapter
 * This ensures the same execution logic as normal mode
 */
export async function startSdkSession(): Promise<void> {
  // Create output adapter that writes to stdout
  const outputAdapter = new SdkOutputAdapter();
  
  // Create interactive session
  const session = new InteractiveSession();
  
  // Enable SDK mode with the output adapter
  session.setSdkMode(outputAdapter);
  
  // Set execution mode to SMART for SDK
  session.setExecutionMode(ExecutionMode.SMART);
  
  // Flag to control shutdown
  (session as any)._isShuttingDown = false;

  // Set up stdin handler for SDK mode
  process.stdin.setEncoding('utf8');
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    if ((session as any)._isShuttingDown) {
      return;
    }
    (session as any)._isShuttingDown = true;
    process.removeAllListeners('SIGINT');
    
    outputAdapter.outputSystem('shutdown', { reason: 'user_interrupt' });
    
    process.exit(0);
  });

  try {
    await session.start();
  } catch (error: any) {
    outputAdapter.outputError(`Session error: ${error.message}`);
    process.exit(1);
  }
}
