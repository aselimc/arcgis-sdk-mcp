/**
 * One HTTP exchange over the built-in `fetch`: manual redirects, a timeout that also covers
 * the body, and a size cap enforced while the body streams in. No policy, cache or retry
 * logic lives here; the gateway (`http-client.ts`) decides what to do with the outcome.
 */

import type { ReadableStreamDefaultReader } from 'node:stream/web';

/** What the gateway asks the transport to send. */
export interface TransportRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string | undefined;
  timeoutMs: number;
  /** Largest body accepted, in bytes after content decoding. */
  maxBytes: number;
  /** The caller's own cancellation signal. */
  signal?: AbortSignal | undefined;
}

/** A completed exchange. `body` is empty for every status outside 2xx. */
export interface TransportResponse {
  status: number;
  headers: Headers;
  body: Buffer;
}

/** Why an exchange produced no response. */
export type TransportFailure = 'timeout' | 'network' | 'oversized' | 'aborted';

/** The only error {@link send} rejects with. */
export class TransportError extends Error {
  override readonly name = 'TransportError';

  constructor(
    readonly kind: TransportFailure,
    message: string,
  ) {
    super(message);
  }
}

function classify(error: unknown, callerSignal: AbortSignal | undefined): TransportError {
  if (error instanceof TransportError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'TimeoutError') return new TransportError('timeout', 'timeout');
  if (name === 'AbortError') {
    // Our own timeout can also surface as AbortError when it fires during the body read.
    return callerSignal?.aborted === true
      ? new TransportError('aborted', 'cancelled by the caller')
      : new TransportError('timeout', 'timeout');
  }
  return new TransportError('network', `network error: ${message}`);
}

/**
 * Abandons a body without waiting: cancellation only settles once the stream has let go,
 * which a stalled peer (or a second reader of the same stream) can delay indefinitely.
 */
function discard(body: { cancel(): Promise<void> } | null): void {
  body?.cancel().catch(() => undefined);
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    discard(response.body);
    throw new TransportError('oversized', `body of ${declared} bytes exceeds ${maxBytes}`);
  }
  if (response.body === null) return Buffer.alloc(0);

  // The cast names the chunk type: the built-in stream typings leave it open.
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      // Stop the download: the rest of an oversized body is of no use to anyone.
      discard(reader);
      throw new TransportError('oversized', `body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Sends one request and reads the body of a 2xx answer. Redirects are returned, not followed:
 * every hop has to pass the source policy first.
 *
 * @throws TransportError and nothing else.
 */
export async function send(
  fetchImpl: typeof fetch,
  request: TransportRequest,
): Promise<TransportResponse> {
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal =
    request.signal === undefined ? timeout : AbortSignal.any([timeout, request.signal]);
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
      signal,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    if (response.status < 200 || response.status > 299) {
      // Release the connection; only the status and headers of these answers matter.
      discard(response.body);
      return { status: response.status, headers: response.headers, body: Buffer.alloc(0) };
    }
    const body = await readCapped(response, request.maxBytes);
    return { status: response.status, headers: response.headers, body };
  } catch (error) {
    throw classify(error, request.signal);
  }
}
