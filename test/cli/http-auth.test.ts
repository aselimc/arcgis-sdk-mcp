import { describe, expect, it } from 'vitest';
import {
  AUTH_REALM,
  LOOPBACK_NAMES,
  allowedHostnames,
  bearerChallenge,
  bracketed,
  checkBearer,
  isWildcardHost,
  missingTokenMessage,
  tokenRequirement,
} from '../../src/cli/http-auth.js';

const TOKEN = '0123456789abcdef0123456789abcdef';

describe('checkBearer', () => {
  it('accepts the exact token with the Bearer scheme in any case', () => {
    expect(checkBearer(`Bearer ${TOKEN}`, TOKEN)).toBe('ok');
    expect(checkBearer(`bearer ${TOKEN}`, TOKEN)).toBe('ok');
    expect(checkBearer(`  BEARER \t${TOKEN}  `, TOKEN)).toBe('ok');
  });

  it('reports a missing header', () => {
    for (const header of [undefined, null, '', '   ']) {
      expect(checkBearer(header, TOKEN)).toBe('missing');
    }
  });

  it('refuses a wrong, truncated, extended or differently cased token', () => {
    for (const presented of [
      'wrong',
      TOKEN.slice(0, -1),
      `${TOKEN}0`,
      TOKEN.toUpperCase(),
      `${TOKEN} extra`,
    ]) {
      expect(checkBearer(`Bearer ${presented}`, TOKEN)).toBe('invalid');
    }
  });

  it('refuses other schemes and a bare token', () => {
    expect(checkBearer(`Basic ${TOKEN}`, TOKEN)).toBe('invalid');
    expect(checkBearer(TOKEN, TOKEN)).toBe('invalid');
    expect(checkBearer('Bearer', TOKEN)).toBe('invalid');
    expect(checkBearer(`Bearer${TOKEN}`, TOKEN)).toBe('invalid');
  });
});

describe('bearerChallenge', () => {
  it('answers a missing token with a plain challenge and a wrong one with invalid_token', () => {
    const missing = bearerChallenge('missing');
    expect(missing.status).toBe(401);
    expect(missing.headers['www-authenticate']).toBe(`Bearer realm="${AUTH_REALM}"`);
    expect(missing.body.error).toMatch(/Authorization: Bearer <token>/);

    const invalid = bearerChallenge('invalid');
    expect(invalid.status).toBe(401);
    expect(invalid.headers['www-authenticate']).toBe(
      `Bearer realm="${AUTH_REALM}", error="invalid_token"`,
    );
    expect(invalid.body.error).not.toContain(TOKEN);
  });
});

describe('tokenRequirement', () => {
  it('requires nothing for a loopback bind on a plain machine', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.1.2.3']) {
      expect(tokenRequirement(host, undefined)).toBeUndefined();
    }
  });

  it('requires a token beyond loopback, on a platform, and for a hosted function', () => {
    expect(tokenRequirement('0.0.0.0', undefined)).toBe('--host 0.0.0.0 is not a loopback address');
    expect(tokenRequirement('192.168.1.20', undefined)).toMatch(/not a loopback address/);
    expect(tokenRequirement('127.0.0.1', 'Vercel')).toBe('it runs on Vercel');
    expect(tokenRequirement(undefined, undefined)).toBe('it runs as a hosted function');
    expect(tokenRequirement(undefined, 'Fly.io')).toBe('it runs on Fly.io');
  });

  it('explains how to fix it', () => {
    const message = missingTokenMessage('it runs on Vercel');
    expect(message).toMatch(/^ARCGIS_DOCS_HTTP_TOKEN is not set and it runs on Vercel\./);
    expect(message).toMatch(/openssl rand -hex 32/);
  });
});

describe('allowedHostnames', () => {
  it('allows loopback names and the extra names for a loopback bind', () => {
    expect(allowedHostnames('127.0.0.1', [])).toEqual([...LOOPBACK_NAMES]);
    expect(allowedHostnames('localhost', ['docs.example.com'])).toEqual([
      ...LOOPBACK_NAMES,
      'docs.example.com',
    ]);
  });

  it('allows the named address of a remote bind', () => {
    expect(allowedHostnames('Docs.Internal', [])).toEqual(['docs.internal', ...LOOPBACK_NAMES]);
    expect(allowedHostnames('fd00::5', [])).toEqual(['[fd00::5]', ...LOOPBACK_NAMES]);
  });

  it('checks nothing for a wildcard bind unless names are configured', () => {
    expect(allowedHostnames('0.0.0.0', [])).toBeUndefined();
    expect(allowedHostnames('::', ['docs.example.com'])).toEqual([
      'docs.example.com',
      ...LOOPBACK_NAMES,
    ]);
  });

  it('allows the deployment names plus loopback for a hosted function', () => {
    expect(allowedHostnames(undefined, ['arcgis-sdk-mcp.vercel.app'])).toEqual([
      'arcgis-sdk-mcp.vercel.app',
      ...LOOPBACK_NAMES,
    ]);
    expect(allowedHostnames(undefined, [])).toEqual([...LOOPBACK_NAMES]);
  });

  it('knows wildcard addresses and brackets IPv6 literals once', () => {
    expect(['0.0.0.0', '::', '[::]'].every(isWildcardHost)).toBe(true);
    expect(isWildcardHost('127.0.0.1')).toBe(false);
    expect(bracketed('::1')).toBe('[::1]');
    expect(bracketed('[::1]')).toBe('[::1]');
    expect(bracketed('example.com')).toBe('example.com');
  });
});
