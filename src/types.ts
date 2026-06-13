/**
 * Public response types for the `/sdk/v1` surface, mirroring the
 * OpenAPI spec at `apps/backend/openapi.json`. Kept hand-authored
 * (rather than generated) so the SDK stays terse and contributors can
 * read this file standalone — drift is caught by integration tests.
 */

export type AttemptStatus = 'in_progress' | 'completed' | 'expired' | 'force_completed';

export interface Attempt {
  id: string;
  eventId: string;
  eventWindowId: string;
  leaderboardId: string;
  playerId: string;
  startedAt: string;
  endsAt: string;
  completedAt: string | null;
  metrics: Record<string, number>;
  metricsRaw: Record<string, number>;
  score: number;
  status: AttemptStatus;
}

export interface StartAttemptResponse {
  attempt: Attempt;
  leaderboardId: string;
  windowEndsAt: string;
}

export interface ProgressInput {
  /** `'set'` writes the value as the new metric; `'increment'` adds to the current. */
  mode: 'set' | 'increment';
  metricValue?: number;
  metrics?: Record<string, number>;
  /** Override server-side timestamp for replay scenarios. */
  occurredAt?: string;
  /** SDK auto-generates one if omitted. */
  idempotencyKey?: string;
}

export interface LeaderboardEntry {
  participantId: string;
  kind: 'player' | 'bot';
  name: string | null;
  avatarUrl?: string | null;
  score: number;
  rank: number;
}

export interface Leaderboard {
  leaderboardId: string;
  mode: string;
  finalized: boolean;
  entries: LeaderboardEntry[];
  self: { rank: number; score: number } | null;
}

export interface LeaderboardReadOptions {
  /** Number of entries to fetch. 1–200, default 50 on the server side. */
  limit?: number;
  /** When true, server returns `self: { rank, score }` for the given externalId. */
  includeSelf?: boolean;
  /** Required when `includeSelf` is set. */
  externalId?: string;
}

export type GrantKind = 'reward' | 'crate';
export type GrantStatus = 'pending' | 'claimed' | 'expired';

export interface Grant {
  id: string;
  kind: GrantKind;
  contents: Record<string, unknown>;
  sourceKind: string;
  sourceRefId: string | null;
  parentGrantId: string | null;
  status: GrantStatus;
  rolledAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface OpenCrateResponse {
  crate: Grant;
  contents: Grant;
}

/**
 * Milestone payouts that fired during a single `progress` call. The
 * `key` identifies which milestone tripped (designers set this in the
 * event editor — show a toast or run a celebration animation against
 * it). `grants` carries the concrete rewards the engine wrote — same
 * shape `/grants/pending` would return, so the same handler can render
 * either path.
 */
export interface MilestoneFired {
  key: string;
  grants: Grant[];
}

export interface ProgressResponse {
  attempt: Attempt;
  /** Empty when nothing fired this update — never null, so callers can
   *  iterate without a null check. */
  milestonesFired: MilestoneFired[];
}

/**
 * One slot in an event's `entryCost.currencies` list — paid from the
 * player's wallet on attempt start. Lifted from the backend's
 * `EntryCost` shape verbatim.
 */
export interface EntryCostCurrency {
  key: string;
  amount: number;
}

/**
 * One slot in an event's `entryCost.items` list — consumed from
 * inventory on attempt start.
 */
export interface EntryCostItem {
  key: string;
  quantity: number;
}

/**
 * Transactional cost paid on `events.start`. Server atomically debits +
 * creates the attempt in a single tx — partial debits never persist.
 * Missing entry triggers a `KratyApiError` with code
 * `insufficient_entry_cost`.
 */
export interface EntryCost {
  currencies?: EntryCostCurrency[];
  items?: EntryCostItem[];
}

/**
 * Reward entry — one slot inside a reward bundle or milestone reward
 * payload. Sealed union on `type`.
 */
export type RewardEntryPreview =
  | { type: 'currency'; currencyKey: string; amount: number }
  | { type: 'item'; itemKey: string; quantity: number; parameters?: Record<string, unknown> }
  | { type: 'crate'; crateItemKey: string; quantity: number };

/**
 * Inline preview of a reward bundle's contents. Surfaced on
 * `EventListing.rewardPolicy` so the studio can render "you'll win X"
 * without resolving bundle IDs against a separate endpoint.
 */
export interface RewardBundlePreview {
  key: string;
  /** LocalizedString — either a plain string or a map. */
  name: unknown;
  entries: RewardEntryPreview[];
}

/**
 * One milestone reward — fires when the player crosses `threshold`
 * on `metricKey` during a single attempt. Use the preview to render
 * "next milestone: 5 rabbits → 200 cash + 5 bullets" in your UI.
 */
export interface MilestoneRewardPreview {
  key: string;
  metricKey: string;
  threshold: number;
  entries: RewardEntryPreview[];
}

/**
 * Reward policy summary with inline bundle previews. Mirrors the four
 * sealed policy types the backend supports:
 *  - `none` — event has no rewards (training / practice modes).
 *  - `fixed_bundle` — everyone who completes gets the same bundle.
 *  - `rank_scaled` — bundle picked by the player's final leaderboard rank.
 *  - `shared_pool` — currency pool split among winners.
 */
export interface RewardPolicySummary {
  type: 'none' | 'fixed_bundle' | 'rank_scaled' | 'shared_pool' | string;
  /** Set when `type === 'fixed_bundle'`. */
  bundle?: RewardBundlePreview | null;
  /** Set when `type === 'rank_scaled'`. */
  tiers?: Array<{ fromRank: number; toRank: number; bundle: RewardBundlePreview | null }>;
  /** Set when `type === 'shared_pool'`. */
  pool?: number;
  /** Set when `type === 'shared_pool'`. */
  currencyKey?: string;
}

export interface EventListing {
  eventKey: string;
  /**
   * LocalizedString — either a plain string or a map. Kept as
   * `unknown` so the SDK doesn't force a shape on consumers.
   */
  name: unknown;
  windowId: string;
  startsAt: string;
  endsAt: string;
  leaderboardId: string | null;
  currentAttemptId: string | null;

