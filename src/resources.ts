import { KratyClient } from './client.js';
import { KratyApiError } from './errors.js';
import {
  openLeaderboardStream,
  type LeaderboardStream,
  type LeaderboardStreamEvent,
} from './leaderboard-stream.js';
import type {
  Catalog,
  ConsumeItemInput,
  ConsumeItemResult,
  DebitWalletInput,
  DebitWalletResult,
  EventLeaderboard,
  EventLeaderboardReadOptions,
  EventListing,
  Grant,
  Leaderboard,
  LeaderboardPeriods,
  LeaderboardReadOptions,
  LeaderboardScoreResult,
  Lobby,
  OpenCrateResponse,
  PlayerContext,
  PlayerItemHolding,
  PlayerRegistration,
  PlayerWalletHolding,
  ProgressInput,
  ProgressResponse,
  StartAttemptResponse,
} from './types.js';

/** Wrapper helper: every response from the SDK API is `{ data: T }`. */
interface DataEnvelope<T> {
  data: T;
}

/**
 * Resolve which player a resource call should target.
 *
 *   - If the caller passed `as`, that wins (server-side tooling
 *     addressing a different player from a single SDK instance).
 *   - Otherwise the SDK's active identity is used, lazily
 *     creating one if this is the first player-scoped call on a
 *     fresh client. See `KratyClient.ensureIdentity()` for the
 *     three-tier resolution (constructor id → persisted store →
 *     fresh self-serve register).
 *
 * The dev never has to plumb the player id through their code —
 * `kraty.events.start('weekly')` Just Works after `new Kraty(...)`.
 */
async function resolvePlayerId(
  client: KratyClient,
  explicit: string | undefined,
  _methodLabel: string,
): Promise<string> {
  if (explicit) return explicit;
  const identity = await client.ensureIdentity();
  return identity.externalPlayerId;
}

export class EventsClient {
  constructor(private readonly client: KratyClient) {}

