/**
 * Client finalization catch-up, per docs/05b.
 *
 * Tracks the boards the player is currently in (session/event boards) and lets
 * the app learn that one FINALIZED while the player was away, through the same
 * `onFinalized` callback the live stream uses.
 *
 * CORE INVARIANT: a finalization is recorded through EXACTLY ONE writer,
 * {@link FinalizationTracker.resolveFinalized}. Both the live SSE `finalized`
 * event AND `checkFinalizations()` route through it, so the SSE path persists
 * `status: 'finalized'` + `reportedAt` to the registry, not just fires the
 * callback. Whichever path arrives first wins; the other no-ops on
 * `reportedAt`. That is what makes delivery exactly-once across live + catch-up.
 */

/**
 * The kind of board a membership refers to. Use these constants instead of
 * hardcoding the wire strings, e.g. `MembershipKind.EventLeaderboard`, never
 * `'event_leaderboard'`. Values are the on-the-wire/persisted strings.
 */
export const MembershipKind = {
  /** A per-event (or per-session) board a player is placed on. */
  EventLeaderboard: 'event_leaderboard',
  /** A recurring leaderboard (catch-up deferred; see docs/05b). */
  Leaderboard: 'leaderboard',
} as const;
export type MembershipKind = (typeof MembershipKind)[keyof typeof MembershipKind];

/**
 * Why a board finalized. The precise reasons come from the live SSE stream;
 * a catch-up read can only tell that the board ended, reported as `Finalized`.
 */
export const FinalizationReason = {
  /** A session/lobby inside an event terminated early. */
  SessionTerminated: 'session_terminated',
  /** The event window closed. */
  WindowClosed: 'window_closed',
  /** A recurring leaderboard rolled to a new period. */
  PeriodRolled: 'period_rolled',
  /** Ended, but a catch-up read couldn't distinguish the precise cause. */
  Finalized: 'finalized',
} as const;
export type FinalizationReason = (typeof FinalizationReason)[keyof typeof FinalizationReason];

/** Whether a final standing belongs to a real player or a bot. */
export const StandingKind = {
  Player: 'player',
  Bot: 'bot',
} as const;
export type StandingKind = (typeof StandingKind)[keyof typeof StandingKind];

export interface EventLeaderboardRef {
  kind: typeof MembershipKind.EventLeaderboard;
  leaderboardId: string;
  eventKey?: string;
}
export interface LeaderboardRef {
  kind: typeof MembershipKind.Leaderboard;
  key: string;
  /** ISO start of the period the player is in. */
  period: string;
}
export type MembershipRef = EventLeaderboardRef | LeaderboardRef;

export interface TrackedMembership {
  ref: MembershipRef;
  status: 'active' | 'finalized';
  joinedAt: string;
  /** Set when onFinalized has fired; the dedupe guard. */
  reportedAt?: string;
  label?: string;
}

export interface FinalStanding {
  participantId: string;
  rank: number;
  score: number;
  name: string;
  kind: StandingKind;
}

export interface FinalizationResult {
  ref: MembershipRef;
  /** The precise reason when known (live SSE), or `finalized` when a catch-up
   *  read can only tell us the board ended, not why. */
  reason: FinalizationReason;
  self: { rank: number; score: number } | null;
  standings?: FinalStanding[];
  eventKey?: string;
}

/** Persisted registry, keyed per active player. Injectable per platform. */
export interface MembershipStore {
  load(playerId: string): Promise<TrackedMembership[]>;
  save(playerId: string, entries: TrackedMembership[]): Promise<void>;
}

/** Default store: in-process only; catch-up won't survive a restart. */
export class InMemoryMembershipStore implements MembershipStore {
  private readonly byPlayer = new Map<string, TrackedMembership[]>();
  async load(playerId: string): Promise<TrackedMembership[]> {
    return this.byPlayer.get(playerId)?.map((e) => ({ ...e })) ?? [];
  }
  async save(playerId: string, entries: TrackedMembership[]): Promise<void> {
    this.byPlayer.set(playerId, entries.map((e) => ({ ...e })));
  }
}