  /**
   * `'single_metric'` | `'multi_metric'` (and any future event-type
   * registry entries). Lets the SDK consumer pick the right UI
   * without a hardcoded per-event catalog.
   */
  type?: string;

  /**
   * `'global'` | `'global_segmented'` | `'grouped'` | `'lobby_matched'`.
   * Combined with `leaderboardId` tells the consumer whether to
   * expect `lobby_forming` on `events.start`.
   */
  leaderboardMode?: string;

  /**
   * Free-form metric definitions from the event row (key, target,
   * cap, scoreWeight, …). Same shape the server stores.
   */
  metrics?: Array<Record<string, unknown>>;

  /** Player-condition tree — null when there's no join gate. */
  entryRequirement?: Record<string, unknown> | null;

  /** Cost paid on attempt start. Absent / empty means "free to enter". */
  entryCost?: EntryCost | null;

  /**
   * Studio-defined free-form blob. Event-level metadata merged with
   * the active window's metadata (window keys win). Use for UI hints
   * — banner image keys, theme colors, special-event copy, etc.
   */
  metadata?: Record<string, unknown>;

  /** Mid-attempt milestone rewards. Empty array when none configured. */
  milestoneRewards?: MilestoneRewardPreview[];

  /** Reward policy summary with inline bundle previews. */
  rewardPolicy?: RewardPolicySummary;
}

/**
 * One item row as exposed to game clients via the catalog endpoint.
 * Display-relevant fields only — internal config / archival
 * timestamps stay off the SDK wire format.
 */
export interface CatalogItem {
  key: string;
  /** LocalizedString. */
  name: unknown;
  iconUrl: string | null;
  /** LocalizedString. */
  description: unknown | null;
  itemTypeKey: string;
  tags: string[];
  rarity: string | null;
  attributes: Record<string, unknown>;
}

/**
 * One currency row as exposed to game clients. `kind` distinguishes
 * spendable currencies (`'currency'`) from progression resources
 * (`'progression'`).
 */
export interface CatalogCurrency {
  key: string;
  /** LocalizedString. */
  name: unknown;
  iconUrl: string | null;
  /** LocalizedString. */
  description: unknown | null;
  kind: 'currency' | 'progression' | string;
}

export interface Catalog {
  items: CatalogItem[];
  currencies: CatalogCurrency[];
}

export interface PlayerContext {
  /** Arbitrary key/value pairs the engine forwards to score formulas, segments, etc. */
  [field: string]: unknown;
}

export type LobbyStatus = 'forming' | 'active' | 'closed';

export interface Lobby {
  id: string;
  eventId: string;
  eventWindowId: string;
  leaderboardId: string | null;
  mode: string;
  status: LobbyStatus | string;
  capacity: number;
  fillBy: string | null;
  participantCount: number;

  /**
   * Projected bot count at read time — derived server-side from the
   * lobby's age and the matchmaking drip interval. Grows monotonically
   * while the lobby is `'forming'`. UI typically renders
   * `participantCount + botSlots` filled cells out of `capacity` for a
   * smooth fill animation.
   */
  botSlots?: number;

  startedAt: string | null;
  endsAt: string | null;
}

/**
 * Convenience: total filled cells (humans + projected bots), capped at
 * capacity in case server / client clocks ever disagree mid-drip.
 */
export function lobbyFilledSlots(lobby: Lobby): number {
  const total = (lobby.participantCount ?? 0) + (lobby.botSlots ?? 0);
  return total > lobby.capacity ? lobby.capacity : total;
}

/**
 * Result of `players.register()`. The plaintext `secret` is only ever
 * surfaced HERE — store it locally on the device immediately. The next
 * call to `register()` for the same player returns 409
 * `player_already_registered`; lost-secret recovery is a studio-side
 * admin flow, not a client capability.
 */
export interface PlayerRegistration {
  playerId: string;
  externalPlayerId: string;
  secret: string;
  secretPrefix?: string | null;
  registeredAt?: string | null;
}

/**
 * One row in the player's platform-managed inventory. Returned by
 * `GET /sdk/v1/players/:externalId/inventory`. The item's display
 * name and other catalog metadata live on the `items` table — the
 * SDK only carries the per-player quantity + free-form metadata
 * stamped on deposits.
 */
export interface PlayerItemHolding {
  itemKey: string;
  quantity: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row in the player's wallet. Kind-agnostic: a `gold` currency
 * entry sits beside a `trophies` progression entry with the same
 * shape.
 */
export interface PlayerWalletHolding {
  economyKey: string;
  balance: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for `InventoryClient.consume`. The server requires
 * `idempotencyKey` for consume — the SDK auto-generates one if you
 * leave it null.
 */
export interface ConsumeItemInput {
  quantity: number;
  reason?: string;
  idempotencyKey?: string;
}

export interface ConsumeItemResult {
  itemKey: string;
  quantity: number;
  applied: boolean;
}

/**
 * Input for `WalletClient.debit`. Same idempotency story as
 * `ConsumeItemInput`. Credits are intentionally NOT in the client
 * SDK — only the studio's backend (`/server/v1/...`) can mint
 * balance, so a client SDK that exposed `credit` would invite money
 * printing.
 */
export interface DebitWalletInput {
  amount: number;
  reason?: string;
  idempotencyKey?: string;
}

export interface DebitWalletResult {
  economyKey: string;
  balance: number;
  applied: boolean;
}
