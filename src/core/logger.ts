/**
 * Logging and time. Logs are JSON lines on stderr and nowhere else: in stdio mode stdout
 * carries the JSON-RPC stream, so a stray line there would corrupt the protocol.
 */
import type { LogLevel } from './config.js';
import type { Clock, Logger } from './ports.js';

const SEVERITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

/** JSON cannot carry Error objects or bigints, and must not fail on cycles. */
function serialisable(fields: object): Record<string, unknown> {
  const seen = new WeakSet<object>();
  const convert = (value: unknown): unknown => {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Error) {
      const { code, details } = value as { code?: unknown; details?: unknown };
      return {
        name: value.name,
        message: value.message,
        ...(code === undefined ? {} : { code: convert(code) }),
        ...(details === undefined ? {} : { details: convert(details) }),
        stack: value.stack,
      };
    }
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map(convert);
    if (value instanceof Set) return [...value].map(convert);
    if (value instanceof Map)
      return Object.fromEntries([...value].map(([k, v]) => [String(k), convert(v)]));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)]));
  };
  return convert(fields) as Record<string, unknown>;
}

/**
 * Creates a logger that writes one JSON object per line: `{ t, level, msg, ...fields }`.
 *
 * @param level minimum level written; `silent` writes nothing.
 * @param write line sink, stderr by default. Tests pass a collector.
 */
export function createLogger(
  level: LogLevel,
  write: (line: string) => void = (line) => {
    process.stderr.write(line);
  },
): Logger {
  const threshold = SEVERITY[level];
  const emit = (name: Exclude<LogLevel, 'silent'>, msg: string, fields?: object): void => {
    if (SEVERITY[name] < threshold) return;
    const record = {
      ...(fields === undefined ? {} : serialisable(fields)),
      t: new Date().toISOString(),
      level: name,
      msg,
    };
    write(`${JSON.stringify(record)}\n`);
  };
  return {
    debug: (msg, f) => {
      emit('debug', msg, f);
    },
    info: (msg, f) => {
      emit('info', msg, f);
    },
    warn: (msg, f) => {
      emit('warn', msg, f);
    },
    error: (msg, f) => {
      emit('error', msg, f);
    },
  };
}

/** The real clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
  today: () => new Date().toISOString().slice(0, 10),
};