/** Minimal key-value surface; `globalThis.localStorage` satisfies it, but the
 *  SDK tsconfig has no DOM lib, so we declare only what we use. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Browser store: persists across restarts via localStorage. */
export class LocalStorageMembershipStore implements MembershipStore {
  constructor(private readonly ls: KeyValueStorage) {}
  private key(playerId: string): string {
    return `kraty.memberships.${playerId}`;
  }
  async load(playerId: string): Promise<TrackedMembership[]> {
    const raw = this.ls.getItem(this.key(playerId));
    if (!raw) return [];
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? (v as TrackedMembership[]) : [];
    } catch {
      return [];
    }
  }
  async save(playerId: string, entries: TrackedMembership[]): Promise<void> {
    this.ls.setItem(this.key(playerId), JSON.stringify(entries));
  }
}

function sameRef(a: MembershipRef, b: MembershipRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === MembershipKind.EventLeaderboard && b.kind === MembershipKind.EventLeaderboard) {
    return a.leaderboardId === b.leaderboardId;
  }
  if (a.kind === MembershipKind.Leaderboard && b.kind === MembershipKind.Leaderboard) {
    return a.key === b.key && a.period === b.period;
  }
  return false;
}

export type FinalizationListener = (result: FinalizationResult) => void;

export interface FinalizationTrackerDeps {
  store: MembershipStore;
  /** The active player id, or null if none is set yet. */
  getActivePlayerId(): Promise<string | null>;
  /** Read an event board's finalized status, WHY it finalized, and the
   *  caller's self entry. `reason` distinguishes a session that ended early
   *  (`SessionTerminated`) from the whole event window closing (`WindowClosed`);
   *  omit/null when unknown. Returns null when the board can't be read (treat as
   *  still-active). */
  readEventLeaderboard(leaderboardId: string): Promise<{
    finalized: boolean;
    reason?: FinalizationReason | null;
    self: { rank: number; score: number } | null;
  } | null>;
  /** Entries older than this (finalized+reported, or stale-active) are pruned.
   *  Default 7 days. */
  pruneAfterMs?: number;
}

const DEFAULT_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

export class FinalizationTracker {
  private readonly listeners = new Set<FinalizationListener>();
  // Serializes all registry read-modify-write so a live SSE event and a
  // checkFinalizations() poll can't both pass the reportedAt guard.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: FinalizationTrackerDeps) {}