  /**
   * GET /sdk/v1/players/:externalId/events — events whose current
   * window the active player can start now. Pass `{ as }` to address
   * a different player (server-side tooling only).
   */
  async listForPlayer(opts: { as?: string } = {}): Promise<EventListing[]> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'events.listForPlayer');
    const env = await this.client.request<DataEnvelope<EventListing[]>>(
      'GET',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/events`,
    );
    return env.data;
  }

  /**
   * POST /sdk/v1/players/:p/events/:e/start — start an attempt for
   * the active player. Atomically debits any configured entry cost;
   * on insufficient resources throws `KratyApiError` with
   * `isInsufficientEntryCost` true (the debit is rolled back —
   * partial spends never persist).
   *
   * If matchmaking is still forming, throws with `isLobbyForming`
   * true; poll the lobby endpoint and retry start.
   */
  async start(
    eventKey: string,
    playerContext?: PlayerContext,
    opts: { as?: string } = {},
  ): Promise<StartAttemptResponse> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'events.start');
    const env = await this.client.request<DataEnvelope<StartAttemptResponse>>(
      'POST',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/events/${encodeURIComponent(
        eventKey,
      )}/start`,
      { playerContext },
    );
    return env.data;
  }

  /**
   * POST /sdk/v1/players/:p/events/:e/attempts/:a/progress — push a
   * metric update. `mode: 'set'` writes the value; `'increment'` adds.
   *
   * Response carries `milestonesFired`: any per-metric milestone whose
   * threshold was crossed by THIS update. Each entry includes the
   * concrete grant rows the engine wrote, so a game can pop a "you
   * unlocked a chest!" toast without polling `/grants/pending`.
   */
  async progress(
    eventKey: string,
    attemptId: string,
    input: ProgressInput,
    opts: { as?: string } = {},
  ): Promise<ProgressResponse> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'events.progress');
    const env = await this.client.request<DataEnvelope<ProgressResponse>>(
      'POST',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/events/${encodeURIComponent(
        eventKey,
      )}/attempts/${encodeURIComponent(attemptId)}/progress`,
      input,
    );
    return env.data;
  }
}

/**
 * Resource client for `/sdk/v1/leaderboards/:key` — the
 * dashboard-configured cross-event leaderboards. Addressed by the
 * game-scoped `key` (e.g. `"weekly_global"`). For the auto-created
 * per-event-window boards addressed by UUID, see {@link EventLeaderboardsClient}.
 */
export class LeaderboardsClient {
  constructor(private readonly client: KratyClient) {}

  /**
   * GET /sdk/v1/leaderboards/:key — snapshot read of a
   * dashboard-configured cross-event leaderboard.
   *
   * `segment` is required only for `context`-segmented boards — pass
   * the same value your client supplied in
   * `playerContext[segmentation.key]` on attempt start. For
   * `progression`-segmented boards omit it; the server derives the
   * caller's division. Unsegmented boards ignore it.
   *
   * Pass `period: 'current'` (default) for live ranks, or an ISO
   * timestamp from `listPeriods(...)` for a historical snapshot.
   */
  async read(key: string, opts: LeaderboardReadOptions = {}): Promise<Leaderboard> {
    const params = new URLSearchParams();
    if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
    if (opts.segment) params.set('segment', opts.segment);
    if (opts.period) params.set('period', opts.period);
    if (opts.includeSelf) {
      params.set('includeSelf', 'true');
      const externalId =
        opts.externalId ?? (await this.client.ensureIdentity()).externalPlayerId;
      params.set('externalId', externalId);
    }
    const qs = params.toString();
    const path = qs
      ? `/sdk/v1/leaderboards/${encodeURIComponent(key)}?${qs}`
      : `/sdk/v1/leaderboards/${encodeURIComponent(key)}`;
    const env = await this.client.request<DataEnvelope<Leaderboard>>('GET', path);
    return env.data;
  }

  /**
   * POST /sdk/v1/players/:p/leaderboards/:key/score — submit a score
   * for the active player directly to a dashboard-configured board,
   * outside an event attempt. Returns the player's new score + rank.
   *
   * `segment` is required only for `context`-segmented boards (pass
   * the bucket value). For `progression`-segmented boards omit it —
   * the server derives the player's division; unsegmented boards
   * ignore it.
   *
   * Throws `KratyApiError`: `client_scoring_disabled` (403) when the
   * board is server-only, `score_not_supported` (400) on a
   * progression-ranked board, `not_found` (404), `validation_failed`
   * (400). Pass `{ as }` to address a different player (server-side
   * tooling only).
   */
  async submitScore(
    key: string,
    value: number,
    opts: { segment?: string; idempotencyKey?: string; as?: string } = {},
  ): Promise<LeaderboardScoreResult> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'leaderboards.submitScore');
    const body: { value: number; segment?: string; idempotencyKey?: string } = { value };
    if (opts.segment) body.segment = opts.segment;
    if (opts.idempotencyKey) body.idempotencyKey = opts.idempotencyKey;
    const env = await this.client.request<DataEnvelope<LeaderboardScoreResult>>(
      'POST',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/leaderboards/${encodeURIComponent(
        key,
      )}/score`,
      body,
    );
    return env.data;
  }

  /**
   * GET /sdk/v1/leaderboards/:key/periods
   *
   * Lists the available snapshot periods (newest first). Useful when
   * the UI offers "this week", "last week", "two weeks ago" — pick a
   * `periodStartedAt` from the result and re-call `read(key, { period })`.
   */
  async listPeriods(key: string, opts: { limit?: number } = {}): Promise<LeaderboardPeriods> {
    const params = new URLSearchParams();
    if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
    const qs = params.toString();
    const path = qs
      ? `/sdk/v1/leaderboards/${encodeURIComponent(key)}/periods?${qs}`
      : `/sdk/v1/leaderboards/${encodeURIComponent(key)}/periods`;
    const env = await this.client.request<DataEnvelope<LeaderboardPeriods>>('GET', path);
    return env.data;
  }
}

/**
 * Resource client for `/sdk/v1/event-leaderboards/:id` — the auto-generated
 * per-event-window leaderboard, addressed by the UUID
 * `events.start(...)` returns in `attempt.leaderboardId`. Includes
 * Server-Sent-Events live streaming. For the dashboard-configured
 * cross-event boards, see {@link LeaderboardsClient}.
 */
export class EventLeaderboardsClient {
  constructor(private readonly client: KratyClient) {}

