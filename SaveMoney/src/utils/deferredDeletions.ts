/**
 * Queue of deletions that run after a delay unless they are undone, or when they are finalized.
 * Timers and database access are injected, so the queue can be tested without React or Tauri.
 */

export type DeletableType = "income" | "expense" | "recurring";

export interface PendingDeletion {
  key: number;
  id: number;
  type: DeletableType;
}

export interface DeletionOutcome {
  item: PendingDeletion;
  ok: boolean;
  error?: unknown;
}

export interface DeferredDeletionDeps {
  delayMs: number;
  schedule: (run: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
  execute: (type: DeletableType, id: number) => Promise<void>;
  onChange: (pending: PendingDeletion[]) => void;
  onSuccess: (item: PendingDeletion) => void;
  onFailure: (item: PendingDeletion, error: unknown) => void;
}

interface Entry {
  item: PendingDeletion;
  handle: unknown;
  // Set once the DELETE has started: the entry then cannot be undone and must not run again.
  outcome?: Promise<DeletionOutcome>;
}

export class DeferredDeletionQueue {
  private readonly entries = new Map<number, Entry>();
  private nextKey = 0;

  constructor(private readonly deps: DeferredDeletionDeps) {}

  // Returns the key identifying this deletion; undo() and the timer both use it.
  schedule(id: number, type: DeletableType): number {
    this.nextKey += 1;
    const item: PendingDeletion = { key: this.nextKey, id, type };
    // The timer is not cleared on unmount: a pending deletion still runs unless it is undone.
    const handle = this.deps.schedule(() => {
      void this.start(item.key);
    }, this.deps.delayMs);
    this.entries.set(item.key, { item, handle });
    this.emit();
    return item.key;
  }

  // False when the deletion already started or finished, or does not exist.
  undo(key: number): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.outcome) return false;
    this.deps.cancel(entry.handle);
    this.entries.delete(key);
    this.emit();
    return true;
  }

  hasPending(): boolean {
    return this.entries.size > 0;
  }

  pending(): PendingDeletion[] {
    return Array.from(this.entries.values(), (entry) => entry.item);
  }

  // Runs every pending deletion now and waits for those already running.
  // Each operation starts at most once, so concurrent calls share the same work.
  async flushAll(): Promise<DeletionOutcome[]> {
    const started: Promise<DeletionOutcome>[] = [];
    for (const key of Array.from(this.entries.keys())) {
      const outcome = this.start(key);
      if (outcome) started.push(outcome);
    }
    return Promise.all(started);
  }

  private start(key: number): Promise<DeletionOutcome> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (!entry.outcome) {
      this.deps.cancel(entry.handle);
      entry.outcome = this.run(key, entry.item);
    }
    return entry.outcome;
  }

  private async run(key: number, item: PendingDeletion): Promise<DeletionOutcome> {
    try {
      await this.deps.execute(item.type, item.id);
    } catch (error) {
      this.entries.delete(key);
      this.emit();
      this.deps.onFailure(item, error);
      return { item, ok: false, error };
    }
    this.entries.delete(key);
    this.emit();
    this.deps.onSuccess(item);
    return { item, ok: true };
  }

  private emit(): void {
    this.deps.onChange(this.pending());
  }
}
