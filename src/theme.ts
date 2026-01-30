import chalk from 'chalk';

/**
 * Detect if terminal has dark or light background
 * Returns 'dark' for dark backgrounds (default), 'light' for light backgrounds
 */
function getTerminalBackground(): 'dark' | 'light' {
  // Check common environment variables
  const colorfgbg = process.env.COLORFGBG; // e.g., "15;0" (light fg, dark bg)
  const termProgram = process.env.TERM_PROGRAM;
  const termProgramVersion = process.env.TERM_PROGRAM_VERSION;

  // Try to parse COLORFGBG (format: "fg;bg" or "fg;color;bg")
  if (colorfgbg) {
    const parts = colorfgbg.split(';');
    const bg = parts[parts.length - 1];
    // 0-6 are typically dark colors, 7-15 are light
    const bgNum = parseInt(bg, 10);
    if (!isNaN(bgNum)) {
      // Most terminal colors: 0=black, 1=red, 2=green, ... 7=white, 8-15=bright variants
      // For background: 0-6 = dark, 7 = light
      if (bgNum >= 0 && bgNum <= 6) return 'dark';
      if (bgNum >= 7) return 'light';
    }
  }

  // iTerm2 on macOS can indicate background brightness
  if (termProgram === 'Apple_Terminal' || termProgram === 'iTerm.app') {
    // Apple Terminal and iTerm2 default to dark
    return 'dark';
  }

  // Windows Terminal and VS Code Terminal typically dark
  if (termProgram?.includes('WindowsTerminal') || termProgram?.includes('Code')) {
    return 'dark';
  }

  // Default to dark background (most common for developers)
  return 'dark';
}

/**
 * Mix a color with background to create a transparent effect
 * @param hexColor - The base color in hex format
 * @param opacity - Opacity from 0 (background) to 1 (full color)
 * @param background - Terminal background color ('dark' or 'light')
 */
function mixWithBackground(hexColor: string, opacity: number, background: 'dark' | 'light' = 'dark'): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Background colors
  const bg = background === 'dark'
    ? { r: 0, g: 0, b: 0 }       // Black for dark terminals
    : { r: 255, g: 255, b: 255 }; // White for light terminals

  const mr = Math.round(bg.r + (r - bg.r) * opacity);
  const mg = Math.round(bg.g + (g - bg.g) * opacity);
  const mb = Math.round(bg.b + (b - bg.b) * opacity);

  return `#${mr.toString(16).padStart(2, '0')}${mg.toString(16).padStart(2, '0')}${mb.toString(16).padStart(2, '0')}`;
}

// Get terminal background once at module load
const TERMINAL_BG = getTerminalBackground();
export { TERMINAL_BG, getTerminalBackground, mixWithBackground };

type ColorFunction = (text: string) => string;

interface BoxOptions {
  width?: number;
  indent?: string;
  title?: string;
  titleAlign?: 'left' | 'center' | 'right';
  borderColor?: ColorFunction;
}

interface SubAgentBoxOptions {
  indentLevel?: number;
  accentColor?: ColorFunction;
}

interface BoxFunctions {
  single: (content: string, options?: BoxOptions) => string;
  double: (content: string, options?: BoxOptions) => string;
  minimal: (content: string, options?: Omit<BoxOptions, 'title' | 'titleAlign'>) => string;
  subAgent: (agentName: string, description: string, content: string, options?: SubAgentBoxOptions) => string;
}

/**
 * Modern color scheme - using coordinated HSL colors
 */
