/**
 * Unified Output Utility
 * 
 * Provides a centralized output function that automatically chooses between
 * SDK adapter (JSON output) and console output based on the current mode.
 */

export type OutputType = 'info' | 'error' | 'success' | 'warning';

let _sdkAdapter: any = null;
let _isSdkMode: boolean = false;

/**
 * Initialize SDK mode (call this when session is available)
 */
export function initOutputMode(isSdkMode: boolean, adapter?: any): void {
  _isSdkMode = isSdkMode;
  _sdkAdapter = adapter;
}

/**
 * Get current SDK mode status
 */
export function isSdkMode(): boolean {
  return _isSdkMode;
}

/**
 * Get current SDK adapter
 */
export function getSdkAdapter(): any {
  return _sdkAdapter;
}

/**
 * Unified output function that automatically chooses SDK or console
 * @param type - Output type (info, error, success, warning)
 * @param message - Message to output
 * @param context - Optional context data (for error type)
 */
export async function output(type: OutputType, message: string, context?: Record<string, any>): Promise<void> {
  // Try to use SDK adapter if available and in SDK mode
  if (_isSdkMode && _sdkAdapter) {
    try {
      switch (type) {
        case 'info':
          _sdkAdapter.outputInfo(message);
          break;
        case 'error':
          _sdkAdapter.outputError(message, context);
          break;
        case 'warning':
          _sdkAdapter.outputWarning(message);
          break;
        case 'success':
          _sdkAdapter.outputSuccess(message);
          break;
      }
      return; // SDK output successful, don't use console
    } catch {
      // Fall through to console on error
    }
  }

  // Console output
  switch (type) {
    case 'info':
      console.log(message);
      break;
    case 'error':
      console.error(message, context?.error || '');
      break;
    case 'warning':
      console.warn(message);
      break;
    case 'success':
      console.log(message);
      break;
  }
}