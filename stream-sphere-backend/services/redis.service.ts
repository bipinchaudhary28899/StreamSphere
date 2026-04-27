import Redis from 'ioredis';

class RedisService {
  private client: Redis | null = null;


  connect(): void {
    const REDIS_URL = process.env.REDIS_URL;

    if (!REDIS_URL) {
      console.warn('[Redis] REDIS_URL not set — caching disabled, falling back to MongoDB for every request');
      return;
    }

    this.client = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,      // fail fast, don't block the request chain
      connectTimeout: 4000,
      commandTimeout: 3000,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        // Exponential back-off capped at 10 s; give up after 10 attempts
        if (times > 10) return null;
        return Math.min(times * 500, 10_000);
      },
    });

    this.client.on('connect', () => console.log('✅ Redis connected'));
    this.client.on('error',   (e) => console.error('[Redis] error:', e.message));

    this.client.connect().catch(() => {/* initial connect failure — retryStrategy takes over */});
  }

  disconnect(): Promise<string> {
    return this.client ? this.client.quit() : Promise.resolve('OK');
  }

  private alive(): boolean {
    return this.client !== null && this.client.status === 'ready';
  }

  isAvailable(): boolean {
    return this.alive();
  }


  async get<T>(key: string): Promise<T | null> {
    if (!this.alive()) return null;
    try {
      const raw = await this.client!.get(key);
      return raw ? JSON.parse(raw) as T : null;
    } catch (e: any) {
      console.error('[Redis] get error:', e.message);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.alive()) return;
    try {
      await this.client!.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (e: any) {
      console.error('[Redis] set error:', e.message);
    }
  }

  async incr(key: string, ttlSeconds?: number): Promise<void> {
    if (!this.alive()) return;
    try {
      const newVal = await this.client!.incr(key);
      if (newVal === 1 && ttlSeconds) {
        await this.client!.expire(key, ttlSeconds);
      }
    } catch (e: any) {
      console.error('[Redis] incr error:', e.message);
    }
  }

  async getCounter(key: string): Promise<number> {
    if (!this.alive()) return 0;
    try {
      const val = await this.client!.get(key);
      return val ? parseInt(val, 10) : 0;
    } catch (e: any) {
      console.error('[Redis] getCounter error:', e.message);
      return 0;
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.alive() || keys.length === 0) return;
    try {
      await this.client!.del(...keys);
    } catch (e: any) {
      console.error('[Redis] del error:', e.message);
    }
  }

  async delPattern(pattern: string): Promise<void> {
    if (!this.alive()) return;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.client!.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) await this.client!.del(...keys);
      } while (cursor !== '0');
    } catch (e: any) {
      console.error('[Redis] delPattern error:', e.message);
    }
  }
}

// Export singleton
export const redisService = new RedisService();

export const CK = {
  feedAll:      (cursor: string) => `ss:feed:all:${cursor}`,
  feedCat:      (cat: string, cursor: string) => `ss:feed:cat:${encodeURIComponent(cat)}:${cursor}`,
  search:       (term: string) => `ss:search:${encodeURIComponent(term.toLowerCase())}`,
  topLiked:     () => 'ss:top-liked',
  singleVideo:  (id: string) => `ss:video:${id}`,
} as const;

export const TTL = {
  feed:    120,   // 2 min  — home/category pages
  search:   60,   // 1 min  — search results
  topLiked: 300,  // 5 min  — hero carousel
  video:    600,  // 10 min — single video page
} as const;