export const colors = {
  // Primary colors - modern cyan-blue series
  primary: chalk.hex('#06b6d4'), // Cyan-500
  primaryBright: chalk.hex('#22d3ee'), // Cyan-400
  primaryDark: chalk.hex('#0891b2'), // Cyan-600

  // Success colors - soft green
  success: chalk.hex('#10b981'), // Emerald-500
  successBright: chalk.hex('#34d399'), // Emerald-400

  // Warning colors - warm amber
  warning: chalk.hex('#f59e0b'), // Amber-500
  warningBright: chalk.hex('#fbbf24'), // Amber-400

  // Error colors - soft red
  error: chalk.hex('#ef4444'), // Red-500
  errorBright: chalk.hex('#f87171'), // Red-400

  // Info colors - indigo blue
  info: chalk.hex('#6366f1'), // Indigo-500
  infoBright: chalk.hex('#818cf8'), // Indigo-400

  // Debug colors - neutral gray
  debug: chalk.hex('#6b7280'), // Gray-500
  debugBright: chalk.hex('#9ca3af'), // Gray-400

  // Accent colors
  accent: chalk.hex('#8b5cf6'), // Violet-500
  highlight: chalk.hex('#ec4899'), // Pink-500

  // Neutral colors
  text: chalk.hex('#f3f4f6'), // Gray-100
  textMuted: chalk.hex('#9ca3af'), // Gray-400
  textDim: chalk.hex('#6b7280'), // Gray-500
  border: chalk.hex('#374151'), // Gray-700
  borderLight: chalk.hex('#4b5563'), // Gray-600

  // Code block colors
  codeBackground: chalk.hex('#1f2937'), // Gray-800
  codeText: chalk.hex('#e5e7eb'), // Gray-200

  // Diff colors - git-style diff highlighting with transparent backgrounds
  diffAdded: chalk.hex('#10b981'),    // Green - added lines
  diffRemoved: chalk.hex('#ef4444'),  // Red - removed lines
  diffContext: chalk.hex('#6b7280'),  // Gray - context lines
  diffAddedInverse: (text: string) => chalk.bgHex(mixWithBackground('#10b981', 0.25, TERMINAL_BG)).hex(TERMINAL_BG === 'dark' ? '#e5e7eb' : '#1f2937')(text), // Adaptive green bg
  diffRemovedInverse: (text: string) => chalk.bgHex(mixWithBackground('#ef4444', 0.25, TERMINAL_BG)).hex(TERMINAL_BG === 'dark' ? '#e5e7eb' : '#1f2937')(text), // Adaptive red bg

  // Gradient colors
  gradient: (text: string) => {
    const gradientColors = ['#06b6d4', '#8b5cf6', '#ec4899'];
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const colorIndex = Math.floor((i / text.length) * gradientColors.length);
      const color = gradientColors[Math.min(colorIndex, gradientColors.length - 1)];
      result += chalk.hex(color)(text[i]);
    }
    return result;
  }
};

/**
 * Icon system - using emoji and Unicode symbols
 */
export const icons = {
  // Status icons
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  debug: '◦',
  loading: '⟳',
  processing: '⏳',

  // Feature icons
  robot: '🤖',
  brain: '🧠',
  tool: '🔧',
  code: '💻',
  file: '📄',
  folder: '📁',
  lock: '🔐',
  unlock: '🔓',
  star: '⭐',
  sparkles: '✨',
  fire: '🔥',
  bolt: '⚡',
  rocket: '🚀',
  check: '✔',
  cross: '✖',
  arrow: '→',
  arrowRight: '→',
  arrowLeft: '←',
  arrowUp: '↑',
  arrowDown: '↓',
  dots: '⋯',
  plus: '+',
  minus: '−',
  bullet: '•',
  diamond: '◆',
  square: '■',
  circle: '●',
  triangle: '▲',

  // Separators
  separator: '─',
  separatorDouble: '═',
  separatorDashed: '┄',
  separatorDotted: '┈',
  cornerTopLeft: '┌',
  cornerTopRight: '┐',
  cornerBottomLeft: '└',
  cornerBottomRight: '┘',
  teeLeft: '├',
  teeRight: '┤',
  teeTop: '┬',
  teeBottom: '┴',
  crossChar: '┼'
};

/**
 * Style configuration
 */
