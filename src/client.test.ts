import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kraty, KratyApiError, KratyClient, KratyNetworkError, isLobbyForming } from './index.js';

/**
 * The tests run against a `fetchSpy` that records every call and
 * returns whatever the test sets up. No real network IO. Idempotency
 * keys are stamped from a deterministic counter so assertions don't
 * depend on UUID format.
 */

interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetch(responses: Array<() => Response | Promise<Response>>) {
  const calls: FakeCall[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const factory = responses[i++];
    if (!factory) throw new Error(`fake fetch exhausted; got call ${i}`);
    return await factory();
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

let keyCounter = 0;
const deterministicKey = (): string => `idem-${++keyCounter}`;

beforeEach(() => {
  keyCounter = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseOpts = (fetchImpl: typeof fetch) => ({
  apiKey: 'pUUVdrM8.djr4-0Iv9h1JvVNSMZNDmSsSN7lSVq2F9dG6DG4A5uQ',
  baseUrl: 'https://api.test.kraty.io',
  fetch: fetchImpl,
  generateIdempotencyKey: deterministicKey,
  retry: { attempts: 3, initialDelayMs: 1, maxDelayMs: 5, jitter: 0 },
  timeoutMs: 1_000,
});

describe('KratyClient — request layer', () => {
  it('sends Authorization: Bearer <key>', async () => {
    const { fetch, calls } = makeFetch([() => jsonRes(200, { ok: true })]);
    const c = new KratyClient(baseOpts(fetch));
    await c.request<{ ok: boolean }>('GET', '/sdk/v1/ping');
    expect(calls[0]?.headers['authorization']).toBe(
      'Bearer pUUVdrM8.djr4-0Iv9h1JvVNSMZNDmSsSN7lSVq2F9dG6DG4A5uQ',
    );
  });

  it('stamps an idempotencyKey on POST/PUT/PATCH when the body has none', async () => {
    const { fetch, calls } = makeFetch([() => jsonRes(201, { data: { id: 'x' } })]);
    const c = new KratyClient(baseOpts(fetch));
    await c.request('POST', '/sdk/v1/foo', { x: 1 });
    expect(calls[0]?.body).toEqual({ x: 1, idempotencyKey: 'idem-1' });
  });

  it('does NOT stamp an idempotencyKey on GET', async () => {
    const { fetch, calls } = makeFetch([() => jsonRes(200, { data: [] })]);
    const c = new KratyClient(baseOpts(fetch));
    await c.request('GET', '/sdk/v1/foo');
    expect(calls[0]?.body).toBeUndefined();
  });

  it('preserves a caller-supplied idempotencyKey in the body', async () => {
    const { fetch, calls } = makeFetch([() => jsonRes(201, { data: {} })]);
    const c = new KratyClient(baseOpts(fetch));
    await c.request('POST', '/sdk/v1/foo', { idempotencyKey: 'caller-chose-me' });
    expect(calls[0]?.body).toEqual({ idempotencyKey: 'caller-chose-me' });
    // Auto-generator should not have been bumped.
    expect(keyCounter).toBe(0);
  });

  it('throws KratyApiError shaped from { error: { code, message } } on non-2xx', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(404, {
          error: { code: 'not_found', message: 'leaderboard not found' },
        }),
    ]);
    const c = new KratyClient(baseOpts(fetch));
    await expect(c.request('GET', '/sdk/v1/leaderboards/missing')).rejects.toMatchObject({
      name: 'KratyApiError',
      status: 404,
      code: 'not_found',
    });
  });

  it('retries on 503 and succeeds on the second attempt', async () => {
    const { fetch, calls } = makeFetch([
      () => new Response('', { status: 503 }),
      () => jsonRes(200, { data: { ok: true } }),
    ]);
    const c = new KratyClient(baseOpts(fetch));
    const out = await c.request<{ data: { ok: boolean } }>('GET', '/sdk/v1/ping');
    expect(out.data.ok).toBe(true);
    expect(calls.length).toBe(2);
  });

  it('preserves the SAME idempotencyKey across retries', async () => {
    const { fetch, calls } = makeFetch([
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 503 }),
      () => jsonRes(201, { data: {} }),
    ]);
    const c = new KratyClient(baseOpts(fetch));
    await c.request('POST', '/sdk/v1/foo', { x: 1 });
    expect(calls.length).toBe(3);
    expect(calls.every((c) => (c.body as { idempotencyKey: string }).idempotencyKey === 'idem-1')).toBe(
      true,
    );
    // The auto-gen counter must have only fired once — retries reuse
    // the original key so the server can dedup the replay.
    expect(keyCounter).toBe(1);
  });

  it('gives up after retry.attempts and throws the last error', async () => {
    const { fetch, calls } = makeFetch([
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 503 }),
      () => jsonRes(503, { error: { code: 'internal_error', message: 'still broken' } }),
    ]);
    const c = new KratyClient(baseOpts(fetch));
    await expect(c.request('GET', '/sdk/v1/ping')).rejects.toBeInstanceOf(KratyApiError);
    expect(calls.length).toBe(3);
  });

  it('honors Retry-After on 429', async () => {
    const calls = vi.fn();
    const responses: Array<() => Response> = [
      () => new Response('', { status: 429, headers: { 'retry-after': '0' } }),
      () => jsonRes(200, { data: { ok: true } }),
    ];
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      calls();
      const r = responses[i++];
      if (!r) throw new Error('fetch exhausted');
      return r();
    }) as unknown as typeof fetch;
    const c = new KratyClient(baseOpts(fetchImpl));
    const start = Date.now();
    await c.request('GET', '/sdk/v1/ping');
    // Retry-After=0 should NOT spin forever, but should be fast.
    expect(Date.now() - start).toBeLessThan(500);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx other than 408/425/429', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(404, {
          error: { code: 'not_found', message: 'no such grant' },
        }),
    ]);
    const c = new KratyClient(baseOpts(fetch));
    await expect(c.request('POST', '/sdk/v1/foo', { x: 1 })).rejects.toBeInstanceOf(KratyApiError);
    expect(calls.length).toBe(1);
  });

  it('wraps a fetch crash as KratyNetworkError after retries are exhausted', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const c = new KratyClient({
      ...baseOpts(fetchImpl),
      retry: { attempts: 2, initialDelayMs: 1, maxDelayMs: 2, jitter: 0 },
    });
    await expect(c.request('GET', '/sdk/v1/ping')).rejects.toBeInstanceOf(KratyNetworkError);
  });

  it('exposes onRequest for telemetry hooks', async () => {
    const { fetch } = makeFetch([() => jsonRes(200, { data: {} })]);
    const events: Array<{ status?: number; ok?: boolean }> = [];
    const c = new KratyClient({
      ...baseOpts(fetch),
      onRequest: (i) => events.push({ status: i.status, ok: i.ok }),
    });
    await c.request('GET', '/sdk/v1/ping');
    expect(events).toEqual([{ status: 200, ok: true }]);
  });
});

