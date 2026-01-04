import chalk from 'chalk';

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
    dots: ['⠁', '⠂', '⠄', '⡀', '⡈', '⡐', '⡠', '⣀', '⣁', '⣂', '⣄', '⣌', '⣔', '⣤', '⣥', '⣦'],
    bars: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
    arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙']
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
 * Get theme configuration
 */
export function getTheme() {
  return theme;
}

export default theme;