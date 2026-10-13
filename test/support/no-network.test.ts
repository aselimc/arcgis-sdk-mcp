import { describe, expect, it, vi } from 'vitest';
import { guardFetch } from './no-network.js';

describe('network guard', () => {
  it('is installed for unit tests: a real host is rejected by name', async () => {
    await expect(fetch('https://developers.arcgis.com/widgets/')).rejects.toThrow(
      /Network access is not allowed in unit tests: fetch\(https:\/\/developers\.arcgis\.com\/widgets\/\)/,
    );
  });

  it('rejects every input form and relative URLs', async () => {
    const original = vi.fn<typeof fetch>();
    const guarded = guardFetch(original);
    await expect(guarded(new URL('https://doc.esri.com/en/x/'))).rejects.toThrow(/doc\.esri\.com/);
    await expect(guarded(new Request('https://pypi.org/pypi/arcgis/json'))).rejects.toThrow(
      /pypi\.org/,
    );
    await expect(guarded('/relative')).rejects.toThrow(/not allowed/);
    expect(original).not.toHaveBeenCalled();
  });

  it('passes loopback requests through unchanged', async () => {
    const response = new Response('ok');
    const original = vi.fn<typeof fetch>(async () => response);
    const guarded = guardFetch(original);
    const init = { method: 'POST' };
    await expect(guarded('http://127.0.0.1:3333/mcp', init)).resolves.toBe(response);
    await expect(guarded('http://localhost:3333/healthz')).resolves.toBe(response);
    await expect(guarded(new URL('http://[::1]:3333/mcp'))).resolves.toBe(response);
    expect(original).toHaveBeenCalledTimes(3);
    expect(original).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3333/mcp', init);
  });
});
