/** Bounded LRU. Use a lease when a handle must survive an await or another lookup. */
export class HandlePool<T extends { close(): void }> {
  private entries = new Map<string, { value: T; leases: number }>();
  constructor(private open: (key: string) => T, private capacity = 50) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid handle pool capacity');
  }
  get size() { return this.entries.size; }
  get(key: string): T {
    const existing = this.entries.get(key);
    if (existing) { this.entries.delete(key); this.entries.set(key, existing); return existing.value; }
    if (this.entries.size >= this.capacity) {
      const oldest = [...this.entries].find(([, entry]) => entry.leases === 0);
      if (!oldest) throw new Error('Workspace handle capacity reached; all handles are in use');
      oldest[1].value.close(); this.entries.delete(oldest[0]);
    }
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
  }
}
