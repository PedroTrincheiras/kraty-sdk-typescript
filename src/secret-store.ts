/**
 * Per-player secret persistence contract for `Kraty.connectAsPlayer`.
 * The SDK is runtime-agnostic so it can't pick a platform-specific
 * storage backend. Consumers implement this against whatever they ship:
 *
 * - **Browser** → use the bundled `LocalStorageSecretStore`, or wrap
 *   `window.sessionStorage` / IndexedDB for non-persistent secrets.
 * - **Node** → wrap `fs.promises` against a per-user secret file,
 *   or the OS keychain via a third-party module.
 * - **Tests** → use `InMemorySecretStore`.
 *
 * Contract:
 *
 * - `read` returns `null` (not throw) when no secret is stored. The
 *   SDK treats `null` and the empty string identically — both
 *   trigger a fresh `register`.
 * - `write` must be durable across page loads / process restarts. The
 *   SDK calls it exactly once per successful register. Overwriting is
 *   fine — that's the rotation path.
 * - `remove` is called by your own logout flow; the SDK never calls
 *   it internally.
 * - Operations are awaited on the boot path — implementations should
 *   be reasonably fast (`<50ms`). Don't network-call from here.
 * - Key namespace is your problem: include `externalPlayerId` in the
 *   storage key so a device switching between two players doesn't
 *   mix secrets.
 */
export interface SecretStore {
  read(externalPlayerId: string): Promise<string | null>;
  write(externalPlayerId: string, secret: string): Promise<void>;
  remove(externalPlayerId: string): Promise<void>;
  /**
   * Optional: persist and recall which player this device is
   * currently signed in as. Used by `kraty.players.currentIdentity()`
   * and `restoreIdentity()` so the studio's UI can ask "who's
   * logged in?" without threading the id through their own state.
   *
   * Stores that don't implement these methods are forward-compatible
   * — the Kraty client falls back to "no remembered identity".
   */
  readActiveExternalPlayerId?(): Promise<string | null>;
  writeActiveExternalPlayerId?(externalPlayerId: string): Promise<void>;
  clearActiveExternalPlayerId?(): Promise<void>;
}

/**
 * Volatile, process-local store. Intended for unit tests and
 * short-lived bootstrap scripts. Production code SHOULD ship a
 * persisted impl so a fresh launch doesn't trigger an avoidable
 * `register?force=true` rotation.
 */
export class InMemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();
  private activeExternalPlayerId: string | null = null;

  async read(externalPlayerId: string): Promise<string | null> {
    return this.secrets.get(externalPlayerId) ?? null;
  }

  async write(externalPlayerId: string, secret: string): Promise<void> {
    this.secrets.set(externalPlayerId, secret);
  }

  async remove(externalPlayerId: string): Promise<void> {
    this.secrets.delete(externalPlayerId);
    if (this.activeExternalPlayerId === externalPlayerId) {
      this.activeExternalPlayerId = null;
    }
  }

  async readActiveExternalPlayerId(): Promise<string | null> {
    return this.activeExternalPlayerId;
  }

  async writeActiveExternalPlayerId(externalPlayerId: string): Promise<void> {
    this.activeExternalPlayerId = externalPlayerId;
  }

  async clearActiveExternalPlayerId(): Promise<void> {
    this.activeExternalPlayerId = null;
  }
}

/**
 * Minimal structural type matching the bits of `window.localStorage`
 * the SDK uses. Declared locally so the SDK doesn't have to pull in
 * the full DOM type lib (it ships ES2022-lib-only to stay isomorphic).
 */
interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Browser-only `SecretStore` backed by `window.localStorage`.
 * Reasonable default for prototypes; for higher-security flows
 * consider `sessionStorage` (cleared on tab close) or an
 * auth-provider session store.
 *
 * Throws on construction if `localStorage` isn't available (Node,
 * service workers, sandboxed iframes with storage disabled). Pass a
 * compatible store (e.g. `sessionStorage`) as the first arg to use a
 * different backend with the same wire shape.
 */
export class LocalStorageSecretStore implements SecretStore {
  private readonly storage: WebStorageLike;
  private readonly keyPrefix: string;

  constructor(
    storageOrPrefix?: WebStorageLike | string,
    keyPrefix = 'kraty.playerSecret.',
  ) {
    let store: WebStorageLike | undefined;
    let prefix = keyPrefix;
    if (typeof storageOrPrefix === 'string') {
      prefix = storageOrPrefix;
    } else if (storageOrPrefix) {
      store = storageOrPrefix;
    }
    if (!store) {
      const g = globalThis as { localStorage?: WebStorageLike };
      if (!g.localStorage) {
        throw new Error(
          'LocalStorageSecretStore: window.localStorage is not available in this runtime — pass a compatible store explicitly',
        );
      }
      store = g.localStorage;
    }
    this.storage = store;
    this.keyPrefix = prefix;
  }

  async read(externalPlayerId: string): Promise<string | null> {
    const v = this.storage.getItem(this.keyPrefix + externalPlayerId);
    return v && v.length > 0 ? v : null;
  }

  async write(externalPlayerId: string, secret: string): Promise<void> {
    this.storage.setItem(this.keyPrefix + externalPlayerId, secret);
  }

  async remove(externalPlayerId: string): Promise<void> {
    this.storage.removeItem(this.keyPrefix + externalPlayerId);
    const active = this.storage.getItem(this.keyPrefix + '__active__');
    if (active === externalPlayerId) {
      this.storage.removeItem(this.keyPrefix + '__active__');
    }
  }

  async readActiveExternalPlayerId(): Promise<string | null> {
    const v = this.storage.getItem(this.keyPrefix + '__active__');
    return v && v.length > 0 ? v : null;
  }

  async writeActiveExternalPlayerId(externalPlayerId: string): Promise<void> {
    this.storage.setItem(this.keyPrefix + '__active__', externalPlayerId);
  }

  async clearActiveExternalPlayerId(): Promise<void> {
    this.storage.removeItem(this.keyPrefix + '__active__');
  }
}
