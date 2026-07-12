# Kraty TypeScript SDK: public surface (v0.6.0)

Canonical method + type listing for `@kraty/sdk`. Update this file in
the same commit as any signature change.

All methods sit on the `Kraty` facade unless noted. Every async method
returns a `Promise`. The optional `as` field on resource calls is for
server-side tooling addressing a different player from a single SDK
instance. Game code never sets it.

## `Kraty` facade

```ts
new Kraty(opts: KratyClientOptions)

readonly activeExternalPlayerId: string | null
ensureIdentity(): Promise<{ externalPlayerId: string; secret: string }>
signIn(externalPlayerId: string, secret: string): Promise<void>
logout(): Promise<void>

// Finalization catch-up (docs/05b). Fires exactly once per board across the
// live SSE `finalized` event AND boards that ended while the player was away.
onFinalized(cb: (result: FinalizationResult) => void): () => void  // returns unsubscribe
checkFinalizations(): Promise<FinalizationResult[]>  // call on app foreground/reconnect
dismiss(ref: MembershipRef): Promise<void>           // ack one handled result
clearReported(): Promise<number>                     // bulk-drop delivered entries

// Static identity helpers
static readStoredIdentity(secretStore: SecretStore): Promise<StoredIdentity | null>
static restoreStoredIdentity(client: KratyClient, identity: StoredIdentity, secretStore: SecretStore): Promise<void>
static clearStoredIdentity(secretStore: SecretStore): Promise<void>
static connectAsPlayer(opts: KratyClientOptions, externalPlayerId: string | null, secretStore: SecretStore, autoRotateOnConflict?: boolean): Promise<Kraty>
```

`FinalizationResult` = `{ ref: MembershipRef; reason: FinalizationReason; self: { rank, score } | null; standings?: FinalStanding[]; eventKey? }`.
`reason` (a `FinalizationReason` const, not a raw string): `SessionTerminated` \| `WindowClosed` \| `PeriodRolled` \| `Finalized`. Kinds use the `MembershipKind` / `StandingKind` consts. Registry persistence is injectable via `KratyClientOptions.membershipStore` (`LocalStorageMembershipStore` in the browser, `InMemoryMembershipStore` otherwise).

## `kraty.events`: `EventsClient`

```ts
listForPlayer(opts?: { as?: string }): Promise<EventListing[]>
start(eventKey: string, playerContext?: PlayerContext, opts?: { idempotencyKey?: string; as?: string }): Promise<StartAttemptResponse>
progress(eventKey: string, attemptId: string, input: ProgressInput, opts?: { as?: string }): Promise<ProgressResponse>
```

## `kraty.leaderboards`: `LeaderboardsClient`

The dashboard-configured cross-event boards. Addressed by stable
game-scoped **key**. Wire endpoints:

- `GET /sdk/v1/leaderboards/:key`
- `GET /sdk/v1/leaderboards/:key/standings`
- `GET /sdk/v1/leaderboards/:key/periods`
- `POST /sdk/v1/players/:externalId/leaderboards/:key/join`
- `POST /sdk/v1/players/:externalId/leaderboards/:key/score`

```ts
read(key: string, opts?: LeaderboardReadOptions): Promise<Leaderboard>
join(key: string, opts?: { limit?: number; segment?: string; externalId?: string }): Promise<Leaderboard>
standings(key: string, opts?: StandingsReadOptions): Promise<BoardStandings>
submitScore(key: string, value: number, opts?: { segment?: string; idempotencyKey?: string; as?: string }): Promise<LeaderboardScoreResult>
listPeriods(key: string, opts?: { limit?: number }): Promise<LeaderboardPeriods>
```

