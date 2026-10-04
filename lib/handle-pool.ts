/** Bounded LRU. Use a lease when a handle must survive an await or another lookup. */
export class HandlePool<T extends { close(): void }> {
  private entries = new Map<string, { value: T; leases: number }>();
  private closing = new Map<string, { value: T; timer: ReturnType<typeof setTimeout> }>();
  constructor(private open: (key: string) => T, private capacity = 50, private graceMs = 60_000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid handle pool capacity');
    if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('Invalid handle grace period');
  }
  get size() { return this.entries.size; }
  get openSize() { return this.entries.size + this.closing.size; }
  private retireOldest() {
    const oldest = [...this.entries].find(([, entry]) => entry.leases === 0);
    if (!oldest || this.closing.size >= this.capacity) throw new Error('Workspace handle capacity reached; retry after active work or grace period ends');
    const [key, entry] = oldest;
    const timer = setTimeout(() => {
      entry.value.close(); this.closing.delete(key);
    }, this.graceMs);
    timer.unref?.();
    this.entries.delete(key); this.closing.set(key, { value: entry.value, timer });
  }
  get(key: string): T {
    const existing = this.entries.get(key);
    if (existing) { this.entries.delete(key); this.entries.set(key, existing); return existing.value; }
    const pending = this.closing.get(key);
    if (pending) {
      // A revival must not strand the old handle if every active slot is leased.
      if (this.entries.size >= this.capacity && ![...this.entries.values()].some(entry => entry.leases === 0)) throw new Error('Workspace handle capacity reached');
      clearTimeout(pending.timer); this.closing.delete(key);
      if (this.entries.size >= this.capacity) this.retireOldest();
      this.entries.set(key, { value: pending.value, leases: 0 }); return pending.value;
    }
    if (this.entries.size >= this.capacity) this.retireOldest();
    const value = this.open(key); this.entries.set(key, { value, leases: 0 }); return value;
  }
  acquire(key: string): { value: T; release(): void } {
    const value = this.get(key), entry = this.entries.get(key)!;
    entry.leases++;
    let released = false;
    return { value, release() { if (!released) { released = true; entry.leases--; } } };
  }
  async withHandle<R>(key: string, work: (value: T) => R | Promise<R>): Promise<R> {
    const lease = this.acquire(key);
    try { return await work(lease.value); } finally { lease.release(); }
  }
  closeAll() {
    if ([...this.entries.values()].some(entry => entry.leases > 0)) throw new Error('Workspace handles are still in use');
    for (const entry of this.entries.values()) entry.value.close(); this.entries.clear();
    for (const entry of this.closing.values()) { clearTimeout(entry.timer); entry.value.close(); } this.closing.clear();
  }
}
