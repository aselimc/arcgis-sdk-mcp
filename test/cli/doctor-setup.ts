import type { DoctorDeps, DoctorReport } from '../../src/cli/doctor.js';
import type { Product } from '../../src/core/types.js';
import { makeProduct, makeSource } from '../support/builders.js';
import { FakeAdapter } from '../support/fake-adapter.js';
import { makeContainer, type MakeContainerOptions } from './helpers.js';

/** Shared scenario of the doctor tests: a developer product with two sources and a help site. */

const guide = makeSource('gatsby', { base: '/widgets/' });
const api = makeSource(
  'docc',
  { base: '/widgets/api/' },
  { id: 'api', title: 'API', kinds: ['api'], floor: false },
);
export const widgets = makeProduct({ sources: [guide, api] });
const helpSite = makeProduct({
  id: 'gadget-help',
  name: 'Gadget help',
  aliases: [],
  tier: 'help',
  sources: [
    makeSource('sitemap', { url: 'https://doc.arcgis.com/en/gadget/sitemap.xml' }, { id: 'help' }),
  ],
});

export function setup(options: MakeContainerOptions & { products?: Product[] } = {}) {
  const gatsby = new FakeAdapter('gatsby', { probe: { ok: true, ms: 12, records: 40 } });
  const docc = new FakeAdapter('docc');
  const sitemap = new FakeAdapter('sitemap');
  const slept: number[] = [];
  const progress: string[] = [];
  const container = makeContainer({
    products: [widgets, helpSite],
    adapters: [gatsby, docc, sitemap],
    ...options,
  });
  const deps: DoctorDeps = {
    env: {},
    nodeVersion: '22.15.0',
    checkWritable: async () => undefined,
    sleep: async (ms) => void slept.push(ms),
    progress: (line) => void progress.push(line),
  };
  return { container, deps, gatsby, docc, sitemap, slept, progress };
}

export const check = (report: DoctorReport, id: string) => report.checks.find((c) => c.id === id);