`LeaderboardReadOptions`:
- `limit?: number`: 1–200, default 50 server-side
- `segment?: string`: bucket value; required only for `context` segmentation. Omit for `progression`-segmented boards (server derives the caller's division); unsegmented boards ignore it
- `period?: 'current' | string`: `'current'` (default) or an ISO timestamp from `LeaderboardPeriod.periodStartedAt`
- `includeSelf?: boolean`: when true, response includes `self: { rank, score }` (live periods only)
- `externalId?: string`: required when `includeSelf` is true; lazily resolved otherwise

`join`: add the active player to the board at score 0 without submitting a score; returns the current standings with `joined: true`. Idempotent (never resets an existing score). Pass `segment` for `context` boards; omit for `progression` boards (server derives the division from the caller's balance).

`standings`: multi-segment read. Returns one `StandingsSegment` block per segment selected by `scope`. `StandingsReadOptions`:
- `scope?: 'self_segment' | 'mine' | 'segment' | 'all'`: default `'all'`
- `segment?: string`: required when `scope: 'segment'` on a segmented board
- `period?: 'current' | string`: default `'current'`
- `externalId?: string`: auto-resolved for `self_segment` / `mine`
- `limit?: number`: per-segment top-N (1..200, default 50)
- `maxSegments?: number`: cap on returned segment blocks (1..100, default 20)

`BoardStandings`: `key`, `leaderboardId`, `scope`, `resetCadence`, `scoreAggregation`, `period`, `segments: StandingsSegment[]`, `segmentsTruncated: boolean`.
`StandingsSegment`: `segment: string | null`, `participated: boolean`, `selfRank: number | null`, `entries: LeaderboardEntry[]`.

`submitScore`: submit a score for the active player directly to the board, outside an event attempt. `segment` is required only for `context` segmentation; omit for `progression` boards. Errors: `client_scoring_disabled` (403, board is server-only), `score_not_supported` (400, progression-ranked board), `not_found` (404), `validation_failed` (400). Returns `LeaderboardScoreResult`:
- `leaderboardId: string`
- `score: number`
- `rank: number | null`

## `kraty.eventLeaderboards`: `EventLeaderboardsClient`

The auto-generated per-event-window leaderboard. Addressed by the
**UUID** returned in `events.start(...)`'s `attempt.leaderboardId`.
Includes Server-Sent Events live streaming. Wire endpoints:

- `GET /sdk/v1/event-leaderboards/:id`
- `GET /sdk/v1/event-leaderboards/:id/stream`
- `POST /sdk/v1/players/:externalId/event-leaderboards/:id/join`

```ts
read(leaderboardId: string, opts?: EventLeaderboardReadOptions): Promise<EventLeaderboard>
join(leaderboardId: string, opts?: { limit?: number; as?: string }): Promise<EventLeaderboard>
live(leaderboardId: string): Promise<LeaderboardStream>
subscribe(
  leaderboardId: string,
  onEvent: (event: LeaderboardStreamEvent) => void,
  opts?: { pollIntervalMs?: number; onError?: (err: unknown) => void }
): { close: () => Promise<void> }
```

`join`: enrols the active player in the current event window at score 0 without starting a scoring attempt; returns the board with `joined: true`. Idempotent. Throws `KratyApiError` with code `conflict` (409) once the window has finalized.

`EventLeaderboardReadOptions`:
- `limit?: number`
- `includeSelf?: boolean`
- `externalId?: string`

`subscribe` opts:
- `pollIntervalMs`: default 15_000; 0 disables polling (SSE-only)
- `onError`: receives transport / parse errors. Non-fatal; the poll keeps running

`EventLeaderboard` read response includes `finalized: boolean` and, when finalized, `finalizedReason: 'session_terminated' | 'window_closed' | null`, which powers the finalization catch-up's session-vs-window distinction. The `finalized` SSE event carries `reason` + `standings`.

## `kraty.grants`: `GrantsClient`

```ts
listPending(opts?: { limit?: number; as?: string }): Promise<Grant[]>
claim(grantId: string, opts?: { idempotencyKey?: string; as?: string }): Promise<Grant>
open(grantId: string, opts?: { idempotencyKey?: string; as?: string }): Promise<OpenCrateResponse>
collectAll(opts?: { as?: string }): Promise<CollectAllResult>
```

`CollectAllResult`:
- `opened: Grant[]`: crate grants whose contents were rolled
- `claimed: Grant[]`: reward grants flipped to claimed
- `failures: CollectAllFailure[]`: per-grant errors
- `hasFailures: boolean`

## `kraty.lobbies`: `LobbiesClient`

```ts
read(lobbyId: string): Promise<Lobby>
```

## `kraty.inventory`: `InventoryClient`

```ts
list(opts?: { as?: string }): Promise<PlayerItemHolding[]>
consume(itemKey: string, input: ConsumeItemInput, opts?: { as?: string }): Promise<ConsumeItemResult>
```

## `kraty.wallet`: `WalletClient`

```ts
list(opts?: { as?: string }): Promise<PlayerWalletHolding[]>
debit(economyKey: string, input: DebitWalletInput, opts?: { as?: string }): Promise<DebitWalletResult>
```

## `kraty.players`: `PlayersClient`

```ts
register(externalPlayerId: string, opts?: { force?: boolean }): Promise<PlayerRegistration>
```

## `kraty.catalog`: `CatalogClient`

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
class KratyApiError extends Error      // non-2xx; has code (KratyErrorCode), status, payload
class KratyNetworkError extends Error  // transport / parse failure
isLobbyForming(err: unknown): boolean  // type-narrowing helper
```

`KratyApiError` boolean helpers:
`isLobbyForming`, `isInsufficientEntryCost`, `isPlayerSecretInvalid`,
`isPlayerAlreadyRegistered`, `isEntryRequirementFailed`,
`isNoLeaderboard`, `isNoActiveWindow`, `isMaxAttemptsReached`,
`isAttemptExpired`, `isAttemptCompleted`.

Full `KratyErrorCode` union: see `src/errors.ts`.
