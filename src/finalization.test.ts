import { describe, expect, it, vi } from 'vitest';
import {
  FinalizationTracker,
  FinalizationReason,
  InMemoryMembershipStore,
  MembershipKind,
  type FinalizationReason as FinalizationReasonT,
  type FinalizationResult,
} from './finalization.js';

function makeTracker(opts?: {
  finalized?: boolean;
  reason?: FinalizationReasonT | null;
  self?: { rank: number; score: number } | null;
}) {
  const store = new InMemoryMembershipStore();
  const readEventLeaderboard = vi.fn(async () => ({
    finalized: opts?.finalized ?? false,
    reason: opts?.reason ?? null,
    self: opts?.self ?? { rank: 3, score: 42 },
  }));
  const tracker = new FinalizationTracker({
    store,
    getActivePlayerId: async () => 'p1',
    readEventLeaderboard,
  });
  const fired: FinalizationResult[] = [];
  tracker.onFinalized((r) => fired.push(r));
  return { store, tracker, readEventLeaderboard, fired };
}

const REF = { kind: MembershipKind.EventLeaderboard, leaderboardId: 'lb-1', eventKey: 'daily' };

describe('FinalizationTracker.track', () => {
  it('is an idempotent upsert', async () => {
    const { store, tracker } = makeTracker();
    await tracker.track(REF);
    await tracker.track(REF);
    const entries = await store.load('p1');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 'active', ref: REF });
  });
});

describe('the SSE path writes the registry (core invariant)', () => {
  it('onStreamFinalized marks the entry finalized + reportedAt AND fires once', async () => {
    const { store, tracker, fired } = makeTracker();
    await tracker.track(REF);

    await tracker.onStreamFinalized('lb-1', {
      reason: 'session_terminated',
      standings: [{ participantId: 'x', rank: 1, score: 5, name: 'A', kind: 'player' }],
    });

    // Registry updated (not just the callback).
    const entry = (await store.load('p1'))[0]!;
    expect(entry.status).toBe('finalized');
    expect(entry.reportedAt).toBeTruthy();
    // Callback fired exactly once with the SSE reason.
    expect(fired).toHaveLength(1);
    expect(fired[0]!.reason).toBe('session_terminated');
  });

  it('a later checkFinalizations does NOT re-fire what the SSE already resolved', async () => {
    const { tracker, fired, readEventLeaderboard } = makeTracker({ finalized: true });
    await tracker.track(REF);

    // SSE resolves it first.
    await tracker.onStreamFinalized('lb-1', { reason: 'window_closed' });
    expect(fired).toHaveLength(1);

    // Catch-up now sees a finalized board, but the entry is already reported.
    const newlyFinalized = await tracker.checkFinalizations();
    expect(newlyFinalized).toEqual([]); // no re-report
    expect(fired).toHaveLength(1); // still one
    // (readEventLeaderboard may be consulted, but the writer no-ops on reportedAt.)
    void readEventLeaderboard;
  });
});

describe('checkFinalizations (catch-up path)', () => {
  it('fires once for a board that finalized while away, then never again', async () => {
    const { tracker, fired } = makeTracker({ finalized: true, self: { rank: 2, score: 99 } });
    await tracker.track(REF);

    const first = await tracker.checkFinalizations();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ self: { rank: 2, score: 99 }, eventKey: 'daily' });
    expect(fired).toHaveLength(1);

    const second = await tracker.checkFinalizations();
    expect(second).toEqual([]); // dedupe
    expect(fired).toHaveLength(1);
  });

  it('threads the persisted reason through (session vs window)', async () => {
    const session = makeTracker({ finalized: true, reason: FinalizationReason.SessionTerminated });
    await session.tracker.track(REF);
    const s = await session.tracker.checkFinalizations();
    expect(s[0]!.reason).toBe(FinalizationReason.SessionTerminated);

    const window = makeTracker({ finalized: true, reason: FinalizationReason.WindowClosed });
    await window.tracker.track(REF);
    const w = await window.tracker.checkFinalizations();
    expect(w[0]!.reason).toBe(FinalizationReason.WindowClosed);
  });

  it('falls back to Finalized when the read gives no reason', async () => {
    const { tracker } = makeTracker({ finalized: true, reason: null });
    await tracker.track(REF);
    const out = await tracker.checkFinalizations();
    expect(out[0]!.reason).toBe(FinalizationReason.Finalized);
  });

  it('ignores still-active boards', async () => {
    const { tracker, fired } = makeTracker({ finalized: false });
    await tracker.track(REF);
    expect(await tracker.checkFinalizations()).toEqual([]);
    expect(fired).toHaveLength(0);
  });
});

describe('dismiss / clearReported', () => {
  it('dismiss removes a membership so it never resurfaces', async () => {
    const { store, tracker } = makeTracker({ finalized: true });
    await tracker.track(REF);
    await tracker.dismiss(REF);
    expect(await store.load('p1')).toEqual([]);
    // Even though the board is finalized, a check finds nothing tracked.
    expect(await tracker.checkFinalizations()).toEqual([]);
  });

  it('clearReported drops delivered entries but keeps active ones', async () => {
    const { store, tracker } = makeTracker({ finalized: true });
    await tracker.track(REF); // will be reported
    await tracker.track({ kind: 'event_leaderboard', leaderboardId: 'lb-2' }); // stays active
    await tracker.onStreamFinalized('lb-1', { reason: 'window_closed' });

    const removed = await tracker.clearReported();
    expect(removed).toBe(1);
    const left = await store.load('p1');
    expect(left).toHaveLength(1);
    expect(left[0]!.ref).toMatchObject({ leaderboardId: 'lb-2' });
  });
});

describe('serialization', () => {
  it('concurrent SSE + checkFinalizations resolve exactly once', async () => {
    const { tracker, fired } = makeTracker({ finalized: true });
    await tracker.track(REF);

    // Fire both without awaiting between them; the internal queue must
    // serialize so only one passes the reportedAt guard.
    await Promise.all([
      tracker.onStreamFinalized('lb-1', { reason: 'session_terminated' }),
      tracker.checkFinalizations(),
    ]);

    expect(fired).toHaveLength(1);
  });
});