  /** Register a finalization handler. Returns an unsubscribe fn. */
  onFinalized(cb: FinalizationListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Record that the player joined a board (idempotent upsert). Called by the
   *  SDK on start / join / submitScore. */
  async track(ref: MembershipRef, label?: string): Promise<void> {
    const playerId = await this.deps.getActivePlayerId();
    if (!playerId) return;
    await this.serialize(async () => {
      const entries = await this.deps.store.load(playerId);
      const pruned = this.prune(entries);
      if (!pruned.some((e) => sameRef(e.ref, ref))) {
        pruned.push({ ref, status: 'active', joinedAt: new Date().toISOString(), ...(label ? { label } : {}) });
      }
      await this.deps.store.save(playerId, pruned);
    });
  }

  /**
   * The SINGLE writer for a finalization. Persists status + reportedAt THEN
   * fires the callback. Returns true iff this call resolved the entry (so the
   * caller counts it once). No-ops if the entry is unknown or already reported.
   */
  private resolveFinalized(
    playerId: string,
    ref: MembershipRef,
    result: FinalizationResult,
  ): Promise<boolean> {
    return this.serialize(async () => {
      const entries = await this.deps.store.load(playerId);
      const entry = entries.find((e) => sameRef(e.ref, ref));
      if (!entry || entry.reportedAt) return false; // unknown or already reported
      entry.status = 'finalized';
      entry.reportedAt = new Date().toISOString();
      await this.deps.store.save(playerId, entries); // persist BEFORE firing
      this.emit(result);
      return true;
    });
  }

  /**
   * Live SSE path: a `finalized` stream event arrived for `leaderboardId`.
   * Routes through the same writer as catch-up, persisting to the registry AND
   * fires the callback. (This is the invariant in docs/05b.)
   */
  async onStreamFinalized(
    leaderboardId: string,
    data: { reason?: string; standings?: FinalStanding[]; eventId?: string },
  ): Promise<void> {
    const playerId = await this.deps.getActivePlayerId();
    if (!playerId) return;
    const ref: MembershipRef = { kind: MembershipKind.EventLeaderboard, leaderboardId };
    const reason: FinalizationReason =
      data.reason === FinalizationReason.SessionTerminated ||
      data.reason === FinalizationReason.WindowClosed
        ? data.reason
        : FinalizationReason.Finalized;
    await this.resolveFinalized(playerId, ref, {
      ref,
      reason,
      // The self entry isn't in the stream payload; the app can match itself in
      // `standings` by participantId. Left null here.
      self: null,
      ...(data.standings ? { standings: data.standings } : {}),
    });
  }

  /**
   * Catch-up path: poll the still-active tracked boards and report any that
   * have finalized (through the same writer). Returns the newly-finalized
   * results (also delivered via onFinalized). Cheap when the registry is empty.
   */
  async checkFinalizations(): Promise<FinalizationResult[]> {
    const playerId = await this.deps.getActivePlayerId();
    if (!playerId) return [];
    const entries = await this.deps.store.load(playerId);
    const active = entries.filter((e) => e.status === 'active');
    const out: FinalizationResult[] = [];
    for (const e of active) {
      if (e.ref.kind !== MembershipKind.EventLeaderboard) continue; // leaderboard catch-up: see docs/05b (deferred)
      const read = await this.deps.readEventLeaderboard(e.ref.leaderboardId);
      if (!read?.finalized) continue;
      const result: FinalizationResult = {
        ref: e.ref,
        // The board now persists WHY it finalized, so a catch-up read can tell
        // a terminated session from a closed window. `Finalized` is only the
        // fallback if the backend didn't supply a reason.
        reason: read.reason ?? FinalizationReason.Finalized,
        self: read.self,
        ...(e.ref.eventKey ? { eventKey: e.ref.eventKey } : {}),
      };
      if (await this.resolveFinalized(playerId, e.ref, result)) out.push(result);
    }
    return out;
  }

  /**
   * Acknowledge a finalization once the app has shown it; removes that
   * membership from the registry so it never surfaces again and doesn't linger
   * in storage. No-op if the ref isn't tracked. Call from your `onFinalized`
   * handler (or after rendering the result screen).
   */
  async dismiss(ref: MembershipRef): Promise<void> {
    const playerId = await this.deps.getActivePlayerId();
    if (!playerId) return;
    await this.serialize(async () => {
      const entries = await this.deps.store.load(playerId);
      const kept = entries.filter((e) => !sameRef(e.ref, ref));
      if (kept.length !== entries.length) await this.deps.store.save(playerId, kept);
    });
  }

  /**
   * Bulk cleanup: drop every already-reported (finalized + delivered) entry.
   * Handy after a results screen that batch-shows all pending finalizations.
   * Returns how many were removed.
   */
  async clearReported(): Promise<number> {
    const playerId = await this.deps.getActivePlayerId();
    if (!playerId) return 0;
    return this.serialize(async () => {
      const entries = await this.deps.store.load(playerId);
      const kept = entries.filter((e) => !e.reportedAt);
      if (kept.length !== entries.length) await this.deps.store.save(playerId, kept);
      return entries.length - kept.length;
    });
  }

  private prune(entries: TrackedMembership[]): TrackedMembership[] {
    const cutoff = Date.now() - (this.deps.pruneAfterMs ?? DEFAULT_PRUNE_MS);
    return entries.filter((e) => {
      const ts = Date.parse(e.reportedAt ?? e.joinedAt);
      return Number.isNaN(ts) || ts >= cutoff;
    });
  }

  private emit(result: FinalizationResult): void {
    for (const l of this.listeners) {
      try {
        l(result);
      } catch {
        /* a listener throwing must not break the writer */
      }
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
