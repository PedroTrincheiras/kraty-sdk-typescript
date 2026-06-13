import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemorySecretStore,
  Kraty,
  KratyApiError,
  KratyClient,
  LocalStorageSecretStore,
  lobbyFilledSlots,
} from './index.js';

/**
 * Covers the per-player auth + new resource clients added for parity
 * with the Flutter / Unity SDKs: X-Player-Secret header injection,
 * PlayersClient.register, Kraty.connectAsPlayer (happy + already-
 * registered rotation), Inventory + Wallet + collectAll, EntryCost
 * decoding, Lobby botSlots projection.
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

const baseOpts = (
  fetchImpl: typeof fetch,
  playerSecret?: string,
  activeExternalPlayerId: string | undefined = playerSecret ? 'alice' : undefined,
) => ({
  apiKey: 'pUUVdrM8.djr4-0Iv9h1JvVNSMZNDmSsSN7lSVq2F9dG6DG4A5uQ',
  baseUrl: 'https://api.test.kraty.io',
  fetch: fetchImpl,
  playerSecret,
  activeExternalPlayerId,
  generateIdempotencyKey: deterministicKey,
  retry: { attempts: 2, initialDelayMs: 1, maxDelayMs: 5, jitter: 0 },
  timeoutMs: 1_000,
});

describe('X-Player-Secret header injection', () => {
  it('attaches x-player-secret when configured', async () => {
    const { fetch, calls } = makeFetch([() => jsonRes(200, { data: [] })]);
    const c = new KratyClient(baseOpts(fetch, 'abc123'));
    await c.request('GET', '/sdk/v1/players/alice/pending-grants');
    expect(calls[0]?.headers['x-player-secret']).toBe('abc123');
  });

  it('does not attach x-player-secret when not configured', async () => {
    const { fetch, calls } = makeFetch([() => jsonRes(200, { data: [] })]);
    const c = new KratyClient(baseOpts(fetch));
    await c.request('GET', '/sdk/v1/players/alice/pending-grants');
    expect(calls[0]?.headers['x-player-secret']).toBeUndefined();
  });
});

describe('PlayersClient', () => {
  it('register returns the minted secret', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(201, {
          data: {
            playerId: 'p1',
            externalPlayerId: 'alice',
            secret: 's3cret',
            secretPrefix: 'abcd',
            registeredAt: '2026-01-01T00:00:00Z',
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const reg = await k.players.register('alice');
    expect(reg.secret).toBe('s3cret');
    expect(reg.externalPlayerId).toBe('alice');
    expect(calls[0]?.url).toContain('/sdk/v1/players/alice/register');
    expect(calls[0]?.url).not.toContain('force=true');
  });

  it('register with force appends ?force=true', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(201, {
          data: { playerId: 'p1', externalPlayerId: 'alice', secret: 'new-s' },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    await k.players.register('alice', { force: true });
    expect(calls[0]?.url).toContain('?force=true');
  });

  it('register surfaces 409 with isPlayerAlreadyRegistered', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(409, {
          error: { code: 'player_already_registered', message: 'already there' },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    try {
      await k.players.register('alice');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(KratyApiError);
      expect((err as KratyApiError).isPlayerAlreadyRegistered).toBe(true);
    }
  });
});

describe('Kraty.connectAsPlayer', () => {
  it('skips register when secret already stored', async () => {
    const { fetch, calls } = makeFetch([
      () => jsonRes(200, { data: [] }),
    ]);
    const store = new InMemorySecretStore();
    await store.write('alice', 'cached-secret');
    const k = await Kraty.connectAsPlayer({
      options: baseOpts(fetch),
      externalPlayerId: 'alice',
      secretStore: store,
    });
    // No HTTP yet — but the secret should be wired in.
    expect(calls).toHaveLength(0);
    await k.grants.listPending();
    expect(calls[0]?.headers['x-player-secret']).toBe('cached-secret');
  });

  it('registers and persists on empty store', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(201, {
          data: { playerId: 'p1', externalPlayerId: 'bob', secret: 'fresh-secret' },
        }),
    ]);
    const store = new InMemorySecretStore();
    await Kraty.connectAsPlayer({
      options: baseOpts(fetch),
      externalPlayerId: 'bob',
      secretStore: store,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/sdk/v1/players/bob/register');
    expect(await store.read('bob')).toBe('fresh-secret');
  });

  it('auto-rotates on already-registered by default', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(409, {
          error: { code: 'player_already_registered', message: 'already there' },
        }),
      () =>
        jsonRes(201, {
          data: { playerId: 'p1', externalPlayerId: 'carol', secret: 'rotated' },
        }),
    ]);
    const store = new InMemorySecretStore();
    await Kraty.connectAsPlayer({
      options: baseOpts(fetch),
      externalPlayerId: 'carol',
      secretStore: store,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).not.toContain('force=true');
    expect(calls[1]?.url).toContain('force=true');
    expect(await store.read('carol')).toBe('rotated');
  });

  it('surfaces conflict when autoRotateOnConflict=false', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(409, {
          error: { code: 'player_already_registered', message: 'already there' },
        }),
    ]);
    const store = new InMemorySecretStore();
    try {
      await Kraty.connectAsPlayer({
        options: baseOpts(fetch),
        externalPlayerId: 'dave',
        secretStore: store,
        autoRotateOnConflict: false,
      });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(KratyApiError);
      expect((err as KratyApiError).isPlayerAlreadyRegistered).toBe(true);
    }
    expect(await store.read('dave')).toBeNull();
  });
});

describe('InventoryClient', () => {
  it('list unwraps the items array', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            items: [
              {
                itemKey: 'potion_hp',
                quantity: 3,
                metadata: {},
                createdAt: '2026-01-01',
                updatedAt: '2026-01-01',
              },
              {
                itemKey: 'sword_iron',
                quantity: 1,
                metadata: {},
                createdAt: '2026-01-01',
                updatedAt: '2026-01-01',
              },
            ],
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch, 'ps'));
    const items = await k.inventory.list();
    expect(items).toHaveLength(2);
    expect(items[0]?.itemKey).toBe('potion_hp');
    expect(items[0]?.quantity).toBe(3);
  });

  it('consume auto-stamps idempotency key', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(200, {
          data: { itemKey: 'potion_hp', quantity: 2, applied: true },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch, 'ps'));
    const res = await k.inventory.consume('potion_hp', { quantity: 1 });
    expect(res.applied).toBe(true);
    expect(res.quantity).toBe(2);
    expect(calls[0]?.body).toMatchObject({ quantity: 1, idempotencyKey: 'idem-1' });
  });
});

describe('WalletClient', () => {
  it('list unwraps the wallet array', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            wallet: [
              {
                economyKey: 'gold',
                balance: 150,
                metadata: {},
                createdAt: '2026-01-01',
                updatedAt: '2026-01-01',
              },
            ],
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch, 'ps'));
    const wallet = await k.wallet.list();
    expect(wallet).toHaveLength(1);
    expect(wallet[0]?.economyKey).toBe('gold');
    expect(wallet[0]?.balance).toBe(150);
  });

  it('debit passes amount and auto-stamps key', async () => {
    const { fetch, calls } = makeFetch([
      () =>
        jsonRes(200, {
          data: { economyKey: 'gold', balance: 50, applied: true },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch, 'ps'));
    const res = await k.wallet.debit('gold', { amount: 100 });
    expect(res.balance).toBe(50);
    expect(calls[0]?.body).toMatchObject({ amount: 100, idempotencyKey: 'idem-1' });
  });
});

describe('GrantsClient.collectAll', () => {
  it('opens crates and claims rewards', async () => {
    const { fetch } = makeFetch([
      // listPending
      () =>
        jsonRes(200, {
          data: [
            { id: 'g1', kind: 'reward', contents: {}, sourceKind: 'event', sourceRefId: null, parentGrantId: null, status: 'pending', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' },
            { id: 'g2', kind: 'crate',  contents: {}, sourceKind: 'event', sourceRefId: null, parentGrantId: null, status: 'pending', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' },
            { id: 'g3', kind: 'reward', contents: {}, sourceKind: 'event', sourceRefId: null, parentGrantId: null, status: 'pending', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' },
          ],
        }),
      // claim g1
      () => jsonRes(200, { data: { id: 'g1', kind: 'reward', contents: {}, sourceKind: 'event', sourceRefId: null, parentGrantId: null, status: 'claimed', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' } }),
      // open g2
      () => jsonRes(200, { data: {
        crate:    { id: 'g2', kind: 'crate',  contents: {}, sourceKind: 'event', sourceRefId: null, parentGrantId: null, status: 'claimed', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' },
        contents: { id: 'g2c', kind: 'reward', contents: {}, sourceKind: 'crate', sourceRefId: null, parentGrantId: null, status: 'pending', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' },
      } }),
      // claim g3
      () => jsonRes(200, { data: { id: 'g3', kind: 'reward', contents: {}, sourceKind: 'event', sourceRefId: null, parentGrantId: null, status: 'claimed', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' } }),
    ]);
    const k = new Kraty(baseOpts(fetch, 'ps'));
    const result = await k.grants.collectAll();
    expect(result.processed).toBe(3);
    expect(result.opened).toHaveLength(1);
    expect(result.claimed).toHaveLength(2);
    expect(result.hasFailures).toBe(false);
  });

  it('captures per-grant failures without aborting the sweep', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(200, {
          data: [
            { id: 'g1', kind: 'reward', contents: {}, sourceKind: 'event', sourceRefId: null, parentGrantId: null, status: 'pending', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' },
            { id: 'g2', kind: 'reward', contents: {}, sourceKind: 'event', sourceRefId: null, parentGrantId: null, status: 'pending', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' },
          ],
        }),
      () => jsonRes(404, { error: { code: 'not_found', message: 'g1 expired' } }),
      () => jsonRes(200, { data: { id: 'g2', kind: 'reward', contents: {}, sourceKind: 'event', sourceRefId: null, parentGrantId: null, status: 'claimed', rolledAt: null, claimedAt: null, expiresAt: null, createdAt: '2026-01-01' } }),
    ]);
    const k = new Kraty(baseOpts(fetch, 'ps'));
    const result = await k.grants.collectAll();
    expect(result.processed).toBe(2);
    expect(result.claimed).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.grant.id).toBe('g1');
    expect(result.failures[0]?.error).toBeInstanceOf(KratyApiError);
  });
});

describe('typed error helpers', () => {
  it('isInsufficientEntryCost fires for 402', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(402, {
          error: {
            code: 'insufficient_entry_cost',
            message: 'need 50 gold',
            details: { resource: 'gold' },
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch, 'ps'));
    try {
      await k.events.start('race', undefined, { as: 'alice' });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(KratyApiError);
      const apiErr = err as KratyApiError;
      expect(apiErr.isInsufficientEntryCost).toBe(true);
      expect(apiErr.isLobbyForming).toBe(false);
      expect(apiErr.isPlayerSecretInvalid).toBe(false);
    }
  });
});

describe('EventListing + EntryCost', () => {
  it('decodes entryCost and leaderboardMode', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(200, {
          data: [
            {
              eventKey: 'bounty_hunt',
              name: 'Bounty Hunt',
              windowId: 'w1',
              startsAt: '2026-01-01',
              endsAt: '2026-01-02',
              leaderboardId: 'lb1',
              currentAttemptId: null,
              type: 'single_metric',
              leaderboardMode: 'lobby_matched',
              metrics: [{ key: 'score', target: 1000 }],
              entryRequirement: null,
              entryCost: { currencies: [{ key: 'gold', amount: 50 }], items: [] },
            },
          ],
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const events = await k.events.listForPlayer({ as: 'alice' });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventKey).toBe('bounty_hunt');
    expect(events[0]?.leaderboardMode).toBe('lobby_matched');
    expect(events[0]?.entryCost?.currencies?.[0]).toEqual({ key: 'gold', amount: 50 });
  });
});

describe('Lobby botSlots + filledSlots', () => {
  it('decodes botSlots and computes filledSlots helper', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(200, {
          data: {
            id: 'lob1',
            eventId: 'e1',
            eventWindowId: 'w1',
            leaderboardId: 'lb1',
            mode: 'lobby_matched',
            status: 'forming',
            capacity: 4,
            fillBy: '2026-01-01T00:00:30Z',
            participantCount: 1,
            botSlots: 2,
            startedAt: null,
            endsAt: null,
          },
        }),
    ]);
    const k = new Kraty(baseOpts(fetch));
    const lobby = await k.lobbies.read('lob1');
    expect(lobby.participantCount).toBe(1);
    expect(lobby.botSlots).toBe(2);
    expect(lobbyFilledSlots(lobby)).toBe(3);
  });

  it('lobbyFilledSlots caps at capacity', () => {
    expect(
      lobbyFilledSlots({
        id: 'l',
        eventId: 'e',
        eventWindowId: 'w',
        leaderboardId: 'lb',
        mode: 'lobby_matched',
        status: 'active',
        capacity: 4,
        fillBy: null,
        participantCount: 3,
        botSlots: 5,
        startedAt: null,
        endsAt: null,
      }),
    ).toBe(4);
  });
});

describe('SecretStore implementations', () => {
  it('InMemorySecretStore reads, writes, and removes', async () => {
    const store = new InMemorySecretStore();
    expect(await store.read('alice')).toBeNull();
    await store.write('alice', 's1');
    expect(await store.read('alice')).toBe('s1');
    await store.write('alice', 's2');
    expect(await store.read('alice')).toBe('s2');
    await store.remove('alice');
    expect(await store.read('alice')).toBeNull();
  });

  it('LocalStorageSecretStore works with an injected store', async () => {
    const backing = new Map<string, string>();
    const fake = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const store = new LocalStorageSecretStore(fake);
    expect(await store.read('alice')).toBeNull();
    await store.write('alice', 'persisted');
    expect(backing.get('kraty.playerSecret.alice')).toBe('persisted');
    expect(await store.read('alice')).toBe('persisted');
    await store.remove('alice');
    expect(await store.read('alice')).toBeNull();
  });
});

describe('Active player id default (Option B ergonomics)', () => {
  it('grants.listPending uses the active player id when called bare', async () => {
    const { fetch, calls } = makeFetch([() => jsonRes(200, { data: [] })]);
    const k = new Kraty({
      apiKey: 'pUUVdrM8.djr4-0Iv9h1JvVNSMZNDmSsSN7lSVq2F9dG6DG4A5uQ',
      baseUrl: 'https://api.test.kraty.io',
      fetch,
      playerSecret: 'ps',
      activeExternalPlayerId: 'alice',
      generateIdempotencyKey: deterministicKey,
      retry: { attempts: 1, initialDelayMs: 1, maxDelayMs: 5, jitter: 0 },
    });
    await k.grants.listPending();
    // The URL must encode the ACTIVE id, not require the caller to
    // pass one — that's the entire point of this design.
    expect(calls[0]?.url).toContain('/players/alice/pending-grants');
  });

  it('auto-registers a fresh player on the first bare call (no SecretStore plumbed)', async () => {
    // The contract: `new Kraty({apiKey})` is enough. The very
    // first player-scoped call lazily mints an id + secret + a
    // persisted session. Subsequent calls reuse it from the
    // in-memory store (no localStorage in this test runtime).
    const { fetch, calls } = makeFetch([
      () => jsonRes(201, { data: { secret: 'auto-secret' } }),
      () => jsonRes(200, { data: [] }),
    ]);
    const k = new Kraty({
      apiKey: 'pUUVdrM8.djr4-0Iv9h1JvVNSMZNDmSsSN7lSVq2F9dG6DG4A5uQ',
      baseUrl: 'https://api.test.kraty.io',
      fetch,
      generateIdempotencyKey: deterministicKey,
      retry: { attempts: 1, initialDelayMs: 1, maxDelayMs: 5, jitter: 0 },
    });
    await k.grants.listPending();
    // First call hits the lazy-register endpoint with a fresh
    // SDK-generated id.
    expect(calls[0]?.url).toMatch(
      /\/sdk\/v1\/players\/kp_[A-Za-z0-9_-]+\/register$/,
    );
    // Second call reuses the freshly minted id — no second
    // register, no plumbing through user code.
    expect(calls[1]?.url).toMatch(
      /\/sdk\/v1\/players\/kp_[A-Za-z0-9_-]+\/pending-grants$/,
    );
    expect(k.activeExternalPlayerId).toMatch(/^kp_/);
  });

  it('opts.as overrides the active player id', async () => {
    const { fetch, calls } = makeFetch([() => jsonRes(200, { data: [] })]);
    const k = new Kraty({
      apiKey: 'pUUVdrM8.djr4-0Iv9h1JvVNSMZNDmSsSN7lSVq2F9dG6DG4A5uQ',
      baseUrl: 'https://api.test.kraty.io',
      fetch,
      playerSecret: 'ps',
      activeExternalPlayerId: 'alice',
      generateIdempotencyKey: deterministicKey,
      retry: { attempts: 1, initialDelayMs: 1, maxDelayMs: 5, jitter: 0 },
    });
    await k.grants.listPending({ as: 'bob' });
    expect(calls[0]?.url).toContain('/players/bob/pending-grants');
  });

  it('connectAsPlayer seeds activeExternalPlayerId on the returned Kraty', async () => {
    const { fetch } = makeFetch([
      () =>
        jsonRes(201, {
          data: {
            playerId: 'plr1',
            externalPlayerId: 'eve',
            secret: 'new-secret',
            createdAt: '2026-01-01',
          },
        }),
    ]);
    const store = new InMemorySecretStore();
    const k = await Kraty.connectAsPlayer({
      options: {
        apiKey: 'pUUVdrM8.djr4-0Iv9h1JvVNSMZNDmSsSN7lSVq2F9dG6DG4A5uQ',
        baseUrl: 'https://api.test.kraty.io',
        fetch,
        generateIdempotencyKey: deterministicKey,
        retry: { attempts: 1, initialDelayMs: 1, maxDelayMs: 5, jitter: 0 },
      },
      externalPlayerId: 'eve',
      secretStore: store,
    });
    expect(k.client.activeExternalPlayerId).toBe('eve');
    expect(k.client.playerSecret).toBe('new-secret');
  });
});
