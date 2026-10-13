import type { Logger } from '../../src/core/ports.js';

/** One captured log call. */
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  fields?: object;
}

/** A logger that keeps everything in memory so tests can assert on it. Writes nothing. */
export class FakeLogger implements Logger {
  readonly entries: LogEntry[] = [];

  debug(msg: string, f?: object): void {
    this.push('debug', msg, f);
  }

  info(msg: string, f?: object): void {
    this.push('info', msg, f);
  }

  warn(msg: string, f?: object): void {
    this.push('warn', msg, f);
  }

  error(msg: string, f?: object): void {
    this.push('error', msg, f);
  }

  /** Messages at one level, in order. */
  messages(level?: LogEntry['level']): string[] {
    return this.entries
      .filter((entry) => level === undefined || entry.level === level)
      .map((entry) => entry.msg);
  }

  /** Forgets everything captured so far. */
  clear(): void {
    this.entries.length = 0;
  }

  private push(level: LogEntry['level'], msg: string, fields?: object): void {
    this.entries.push(fields === undefined ? { level, msg } : { level, msg, fields });
  }
}
