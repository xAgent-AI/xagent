import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';

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
}

export interface LoggerConfig {
  minLevel: LogLevel;
  showTimestamp: boolean;
  maxWidth: number;
  wrapText: boolean;
  showSuggestions: boolean;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.SUCCESS]: 2,
  [LogLevel.WARN]: 3,
  [LogLevel.ERROR]: 4
};

const DEFAULT_ICONS: Record<LogLevel, string> = {
  [LogLevel.ERROR]: '✖',
  [LogLevel.WARN]: '⚠',
  [LogLevel.SUCCESS]: '✔',
  [LogLevel.INFO]: 'ℹ',
  [LogLevel.DEBUG]: '○'
};

const DEFAULT_COLORS: Record<LogLevel, (text: string) => string> = {
  [LogLevel.ERROR]: chalk.red,
  [LogLevel.WARN]: chalk.yellow,
  [LogLevel.SUCCESS]: chalk.green,
  [LogLevel.INFO]: chalk.cyan,
  [LogLevel.DEBUG]: chalk.gray
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
      formatted += chalk.gray(`[${timestamp}] `);
    }

    formatted += color(`${icon} `);

    if (wrap) {
      const availableWidth = maxWidth - stringWidth(formatted);
      formatted += wrapAnsi(message, availableWidth, {
        hard: true,
        trim: true
      });
    } else {
      formatted += message;
    }

    return formatted;
  }

  private formatSuggestion(suggestion: string): string {
    const prefix = chalk.gray('💡 建议: ');
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
    const separator = '─'.repeat(this.config.maxWidth - 2);
    console.log(chalk.cyan(`\n${title}`));
    console.log(chalk.gray(separator));
  }

  subsection(title: string): void {
    console.log(chalk.yellow(`\n${title}`));
  }

  list(items: string[], options?: { numbered?: boolean; indent?: number }): void {
    const numbered = options?.numbered ?? false;
    const indent = options?.indent ?? 2;
    const prefix = ' '.repeat(indent);

    items.forEach((item, index) => {
      const bullet = numbered ? `${index + 1}.` : '•';
      const availableWidth = this.config.maxWidth - stringWidth(prefix + bullet + ' ');
      const wrapped = wrapAnsi(item, availableWidth, {
        hard: true,
        trim: true
      });

      console.log(`${prefix}${bullet} ${wrapped}`);
    });
  }

  table(headers: string[], rows: string[][]): void {
    const columnWidths = headers.map((header, index) => {
      const maxRowWidth = Math.max(...rows.map(row => stringWidth(row[index] || '')));
      return Math.max(stringWidth(header), maxRowWidth);
    });

    const separator = columnWidths.map(width => '─'.repeat(width + 2)).join('┼');

    console.log(chalk.gray(separator));
    console.log(
      '│ ' +
      headers.map((header, index) => {
        const padded = header.padEnd(columnWidths[index]);
        return chalk.cyan(padded);
      }).join(' │ ') +
      ' │'
    );
    console.log(chalk.gray(separator));

    rows.forEach(row => {
      console.log(
        '│ ' +
        row.map((cell, index) => {
          const padded = (cell || '').padEnd(columnWidths[index]);
          return padded;
        }).join(' │ ') +
        ' │'
      );
    });

    console.log(chalk.gray(separator));
  }

  code(code: string, language?: string): void {
    const lang = language || '';
    console.log(chalk.gray(`\n${lang ? lang + ' code:' : 'Code:'}`));
    console.log(chalk.gray('─'.repeat(this.config.maxWidth - 2)));
    console.log(code);
    console.log(chalk.gray('─'.repeat(this.config.maxWidth - 2)));
  }

  link(text: string, url: string): void {
    console.log(chalk.cyan(`${text}: ${chalk.underline(url)}`));
  }

  progress(message: string, current: number, total: number): void {
    const percentage = Math.round((current / total) * 100);
    const barWidth = 30;
    const filled = Math.round((current / total) * barWidth);
    const empty = barWidth - filled;

    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('█'.repeat(empty));
    console.log(`${message} ${bar} ${percentage}%`);
  }

  divider(): void {
    console.log(chalk.gray('─'.repeat(this.config.maxWidth - 2)));
  }

  blank(): void {
    console.log();
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
