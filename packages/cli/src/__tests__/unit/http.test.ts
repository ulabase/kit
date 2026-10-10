import { describe, it, expect, vi, afterEach } from 'vitest';
import { request, retryAfterSeconds } from '../../http.js';

describe('request on a rate limit', () => {
  afterEach(() => vi.useRealTimers());

  it('waits the Retry-After seconds and tries again', async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const answers = [
      new Response(JSON.stringify({ error: 'Rate limit of 150 requests/min of the free plan exceeded' }), {
        status: 429,
        headers: { 'Retry-After': '2' },
      }),
      new Response('{}', { status: 200 }),
    ];
    const transport = vi.fn(async () => answers.shift()!);

    const pending = request('https://x.test', '/orders', {}, transport);
    await vi.advanceTimersByTimeAsync(2000);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('gives up after three retries with the 429 as the error', async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const transport = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { 'Retry-After': '1' } })
    );

    const pending = request('https://x.test', '/orders', {}, transport).catch(e => e);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toEqual({ status: 429, message: 'Rate limit exceeded' });
    expect(transport).toHaveBeenCalledTimes(4);
  });
});

describe('retryAfterSeconds', () => {
  it('reads the header, and falls back to a minute', () => {
    expect(retryAfterSeconds('60')).toBe(60);
    expect(retryAfterSeconds(null)).toBe(60);
    expect(retryAfterSeconds('soon')).toBe(60);
    expect(retryAfterSeconds('900')).toBe(120);
  });
});