export const styleHelpers = {
  // Border styles
  border: {
    single: {
      topLeft: '┌',
      topRight: '┐',
      bottomLeft: '└',
      bottomRight: '┘',
      horizontal: '─',
      vertical: '│',
      leftT: '├',
      rightT: '┤',
      topT: '┬',
      bottomT: '┴',
      cross: '┼'
    },
    double: {
      topLeft: '╔',
      topRight: '╗',
      bottomLeft: '╚',
      bottomRight: '╝',
      horizontal: '═',
      vertical: '║',
      leftT: '╠',
      rightT: '╣',
      topT: '╦',
      bottomT: '╩',
      cross: '╬'
    },
    rounded: {
      topLeft: '╭',
      topRight: '╮',
      bottomLeft: '╰',
      bottomRight: '╯',
      horizontal: '─',
      vertical: '│',
      leftT: '├',
      rightT: '┤',
      topT: '┬',
      bottomT: '┴',
      cross: '┼'
    }
  },

  // Text styles
  text: {
    bold: chalk.bold,
    dim: chalk.dim,
    italic: chalk.italic,
    underline: chalk.underline,
    strikethrough: chalk.strikethrough,
    inverse: chalk.inverse
  },

  // Animation effects
  animation: {
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    dots: ['⠁', '⠂', '⠄', '⡀', '⡈', '⡐', '⡠', '⣀', '⣁', '⣂', '⣄', '⣌', '⣔', '⣤', '⣥', '�'],
    bars: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
    arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙']
  },

  // Box rendering for sub-agents
  box: {
    single: (content: string, options: { width?: number; indent?: string; title?: string; titleAlign?: 'left' | 'center' | 'right' } = {}) => {
      const { width = 60, indent = '', title, titleAlign = 'left' } = options;
      const chars = styleHelpers.border.single;
      const availableWidth = width - 4;

      let lines: string[] = [];

      if (title) {
        const titleContent = ` ${title} `;
        const paddingNeeded = availableWidth - titleContent.length;
        let leftPad = titleAlign === 'center' ? Math.floor(paddingNeeded / 2) : (titleAlign === 'right' ? paddingNeeded : 0);
        let rightPad = titleAlign === 'center' ? Math.ceil(paddingNeeded / 2) : (titleAlign === 'right' ? 0 : paddingNeeded);

        lines.push(`${indent}${chars.topLeft}${' '.repeat(leftPad)}${titleContent}${' '.repeat(rightPad)}${chars.topRight}`);
      } else {
        lines.push(`${indent}${chars.topLeft}${chars.horizontal.repeat(availableWidth)}${chars.topRight}`);
      }

      const contentLines = content.split('\n');
      for (const line of contentLines) {
        const lineContent = line.length > availableWidth ? line.substring(0, availableWidth - 3) + '...' : line;
        const padding = availableWidth - lineContent.length;
        lines.push(`${indent}${chars.vertical} ${lineContent}${' '.repeat(padding - 1)} ${chars.vertical}`);
      }

      lines.push(`${indent}${chars.bottomLeft}${chars.horizontal.repeat(availableWidth)}${chars.bottomRight}`);

      return lines.join('\n');
    },

    double: (content: string, options: { width?: number; indent?: string; title?: string; titleAlign?: 'left' | 'center' | 'right' } = {}) => {
      const { width = 60, indent = '', title, titleAlign = 'left' } = options;
      const chars = styleHelpers.border.double;
      const availableWidth = width - 4;

      let lines: string[] = [];

      if (title) {
        const titleContent = ` ${title} `;
        const paddingNeeded = availableWidth - titleContent.length;
        let leftPad = titleAlign === 'center' ? Math.floor(paddingNeeded / 2) : (titleAlign === 'right' ? paddingNeeded : 0);
        let rightPad = titleAlign === 'center' ? Math.ceil(paddingNeeded / 2) : (titleAlign === 'right' ? 0 : paddingNeeded);

        lines.push(`${indent}${chars.topLeft}${' '.repeat(leftPad)}${titleContent}${' '.repeat(rightPad)}${chars.topRight}`);
      } else {
        lines.push(`${indent}${chars.topLeft}${chars.horizontal.repeat(availableWidth)}${chars.topRight}`);
      }

      const contentLines = content.split('\n');
      for (const line of contentLines) {
        const lineContent = line.length > availableWidth ? line.substring(0, availableWidth - 3) + '...' : line;
        const padding = availableWidth - lineContent.length;
        lines.push(`${indent}${chars.vertical} ${lineContent}${' '.repeat(padding - 1)} ${chars.vertical}`);
      }

      lines.push(`${indent}${chars.bottomLeft}${chars.horizontal.repeat(availableWidth)}${chars.bottomRight}`);

      return lines.join('\n');
    },

    minimal: (content: string, options: { width?: number; indent?: string; borderColor?: (text: string) => string } = {}) => {
      const { width = 60, indent = '', borderColor = colors.border } = options;
      const chars = styleHelpers.border.single;
      const availableWidth = width - 2;

      const lines = [
        borderColor(`${indent}${chars.topLeft}${chars.horizontal.repeat(availableWidth)}${chars.topRight}`),
        ...content.split('\n').map(line => {
          const lineContent = line.length > availableWidth ? line.substring(0, availableWidth - 3) + '...' : line;
          return `${indent}${chars.vertical} ${lineContent}${' '.repeat(availableWidth - lineContent.length - 2)}${chars.vertical}`;
        }),
        borderColor(`${indent}${chars.bottomLeft}${chars.horizontal.repeat(availableWidth)}${chars.bottomRight}`)
      ];

      return lines.join('\n');
    },

    subAgent: (agentName: string, description: string, content: string, options: { indentLevel?: number; accentColor?: (text: string) => string; contentColor?: (text: string) => string } = {}) => {
      const { indentLevel = 1, accentColor = colors.accent, contentColor = colors.text } = options;
      const indent = '  '.repeat(indentLevel);
      const chars = styleHelpers.border.single;
      const width = Math.min(70, (process.stdout.columns || 80) - indentLevel * 2);
      const availableWidth = width - 2;

      const headerContent = `${colors.primaryBright(agentName)}: ${description}`;
      const headerContentLength = headerContent.replace(/\x1b\[[0-9;]*m/g, '').length;
      const headerFillLength = Math.max(0, availableWidth - 3 - headerContentLength);
      const headerLine = `${indent}${accentColor(chars.topLeft)}${accentColor('─── ')}${headerContent} ${accentColor('─'.repeat(headerFillLength))}${accentColor(chars.topRight)}`;

      const contentLines = content.split('\n');
      const maxContentWidth = width - 4;
      const middleLines = contentLines.map(line => {
        const lineLength = line.length;
        if (lineLength <= maxContentWidth) {
          const paddingLength = Math.max(0, width - lineLength - 4);
          return `${indent}${chars.vertical} ${contentColor(line)}${' '.repeat(paddingLength)}${chars.vertical}`;
        }
        const wrappedLines: string[] = [];
        let remaining = line;
        while (remaining.length > maxContentWidth) {
          wrappedLines.push(`${indent}${chars.vertical} ${contentColor(remaining.substring(0, maxContentWidth - 3))}...${chars.vertical}`);
          remaining = '... ' + remaining.substring(maxContentWidth - 3);
        }
        const remainingLength = remaining.length;
        const remainingPadding = Math.max(0, width - remainingLength - 4);
        wrappedLines.push(`${indent}${chars.vertical} ${contentColor(remaining)}${' '.repeat(remainingPadding)}${chars.vertical}`);
        return wrappedLines.join('\n');
      });

      const bottomLine = `${indent}${accentColor(chars.bottomLeft)}${accentColor('─'.repeat(width - 2))}${accentColor(chars.bottomRight)}`;

      return [headerLine, ...middleLines, bottomLine].join('\n');
    }
  }
};

/**
 * Theme configuration
 */
export const theme = {
  colors,
  icons,
  styles: styleHelpers,

  // Predefined style combinations
  predefinedStyles: {
    // Title styles
    title: (text: string) => styleHelpers.text.bold(colors.primary(text)),
    subtitle: (text: string) => colors.infoBright(text),
    section: (text: string) => styleHelpers.text.bold(colors.primaryBright(text)),

    // Status styles
    success: (text: string) => colors.success(`${icons.success} ${text}`),
    error: (text: string) => colors.error(`${icons.error} ${text}`),
    warning: (text: string) => colors.warning(`${icons.warning} ${text}`),
    info: (text: string) => colors.info(`${icons.info} ${text}`),
    debug: (text: string) => colors.debug(`${icons.debug} ${text}`),

    // Code styles
    code: (text: string) => colors.codeBackground(` ${text} `),
    inlineCode: (text: string) => colors.codeText(`\`${text}\``),

    // Link styles
    link: (text: string, url: string) => colors.primaryBright(`${text}: ${styleHelpers.text.underline(url)}`),

    // Emphasis styles
    highlight: (text: string) => colors.highlight(text),
    accent: (text: string) => colors.accent(text),
    muted: (text: string) => colors.textMuted(text),
    dim: (text: string) => colors.textDim(text),

    // Separators
    separator: (width: number) => colors.border(icons.separator.repeat(width)),
    separatorDouble: (width: number) => colors.border(icons.separatorDouble.repeat(width)),
    separatorDashed: (width: number) => colors.border(icons.separatorDashed.repeat(width)),

    // Progress bar
    progressBar: (current: number, total: number, width: number = 30) => {
      const percentage = Math.round((current / total) * 100);
      const filled = Math.round((current / total) * width);
      const empty = width - filled;

      const filledBar = colors.success(icons.square.repeat(filled));
      const emptyBar = colors.border(icons.square.repeat(empty));

      return `${filledBar}${emptyBar} ${percentage}%`;
    }
  }
};

/**
 * Simple markdown renderer for terminal output
 */
export function renderMarkdown(text: string, maxWidth: number = 80): string {
  if (!text) return '';

  const lines = text.split('\n');
  const result: string[] = [];

  let inCodeBlock = false;
  let codeLanguage = '';
  let codeContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for code block start/end
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        // Start of code block
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim() || '';
        codeContent = [];
      } else {
        // End of code block
        inCodeBlock = false;
        if (codeContent.length > 0) {
          result.push('');
          result.push(colors.accent(`${icons.code} ${codeLanguage ? codeLanguage + ' Code' : 'Code'}:`));
          codeContent.forEach(line => {
            result.push(colors.codeText(line));
          });
          result.push(colors.border(icons.separator.repeat(Math.min(40, maxWidth))));
          result.push('');
        }
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    // Process inline markdown
    let processed = line;

    // Headers (H1, H2, H3, H4)
    if (line.startsWith('#### ')) {
      processed = colors.primaryBright(line.slice(5));
    } else if (line.startsWith('### ')) {
      processed = colors.primaryBright(styleHelpers.text.bold(line.slice(4)));
    } else if (line.startsWith('## ')) {
      processed = colors.primaryBright(styleHelpers.text.bold(line.slice(3)));
    } else if (line.startsWith('# ')) {
      processed = colors.primaryBright(styleHelpers.text.bold(line.slice(2)));
    } else {
      // Inline formatting
      processed = processed
        // Code inline
        .replace(/`([^`]+)`/g, (_, code) => colors.codeText(code))
        // Bold
        .replace(/\*\*([^*]+)\*\*/g, (_, text) => styleHelpers.text.bold(text))
        // Italic
        .replace(/\*([^*]+)\*/g, (_, text) => styleHelpers.text.italic(text))
        // Strikethrough
        .replace(/~~([^~]+)~~/g, (_, text) => colors.textDim(text))
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => colors.primaryBright(`${text}: ${styleHelpers.text.underline(url)}`));
    }

    result.push(processed);
  }

  return result.join('\n');
}

/**
 * Parse a single diff line.
 * Format: "+<num> content" or "-<num> content" or " <num> content"
 * Also handles: "+<num>..." for skipped lines
 */
function parseDiffLine(line: string): { prefix: string; lineNum: string; content: string } | null {
  // Skip empty lines
  if (!line || line.trim() === '') return null;

  const firstChar = line[0];
  if (!['+', '-', ' '].includes(firstChar)) {
    // Try to detect if this is a diff-like line with different format
    // e.g., "+  1 content" (with padding)
    const match = line.match(/^[+\-\s]\s*/);
    if (match) {
      // This looks like a diff line but with unexpected format
      // Extract the content after the prefix
      const afterPrefix = line.slice(match[0].length).trim();
      return { prefix: firstChar, lineNum: '', content: afterPrefix };
    }
    return null;
  }

  // Extract content after the prefix char
  const afterPrefix = line.slice(1).trim();

  // Check for skipped lines marker
  if (afterPrefix === '...') {
    return { prefix: firstChar, lineNum: '', content: '...' };
  }

  // Return the rest as content
  return { prefix: firstChar, lineNum: '', content: afterPrefix };
}

/**
 * Replace tabs with spaces for consistent rendering.
 */
function replaceTabs(text: string): string {
  return text.replace(/\t/g, '   ');
}

/**
 * Compute word-level diff and render with inverse on changed parts.
 * Uses diffWords which groups whitespace with adjacent words for cleaner highlighting.
 */
function renderIntraLineDiff(oldContent: string, newContent: string): { removedLine: string; addedLine: string } {
  // Simple word diff without external dependency
  const oldWords = oldContent.split(/(\s+)/);
  const newWords = newContent.split(/(\s+)/);

  let removedLine = '';
  let addedLine = '';
  let i = 0, j = 0;

  while (i < oldWords.length || j < newWords.length) {
    const oldWord = oldWords[i] || '';
    const newWord = newWords[j] || '';

    if (oldWord === newWord) {
      removedLine += oldWord;
      addedLine += newWord;
      i++;
      j++;
    } else if (oldWord === '' || oldWord.match(/^\s+$/)) {
      addedLine += newWord;
      j++;
    } else if (newWord === '' || newWord.match(/^\s+$/)) {
      removedLine += oldWord;
      i++;
    } else {
      // Simple heuristic: show removed with inverse, added with inverse
      removedLine += colors.diffRemovedInverse(oldWord);
      addedLine += colors.diffAddedInverse(newWord);
      i++;
      j++;
    }
  }

  return { removedLine, addedLine };
}

/**
 * Render a diff string with colored lines and intra-line change highlighting.
 * - Context lines: gray
 * - Removed lines: red
 * - Added lines: green
 */
export function renderDiff(diffText: string): string {
  if (!diffText) return '';

  const lines = diffText.split('\n');
  const result: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const parsed = parseDiffLine(line);

    if (!parsed) {
      result.push(colors.diffContext(line));
      i++;
      continue;
    }

    if (parsed.prefix === '-') {
      // Collect consecutive removed lines
      const removedLines: { lineNum: string; content: string }[] = [];
      while (i < lines.length) {
        const p = parseDiffLine(lines[i]);
        if (!p || p.prefix !== '-') break;
        removedLines.push({ lineNum: p.lineNum, content: p.content });
        i++;
      }

      // Collect consecutive added lines
      const addedLines: { lineNum: string; content: string }[] = [];
      while (i < lines.length) {
        const p = parseDiffLine(lines[i]);
        if (!p || p.prefix !== '+') break;
        addedLines.push({ lineNum: p.lineNum, content: p.content });
        i++;
      }

      // Intra-line diff for single line modification
      if (removedLines.length === 1 && addedLines.length === 1) {
        const removed = removedLines[0];
        const added = addedLines[0];
        const { removedLine, addedLine } = renderIntraLineDiff(replaceTabs(removed.content), replaceTabs(added.content));
        const textColor = TERMINAL_BG === 'dark' ? '#e5e7eb' : '#1f2937';
        result.push(chalk.bgHex(mixWithBackground('#ef4444', 0.25, TERMINAL_BG)).hex(textColor)(`-${removedLine}`));
        result.push(chalk.bgHex(mixWithBackground('#10b981', 0.25, TERMINAL_BG)).hex(textColor)(`+${addedLine}`));
      } else {
        const textColor = TERMINAL_BG === 'dark' ? '#e5e7eb' : '#1f2937';
        for (const removed of removedLines) {
          result.push(chalk.bgHex(mixWithBackground('#ef4444', 0.25, TERMINAL_BG)).hex(textColor)(`-${replaceTabs(removed.content)}`));
        }
        for (const added of addedLines) {
          result.push(chalk.bgHex(mixWithBackground('#10b981', 0.25, TERMINAL_BG)).hex(textColor)(`+${replaceTabs(added.content)}`));
        }
      }
    } else if (parsed.prefix === '+') {
      const textColor = TERMINAL_BG === 'dark' ? '#e5e7eb' : '#1f2937';
      result.push(chalk.bgHex(mixWithBackground('#10b981', 0.25, TERMINAL_BG)).hex(textColor)(`+${replaceTabs(parsed.content)}`));
      i++;
    } else {
      result.push(chalk.hex('#374151')(` ${replaceTabs(parsed.content)}`));
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Render a code preview with line numbers and syntax highlighting.
 * Automatically adapts to dark/light terminal backgrounds.
 */
export function renderCodePreview(content: string, options: { filePath?: string; maxLines?: number; indent?: string } = {}): string {
  const { filePath = '', maxLines = 10, indent = '' } = options;
  const lines = content.split('\n');
  const displayLines = lines.slice(0, maxLines);
  const hasMore = lines.length > maxLines;

  const textColor = TERMINAL_BG === 'dark' ? '#e5e7eb' : '#1f2931';
  const bgColor = TERMINAL_BG === 'dark' ? '#1f2937' : '#f3f4f6';
  const codeStyle = chalk.bgHex(bgColor).hex(textColor);

  const lineNumWidth = String(displayLines.length).length;
  const parts: string[] = [];

  if (filePath) {
    parts.push(`${indent}${chalk.hex(TERMINAL_BG === 'dark' ? '#22d3ee' : '#0891b2').bold(filePath)}`);
  }

  displayLines.forEach((line, idx) => {
    const lineNum = String(idx + 1).padStart(lineNumWidth, ' ');
    parts.push(`${indent} ${codeStyle(`${lineNum} │ ${line}`)}`);
  });

  if (hasMore) {
    const dotsLine = `${indent}   ${chalk.hex(TERMINAL_BG === 'dark' ? '#6b7280' : '#9ca3af').dim('...')}`;
    parts.push(dotsLine);
  }

  return parts.join('\n');
}

/**
 * Render new file content in diff-like style (without line numbers).
 * Uses + prefix for added lines.
 */
export function renderLines(content: string, options: { maxLines?: number; indent?: string } = {}): string {
  const { maxLines = 20, indent = '' } = options;
  const lines = content.split('\n').slice(0, maxLines);
  const hasMore = content.split('\n').length > maxLines;

  const textColor = TERMINAL_BG === 'dark' ? '#e5e7eb' : '#1f2937';
  const bgColor = mixWithBackground('#10b981', 0.15, TERMINAL_BG);
  const lineStyle = chalk.bgHex(bgColor).hex(textColor);

  const parts: string[] = lines.map(line => `${indent}${lineStyle(`+ ${line}`)}`);

  if (hasMore) {
    parts.push(`${indent}${chalk.hex(TERMINAL_BG === 'dark' ? '#6b7280' : '#9ca3af').dim('...')}`);
  }

  return parts.join('\n');
}

export default theme;