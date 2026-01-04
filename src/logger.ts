import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import { theme, icons, colors, styleHelpers } from './theme.js';

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  SUCCESS = 'success',
  INFO = 'info',
  DEBUG = 'debug'
}

export interface LogOptions {
  level?: LogLevel;
  icon?: string;
  color?: (text: string) => string;
  showTimestamp?: boolean;
  wrap?: boolean;
  maxWidth?: number;
  suggestion?: string;
  prefix?: string;
  suffix?: string;
}

export interface LoggerConfig {
  minLevel: LogLevel;
  showTimestamp: boolean;
  maxWidth: number;
  wrapText: boolean;
  showSuggestions: boolean;
  useBorders: boolean;
  borderStyle: 'single' | 'double' | 'rounded';
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.SUCCESS]: 2,
  [LogLevel.WARN]: 3,
  [LogLevel.ERROR]: 4
};

const DEFAULT_ICONS: Record<LogLevel, string> = {
  [LogLevel.ERROR]: icons.error,
  [LogLevel.WARN]: icons.warning,
  [LogLevel.SUCCESS]: icons.success,
  [LogLevel.INFO]: icons.info,
  [LogLevel.DEBUG]: icons.debug
};

const DEFAULT_COLORS: Record<LogLevel, (text: string) => string> = {
  [LogLevel.ERROR]: colors.error,
  [LogLevel.WARN]: colors.warning,
  [LogLevel.SUCCESS]: colors.success,
  [LogLevel.INFO]: colors.info,
  [LogLevel.DEBUG]: colors.debug
};

