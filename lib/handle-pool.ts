/** Bounded process-local LRU. Callers must not retain handles across eviction. */
export class HandlePool<T extends { close(): void }> {
  private entries = new Map<string, T>();
  constructor(private open: (key: string) => T, private capacity = 50) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid handle pool capacity');
  }
  get size() { return this.entries.size; }
  get(key: string): T {
    const existing = this.entries.get(key);
    if (existing) { this.entries.delete(key); this.entries.set(key, existing); return existing; }
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value!;
      this.entries.get(oldest)!.close(); this.entries.delete(oldest);
    }
    const value = this.open(key); this.entries.set(key, value); return value;
  }
  closeAll() { for (const value of this.entries.values()) value.close(); this.entries.clear(); }
}
