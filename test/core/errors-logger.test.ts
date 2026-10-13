import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, McpDocError, isMcpDocError, toMcpDocError } from '../../src/core/errors.js';
import { createLogger, systemClock } from '../../src/core/logger.js';

describe('McpDocError', () => {
  it('carries a code, a message and optional details', () => {
    const error = new McpDocError('UNKNOWN_PRODUCT', 'No product matches "javscript"', {
      why: 'The name is not a product id or alias',
      next: 'arcgis_docs_list_products({"query":"javscript"})',
      candidates: ['js-maps-sdk'],
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('McpDocError');
    expect(error.code).toBe('UNKNOWN_PRODUCT');
    expect(error.message).toBe('No product matches "javscript"');
    expect(error.details?.candidates).toEqual(['js-maps-sdk']);
    expect(new McpDocError('INTERNAL', 'x').details).toBeUndefined();
  });

  it('lists the fifteen codes of the catalogue', () => {
    expect(ERROR_CODES).toHaveLength(15);
    expect(new Set(ERROR_CODES).size).toBe(15);
  });
});

describe('isMcpDocError', () => {
  it('recognises instances', () => {
    expect(isMcpDocError(new McpDocError('DOC_NOT_FOUND', 'gone'))).toBe(true);
  });

  it('recognises an instance from another copy of the module by shape', () => {
    const foreign = Object.assign(new Error('gone'), {
      name: 'McpDocError',
      code: 'DOC_NOT_FOUND',
    });
    expect(isMcpDocError(foreign)).toBe(true);
  });

  it('rejects everything else', () => {
    const wrongCode = Object.assign(new Error('x'), { name: 'McpDocError', code: 'NOPE' });
    const noCode = Object.assign(new Error('x'), { name: 'McpDocError' });
    for (const value of [
      new Error('plain'),
      wrongCode,
      noCode,
      { name: 'McpDocError', code: 'DOC_NOT_FOUND' },
      'DOC_NOT_FOUND',
      null,
      undefined,
    ]) {
      expect(isMcpDocError(value)).toBe(false);
    }
  });
});

describe('toMcpDocError', () => {
  it('returns an McpDocError unchanged', () => {
    const error = new McpDocError('LINK_ONLY', 'not fetched');
    expect(toMcpDocError(error)).toBe(error);
  });

  it('wraps anything else as INTERNAL with the original as cause', () => {
    const original = new TypeError('cannot read properties of undefined');
    const wrapped = toMcpDocError(original);
    expect(wrapped.code).toBe('INTERNAL');
    expect(wrapped.message).toBe('Internal error');
    expect(wrapped.details?.why).toBe('cannot read properties of undefined');
    expect(wrapped.cause).toBe(original);
    expect(toMcpDocError('a string').details?.why).toBe('a string');
  });
});

describe('createLogger', () => {
  function capture(level: Parameters<typeof createLogger>[0]) {
    const lines: string[] = [];
    const logger = createLogger(level, (line) => lines.push(line));
    const records = (): Array<Record<string, unknown>> =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    return { logger, lines, records };
  }

  it('writes one JSON object per line with time, level, message and fields', () => {
    const { logger, lines, records } = capture('debug');
    logger.info('index built', { product: 'js-maps-sdk', records: 42 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(lines[0]?.slice(0, -1)).not.toContain('\n');
    expect(records()[0]).toMatchObject({
      level: 'info',
      msg: 'index built',
      product: 'js-maps-sdk',
      records: 42,
    });
    expect(Date.parse(String(records()[0]?.t))).not.toBeNaN();
  });

  it('filters below the configured level', () => {
    const { logger, records } = capture('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(records().map((record) => record.level)).toEqual(['warn', 'error']);
  });

  it('writes everything at debug and nothing at silent', () => {
    const all = capture('debug');
    all.logger.debug('d');
    all.logger.info('i');
    all.logger.warn('w');
    all.logger.error('e');
    expect(all.lines).toHaveLength(4);

    const none = capture('silent');
    none.logger.error('e');
    expect(none.lines).toHaveLength(0);
  });

  it('does not let fields overwrite the envelope', () => {
    const { logger, records } = capture('info');
    logger.info('real message', { msg: 'spoofed', level: 'error', t: 'never' });
    expect(records()[0]).toMatchObject({ msg: 'real message', level: 'info' });
    expect(records()[0]?.t).not.toBe('never');
  });

  it('serialises errors, bigints, sets, maps, nested values and cycles', () => {
    const { logger, records } = capture('info');
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    logger.error('failed', {
      error: new McpDocError('UPSTREAM_UNAVAILABLE', 'host down', { host: 'h.example' }),
      plain: new Error('plain'),
      big: 10n,
      set: new Set(['a', 'b']),
      map: new Map<string, unknown>([['k', 1n]]),
      list: [1, { deep: 2n }],
      nothing: null,
      cyclic,
    });
    const record = records()[0];
    expect(record?.error).toMatchObject({
      name: 'McpDocError',
      message: 'host down',
      code: 'UPSTREAM_UNAVAILABLE',
      details: { host: 'h.example' },
    });
    expect((record?.error as { stack?: string }).stack).toContain('McpDocError');
    expect(record?.plain).toMatchObject({ name: 'Error', message: 'plain' });
    expect(record?.plain).not.toHaveProperty('code');
    expect(record).toMatchObject({
      big: '10',
      set: ['a', 'b'],
      map: { k: '1' },
      list: [1, { deep: '2' }],
      nothing: null,
      cyclic: { name: 'loop', self: '[circular]' },
    });
  });

  it('writes to stderr by default and never to stdout', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    createLogger('info').warn('to stderr');
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain('"msg":"to stderr"');
    expect(stdout).not.toHaveBeenCalled();
  });
});

describe('systemClock', () => {
  it('reports the current time consistently in all three forms', () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
    expect(systemClock.iso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(systemClock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Both read the same clock; allow for a midnight roll-over between the two calls.
    expect([
      systemClock.iso().slice(0, 10),
      new Date(Date.now() - 1000).toISOString().slice(0, 10),
    ]).toContain(systemClock.today());
  });
});
