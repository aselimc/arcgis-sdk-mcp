/**
 * Public factory of the cache package.
 */
import type { CreateCache } from '../core/factories.js';
import { createFileCache } from './file-cache.js';
import { resolveCacheDir } from './paths.js';

const MEBIBYTE = 1024 * 1024;

/**
 * Creates the per-user disk cache with its in-memory memo. Resolves the directory from the
 * configuration (or the platform default) and performs no I/O until the first operation.
 */
export const createCache: CreateCache = ({ config, logger, clock }) =>
  createFileCache({
    dir: resolveCacheDir(config),
    maxBytes: config.cacheMaxMb * MEBIBYTE,
    memoryMaxBytes: config.memoryMaxMb * MEBIBYTE,
    logger,
    clock,
  });
