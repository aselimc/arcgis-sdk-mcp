import { describe, expect, it } from 'vitest';
import { TransportError, send, type TransportRequest } from '../../src/net/fetch-transport.js';
import { rejection } from './harness.js';

const REQUEST: TransportRequest = {
  url: 'https://docs.example.com/page',
  method: 'GET',
  headers: { accept: 'text/html' },
  timeoutMs: 5000,
  maxBytes: 1024,
};

async function failure(promise: Promise<unknown>): Promise<TransportError> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(TransportError);
  return error as TransportError;
}

/** A `fetch` that never answers until its signal fires, like a stalled connection. */
const hang: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });

describe('send', () => {
  it('passes the request on with manual redirects and returns status, headers and body', async () => {
    let seen: RequestInit | undefined;
    const res = await send(
      async (_input, init) => {
        seen = init;
        return new Response('hello', { status: 200, headers: { etag: '"1"' } });
      },
      { ...REQUEST, method: 'POST', body: '{"q":1}' },
    );
    expect(seen).toMatchObject({ method: 'POST', redirect: 'manual', body: '{"q":1}' });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"1"');
    expect(res.body.toString('utf8')).toBe('hello');
  });

  it('sends no body for a GET', async () => {
    let seen: RequestInit | undefined;
    await send(async (_input, init) => {
      seen = init;
      return new Response('x');
    }, REQUEST);
    expect(seen !== undefined && 'body' in seen).toBe(false);
  });

  it('returns a redirect as it is, without its body', async () => {
    const res = await send(
      async () => new Response('moved', { status: 301, headers: { location: '/next' } }),
      REQUEST,
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/next');
    expect(res.body.byteLength).toBe(0);
  });

  it('returns an empty body for a response without one', async () => {
    const res = await send(async () => new Response(null, { status: 204 }), REQUEST);
    expect(res.body.byteLength).toBe(0);
  });

  it('joins a body that arrives in several chunks', async () => {
    const chunks = ['<p>one</p>', '<p>two</p>', '<p>three</p>'];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(new TextEncoder().encode(next));
      },
    });
    const res = await send(async () => new Response(stream), REQUEST);
    expect(res.body.toString('utf8')).toBe('<p>one</p><p>two</p><p>three</p>');
  });

  it('accepts a body of exactly the cap and refuses one byte more', async () => {
    const exact = await send(async () => new Response('x'.repeat(1024)), REQUEST);
    expect(exact.body.byteLength).toBe(1024);
    const over = await failure(send(async () => new Response('x'.repeat(1025)), REQUEST));
    expect(over.kind).toBe('oversized');
  });

  it('refuses on the declared Content-Length alone', async () => {
    // The body itself is tiny: only the header can have caused the refusal.
    const error = await failure(
      send(async () => new Response('ok', { headers: { 'content-length': '99999' } }), REQUEST),
    );
    expect(error.kind).toBe('oversized');
    expect(error.message).toContain('99999');
  });

  it('times out a request that never answers', async () => {
    const error = await failure(send(hang, { ...REQUEST, timeoutMs: 20 }));
    expect(error.kind).toBe('timeout');
  });

  it('times out a body that stalls after the headers', async () => {
    const stalled: typeof fetch = async (_input, init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('<p>start'));
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('aborted', 'AbortError'));
            });
          },
        }),
      );
    const error = await failure(send(stalled, { ...REQUEST, timeoutMs: 20 }));
    expect(error.kind).toBe('timeout');
  });

  it('reports the caller cancelling as aborted, not as a timeout', async () => {
    const controller = new AbortController();
    const pending = failure(send(hang, { ...REQUEST, signal: controller.signal }));
    controller.abort();
    expect((await pending).kind).toBe('aborted');
  });

  it('classifies everything else as a network error', async () => {
    const refusedConnection = await failure(
      send(async () => {
        throw new TypeError('fetch failed');
      }, REQUEST),
    );
    expect(refusedConnection.kind).toBe('network');
    expect(refusedConnection.message).toBe('network error: fetch failed');

    const odd = await failure(send(() => Promise.reject(new Error('socket hang up')), REQUEST));
    expect(odd.kind).toBe('network');
  });
});
