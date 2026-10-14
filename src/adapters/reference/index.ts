/**
 * Public entry point of the reference adapters: the adapters that read
 * generated API references, Esri's npm packages and GitHub repositories.
 */
import type { SourceAdapter } from '../../core/ports.js';
import { dartdocAdapter } from './dartdoc.js';
import { doccAdapter } from './docc.js';
import { docfxNetAdapter } from './docfx-net.js';
import { dokkaAdapter } from './dokka.js';
import { githubAdapters } from './github/index.js';
import { javadocAdapter } from './javadoc.js';
import { npmAdapters } from './npm/index.js';
import { pkgdownAdapter } from './pkgdown.js';
import { sphinxAdapter } from './sphinx.js';
import { xmldocAdapter } from './xmldoc.js';

/**
 * Every reference adapter, one per adapter type: `docc`, `dokka`, `dartdoc`, `docfx-net`,
 * `javadoc`, `sphinx`, the npm adapters (`npm-dts`, `npm-cem`, `npm-json`), `github-repo`,
 * `xmldoc` and `pkgdown`. Adapters are stateless values, so the same instances are returned
 * on every call; the composition root hands them to the adapter registry together with the
 * site adapters.
 */
export function referenceAdapters(): SourceAdapter[] {
  return [
    doccAdapter,
    dokkaAdapter,
    dartdocAdapter,
    docfxNetAdapter,
    javadocAdapter,
    sphinxAdapter,
    ...npmAdapters(),
    ...githubAdapters(),
    xmldocAdapter,
    pkgdownAdapter,
  ];
}
