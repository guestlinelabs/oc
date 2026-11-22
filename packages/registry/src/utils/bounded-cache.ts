// A small LRU cache keyed by namespace + key. Backed by a Map, which
// preserves insertion order: re-inserting an entry moves it to the
// most-recently-used end, and the oldest entry is always first.

export default class BoundedCache {
  private readonly cache = new Map<string, NonNullable<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('Cache capacity must be a positive integer');
    }
    this.maxEntries = maxEntries;
  }

  get<T>(namespace: string, key: string): T | undefined {
    const cacheKey = this.toKey(namespace, key);
    if (!this.cache.has(cacheKey)) {
      return undefined;
    }
    const value = this.cache.get(cacheKey) as T;
    // promote to most-recently-used
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, value as NonNullable<unknown>);
    return value;
  }

  set<T>(namespace: string, key: string, value: T): void {
    const cacheKey = this.toKey(namespace, key);
    // delete first so re-inserts land at the most-recently-used end
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, value as NonNullable<unknown>);

    if (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
  }

  delete(namespace: string, key: string): boolean {
    return this.cache.delete(this.toKey(namespace, key));
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private toKey(namespace: string, key: string): string {
    return JSON.stringify([namespace, key]);
  }
}
