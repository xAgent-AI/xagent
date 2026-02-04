/**
 * Tool Call Utilities
 * Shared utilities for handling tool_call operations across the codebase
 */

/**
 * Tool call item interface
 */
export interface ToolCallItem {
  id?: string;
  type?: string;
  function?: {
    name: string;
    arguments: string | any;
  };
}

/**
 * Result of fixing duplicate tool_call.id
 */
export interface FixDuplicateResult {
  fixed: ToolCallItem[];
  mapping: Map<string, string>;
}

/**
 * Fix duplicate tool_call.id in assistant.tool_calls
 * MiniMax requires all tool_call.id to be unique in one message
 * 
 * @param toolCalls - Array of tool call items
 * @returns Object containing fixed tool calls and id mapping
 */
export function fixDuplicateToolCallIds(toolCalls: ToolCallItem[]): FixDuplicateResult {
  // Filter out tool calls without id (they can't cause duplicates)
  const validCalls = toolCalls.filter((tc) => tc.id !== undefined);
  const invalidCount = toolCalls.length - validCalls.length;

  // Count occurrences of each id
  const idCountMap = new Map<string, number>();
  for (const tc of validCalls) {
    idCountMap.set(tc.id!, (idCountMap.get(tc.id!) || 0) + 1);
  }

  // Check if any duplicates exist
  const hasDuplicates = Array.from(idCountMap.values()).some((count) => count > 1);
  if (!hasDuplicates) {
    // No duplicates, return original with empty mapping
    return { fixed: toolCalls, mapping: new Map() };
  }

  console.log(`[FIX-DUP-ID] Found duplicate tool_call.id, fixing...`);
  idCountMap.forEach((count, id) => {
    if (count > 1) {
      console.log(`[FIX-DUP-ID]   id="${id}" appears ${count} times`);
    }
  });

  // Create id mapping: originalId -> fixedId
  const mapping = new Map<string, string>();
  const idOccurrence = new Map<string, number>();

  for (const tc of validCalls) {
    const currentCount = (idOccurrence.get(tc.id!) || 0) + 1;
    idOccurrence.set(tc.id!, currentCount);
    const totalCount = idCountMap.get(tc.id!) || 1;

    if (totalCount > 1) {
      // Duplicate id: first keeps original, others get suffix _0, _1, ...
      if (currentCount === 1) {
        mapping.set(tc.id!, tc.id!);
      } else {
        const fixedId = `${tc.id!}_${currentCount - 1}`;
        mapping.set(tc.id!, fixedId);
      }
    }
  }

  // Apply mapping to create fixed toolCalls
  const fixed = toolCalls.map((tc) => {
    if (!tc.id) return tc;
    const fixedId = mapping.get(tc.id);
    if (fixedId !== undefined && fixedId !== tc.id) {
      console.log(`[FIX-DUP-ID]   "${tc.id}" -> "${fixedId}"`);
      return { ...tc, id: fixedId };
    }
    return tc;
  });

  console.log(`[FIX-DUP-ID] Done, mapping size: ${mapping.size}`);
  return { fixed, mapping };
}

/**
 * Get fixed tool_call_id using the mapping from original to fixed
 * 
 * @param originalId - The original tool_call.id
 * @param mapping - The mapping from original to fixed ids
 * @returns The fixed id if exists, otherwise the original id
 */
export function getFixedToolCallId(originalId: string, mapping: Map<string, string>): string {
  const fixedId = mapping.get(originalId);
  if (fixedId) {
    return fixedId;
  }
  return originalId;
}
