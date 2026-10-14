/**
 * Entry point of the GitHub part of the reference adapters.
 */
import type { SourceAdapter } from '../../../core/ports.js';
import { githubRepoAdapter } from './adapter.js';

export { githubRepoAdapter } from './adapter.js';

/**
 * The adapters that read GitHub repositories: `github-repo`. Adapters are stateless values,
 * so the same instance is returned on every call.
 */
export function githubAdapters(): SourceAdapter[] {
  return [githubRepoAdapter];
}
