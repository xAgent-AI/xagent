import chalk from 'chalk';

/**
 * 现代化配色方案 - 使用协调的 HSL 色彩
 */
export const colors = {
  // 主色调 - 使用现代的青蓝色系
  primary: chalk.hex('#06b6d4'), // Cyan-500
  primaryBright: chalk.hex('#22d3ee'), // Cyan-400
  primaryDark: chalk.hex('#0891b2'), // Cyan-600

  // 成功色 - 使用柔和的绿色
  success: chalk.hex('#10b981'), // Emerald-500
  successBright: chalk.hex('#34d399'), // Emerald-400

  // 警告色 - 使用温暖的琥珀色
  warning: chalk.hex('#f59e0b'), // Amber-500
  warningBright: chalk.hex('#fbbf24'), // Amber-400

  // 错误色 - 使用柔和的红色
  error: chalk.hex('#ef4444'), // Red-500
  errorBright: chalk.hex('#f87171'), // Red-400

  // 信息色 - 使用靛蓝色
  info: chalk.hex('#6366f1'), // Indigo-500
  infoBright: chalk.hex('#818cf8'), // Indigo-400

  // 调试色 - 使用中性灰色
  debug: chalk.hex('#6b7280'), // Gray-500
  debugBright: chalk.hex('#9ca3af'), // Gray-400

  // 辅助色
  accent: chalk.hex('#8b5cf6'), // Violet-500
  highlight: chalk.hex('#ec4899'), // Pink-500

  // 中性色
  text: chalk.hex('#f3f4f6'), // Gray-100
  textMuted: chalk.hex('#9ca3af'), // Gray-400
  textDim: chalk.hex('#6b7280'), // Gray-500
  border: chalk.hex('#374151'), // Gray-700
  borderLight: chalk.hex('#4b5563'), // Gray-600

  // 代码块颜色
  codeBackground: chalk.hex('#1f2937'), // Gray-800
  codeText: chalk.hex('#e5e7eb'), // Gray-200

  // 渐变色
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
 * 图标系统 - 使用 emoji 和 Unicode 符号
 */
export const icons = {
  // 状态图标
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  debug: '◦',
  loading: '⟳',
  processing: '⏳',

  // 功能图标
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

  // 分隔符
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
 * 样式配置
 */
export const styleHelpers = {
  // 边框样式
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

  // 文本样式
  text: {
    bold: chalk.bold,
    dim: chalk.dim,
    italic: chalk.italic,
    underline: chalk.underline,
    strikethrough: chalk.strikethrough,
    inverse: chalk.inverse
  },

  // 动画效果
  animation: {
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    dots: ['⠁', '⠂', '⠄', '⡀', '⡈', '⡐', '⡠', '⣀', '⣁', '⣂', '⣄', '⣌', '⣔', '⣤', '⣥', '⣦'],
    bars: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
    arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙']
  }
};

/**
 * 主题配置
 */
export const theme = {
  colors,
  icons,
  styles: styleHelpers,

  // 预定义样式组合
  predefinedStyles: {
    // 标题样式
    title: (text: string) => styleHelpers.text.bold(colors.primary(text)),
    subtitle: (text: string) => colors.infoBright(text),
    section: (text: string) => styleHelpers.text.bold(colors.primaryBright(text)),

    // 状态样式
    success: (text: string) => colors.success(`${icons.success} ${text}`),
    error: (text: string) => colors.error(`${icons.error} ${text}`),
    warning: (text: string) => colors.warning(`${icons.warning} ${text}`),
    info: (text: string) => colors.info(`${icons.info} ${text}`),
    debug: (text: string) => colors.debug(`${icons.debug} ${text}`),

    // 代码样式
    code: (text: string) => colors.codeBackground(` ${text} `),
    inlineCode: (text: string) => colors.codeText(`\`${text}\``),

    // 链接样式
    link: (text: string, url: string) => colors.primaryBright(`${text}: ${styleHelpers.text.underline(url)}`),

    // 强调样式
    highlight: (text: string) => colors.highlight(text),
    accent: (text: string) => colors.accent(text),
    muted: (text: string) => colors.textMuted(text),
    dim: (text: string) => colors.textDim(text),

    // 分隔线
    separator: (width: number) => colors.border(icons.separator.repeat(width)),
    separatorDouble: (width: number) => colors.border(icons.separatorDouble.repeat(width)),
    separatorDashed: (width: number) => colors.border(icons.separatorDashed.repeat(width)),

    // 进度条
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
 * 获取主题配置
 */
export function getTheme() {
  return theme;
}

export default theme;