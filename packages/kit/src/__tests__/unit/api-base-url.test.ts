import { describe, expect, it } from 'vitest';
import { isValidApiBaseUrl } from '../../index';

describe('isValidApiBaseUrl', () => {
  it('accepts any https service URL, on every platform domain and on-prem', () => {
    expect(isValidApiBaseUrl('https://c0ffee.eu-central-1-free-1.restheart.com')).toBe(true);
    expect(isValidApiBaseUrl('https://100f07.ulabase.app')).toBe(true);
    expect(isValidApiBaseUrl('https://2000c9.nodes.ulabase.dev')).toBe(true);
    expect(isValidApiBaseUrl('https://api.acme.co.uk')).toBe(true);
  });

  it('accepts http only on local host names, and on the legacy integration environment', () => {
    expect(isValidApiBaseUrl('http://localhost:8080')).toBe(true);
    expect(isValidApiBaseUrl('http://c0ffee.localhost:8080')).toBe(true);
    expect(isValidApiBaseUrl('http://c0ffee.ulabase.local:8080')).toBe(true);
    expect(isValidApiBaseUrl('http://api.acme.test')).toBe(true);
    expect(isValidApiBaseUrl('http://ea820b.eu-central-1-it-free-1.restheart.com:8081')).toBe(true);
    expect(isValidApiBaseUrl('http://100f07.ulabase.app')).toBe(false);
    expect(isValidApiBaseUrl('http://api.acme.it')).toBe(false);
  });

  it('rejects what is not an http(s) URL', () => {
    expect(isValidApiBaseUrl('not a url')).toBe(false);
    expect(isValidApiBaseUrl('ftp://c0ffee.restheart.com')).toBe(false);
    expect(isValidApiBaseUrl('')).toBe(false);
  });
});