  /**
   * GET /sdk/v1/event-leaderboards/:id — top `limit` entries for one event
   * window's leaderboard. Pass `includeSelf: true` + `externalId` to
   * also receive the caller's rank/score.
   */
  async read(
    leaderboardId: string,
    opts: EventLeaderboardReadOptions = {},
  ): Promise<EventLeaderboard> {
    const params = new URLSearchParams();
    if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
    if (opts.includeSelf) {
      params.set('includeSelf', 'true');
      // Lazily resolve the active player when the dev didn't pass an
      // explicit `externalId`. Same contract as every other
      // player-scoped method on the SDK.
      const externalId =
        opts.externalId ?? (await this.client.ensureIdentity()).externalPlayerId;
      params.set('externalId', externalId);
    }
    const qs = params.toString();
    const path = qs
      ? `/sdk/v1/event-leaderboards/${encodeURIComponent(leaderboardId)}?${qs}`
      : `/sdk/v1/event-leaderboards/${encodeURIComponent(leaderboardId)}`;
    const env = await this.client.request<DataEnvelope<EventLeaderboard>>('GET', path);
    return env.data;
  }

  /**
   * GET /sdk/v1/event-leaderboards/:id/stream — opens a Server-Sent Events
   * subscription that pushes score updates in real time. Returns a
   * `LeaderboardStream` handle whose `events` async-iterable yields
   * each parsed event (`ready`, `score_update`, `closed`).
   *
   * Does NOT auto-reconnect on transport drop — the iterable throws
   * `KratyNetworkError` and you re-call `live(...)` after a backoff
   * if you want resumption.
   *
   * Low-level — prefer `subscribe(...)` for game UIs.
   */
  live(leaderboardId: string): Promise<LeaderboardStream> {
    return openLeaderboardStream({
      fetchImpl: this.client.fetchForStreaming,
      baseUrl: this.client.baseUrl,
      leaderboardId,
      authHeader: this.client.authHeader,
      playerSecret: this.client.playerSecret,
      sdkUserAgent: this.client.sdkUserAgent,
    });
  }

  /**
   * High-level live event-leaderboard subscription. Composes the
   * `live()` SSE stream with a periodic background `read()` poll that
   * nudges the server's lazy bot evaluator and dedupes the resulting
   * deltas against the SSE feed. Idle UIs need the poll so bots tick
   * on schedule even without player action; the SSE side carries the
   * resulting score updates with low latency.
   *
   * Callback fires for every event from either source, deduped so the
   * same `(participantId, score)` doesn't surface twice. Returns a
   * handle whose `close()` tears down both transports.
   *
   * @param leaderboardId  The event leaderboard UUID to subscribe to.
   * @param onEvent        Fired for every `LeaderboardStreamEvent`.
   * @param opts.pollIntervalMs  Background read cadence. Default 15_000.
   *                              Set to 0 to disable polling (SSE-only).
   * @param opts.onError   Optional — receives transport / parse errors.
   */
  subscribe(
    leaderboardId: string,
    onEvent: (event: LeaderboardStreamEvent) => void,
    opts: {
      pollIntervalMs?: number;
      onError?: (err: unknown) => void;
    } = {},
  ): { close: () => Promise<void> } {
    const pollIntervalMs = opts.pollIntervalMs ?? 15_000;
    const onError = opts.onError ?? (() => undefined);

    // Track the last score we surfaced for each participant so we can
    // suppress duplicates when SSE and a poll happen to deliver the
    // same delta. Players who replay the same score get suppressed too,
    // which matches what game UIs want (no re-render churn).
    const lastSurfacedScore = new Map<string, number>();
    let closed = false;
    let streamHandle: LeaderboardStream | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const surface = (event: LeaderboardStreamEvent): void => {
      if (closed) return;
      // For score_update events, dedupe by (participantId, score). Other
      // event kinds (ready, closed, parse-error) always pass through.
      if (event.kind === 'score_update') {
        const pid = String(event.data['participantId'] ?? '');
        const score = Number(event.data['score']);
        if (pid && Number.isFinite(score)) {
          const prior = lastSurfacedScore.get(pid);
          if (prior === score) return;
          lastSurfacedScore.set(pid, score);
        }
      }
      try {
        onEvent(event);
      } catch (err) {
        try { onError(err); } catch { /* swallow */ }
      }
    };

    const consumeSse = async (): Promise<void> => {
      try {
        streamHandle = await this.live(leaderboardId);
      } catch (err) {
        try { onError(err); } catch { /* swallow */ }
        return;
      }
      try {
        for await (const ev of streamHandle.events) {
          surface(ev);
        }
      } catch (err) {
        if (!closed) {
          try { onError(err); } catch { /* swallow */ }
        }
      }
    };

    const consumePollOnce = async (): Promise<void> => {
      if (closed) return;
      try {
        const lb = await this.read(leaderboardId);
        for (const entry of lb.entries) {
          surface({
            kind: 'score_update',
            data: {
              leaderboardId: lb.leaderboardId,
              participantId: entry.participantId,
              score: entry.score,
              rank: entry.rank,
            },
          });
        }
      } catch (err) {
        try { onError(err); } catch { /* swallow */ }
      }
    };

    const schedulePoll = (): void => {
      if (closed || pollIntervalMs <= 0) return;
      pollTimer = setTimeout(async () => {
        await consumePollOnce();
        schedulePoll();
      }, pollIntervalMs);
    };

    // Kick off both transports in parallel. Poll fires once immediately
    // so the first frame of the UI lands with current scores; SSE wires
    // up alongside for low-latency real-time pushes.
    void consumeSse();
    if (pollIntervalMs > 0) {
      void consumePollOnce().then(schedulePoll);
    }

    return {
      close: async () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (streamHandle) {
          try { await streamHandle.close(); } catch { /* swallow */ }
        }
      },
    };
  }
}

