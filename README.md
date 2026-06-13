# @kraty/sdk

TypeScript SDK for the Kraty game-events platform. Targets the public
[`/sdk/v1`](../../docs/13-rest-api.md) surface: events, leaderboards,
grants, crates.

This is the **reference SDK** — patterns established here (idempotency
keys auto-generated on retry, exponential backoff with jitter, adaptive
polling helpers, sealed error codes) are mirrored by the future Unity
(C#) and Godot SDKs.

## Install

The package isn't published to npm yet — consume it via the pnpm
workspace:

```jsonc
// package.json of a sibling package or app
{
  "dependencies": {
    "@kraty/sdk": "workspace:*"
  }
}
```

For a future published version: `pnpm add @kraty/sdk`.

## Quickstart

```ts
import { Kraty } from '@kraty/sdk';

const kraty = new Kraty({
  apiKey: process.env.KRATY_API_KEY!,
  // Defaults to https://api.kraty.io — override for staging / local:
  baseUrl: 'http://localhost:8080',
});

// First player-scoped call auto-registers + persists the player
// identity. Every subsequent call reuses it across launches.

// 1) Find events the player can start right now.
const events = await kraty.events.listForPlayer();

// 2) Start an attempt.
const { attempt, leaderboardId } = await kraty.events.start(
  events[0]!.eventKey,
  { country: 'PT', level: 7 },
);

// 3) Push progress. `mode: 'set'` writes the value directly;
//    `'increment'` adds to the current.
await kraty.events.progress(events[0]!.eventKey, attempt.id, {
  mode: 'set',
  metricValue: 100,
});

// 4) Read the leaderboard — includeSelf resolves to the active
//    player automatically.
const board = await kraty.leaderboards.read(leaderboardId, {
  limit: 50,
  includeSelf: true,
});
console.log(board.entries.slice(0, 3), 'self:', board.self);

// 5) Claim any pending grants the player earned.
const pending = await kraty.grants.listPending();
for (const grant of pending) {
  if (grant.kind === 'reward') {
    await kraty.grants.claim(grant.id);
  } else if (grant.kind === 'crate') {
    const opened = await kraty.grants.open(grant.id);
    console.log('crate rolled:', opened.contents);
  }
}
```

### Bring your own player id

If your own auth backend already issues player ids, pin it in the
constructor — the SDK still handles register + persistence on
the first call:

```ts
const kraty = new Kraty({
  apiKey: process.env.KRATY_API_KEY!,
  activeExternalPlayerId: 'player_42',
});
```

### Switch / sign out

```ts
await kraty.logout();
// Next player-scoped call lazily registers a new player.

await kraty.signIn({ externalPlayerId: 'player_99', secret: '<from-your-backend>' });
// Next call uses player_99 + the supplied secret.
```

## Retry + idempotency

Every `POST` / `PUT` / `PATCH` is automatically stamped with an
`idempotencyKey` (a `crypto.randomUUID()` by default). The SDK retries
on `408` / `425` / `429` / `5xx` and network failures with exponential
backoff + jitter, **reusing the same key across retries** so the
server's idempotency check dedupes a retried call.

If the caller supplies an `idempotencyKey` in the body, the SDK
respects it; otherwise it auto-generates one. Override the generator
(deterministic tests, custom logging):

```ts
const kraty = new Kraty({
  apiKey: '...',
  generateIdempotencyKey: () => `${Date.now()}-${counter++}`,
});
```

Retry config is tunable per client:

```ts
new Kraty({
  apiKey: '...',
  retry: {
    attempts: 5,
    initialDelayMs: 200,
    maxDelayMs: 10_000,
    jitter: 0.25,
  },
});
```

`Retry-After` headers (used by the platform's 429 responses) are
honored — the SDK sleeps for the server-supplied duration before the
next attempt.

## Error handling

Non-2xx responses throw `KratyApiError`. The `code` field is a sealed
union (`KratyErrorCode`) mirroring the backend's
[`api/errors.ts`](../../apps/backend/src/api/errors.ts).

```ts
import { KratyApiError, isLobbyForming } from '@kraty/sdk';

try {
  await kraty.events.start('race');
} catch (err) {
  if (isLobbyForming(err)) {
    // Lobby still filling — poll and retry.
  } else if (err instanceof KratyApiError) {
    switch (err.code) {
      case 'no_active_window':
        console.log('event is between windows');
        break;
      case 'max_attempts_reached':
        console.log('player burned all attempts for this window');
        break;
      // ...
    }
  }
}
```

Network-layer failures (no HTTP response) throw `KratyNetworkError`.

## Adaptive grant polling

When the game can't subscribe to webhooks (most cases for a thin
client), the SDK ships an adaptive poller. Interval grows when the
queue is empty and snaps back to the floor as soon as grants land:

```ts
const ac = new AbortController();
kraty.pollPendingGrants({
  startMs: 2_000,
  growMs: 1.5,
  maxMs: 30_000,
  signal: ac.signal,
  onBatch: (grants) => {
    for (const g of grants) {
      // claim / open / queue for UI
    }
  },
});

// Later:
ac.abort();
```

## Development

```bash
pnpm install
pnpm --filter @kraty/sdk typecheck
pnpm --filter @kraty/sdk test
pnpm --filter @kraty/sdk build
```

Tests use vitest + a hand-rolled fake fetch (no real network IO).
