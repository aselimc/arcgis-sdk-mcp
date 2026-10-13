/**
 * The adapter registry: one adapter per adapter type, looked up by the services. It is built
 * by the composition root from the arrays the adapter packages return, so this module (like
 * every module but the composition root) imports no other package.
 */
import { McpDocError } from '../core/errors.js';
import type { AdapterRegistry, SourceAdapter } from '../core/ports.js';
import { ADAPTER_TYPES, type AdapterType } from '../core/types.js';

/**
 * Builds the registry over the adapter lists of the site and reference packages.
 *
 * `get` rejects an unregistered type with `INTERNAL`: the registry data names an adapter
 * that this build does not carry, which is a defect and not something a caller can recover
 * from by changing its arguments.
 *
 * @throws Error when two adapters claim the same type. This is a wiring mistake and must
 *   stop start-up, because which adapter would answer is otherwise an accident of order.
 */
export function createAdapterRegistry(
  ...lists: ReadonlyArray<readonly SourceAdapter[]>
): AdapterRegistry {
  const byType = new Map<AdapterType, SourceAdapter>();
  for (const adapter of lists.flat()) {
    if (byType.has(adapter.type)) {
      throw new Error(`Two source adapters are registered for type "${adapter.type}"`);
    }
    byType.set(adapter.type, adapter);
  }

  return {
    get<A extends AdapterType>(type: A): SourceAdapter<A> {
      const adapter = byType.get(type);
      if (adapter === undefined) {
        throw new McpDocError('INTERNAL', `No source adapter is registered for type "${type}"`, {
          why: 'the product registry names an adapter this build does not include',
          retryable: false,
        });
      }
      // The map is keyed by `adapter.type`, so the entry under `type` has that type parameter.
      return adapter as unknown as SourceAdapter<A>;
    },
    types: () => [...byType.keys()],
  };
}

/** Adapter types the registry data may name but `adapters` does not provide. */
export function missingAdapterTypes(adapters: AdapterRegistry): AdapterType[] {
  const present = new Set(adapters.types());
  return ADAPTER_TYPES.filter((type) => !present.has(type));
}