export class GrantsClient {
  constructor(private readonly client: KratyClient) {}

  /**
   * GET /sdk/v1/players/:p/pending-grants — the active player's
   * unclaimed grants. Empty array for unknown players (not 404).
   * Pass `{ as }` to query another player (server tooling only).
   */
  async listPending(opts: { limit?: number; as?: string } = {}): Promise<Grant[]> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'grants.listPending');
    const qs = typeof opts.limit === 'number' ? `?limit=${opts.limit}` : '';
    const env = await this.client.request<DataEnvelope<Grant[]>>(
      'GET',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/pending-grants${qs}`,
    );
    return env.data;
  }

  /**
   * POST /sdk/v1/players/:p/grants/:g/claim — flip a pending grant
   * to claimed for the active player. Idempotent: claiming an
   * already-claimed grant returns the same row with 200.
   */
  async claim(grantId: string, opts: { as?: string } = {}): Promise<Grant> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'grants.claim');
    const env = await this.client.request<DataEnvelope<Grant>>(
      'POST',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/grants/${encodeURIComponent(
        grantId,
      )}/claim`,
      {},
    );
    return env.data;
  }

  /**
   * POST /sdk/v1/players/:p/crates/:g/open — roll the crate's reward
   * table for the active player and return both the crate (now
   * claimed) and the contents grant. Idempotent on the crate id.
   */
  async open(grantId: string, opts: { as?: string } = {}): Promise<OpenCrateResponse> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'grants.open');
    const env = await this.client.request<DataEnvelope<OpenCrateResponse>>(
      'POST',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/crates/${encodeURIComponent(
        grantId,
      )}/open`,
      {},
    );
    return env.data;
  }

  /**
   * Burn down the pending-grants queue in one call: list everything
   * pending, open every crate, claim every reward, return a summary.
   * Built for the "round complete" reward-collection moment most
   * games have.
   *
   * Errors per-grant are caught and surfaced in
   * `CollectAllResult.failures` — one bad grant doesn't abort the
   * whole sweep. Crates open BEFORE rewards are claimed — the
   * rolled-contents grant a crate produces lands in the NEXT
   * `listPending`, so re-invoke if you want to drain those too.
   */
  async collectAll(opts: { as?: string } = {}): Promise<CollectAllResult> {
    const pending = await this.listPending(opts);
    const opened: OpenCrateResponse[] = [];
    const claimed: Grant[] = [];
    const failures: CollectAllFailure[] = [];
    for (const g of pending) {
      try {
        if (g.kind === 'crate') {
          opened.push(await this.open(g.id, opts));
        } else {
          claimed.push(await this.claim(g.id, opts));
        }
      } catch (err) {
        failures.push({ grant: g, error: err });
      }
    }
    return {
      processed: pending.length,
      opened,
      claimed,
      failures,
      hasFailures: failures.length > 0,
    };
  }
}

/**
 * One pending grant that `collectAll` couldn't process. The other
 * grants in the same sweep still went through — inspect `error` and
 * retry the individual operation.
 */
export interface CollectAllFailure {
  grant: Grant;
  error: unknown;
}

/**
 * Aggregate result of `GrantsClient.collectAll`. `processed` is the
 * total pending count at the time of the call; `opened` + `claimed`
 * + `failures` sum to that.
 */
export interface CollectAllResult {
  processed: number;
  opened: OpenCrateResponse[];
  claimed: Grant[];
  failures: CollectAllFailure[];
  hasFailures: boolean;
}

/**
 * Resource client for `/sdk/v1/players/:p/inventory(/...)`. Only
 * surfaces meaningful data for games whose
 * `settings.inventoryManagement === 'platform'`. The SDK doesn't
 * expose grant / admin-credit endpoints — those are server-API only.
 */
export class InventoryClient {
  constructor(private readonly client: KratyClient) {}

  /**
   * GET /sdk/v1/players/:p/inventory — every item the active player
   * currently holds. Backend wraps as `{ data: { items: [...] } }`.
   */
  async list(opts: { as?: string } = {}): Promise<PlayerItemHolding[]> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'inventory.list');
    const env = await this.client.request<DataEnvelope<{ items?: PlayerItemHolding[] }>>(
      'GET',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/inventory`,
    );
    return env.data?.items ?? [];
  }

  /**
   * POST /sdk/v1/players/:p/inventory/:itemKey/consume — atomic
   * decrement for the active player. Auto-stamped idempotency key
   * unless you provide one. Throws `KratyApiError` with code
   * `conflict` if the player doesn't have enough of the item.
   */
  async consume(
    itemKey: string,
    input: ConsumeItemInput,
    opts: { as?: string } = {},
  ): Promise<ConsumeItemResult> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'inventory.consume');
    const env = await this.client.request<DataEnvelope<ConsumeItemResult>>(
      'POST',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/inventory/${encodeURIComponent(
        itemKey,
      )}/consume`,
      input,
    );
    return env.data;
  }
}

/**
 * Resource client for `/sdk/v1/players/:p/wallet(/...)`. Mirrors
 * `InventoryClient` for currencies + progression resources.
 */
export class WalletClient {
  constructor(private readonly client: KratyClient) {}

  /**
   * GET /sdk/v1/players/:p/wallet — every economy entry the player
   * has touched. Backend wraps as `{ data: { wallet: [...] } }`.
   */
  async list(opts: { as?: string } = {}): Promise<PlayerWalletHolding[]> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'wallet.list');
    const env = await this.client.request<DataEnvelope<{ wallet?: PlayerWalletHolding[] }>>(
      'GET',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/wallet`,
    );
    return env.data?.wallet ?? [];
  }

  /**
   * POST /sdk/v1/players/:p/wallet/:economyKey/debit — atomic
   * decrement on the active player's wallet. 409 on insufficient
   * balance. Credit is intentionally not exposed here — only the
   * studio's backend can mint balance.
   */
  async debit(
    economyKey: string,
    input: DebitWalletInput,
    opts: { as?: string } = {},
  ): Promise<DebitWalletResult> {
    const externalPlayerId = await resolvePlayerId(this.client, opts.as, 'wallet.debit');
    const env = await this.client.request<DataEnvelope<DebitWalletResult>>(
      'POST',
      `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/wallet/${encodeURIComponent(
        economyKey,
      )}/debit`,
      input,
    );
    return env.data;
  }
}

