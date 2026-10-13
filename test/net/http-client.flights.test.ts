/**
 * Single-flight: concurrent identical requests share one fetch, which runs on the budget and
 * signal of the caller that started it. A caller that joined must not inherit a failure that
 * was the starter's alone.
 */
import { describe, expect, it } from 'vitest';
import { newBudget } from '../../src/core/async.js';
import { declined, declinedBy, unavailable } from '../../src/net/errors.js';
import { Flights } from '../../src/net/flights.js';
import {
  GatedOrigin,
  PAGE,
  hostRow,
  makeRig,
  mcpError,
  page,
  rejection,
  status,
} from './harness.js';

const HOST = 'developers.arcgis.com';
const DOC = `https://${HOST}/javascript/latest/get-started/`;
const HOSTS = [hostRow(HOST)];

describe('gateway: shared flights', () => {
  it('lets a joined caller ask again when the starter cancels', async () => {
    const gate = new GatedOrigin();
    const rig = makeRig({ hosts: HOSTS, fetchImpl: gate.fetch });
    const starter = new AbortController();
    const budget = newBudget(12, 25_000, rig.clock);

    const first = mcpError(rig.http.get({ url: DOC, expect: 'html', signal: starter.signal }));
    const second = rig.http.get({ url: DOC, expect: 'html', budget });
    await gate.reached();
    starter.abort('User cancelled');
    expect(declinedBy(await first)).toBe('cancelled');

    // The second caller never cancelled: its own request goes out, on its own budget.
    await gate.reached();
    gate.answer(page(PAGE));
    expect(await second).toMatchObject({ text: PAGE, cache: 'miss' });
    expect(gate.urls).toEqual([DOC, DOC]);
    expect(budget.used).toBe(1);
  });

  it('lets a joined caller ask again when the budget of the starter is spent', async () => {
    const gate = new GatedOrigin();
    const rig = makeRig({ hosts: HOSTS, fetchImpl: gate.fetch });
    const spent = newBudget(0, 25_000, rig.clock);
    const budget = newBudget(12, 25_000, rig.clock);

    const first = mcpError(rig.http.get({ url: DOC, expect: 'html', budget: spent }));
    const second = rig.http.get({ url: DOC, expect: 'html', budget });
    expect(declinedBy(await first)).toBe('budget');

    await gate.reached();
    gate.answer(page(PAGE));
    expect((await second).text).toBe(PAGE);
    expect(gate.urls).toEqual([DOC]);
    expect(budget.used).toBe(1);
  });

  it('lets a joined caller ask again when the deadline of the starter cut the request short', async () => {
    const gate = new GatedOrigin();
    const rig = makeRig({ hosts: HOSTS, fetchImpl: gate.fetch });
    // 40 ms left: the transport's own timer fires, for want of the starter's time.
    const first = mcpError(
      rig.http.get({ url: DOC, expect: 'html', budget: newBudget(12, 40, rig.clock) }),
    );
    const second = rig.http.get({ url: DOC, expect: 'html' });
    expect(declinedBy(await first)).toBe('budget');

    await gate.reached();
    gate.answer(page(PAGE));
    expect((await second).text).toBe(PAGE);
    expect(rig.http.hostStates()).toEqual([{ host: HOST, breaker: 'closed' }]);
  });

  it('does not ask again for a caller that has itself cancelled or run out of budget', async () => {
    const gate = new GatedOrigin();
    const rig = makeRig({ hosts: HOSTS, fetchImpl: gate.fetch });
    const starter = new AbortController();
    const joiner = new AbortController();

    const first = mcpError(rig.http.get({ url: DOC, expect: 'html', signal: starter.signal }));
    const second = mcpError(rig.http.get({ url: DOC, expect: 'html', signal: joiner.signal }));
    const third = mcpError(
      rig.http.get({ url: DOC, expect: 'html', budget: newBudget(0, 25_000, rig.clock) }),
    );
    await gate.reached();
    joiner.abort();
    starter.abort();
    for (const error of [await first, await second, await third]) {
      expect(declinedBy(error)).toBe('cancelled');
    }
    expect(gate.urls).toEqual([DOC]);
  });

  it('shares what the host said with every caller: a failure of the host is not asked again', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, status(404));
    const errors = await Promise.all(
      [1, 2, 3].map(() => mcpError(rig.http.get({ url: DOC, expect: 'html' }))),
    );
    expect(errors.map((error) => error.code)).toEqual(Array(3).fill('DOC_NOT_FOUND'));
    expect(rig.origin.calls).toHaveLength(1);
  });
});

describe('Flights', () => {
  const never = () => new Promise<string>(() => undefined);

  it('runs one load per key at a time', async () => {
    const flights = new Flights<string>();
    let loads = 0;
    const load = async () => {
      loads += 1;
      await Promise.resolve();
      return 'value';
    };
    expect(
      await Promise.all([flights.run('k', load, () => true), flights.run('k', load, () => true)]),
    ).toEqual(['value', 'value']);
    expect(loads).toBe(1);
    expect(await flights.run('k', load, () => true)).toBe('value');
    expect(loads).toBe(2);
  });

  it('passes on the failure of the caller that started the flight, to that caller', async () => {
    const flights = new Flights<string>();
    const failure = declined('https://x.example.com/', 'budget');
    let loads = 0;
    const load = () => {
      loads += 1;
      return Promise.reject(failure);
    };
    expect(await rejection(flights.run('k', load, () => true))).toBe(failure);
    expect(loads).toBe(1);
  });

  it('gives up after a few flights of other callers', async () => {
    const flights = new Flights<string>();
    const failure = declined('https://x.example.com/', 'cancelled');
    let started = 0;
    // Each time the joiner comes back, another caller has just started a doomed flight.
    const startDoomed = (): void => {
      started += 1;
      void flights
        .run(
          'k',
          () => Promise.reject(failure),
          () => true,
        )
        .catch(() => undefined);
    };
    startDoomed();
    const joined = rejection(
      flights.run('k', never, () => {
        startDoomed();
        return true;
      }),
    );
    expect(await joined).toBe(failure);
    expect(started).toBe(4);
  });

  it("shares a failure that was not the starter's own", async () => {
    const flights = new Flights<string>();
    const failure = unavailable('https://x.example.com/', 'HTTP 503');
    const first = rejection(
      flights.run(
        'k',
        () => Promise.reject(failure),
        () => true,
      ),
    );
    const second = rejection(flights.run('k', never, () => true));
    expect(await first).toBe(failure);
    expect(await second).toBe(failure);
  });
});
