/**
 * Queue of deletions that run after a delay unless they are undone.
 * Timers and database access are injected, so the queue can be tested without React or Tauri.
 */

export type DeletableType = "income" | "expense" | "recurring";

export interface PendingDeletion {
  key: number;
  id: number;
  type: DeletableType;
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
  inFlight: boolean;
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
      void this.commit(item.key);
    }, this.deps.delayMs);
    this.entries.set(item.key, { item, handle, inFlight: false });
    this.emit();
    return item.key;
  }

  // False when the deletion already started (it can no longer be undone) or does not exist.
  undo(key: number): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.inFlight) return false;
    this.deps.cancel(entry.handle);
    this.entries.delete(key);
    this.emit();
    return true;
  }

  pending(): PendingDeletion[] {
    return Array.from(this.entries.values(), (entry) => entry.item);
  }

  private async commit(key: number): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.inFlight) return;
    entry.inFlight = true;
    try {
      await this.deps.execute(entry.item.type, entry.item.id);
    } catch (error) {
      this.entries.delete(key);
      this.emit();
      this.deps.onFailure(entry.item, error);
      return;
    }
    this.entries.delete(key);
    this.emit();
    this.deps.onSuccess(entry.item);
  }

  private emit(): void {
    this.deps.onChange(this.pending());
  }
}