/**
 * Resource client for `/sdk/v1/players/:p/register` — the zero-trust
 * bootstrap. Game client calls `register()` once on first launch
 * (or after the player wipes app data), captures the returned
 * `secret`, persists it locally, and re-creates the `KratyClient`
 * with `playerSecret: <secret>`.
 */
export class PlayersClient {
  constructor(private readonly client: KratyClient) {}

  /**
   * POST /sdk/v1/players/:externalId/register — creates the player
   * row if it doesn't exist + mints a per-player secret. Throws
   * `KratyApiError` with `isPlayerAlreadyRegistered` true if the
   * player has already claimed a secret.
   *
   * Pass `force: true` to ROTATE an existing secret. Only honoured
   * by non-`live` API keys (dev/test/staging). Useful in the "I
   * wiped my app data and need to re-register" flow during testing —
   * never wire this up in a production client.
   */
  async register(
    externalPlayerId: string,
    opts: { force?: boolean } = {},
  ): Promise<PlayerRegistration> {
    const path = opts.force
      ? `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/register?force=true`
      : `/sdk/v1/players/${encodeURIComponent(externalPlayerId)}/register`;
    const env = await this.client.request<DataEnvelope<PlayerRegistration>>('POST', path, {});
    return env.data;
  }
}

/**
 * Resource client for `/sdk/v1/catalog` — single-shot read of every
 * item + currency configured for the game. Studios call this once at
 * boot and cache locally; pairs with `events.listForPlayer` (which
 * inlines reward-bundle previews) so a UI can render names, icons,
 * rarities, and reward previews without keeping a parallel catalog
 * in the client codebase.
 */
