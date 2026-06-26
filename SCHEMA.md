# Kraty TypeScript SDK — public surface (v0.4.0)

Canonical method + type listing for `@kraty/sdk`. Update this file in
the same commit as any signature change.

All methods sit on the `Kraty` facade unless noted. Every async method
returns a `Promise`. The optional `as` field on resource calls is for
server-side tooling addressing a different player from a single SDK
instance — game code never sets it.

## `Kraty` facade

```ts
new Kraty(opts: KratyClientOptions)

readonly activeExternalPlayerId: string | null
ensureIdentity(): Promise<{ externalPlayerId: string; secret: string }>
signIn(externalPlayerId: string, secret: string): Promise<void>
logout(): Promise<void>

// Static identity helpers
static readStoredIdentity(secretStore: SecretStore): Promise<StoredIdentity | null>
static restoreStoredIdentity(client: KratyClient, identity: StoredIdentity, secretStore: SecretStore): Promise<void>
static clearStoredIdentity(secretStore: SecretStore): Promise<void>
static connectAsPlayer(opts: KratyClientOptions, externalPlayerId: string | null, secretStore: SecretStore, autoRotateOnConflict?: boolean): Promise<Kraty>
```

## `kraty.events` — `EventsClient`

```ts
listForPlayer(opts?: { as?: string }): Promise<EventListing[]>
start(eventKey: string, playerContext?: PlayerContext, opts?: { idempotencyKey?: string; as?: string }): Promise<StartAttemptResponse>
progress(eventKey: string, attemptId: string, input: ProgressInput, opts?: { as?: string }): Promise<ProgressResponse>
```

## `kraty.leaderboards` — `LeaderboardsClient`

The dashboard-configured cross-event boards. Addressed by stable
game-scoped **key**.

```ts
read(key: string, opts?: LeaderboardReadOptions): Promise<Leaderboard>
listPeriods(key: string, opts?: { limit?: number }): Promise<LeaderboardPeriods>
```

`LeaderboardReadOptions`:
- `limit?: number` — 1–200, default 50 server-side
- `segment?: string` — bucket value for segmented boards (REQUIRED on segmented boards)
- `period?: 'current' | string` — `'current'` (default) or an ISO timestamp from `LeaderboardPeriod.periodStartedAt`
- `includeSelf?: boolean` — when true, response includes `self: { rank, score }` (live periods only)
- `externalId?: string` — required when `includeSelf` is true; lazily resolved otherwise

## `kraty.eventLeaderboards` — `EventLeaderboardsClient`

The auto-generated per-event-window leaderboard. Addressed by the
**UUID** returned in `events.start(...)`'s `attempt.leaderboardId`.
Includes Server-Sent Events live streaming.

```ts
read(leaderboardId: string, opts?: EventLeaderboardReadOptions): Promise<EventLeaderboard>
live(leaderboardId: string): Promise<LeaderboardStream>
subscribe(
  leaderboardId: string,
  onEvent: (event: LeaderboardStreamEvent) => void,
  opts?: { pollIntervalMs?: number; onError?: (err: unknown) => void }
): { close: () => Promise<void> }
```

`EventLeaderboardReadOptions`:
- `limit?: number`
- `includeSelf?: boolean`
- `externalId?: string`

`subscribe` opts:
- `pollIntervalMs` — default 15_000; 0 disables polling (SSE-only)
- `onError` — receives transport / parse errors. Non-fatal; the poll keeps running

## `kraty.grants` — `GrantsClient`

```ts
listPending(opts?: { limit?: number; as?: string }): Promise<Grant[]>
claim(grantId: string, opts?: { idempotencyKey?: string; as?: string }): Promise<Grant>
open(grantId: string, opts?: { idempotencyKey?: string; as?: string }): Promise<OpenCrateResponse>
collectAll(opts?: { as?: string }): Promise<CollectAllResult>
```

`CollectAllResult`:
- `opened: Grant[]` — crate grants whose contents were rolled
- `claimed: Grant[]` — reward grants flipped to claimed
- `failures: CollectAllFailure[]` — per-grant errors
- `hasFailures: boolean`

## `kraty.lobbies` — `LobbiesClient`

```ts
read(lobbyId: string): Promise<Lobby>
```

## `kraty.inventory` — `InventoryClient`

```ts
list(opts?: { as?: string }): Promise<PlayerItemHolding[]>
consume(itemKey: string, input: ConsumeItemInput, opts?: { as?: string }): Promise<ConsumeItemResult>
```

## `kraty.wallet` — `WalletClient`

```ts
list(opts?: { as?: string }): Promise<PlayerWalletHolding[]>
debit(economyKey: string, input: DebitWalletInput, opts?: { as?: string }): Promise<DebitWalletResult>
```

## `kraty.players` — `PlayersClient`

```ts
register(externalPlayerId: string, opts?: { force?: boolean }): Promise<PlayerRegistration>
```

## `kraty.catalog` — `CatalogClient`

```ts
get(): Promise<Catalog>
```

## Polling helpers

```ts
pollPendingGrants(grants: GrantsClient, opts?: PollPendingGrantsOptions): AsyncIterable<Grant[]>
pollLobbyUntilActive(lobbies: LobbiesClient, lobbyId: string, opts?: PollLobbyOptions): Promise<Lobby>
```

## Secret stores

```ts
interface SecretStore { read(externalId): Promise<string|null>; write(externalId, secret): Promise<void>; remove(externalId): Promise<void>; ... }
InMemorySecretStore       // tests + non-browser
LocalStorageSecretStore   // browsers, wraps window.localStorage
```

## DTOs (response shapes)

`Attempt`, `StartAttemptResponse`, `ProgressInput`, `ProgressResponse`,
`MilestoneFired`, `EventListing`, `EntryCost`, `EntryCostCurrency`,
`EntryCostItem`, `Leaderboard`, `EventLeaderboard`, `LeaderboardEntry`,
`LeaderboardPeriod`, `LeaderboardPeriods`, `Grant`, `GrantKind`,
`GrantStatus`, `OpenCrateResponse`, `Lobby`, `LobbyStatus`,
`PlayerItemHolding`, `PlayerWalletHolding`, `PlayerRegistration`,
`ConsumeItemInput`, `ConsumeItemResult`, `DebitWalletInput`,
`DebitWalletResult`, `Catalog`, `CatalogItem`, `CatalogCurrency`,
`RewardBundlePreview`, `RewardEntryPreview`, `RewardPolicySummary`,
`PlayerContext`.

## Errors

```ts
class KratyApiError extends Error      // non-2xx — has code (KratyErrorCode), status, payload
class KratyNetworkError extends Error  // transport / parse failure
isLobbyForming(err: unknown): boolean  // type-narrowing helper
```

`KratyApiError` boolean helpers:
`isLobbyForming`, `isInsufficientEntryCost`, `isPlayerSecretInvalid`,
`isPlayerAlreadyRegistered`, `isEntryRequirementFailed`,
`isNoLeaderboard`, `isNoActiveWindow`, `isMaxAttemptsReached`,
`isAttemptExpired`, `isAttemptCompleted`.

Full `KratyErrorCode` union: see `src/errors.ts`.
