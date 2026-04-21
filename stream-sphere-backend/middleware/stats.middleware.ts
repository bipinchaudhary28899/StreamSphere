/**
 * stats.middleware.ts
 *
 * Silently increments Redis counters on every API request so the dev
 * dashboard can show backend traffic without external tooling.
 *
 * Keys (both auto-expire after the period rolls over):
 *   ss:stats:api:monthly:YYYY-MM   TTL 35 days
 *   ss:stats:api:daily:YYYY-MM-DD  TTL 2 days
 */

import { Request, Response, NextFunction } from 'express';
import { redisService } from '../services/redis.service';

export function statsMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // Fire-and-forget — never delay the request
  const now      = new Date();
  const month    = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const day      = `${month}-${String(now.getUTCDate()).padStart(2, '0')}`;

  redisService.incr(`ss:stats:api:monthly:${month}`, 35 * 86_400).catch(() => {});
  redisService.incr(`ss:stats:api:daily:${day}`,     2  * 86_400).catch(() => {});

  next();
}