export class Logger {
  private config: LoggerConfig;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      minLevel: LogLevel.INFO,
      showTimestamp: false,
      maxWidth: process.stdout.columns || 80,
      wrapText: true,
      showSuggestions: true,
      useBorders: false,
      borderStyle: 'single',
      ...config
    };

    this.setupResizeListener();
  }

  private setupResizeListener(): void {
    process.stdout.on('resize', () => {
      this.config.maxWidth = process.stdout.columns || 80;
    });
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.config.minLevel];
  }

  private formatMessage(message: string, options: LogOptions): string {
    const level = options.level || LogLevel.INFO;
    const icon = options.icon || DEFAULT_ICONS[level];
    const color = options.color || DEFAULT_COLORS[level];
    const showTimestamp = options.showTimestamp ?? this.config.showTimestamp;
    const wrap = options.wrap ?? this.config.wrapText;
    const maxWidth = options.maxWidth || this.config.maxWidth;

    let formatted = '';

    if (showTimestamp) {
      const timestamp = new Date().toLocaleTimeString();
      formatted += colors.textDim(`[${timestamp}] `);
    }

    formatted += color(`${icon} `);

    if (options.prefix) {
      formatted += colors.textMuted(`${options.prefix} `);
    }

    if (wrap) {
      const availableWidth = maxWidth - stringWidth(formatted) - (options.suffix ? stringWidth(options.suffix) : 0);
      formatted += wrapAnsi(message, availableWidth, {
        hard: true,
        trim: true
      });
    } else {
      formatted += message;
    }

    if (options.suffix) {
      formatted += ` ${colors.textMuted(options.suffix)}`;
    }

    return formatted;
  }

  private formatSuggestion(suggestion: string): string {
    const prefix = colors.primaryBright(`${icons.sparkles} Suggestion: `);
    const maxWidth = this.config.maxWidth;
    const availableWidth = maxWidth - stringWidth(prefix);

    const wrapped = wrapAnsi(suggestion, availableWidth, {
      hard: true,
      trim: true
    });

    return prefix + wrapped;
  }

  private log(message: string, options: LogOptions): void {
    if (!this.shouldLog(options.level || LogLevel.INFO)) {
      return;
    }

    const formatted = this.formatMessage(message, options);
    console.log(formatted);

    if (options.suggestion && this.config.showSuggestions) {
      console.log(this.formatSuggestion(options.suggestion));
    }
  }

  error(message: string, suggestion?: string): void {
    this.log(message, {
      level: LogLevel.ERROR,
      suggestion
    });
  }

  warn(message: string, suggestion?: string): void {
    this.log(message, {
      level: LogLevel.WARN,
      suggestion
    });
  }

  success(message: string, suggestion?: string): void {
    this.log(message, {
      level: LogLevel.SUCCESS,
      suggestion
    });
  }

  info(message: string, suggestion?: string): void {
    this.log(message, {
      level: LogLevel.INFO,
      suggestion
    });
  }

  debug(message: string, suggestion?: string): void {
    this.log(message, {
      level: LogLevel.DEBUG,
      suggestion
    });
  }

  section(title: string): void {
    const separator = icons.separator.repeat(this.config.maxWidth - 2);
    console.log('');
    console.log(colors.primaryBright(styleHelpers.text.bold(title)));
    console.log(colors.border(separator));
  }

  subsection(title: string): void {
    console.log('');
    console.log(colors.infoBright(styleHelpers.text.bold(title)));
  }

  list(items: string[], options?: { numbered?: boolean; indent?: number; icon?: string }): void {
    const numbered = options?.numbered ?? false;
    const indent = options?.indent ?? 2;
    const customIcon = options?.icon;
    const prefix = ' '.repeat(indent);

    items.forEach((item, index) => {
      let bullet: string;
      if (numbered) {
        bullet = `${index + 1}.`;
      } else if (customIcon) {
        bullet = customIcon;
      } else {
        bullet = icons.bullet;
      }

      const availableWidth = this.config.maxWidth - stringWidth(prefix + bullet + ' ');
      const wrapped = wrapAnsi(item, availableWidth, {
        hard: true,
        trim: true
      });

      console.log(`${prefix}${colors.primaryBright(bullet)} ${wrapped}`);
    });
  }

  table(headers: string[], rows: string[][], options?: { showBorders?: boolean; borderStyle?: 'single' | 'double' | 'rounded' }): void {
    const showBorders = options?.showBorders ?? this.config.useBorders;
    const borderStyle = options?.borderStyle ?? this.config.borderStyle;

    const columnWidths = headers.map((header, index) => {
      const maxRowWidth = Math.max(...rows.map(row => stringWidth(row[index] || '')));
      return Math.max(stringWidth(header), maxRowWidth);
    });

    const totalWidth = columnWidths.reduce((sum, width) => sum + width + 2, 0) + (columnWidths.length - 1);

    const createSeparator = (left: string, middle: string, right: string, horizontal: string) => {
      return left + columnWidths.map(width => horizontal.repeat(width + 2)).join(middle) + right;
    };

    const border = styleHelpers.border[borderStyle];

    if (showBorders) {
      console.log(colors.border(createSeparator(border.topLeft, border.topT, border.topRight, border.horizontal)));
    } else {
      console.log(colors.border(createSeparator('', '', '', '─')));
    }

    console.log(
      (showBorders ? colors.border(border.vertical) : '') + ' ' +
      headers.map((header, index) => {
        const padded = header.padEnd(columnWidths[index]);
        return colors.primaryBright(padded);
      }).join(' ' + (showBorders ? colors.border(border.vertical) : '') + ' ') +
      ' ' + (showBorders ? colors.border(border.vertical) : '')
    );

    if (showBorders) {
      console.log(colors.border(createSeparator(border.leftT, border.cross, border.rightT, border.horizontal)));
    } else {
      console.log(colors.border(createSeparator('', '', '', '─')));
    }

    rows.forEach((row, rowIndex) => {
      const isEven = rowIndex % 2 === 0;
      console.log(
        (showBorders ? colors.border(border.vertical) : '') + ' ' +
        row.map((cell, index) => {
          const padded = (cell || '').padEnd(columnWidths[index]);
          return isEven ? padded : colors.textDim(padded);
        }).join(' ' + (showBorders ? colors.border(border.vertical) : '') + ' ') +
        ' ' + (showBorders ? colors.border(border.vertical) : '')
      );
    });

    if (showBorders) {
      console.log(colors.border(createSeparator(border.bottomLeft, border.bottomT, border.bottomRight, border.horizontal)));
    } else {
      console.log(colors.border(createSeparator('', '', '', '─')));
    }
  }

  code(code: string, language?: string): void {
    const lang = language || '';
    const separator = icons.separator.repeat(this.config.maxWidth - 2);

    console.log('');
    console.log(colors.accent(`${icons.code} ${lang ? lang + ' Code' : 'Code'}:`));
    console.log(colors.border(separator));
    console.log(colors.codeText(code));
    console.log(colors.border(separator));
  }

  link(text: string, url: string): void {
    console.log(colors.primaryBright(`${text}: ${styleHelpers.text.underline(url)}`));
  }

  progress(message: string, current: number, total: number): void {
    const percentage = Math.round((current / total) * 100);
    const barWidth = 30;
    const filled = Math.round((current / total) * barWidth);
    const empty = barWidth - filled;

    const filledBar = colors.success(icons.square.repeat(filled));
    const emptyBar = colors.border(icons.square.repeat(empty));

    console.log(`${colors.textMuted(message)} ${filledBar}${emptyBar} ${colors.primaryBright(`${percentage}%`)}`);
  }

  divider(type: 'single' | 'double' | 'dashed' | 'dotted' = 'single'): void {
    let separator: string;
    switch (type) {
      case 'double':
        separator = icons.separatorDouble;
        break;
      case 'dashed':
        separator = icons.separatorDashed;
        break;
      case 'dotted':
        separator = icons.separatorDotted;
        break;
      default:
        separator = icons.separator;
    }

    console.log(colors.border(separator.repeat(this.config.maxWidth - 2)));
  }

  blank(): void {
    console.log();
  }

  box(content: string, title?: string, options?: { borderStyle?: 'single' | 'double' | 'rounded' }): void {
    const borderStyle = options?.borderStyle ?? this.config.borderStyle;
    const border = styleHelpers.border[borderStyle];

    const lines = content.split('\n');
    const maxWidth = Math.max(...lines.map(line => stringWidth(line)));
    const boxWidth = maxWidth + 4;

    const horizontalLine = border.horizontal.repeat(boxWidth);

    console.log(colors.border(`${border.topLeft}${horizontalLine}${border.topRight}`));

    if (title) {
      const titlePadding = boxWidth - stringWidth(title) - 2;
      const leftPadding = Math.floor(titlePadding / 2);
      const rightPadding = titlePadding - leftPadding;

      console.log(
        colors.border(border.vertical) +
        ' '.repeat(leftPadding) +
        colors.primaryBright(styleHelpers.text.bold(title)) +
        ' '.repeat(rightPadding) +
        colors.border(border.vertical)
      );
    }

    lines.forEach(line => {
      const padding = boxWidth - stringWidth(line) - 2;
      console.log(
        colors.border(border.vertical) +
        ' ' +
        line +
        ' '.repeat(padding) +
        colors.border(border.vertical)
      );
    });

    console.log(colors.border(`${border.bottomLeft}${horizontalLine}${border.bottomRight}`));
  }

  gradient(text: string): void {
    console.log(colors.gradient(text));
  }

  highlight(text: string, pattern: string): void {
    const regex = new RegExp(`(${pattern})`, 'gi');
    const highlighted = text.replace(regex, colors.highlight('$1'));
    console.log(highlighted);
  }

  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level;
  }

  setShowTimestamp(show: boolean): void {
    this.config.showTimestamp = show;
  }

  setWrapText(wrap: boolean): void {
    this.config.wrapText = wrap;
  }

  setShowSuggestions(show: boolean): void {
    this.config.showSuggestions = show;
  }

  setUseBorders(use: boolean): void {
    this.config.useBorders = use;
  }

  setBorderStyle(style: 'single' | 'double' | 'rounded'): void {
    this.config.borderStyle = style;
  }

  getMaxWidth(): number {
    return this.config.maxWidth;
  }
}

let loggerInstance: Logger | null = null;

export function getLogger(config?: Partial<LoggerConfig>): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger(config);
  }
  return loggerInstance;
}

export function resetLogger(): void {
  loggerInstance = null;
}