describe('Kraty facade', () => {
  it('wires the resource clients to the shared KratyClient', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            leaderboardId: 'lb_1',
            mode: 'global',
            finalized: false,
            entries: [],
            self: null,
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const board = await k.eventLeaderboards.read('lb_1', { limit: 10 });
    expect(board.leaderboardId).toBe('lb_1');
    expect(calls[0]?.url).toContain('/sdk/v1/leaderboards/lb_1?limit=10');
  });

  it('lobby_forming surfaces as an isLobbyForming() error', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(202, {
          error: { code: 'lobby_forming', message: "lobby '...' is filling (1/3)" },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    let caught: unknown;
    try {
      await k.events.start('race', {}, { as: 'alice' });
    } catch (err) {
      caught = err;
    }
    expect(isLobbyForming(caught)).toBe(true);
  });

  it('start() includes the playerContext in the request body', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(201, {
          data: {
            attempt: {
              id: 'a1',
              eventId: 'e1',
              eventWindowId: 'w1',
              leaderboardId: 'lb1',
              playerId: 'p1',
              startedAt: '2026-01-01T00:00:00Z',
              endsAt: '2026-01-01T00:10:00Z',
              completedAt: null,
              metrics: {},
              metricsRaw: {},
              score: 0,
              status: 'in_progress',
            },
            leaderboardId: 'lb1',
            windowEndsAt: '2026-01-01T00:10:00Z',
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    await k.events.start('race', { country: 'PT', level: 7 }, { as: 'alice' });
    expect(calls[0]?.body).toMatchObject({
      playerContext: { country: 'PT', level: 7 },
    });
    // POST → idempotencyKey auto-stamped.
    expect((calls[0]?.body as { idempotencyKey: string }).idempotencyKey).toBe('idem-1');
  });

  it('progress() surfaces milestonesFired alongside the attempt', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            attempt: {
              id: 'a1',
              eventId: 'e1',
              eventWindowId: 'w1',
              leaderboardId: 'lb1',
              playerId: 'p1',
              startedAt: '2026-01-01T00:00:00Z',
              endsAt: '2026-01-01T00:10:00Z',
              completedAt: null,
              metrics: { kills: 15 },
              metricsRaw: { kills: 15 },
              score: 15,
              status: 'in_progress',
            },
            milestonesFired: [
              {
                key: 'kills_15',
                grants: [
                  {
                    id: 'g1',
                    kind: 'reward',
                    contents: { entries: [{ type: 'currency', currencyKey: 'gold', amount: 50 }] },
                    sourceKind: 'event_milestone',
                    sourceRefId: 'a1',
                    parentGrantId: null,
                    status: 'pending',
                    rolledAt: '2026-01-01T00:05:00Z',
                    claimedAt: null,
                    expiresAt: null,
                    createdAt: '2026-01-01T00:05:00Z',
                  },
                ],
              },
            ],
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const out = await k.events.progress('race', 'a1', {
      mode: 'set',
      metricValue: 15,
    }, { as: 'alice' });
    expect(out.attempt.id).toBe('a1');
    expect(out.milestonesFired).toHaveLength(1);
    expect(out.milestonesFired[0]?.key).toBe('kills_15');
    expect(out.milestonesFired[0]?.grants[0]?.kind).toBe('reward');
    expect(out.milestonesFired[0]?.grants[0]?.sourceKind).toBe('event_milestone');
  });

  it('progress() returns an empty milestonesFired when nothing fires', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            attempt: {
              id: 'a1',
              eventId: 'e1',
              eventWindowId: 'w1',
              leaderboardId: 'lb1',
              playerId: 'p1',
              startedAt: '2026-01-01T00:00:00Z',
              endsAt: '2026-01-01T00:10:00Z',
              completedAt: null,
              metrics: { kills: 2 },
              metricsRaw: { kills: 2 },
              score: 2,
              status: 'in_progress',
            },
            milestonesFired: [],
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const out = await k.events.progress('race', 'a1', {
      mode: 'increment',
      metricValue: 1,
    }, { as: 'alice' });
    expect(out.milestonesFired).toEqual([]);
  });

  it('eventLeaderboards.read with includeSelf builds the query string', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            leaderboardId: 'lb_self',
            mode: 'global',
            finalized: false,
            entries: [],
            self: { rank: 4, score: 90 },
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const out = await k.eventLeaderboards.read('lb_self', {
      includeSelf: true,
      externalId: 'alice',
      limit: 5,
    });
    expect(out.self).toEqual({ rank: 4, score: 90 });
    expect(calls[0]?.url).toContain('limit=5');
    expect(calls[0]?.url).toContain('includeSelf=true');
    expect(calls[0]?.url).toContain('externalId=alice');
  });

  it('eventLeaderboards.read auto-resolves the active player when includeSelf is set without externalId', async () => {
    // Three calls: (1) lazy register the auto-player, (2) the
    // eventLeaderboards.read with `externalId` filled in from the
    // freshly-minted id, (3) nothing else. The test asserts the
    // SDK no longer demands the dev plumb `externalId` through.
    const { fetch, calls } = makeFetch([
      () => jsonRes(201, { data: { secret: 'shh' } }),
      () =>
        jsonRes(200, {
          data: {
            leaderboardId: 'lb_x',
            mode: 'event',
            finalized: false,
            entries: [],
            self: { rank: 9, score: 1 },
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const out = await k.eventLeaderboards.read('lb_x', { includeSelf: true });
    expect(out.self).toEqual({ rank: 9, score: 1 });
    // Auto-minted id is UUID-shaped with the `kp_` prefix.
    expect(calls[0]?.url).toMatch(/\/sdk\/v1\/players\/kp_[A-Za-z0-9_-]+\/register$/);
    expect(calls[1]?.url).toContain('includeSelf=true');
    expect(calls[1]?.url).toMatch(/externalId=kp_[A-Za-z0-9_-]+/);
  });

  it('leaderboards.read hits the keyed route and decodes the shape', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            key: 'weekly_global',
            sharedLeaderboardId: 'slb_1',
            scope: 'game',
            resetCadence: 'weekly',
            scoreAggregation: 'best',
            segment: null,
            period: '2026-06-22T00:00:00Z',
            entries: [
              { participantId: 'p1', kind: 'player', name: 'alice', avatarUrl: null, score: 42, rank: 1, isSelf: false },
            ],
            self: null,
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const board = await k.leaderboards.read('weekly_global', { limit: 10 });
    expect(board.key).toBe('weekly_global');
    expect(board.sharedLeaderboardId).toBe('slb_1');
    expect(board.resetCadence).toBe('weekly');
    expect(board.entries).toHaveLength(1);
    expect(calls[0]?.url).toContain('/sdk/v1/shared-leaderboards/weekly_global?limit=10');
  });

  it('leaderboards.read passes segment + period + includeSelf in the URL', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            key: 'weekly_region',
            sharedLeaderboardId: 'slb_2',
            scope: 'game',
            resetCadence: 'weekly',
            scoreAggregation: 'best',
            segment: 'eu',
            period: '2026-06-15T00:00:00Z',
            entries: [],
            self: { rank: 7, score: 100 },
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const board = await k.leaderboards.read('weekly_region', {
      limit: 25,
      segment: 'eu',
      period: '2026-06-15T00:00:00Z',
      includeSelf: true,
      externalId: 'alice',
    });
    expect(board.segment).toBe('eu');
    expect(board.self).toEqual({ rank: 7, score: 100 });
    expect(calls[0]?.url).toContain('limit=25');
    expect(calls[0]?.url).toContain('segment=eu');
    expect(calls[0]?.url).toContain('period=2026-06-15T00%3A00%3A00Z');
    expect(calls[0]?.url).toContain('includeSelf=true');
    expect(calls[0]?.url).toContain('externalId=alice');
  });

  it('leaderboards.listPeriods decodes newest-first periods', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            key: 'weekly_global',
            sharedLeaderboardId: 'slb_1',
            currentPeriodStartedAt: '2026-06-22T00:00:00Z',
            periods: [
              { periodStartedAt: '2026-06-15T00:00:00Z', periodEndedAt: '2026-06-22T00:00:00Z' },
              { periodStartedAt: '2026-06-08T00:00:00Z', periodEndedAt: '2026-06-15T00:00:00Z' },
            ],
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const resp = await k.leaderboards.listPeriods('weekly_global', { limit: 5 });
    expect(resp.periods).toHaveLength(2);
    expect(resp.periods[0]?.periodStartedAt).toBe('2026-06-15T00:00:00Z');
    expect(calls[0]?.url).toContain('/sdk/v1/shared-leaderboards/weekly_global/periods?limit=5');
  });
});
