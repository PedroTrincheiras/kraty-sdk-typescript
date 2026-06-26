import { KratyApiError, KratyNetworkError, type KratyErrorPayload } from './errors.js';

/**
 * One event emitted by the leaderboard SSE stream. `kind` is the SSE
 * `event:` line — typically:
 *
 * - `ready` — handshake, sent once after the subscription is wired.
 *   Safe to start posting progress as soon as this lands without
 *   missing the resulting update.
 * - `score_update` — a participant's score / rank changed; `data`
 *   carries the new entry.
 * - `closed` — server is finalizing or closing. After this the
 *   stream completes.
 *
 * `data` is the parsed `data:` JSON line.
 */
export interface LeaderboardStreamEvent {
  kind: string;
  data: Record<string, unknown>;
}

/**
 * Handle to an active SSE subscription. Iterate `events` to consume
 * server-pushed updates, call `close()` to stop.
 *
 * The SDK does NOT auto-reconnect on transport drop — surface errors
 * from the iterable and re-call `leaderboards.live(...)` after a
 * backoff if you want resumption.
 */
export interface LeaderboardStream {
  /** Async iterable of server-pushed events. Throws on transport drop. */
  events: AsyncIterable<LeaderboardStreamEvent>;
  /**
   * Cancels the subscription + closes the underlying HTTP stream.
   * Idempotent — safe to call after the server emits `closed`.
   */
  close(): Promise<void>;
}

interface OpenArgs {
  fetchImpl: typeof fetch;
  baseUrl: string;
  leaderboardId: string;
  authHeader: string;
  playerSecret: string | null;
  sdkUserAgent: string;
}

/**
 * Opens an SSE subscription to a leaderboard. Returns a
 * `LeaderboardStream` handle whose `events` async-iterable yields
 * each parsed event. Does NOT auto-reconnect.
 */
export async function openLeaderboardStream(args: OpenArgs): Promise<LeaderboardStream> {
  const url = `${args.baseUrl}/sdk/v1/event-leaderboards/${encodeURIComponent(args.leaderboardId)}/stream`;
  const controller = new AbortController();

  let response: Response;
  try {
    response = await args.fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: args.authHeader,
        accept: 'text/event-stream',
        'x-kraty-sdk': args.sdkUserAgent,
        ...(args.playerSecret ? { 'x-player-secret': args.playerSecret } : {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    throw new KratyNetworkError(
      `leaderboard stream connect failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let payload: { error?: KratyErrorPayload } | undefined;
    try {
      payload = text ? (JSON.parse(text) as { error?: KratyErrorPayload }) : undefined;
    } catch {
      /* not JSON — fall through */
    }
    throw new KratyApiError(
      response.status,
      payload?.error?.code ?? `http_${response.status}`,
      payload?.error?.message ?? text,
      payload?.error?.details,
    );
  }

  if (!response.body) {
    throw new KratyNetworkError('leaderboard stream: response has no body stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let closed = false;

  async function* iterate(): AsyncGenerator<LeaderboardStreamEvent, void, unknown> {
    let currentEvent = 'message';
    let dataBuffer = '';

    const flushEvent = (): LeaderboardStreamEvent | null => {
      if (dataBuffer.length === 0) {
        currentEvent = 'message';
        return null;
      }
      let parsed: Record<string, unknown>;
      try {
        const j: unknown = JSON.parse(dataBuffer);
        parsed = j && typeof j === 'object' && !Array.isArray(j)
          ? (j as Record<string, unknown>)
          : { value: j };
      } catch {
        // Parse error — surface as an event with kind="parse-error"
        // so consumers can decide whether to bail or keep listening.
        parsed = { raw: dataBuffer };
        const ev: LeaderboardStreamEvent = { kind: 'parse-error', data: parsed };
        dataBuffer = '';
        currentEvent = 'message';
        return ev;
      }
      const ev: LeaderboardStreamEvent = { kind: currentEvent, data: parsed };
      dataBuffer = '';
      currentEvent = 'message';
      return ev;
    };

    const processLine = (line: string): LeaderboardStreamEvent | null => {
      if (line.length === 0) {
        // Blank line terminates an event.
        return flushEvent();
      }
      if (line.startsWith(':')) {
        // Comment / heartbeat — ignore.
        return null;
      }
      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) return null;
      const field = line.slice(0, colonIdx);
      let value = line.slice(colonIdx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      switch (field) {
        case 'event':
          currentEvent = value;
          break;
        case 'data':
          if (dataBuffer.length > 0) dataBuffer += '\n';
          dataBuffer += value;
          break;
        // SSE also defines `id` and `retry` — we don't use them.
        default:
          break;
      }
      return null;
    };

    try {
      while (true) {
        if (closed) return;
        const { value, done } = await reader.read();
        if (done) {
          // Server closed the stream — flush any final event.
          const tail = flushEvent();
          if (tail) yield tail;
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          // SSE uses LF or CRLF; trim a trailing CR.
          let line = buffer.slice(0, newlineIdx);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          buffer = buffer.slice(newlineIdx + 1);
          const ev = processLine(line);
          if (ev) yield ev;
        }
      }
    } catch (err) {
      if (closed) return;
      if (err instanceof KratyApiError || err instanceof KratyNetworkError) throw err;
      throw new KratyNetworkError(
        `leaderboard stream read failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  return {
    events: iterate(),
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try { controller.abort(); } catch { /* swallow */ }
      try { await reader.cancel(); } catch { /* swallow */ }
    },
  };
}
