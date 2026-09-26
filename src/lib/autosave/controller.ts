/**
 * Autosave controller — framework-free so it can be unit-tested with fake
 * timers.
 *
 * Guarantees:
 * - Changes are debounced (default 1 s) and saved in order; a change made
 *   while a save is running is saved right after it.
 * - Every unconfirmed snapshot is mirrored to durable storage and only removed
 *   once the server confirmed that exact snapshot.
 * - Failed saves retry automatically with exponential backoff (2 s → 30 s)
 *   and can be retried manually. Nothing is silently dropped.
 */
export type AutosaveStatus =
  | "idle" // nothing to save yet
  | "blocked" // changes exist but cannot be saved yet (required fields missing)
  | "pending" // waiting for debounce
  | "saving"
  | "saved"
  | "error";

export type DurableStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

export type AutosaveOptions<T> = {
  /** Persist the snapshot. Must be idempotent (upsert). */
  save: (snapshot: T) => Promise<void>;
  /** False while required fields are missing: keep mirroring, don't send. */
  canSave?: (snapshot: T) => boolean;
  storageKey: string;
  store?: DurableStore | null;
  debounceMs?: number;
  onStatus?: (status: AutosaveStatus, error?: unknown) => void;
  onSaved?: (snapshot: T) => void;
  now?: () => number;
};

const BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];

export class AutosaveController<T> {
  private pending: T | null = null;
  private version = 0;
  private savedVersion = 0;
  private saving = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private status: AutosaveStatus = "idle";
  private disposed = false;
  private readonly opts: Required<Omit<AutosaveOptions<T>, "store" | "onSaved">> &
    Pick<AutosaveOptions<T>, "store" | "onSaved">;

  constructor(opts: AutosaveOptions<T>) {
    this.opts = {
      canSave: () => true,
      debounceMs: 1000,
      onStatus: () => {},
      now: () => Date.now(),
      ...opts,
    };
  }

  getStatus() {
    return this.status;
  }

  /** True while there are changes the server has not confirmed. */
  hasUnsaved() {
    return this.version !== this.savedVersion;
  }

  /** Previously mirrored snapshot that never reached the server (e.g. after a crash). */
  readRecovery(): { snapshot: T; at: number } | null {
    const raw = this.opts.store?.get(this.opts.storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { snapshot: T; at: number };
    } catch {
      return null;
    }
  }

  clearRecovery() {
    this.opts.store?.remove(this.opts.storageKey);
  }

  update(snapshot: T) {
    if (this.disposed) return;
    this.pending = snapshot;
    this.version++;
    this.mirror(snapshot);
    if (!this.opts.canSave(snapshot)) {
      this.clearTimer();
      this.setStatus("blocked");
      return;
    }
    this.failures = 0;
    this.schedule(this.opts.debounceMs);
    if (!this.saving) this.setStatus("pending");
  }

  /** Save now (e.g. on blur, before navigation, manual retry). */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.saving || this.disposed) return;
    if (!this.pending || !this.hasUnsaved()) return;
    if (!this.opts.canSave(this.pending)) {
      this.setStatus("blocked");
      return;
    }

    const snapshot = this.pending;
    const version = this.version;
    this.saving = true;
    this.setStatus("saving");
    try {
      await this.opts.save(snapshot);
      this.saving = false;
      this.failures = 0;
      this.savedVersion = Math.max(this.savedVersion, version);
      this.opts.onSaved?.(snapshot);
      if (this.hasUnsaved()) {
        // Newer edits arrived while saving: save them next.
        this.schedule(0);
        this.setStatus("pending");
      } else {
        this.clearRecovery();
        this.setStatus("saved");
      }
    } catch (error) {
      this.saving = false;
      const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
      this.failures++;
      this.setStatus("error", error);
      this.schedule(delay);
    }
  }

  retry() {
    this.failures = 0;
    return this.flush();
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
  }

  private schedule(ms: number) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private mirror(snapshot: T) {
    try {
      this.opts.store?.set(this.opts.storageKey, JSON.stringify({ snapshot, at: this.opts.now() }));
    } catch {
      // Storage full or unavailable: the in-memory copy still gets saved.
    }
  }

  private setStatus(status: AutosaveStatus, error?: unknown) {
    this.status = status;
    this.opts.onStatus(status, error);
  }
}

/** localStorage wrapper that never throws (private mode, quota, SSR). */
export const browserStore: DurableStore = {
  get(key) {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
