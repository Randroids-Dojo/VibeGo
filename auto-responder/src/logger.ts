import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private logFile: string;
  private minLevel: number;
  private stream: fs.WriteStream | null = null;

  constructor(logFile: string, level: LogLevel = 'info') {
    this.logFile = logFile;
    this.minLevel = LOG_LEVELS[level];
    this.ensureLogDir();
    this.openStream();
  }

  private ensureLogDir(): void {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private openStream(): void {
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
    this.stream.on('error', (err) => {
      console.error('Logger stream error:', err);
    });
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);

    let logLine = `${timestamp} [${levelStr}] ${message}`;

    if (data !== undefined) {
      try {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        logLine += ` ${dataStr}`;
      } catch {
        logLine += ' [unserializable data]';
      }
    }

    return logLine;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] < this.minLevel) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message, data);

    // Write to file
    if (this.stream) {
      this.stream.write(formattedMessage + '\n');
    }

    // Also write to console based on level
    switch (level) {
      case 'error':
        console.error(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      default:
        console.log(formattedMessage);
    }
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

// Singleton logger instance
let loggerInstance: Logger | null = null;

export function initLogger(logFile: string, level: LogLevel = 'info'): Logger {
  if (loggerInstance) {
    loggerInstance.close();
  }
  loggerInstance = new Logger(logFile, level);
  return loggerInstance;
}

export function getLogger(): Logger {
  if (!loggerInstance) {
    throw new Error('Logger not initialized. Call initLogger first.');
  }
  return loggerInstance;
}