export class CatalogClient {
  constructor(private readonly client: KratyClient) {}

  /**
   * GET `/sdk/v1/catalog` — items + currencies for the calling game.
   * Game is derived from the API key; no parameters.
   */
  async read(): Promise<Catalog> {
    const env = await this.client.request<DataEnvelope<Catalog>>(
      'GET',
      '/sdk/v1/catalog',
    );
    return env.data;
  }
}

export class LobbiesClient {
  constructor(private readonly client: KratyClient) {}

  /**
   * GET /sdk/v1/lobbies/:lobbyId — poll a lobby that's still filling.
   * After `events.start` returns `lobby_forming` (202 with the
   * lobby-forming code), poll via this method until
   * `status !== 'forming'`, then retry `start`.
   */
  async read(lobbyId: string): Promise<Lobby> {
    const env = await this.client.request<{ data: Lobby }>(
      'GET',
      `/sdk/v1/lobbies/${encodeURIComponent(lobbyId)}`,
    );
    return env.data;
  }
}

export interface PollLobbyOptions {
  /** Initial poll interval (ms). Default 1_000. */
  intervalMs?: number;
  /** Cap on total wait time before rejecting. Default 60_000. */
  timeoutMs?: number;
  /** Aborts the poll early. */
  signal?: AbortSignal;
}

/**
 * Polls a lobby until it transitions out of `'forming'`. Resolves
 * with the lobby once it's `active` (or any non-forming status),
 * throws if the timeout elapses or the signal aborts.
 */
export async function pollLobbyUntilActive(
  lobbies: LobbiesClient,
  lobbyId: string,
  opts: PollLobbyOptions = {},
): Promise<Lobby> {
  const interval = opts.intervalMs ?? 1_000;
  const timeout = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error('pollLobbyUntilActive: aborted');
    const lobby = await lobbies.read(lobbyId);
    if (lobby.status !== 'forming') return lobby;
    await sleepAbortable(interval, opts.signal);
  }
  throw new Error(`pollLobbyUntilActive: lobby '${lobbyId}' did not leave 'forming' within ${timeout}ms`);
}

export interface PollPendingGrantsOptions {
  /** Starting interval in milliseconds. Default 2_000. */
  startMs?: number;
  /** Multiplier between polls when the result is empty. Default 1.5. */
  growMs?: number;
  /** Cap. Default 30_000 (30s). */
  maxMs?: number;
  /** Abort the polling loop. */
  signal?: AbortSignal;
  /** Fires for every batch (including empty ones). */
  onBatch?: (grants: Grant[]) => void;
  /** Override the active player (server tooling only). */
  as?: string;
}

/**
 * Adaptive polling for a player's pending grants. Grows the interval
 * when the queue is empty and shrinks back to `startMs` when grants
 * land. Resolves when the consumer aborts via `signal`.
 */
export async function pollPendingGrants(
  grants: GrantsClient,
  opts: PollPendingGrantsOptions = {},
): Promise<void> {
  const start = opts.startMs ?? 2_000;
  const grow = opts.growMs ?? 1.5;
  const max = opts.maxMs ?? 30_000;
  let interval = start;
  const signal = opts.signal;
  const listOpts = opts.as ? { as: opts.as } : {};
  while (!signal?.aborted) {
    const batch = await grants.listPending(listOpts);
    opts.onBatch?.(batch);
    if (batch.length > 0) {
      interval = start;
    } else {
      interval = Math.min(interval * grow, max);
    }
    await sleepAbortable(interval, signal);
  }
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// Re-export for index aggregation.
export type { KratyApiError };
