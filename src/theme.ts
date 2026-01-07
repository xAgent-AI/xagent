import chalk from 'chalk';

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

    // Headers (only H1, H2, H3)
    if (line.startsWith('### ')) {
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

export default theme;