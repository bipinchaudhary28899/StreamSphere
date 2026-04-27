import axios from 'axios';
import { RadioMapCache }    from '../models/radioMapCache';
import { StreamingSession } from '../models/streamingSession';
import { TelemetryPing }    from '../models/telemetryPing';
import { DeadZone }         from '../models/deadZone';
import { tileId, tileBbox, TILE_SIZE_DEGREES } from '../utils/geo';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEAD_ZONE_RADIUS_M       = 500;
const MIN_PINGS_FOR_HISTORY    = 3;
const STATIC_CACHE_TTL_MS      = 24  * 60 * 60 * 1000;   // 24 h for static-only tiles
const OBSERVED_CACHE_TTL_MS    = 30  * 24 * 60 * 60 * 1000; // 30 days for tiles with real data
// After this many days, old samples are down-weighted so fresh data has more impact
const FRESHNESS_DECAY_DAYS     = 14;

// ── Coverage result type ──────────────────────────────────────────────────────

export interface CoverageResult {
  tile_id:            string;
  fused_score:        number;
  static_score:       number;
  user_history_score: number | null;
  dead_zone_risk:     number;
  from_cache:         boolean;
  recommendation:     'prebuffer_aggressive' | 'prebuffer_moderate' | 'normal';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPeakHour(): boolean {
  const h = new Date().getUTCHours();
  return (h >= 7 && h <= 9) || (h >= 17 && h <= 20);
}

/** Running-average update that applies a freshness decay when old data is stale.
 *  After FRESHNESS_DECAY_DAYS days, the effective old_count is halved so that
 *  new observations can meaningfully shift a tile that hasn't been visited in a while. */
function runningAvg(
  oldAvg:       number | null,
  oldCount:     number,
  newSum:       number,
  newCount:     number,
  lastUpdated:  Date | null,
): number {
  if (oldAvg === null || oldCount === 0) return newSum / newCount;

  let effectiveOldCount = oldCount;
  if (lastUpdated) {
    const daysSince = (Date.now() - lastUpdated.getTime()) / 86_400_000;
    if (daysSince > FRESHNESS_DECAY_DAYS) {
      effectiveOldCount = Math.ceil(oldCount / 2);
    }
  }

  return (oldAvg * effectiveOldCount + newSum) / (effectiveOldCount + newCount);
}

/** Merge two TileStats objects using running average.
 *  oldStats may be null if this bucket has never been recorded. */
function mergeTileStats(
  oldStats:     { count: number; avg_downlink_mbps: number; avg_rtt_ms: number | null } | null,
  newCount:     number,
  newSumDown:   number,
  newSumRtt:    number | null,
  lastUpdated:  Date | null,
): { count: number; avg_downlink_mbps: number; avg_rtt_ms: number | null } {
  if (!oldStats || oldStats.count === 0) {
    return {
      count:             newCount,
      avg_downlink_mbps: newCount > 0 ? newSumDown / newCount : 0,
      avg_rtt_ms:        (newSumRtt !== null && newCount > 0) ? newSumRtt / newCount : null,
    };
  }

  const merged_down = runningAvg(oldStats.avg_downlink_mbps, oldStats.count, newSumDown, newCount, lastUpdated);
  const merged_rtt  = (oldStats.avg_rtt_ms !== null && newSumRtt !== null)
    ? runningAvg(oldStats.avg_rtt_ms, oldStats.count, newSumRtt, newCount, lastUpdated)
    : (oldStats.avg_rtt_ms ?? (newSumRtt !== null && newCount > 0 ? newSumRtt / newCount : null));

  return {
    count:             oldStats.count + newCount,
    avg_downlink_mbps: merged_down,
    avg_rtt_ms:        merged_rtt,
  };
}

// ── Layer 1: Static score from OpenCellID ────────────────────────────────────

async function fetchStaticScore(lat: number, lng: number): Promise<number> {
  const apiKey = process.env.OPENCELLID_API_KEY;
  if (!apiKey) return 0.6;

  try {
    const [south, west, north, east] = tileBbox(lat, lng);
    const res = await axios.get('https://opencellid.org/cell/getInArea', {
      params: { key: apiKey, BBOX: `${south},${west},${north},${east}`, format: 'json' },
      timeout: 4000,
    });

    const count: number = res.data?.count ?? 0;
    if (count === 0)  return 0.10;
    if (count <= 2)   return 0.30;
    if (count <= 5)   return 0.60;
    if (count <= 10)  return 0.80;
    return 1.00;
  } catch {
    return 0.6;
  }
}

// ── Layer 2: User history from radio_map_cache ────────────────────────────────
// Once the cache has real observed stats (avg_downlink_mbps != null), reading a
// single indexed document is far cheaper than aggregating across raw pings.
// We fall back to raw pings only if the cache entry has no observed data yet.

function connectionTypeScore(type: string | null): number {
  switch (type) {
    case 'wifi': return 0.90;
    case '4g':   return 0.75;
    case '3g':   return 0.45;
    case '2g':   return 0.15;
    default:     return 0.50;
  }
}

async function getUserHistoryScore(
  lat:    number,
  lng:    number,
  userId: string | null,
): Promise<{ score: number | null; pingCount: number }> {
  const id = tileId(lat, lng);

  // Primary path: read observed network stats from radio_map_cache.
  // This is a single indexed lookup and works for ANY user (not just the current one)
  // because the cache aggregates signal from all sessions.
  const cached = await RadioMapCache.findOne({ tile_id: id }, {
    avg_downlink_mbps: 1, sample_count: 1,
    peak_stats: 1, offpeak_stats: 1,
    driving_stats: 1,
  }).lean();

  if (cached && (cached as any).avg_downlink_mbps !== null) {
    const c = cached as any;
    // Pick the most contextually relevant sub-stat if available
    const contextStats = isPeakHour() ? c.peak_stats : c.offpeak_stats;
    const downlink: number = contextStats?.avg_downlink_mbps ?? c.avg_downlink_mbps;
    const score = Math.min(downlink / 10, 1.0);
    return { score, pingCount: c.sample_count };
  }

  // Fallback: if the cache has no real observed data yet, query raw pings.
  // This path is hit only for brand-new tiles before any session has ended.
  if (!userId) return { score: null, pingCount: 0 };

  const sessions = await StreamingSession.find(
    { user_id: userId },
    { session_id: 1 },
  ).sort({ started_at: -1 }).limit(20).lean();

  if (sessions.length === 0) return { score: null, pingCount: 0 };

  const sessionIds = sessions.map((s: any) => s.session_id as string);
  const [south, west, north, east] = tileBbox(lat, lng);

  const result = await TelemetryPing.aggregate([
    {
      $match: {
        session_id: { $in: sessionIds },
        lat:        { $gte: south, $lte: north },
        lng:        { $gte: west,  $lte: east  },
      },
    },
    {
      $group: {
        _id:         null,
        count:       { $sum: 1 },
        downlinks:   { $push: '$downlink_mbps' },
        connTypes:   { $push: '$connection_type' },
      },
    },
  ]);

  if (!result.length || result[0].count < MIN_PINGS_FOR_HISTORY) {
    return { score: null, pingCount: result[0]?.count ?? 0 };
  }

  const { downlinks, connTypes, count } = result[0];
  const scores: number[] = (downlinks as (number | null)[]).map((dl, i) =>
    dl != null ? Math.min(dl / 10, 1.0) : connectionTypeScore((connTypes as (string | null)[])[i]),
  );
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { score: avg, pingCount: count };
}

// ── Layer 3: Dead zone risk ───────────────────────────────────────────────────

async function getDeadZoneRisk(lat: number, lng: number): Promise<number> {
  const nearest = await DeadZone.findOne({
    location: {
      $nearSphere: {
        $geometry:    { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: DEAD_ZONE_RADIUS_M,
      },
    },
  }).sort({ signal_score: 1 }).lean();

  if (!nearest) return 0;
  return 1 - (nearest as any).signal_score;
}

// ── Cache read / write ────────────────────────────────────────────────────────

async function readCache(id: string): Promise<{
  static_score:       number;
  user_history_score: number | null;
  fused_score:        number;
} | null> {
  const doc = await RadioMapCache.findOne({ tile_id: id }).lean();
  if (!doc) return null;
  if (new Date() > (doc as any).expires_at) return null;
  return {
    static_score:       (doc as any).static_score,
    user_history_score: (doc as any).user_history_score,
    fused_score:        (doc as any).fused_score,
  };
}

async function writeCache(
  lat:          number,
  lng:          number,
  id:           string,
  staticScore:  number,
  historyScore: number | null,
  fusedScore:   number,
  pingCount:    number,
): Promise<void> {
  // Tiles with real observed data live much longer than static-only tiles
  const hasRealData = pingCount >= MIN_PINGS_FOR_HISTORY;
  const ttl         = hasRealData ? OBSERVED_CACHE_TTL_MS : STATIC_CACHE_TTL_MS;
  const expiresAt   = new Date(Date.now() + ttl);

  await RadioMapCache.findOneAndUpdate(
    { tile_id: id },
    {
      $set: {
        tile_id:             id,
        center:              { type: 'Point', coordinates: [lng, lat] },
        static_score:        staticScore,
        user_history_score:  historyScore,
        fused_score:         fusedScore,
        sample_count:        pingCount,
        expires_at:          expiresAt,
        last_fetched_static: new Date(),
      },
    },
    { upsert: true },
  );
}

// ── Radio map update from session pings ───────────────────────────────────────
// Called at session end (from qoe.service.ts).  Aggregates pings from this
// session into per-tile running averages before the 2-day TTL deletes them.

function snapToTile(val: number): number {
  return Math.floor(val / TILE_SIZE_DEGREES) * TILE_SIZE_DEGREES;
}

export async function updateRadioMapFromSession(sessionId: string): Promise<void> {
  // Aggregate pings into per-tile buckets in one query
  const rows = await TelemetryPing.aggregate([
    {
      $match: {
        session_id:   sessionId,
        downlink_mbps: { $ne: null },
      },
    },
    {
      $addFields: {
        tile_lat: {
          $multiply: [
            { $floor: { $divide: ['$lat', TILE_SIZE_DEGREES] } },
            TILE_SIZE_DEGREES,
          ],
        },
        tile_lng: {
          $multiply: [
            { $floor: { $divide: ['$lng', TILE_SIZE_DEGREES] } },
            TILE_SIZE_DEGREES,
          ],
        },
        is_peak: {
          $let: {
            vars: { h: { $hour: '$timestamp' } },
            in:   {
              $or: [
                { $and: [{ $gte: ['$$h', 7] }, { $lte: ['$$h', 9] }] },
                { $and: [{ $gte: ['$$h', 17] }, { $lte: ['$$h', 20] }] },
              ],
            },
          },
        },
        is_driving:    { $gt:  ['$speed_kmh', 10] },
        is_stationary: { $lt:  ['$speed_kmh', 2] },
      },
    },
    {
      $group: {
        _id:            { tile_lat: '$tile_lat', tile_lng: '$tile_lng' },
        count:          { $sum: 1 },
        sum_down:       { $sum: '$downlink_mbps' },
        sum_sq_down:    { $sum: { $multiply: ['$downlink_mbps', '$downlink_mbps'] } },
        sum_rtt:        { $sum: { $ifNull: ['$rtt_ms', null] } },
        rtt_count:      { $sum: { $cond: [{ $ne: ['$rtt_ms', null] }, 1, 0] } },
        sum_buffer:     { $sum: { $ifNull: ['$buffer_level_sec', null] } },
        buf_count:      { $sum: { $cond: [{ $ne: ['$buffer_level_sec', null] }, 1, 0] } },
        sum_bitrate:    { $sum: { $ifNull: ['$bitrate_kbps', null] } },
        bit_count:      { $sum: { $cond: [{ $ne: ['$bitrate_kbps', null] }, 1, 0] } },
        center_lat:     { $avg: '$lat' },
        center_lng:     { $avg: '$lng' },
        // Context-bucket sums
        peak_count:     { $sum: { $cond: ['$is_peak', 1, 0] } },
        peak_sum_down:  { $sum: { $cond: ['$is_peak', '$downlink_mbps', 0] } },
        peak_sum_rtt:   { $sum: { $cond: ['$is_peak', { $ifNull: ['$rtt_ms', 0] }, 0] } },
        off_count:      { $sum: { $cond: ['$is_peak', 0, 1] } },
        off_sum_down:   { $sum: { $cond: ['$is_peak', 0, '$downlink_mbps'] } },
        off_sum_rtt:    { $sum: { $cond: ['$is_peak', 0, { $ifNull: ['$rtt_ms', 0] }] } },
        drv_count:      { $sum: { $cond: ['$is_driving', 1, 0] } },
        drv_sum_down:   { $sum: { $cond: ['$is_driving', '$downlink_mbps', 0] } },
        drv_sum_rtt:    { $sum: { $cond: ['$is_driving', { $ifNull: ['$rtt_ms', 0] }, 0] } },
        sta_count:      { $sum: { $cond: ['$is_stationary', 1, 0] } },
        sta_sum_down:   { $sum: { $cond: ['$is_stationary', '$downlink_mbps', 0] } },
        sta_sum_rtt:    { $sum: { $cond: ['$is_stationary', { $ifNull: ['$rtt_ms', 0] }, 0] } },
      },
    },
  ]);

  for (const row of rows) {
    const tile_lat  = row._id.tile_lat  as number;
    const tile_lng  = row._id.tile_lng  as number;
    const tileIdStr = tileId(tile_lat + TILE_SIZE_DEGREES / 2, tile_lng + TILE_SIZE_DEGREES / 2);

    // Read current cache entry for running average
    const existing: any = await RadioMapCache.findOne({ tile_id: tileIdStr }).lean();
    const oldCount     = existing?.sample_count    ?? 0;
    const lastUpdated  = existing?.last_updated    ?? null;

    // Overall running averages
    const newCount    = row.count as number;
    const newAvgDown  = (row.sum_down  as number) / newCount;
    const newAvgRtt   = row.rtt_count  > 0 ? (row.sum_rtt   as number) / (row.rtt_count  as number) : null;
    const newAvgBuf   = row.buf_count  > 0 ? (row.sum_buffer as number) / (row.buf_count  as number) : null;
    const newAvgBit   = row.bit_count  > 0 ? (row.sum_bitrate as number) / (row.bit_count as number) : null;

    // Variance: E[X²] - (E[X])²
    const newVariance = ((row.sum_sq_down as number) / newCount) - (newAvgDown ** 2);

    const mergedAvgDown = runningAvg(existing?.avg_downlink_mbps ?? null, oldCount, row.sum_down, newCount, lastUpdated);
    const mergedAvgRtt  = runningAvg(existing?.avg_rtt_ms        ?? null, oldCount,
      newAvgRtt !== null ? newAvgRtt * newCount : 0, newAvgRtt !== null ? newCount : 0, lastUpdated);
    const mergedAvgBuf  = runningAvg(existing?.avg_buffer_sec    ?? null, oldCount,
      newAvgBuf !== null ? newAvgBuf * newCount : 0, newAvgBuf !== null ? newCount : 0, lastUpdated);
    const mergedAvgBit  = runningAvg(existing?.avg_bitrate_kbps  ?? null, oldCount,
      newAvgBit !== null ? newAvgBit * newCount : 0, newAvgBit !== null ? newCount : 0, lastUpdated);

    // Running variance: combine online via E[X²] - E[X]² approximation
    const mergedVariance = runningAvg(existing?.signal_variance ?? null, oldCount, newVariance * newCount, newCount, lastUpdated);

    // Context-bucket merges
    const peak_new  = mergeTileStats(existing?.peak_stats        ?? null, row.peak_count, row.peak_sum_down, row.peak_count > 0 ? row.peak_sum_rtt : null, lastUpdated);
    const off_new   = mergeTileStats(existing?.offpeak_stats     ?? null, row.off_count,  row.off_sum_down,  row.off_count  > 0 ? row.off_sum_rtt  : null, lastUpdated);
    const drv_new   = mergeTileStats(existing?.driving_stats     ?? null, row.drv_count,  row.drv_sum_down,  row.drv_count  > 0 ? row.drv_sum_rtt  : null, lastUpdated);
    const sta_new   = mergeTileStats(existing?.stationary_stats  ?? null, row.sta_count,  row.sta_sum_down,  row.sta_count  > 0 ? row.sta_sum_rtt  : null, lastUpdated);

    // Recompute fused_score from updated downlink average
    const newHistScore = Math.min(mergedAvgDown / 10, 1.0);
    const staticScore  = existing?.static_score ?? 0.6;
    const w            = (oldCount + newCount) >= 10 ? 0.65 : 0.45;
    const fusedScore   = (1 - w) * staticScore + w * newHistScore;

    const expiresAt = new Date(Date.now() + OBSERVED_CACHE_TTL_MS);

    await RadioMapCache.findOneAndUpdate(
      { tile_id: tileIdStr },
      {
        $set: {
          tile_id:           tileIdStr,
          center:            { type: 'Point', coordinates: [tile_lng + TILE_SIZE_DEGREES / 2, tile_lat + TILE_SIZE_DEGREES / 2] },
          fused_score:       Math.min(Math.max(fusedScore, 0), 1),
          static_score:      staticScore,
          user_history_score: newHistScore,
          avg_downlink_mbps: Math.round(mergedAvgDown * 100) / 100,
          avg_rtt_ms:        mergedAvgRtt  !== null ? Math.round(mergedAvgRtt)  : null,
          avg_buffer_sec:    mergedAvgBuf  !== null ? Math.round(mergedAvgBuf  * 10) / 10 : null,
          avg_bitrate_kbps:  mergedAvgBit  !== null ? Math.round(mergedAvgBit) : null,
          signal_variance:   Math.round(mergedVariance * 100) / 100,
          peak_stats:        peak_new.count > 0  ? peak_new  : existing?.peak_stats        ?? null,
          offpeak_stats:     off_new.count  > 0  ? off_new   : existing?.offpeak_stats     ?? null,
          driving_stats:     drv_new.count  > 0  ? drv_new   : existing?.driving_stats     ?? null,
          stationary_stats:  sta_new.count  > 0  ? sta_new   : existing?.stationary_stats  ?? null,
          last_updated:      new Date(),
          expires_at:        expiresAt,
        },
        $inc: { sample_count: newCount },
      },
      { upsert: true },
    );
  }
}

// ── Fusion + recommendation ───────────────────────────────────────────────────

function fuse(staticScore: number, historyScore: number | null, pingCount: number): number {
  if (historyScore === null) return staticScore;
  const w = pingCount >= 10 ? 0.65 : 0.45;
  return (1 - w) * staticScore + w * historyScore;
}

function recommend(fusedScore: number, deadZoneRisk: number): CoverageResult['recommendation'] {
  const effective = fusedScore * (1 - deadZoneRisk * 0.5);
  if (effective < 0.35) return 'prebuffer_aggressive';
  if (effective < 0.65) return 'prebuffer_moderate';
  return 'normal';
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getCoverage(
  lat:          number,
  lng:          number,
  userId:       string | null,
  forceRefresh = false,
): Promise<CoverageResult> {
  const id = tileId(lat, lng);

  const deadZoneRisk = await getDeadZoneRisk(lat, lng);

  if (!forceRefresh) {
    const cached = await readCache(id);
    if (cached) {
      return {
        tile_id:            id,
        fused_score:        cached.fused_score,
        static_score:       cached.static_score,
        user_history_score: cached.user_history_score,
        dead_zone_risk:     deadZoneRisk,
        from_cache:         true,
        recommendation:     recommend(cached.fused_score, deadZoneRisk),
      };
    }
  }

  const [staticScore, { score: historyScore, pingCount }] = await Promise.all([
    fetchStaticScore(lat, lng),
    getUserHistoryScore(lat, lng, userId),
  ]);

  const fusedScore = fuse(staticScore, historyScore, pingCount);

  writeCache(lat, lng, id, staticScore, historyScore, fusedScore, pingCount).catch(() => {});

  return {
    tile_id:            id,
    fused_score:        fusedScore,
    static_score:       staticScore,
    user_history_score: historyScore,
    dead_zone_risk:     deadZoneRisk,
    from_cache:         false,
    recommendation:     recommend(fusedScore, deadZoneRisk),
  };
}

export async function ingestDeadZone(
  lat:         number,
  lng:         number,
  signalScore: number,
  source:      'user_reported' | 'inferred' = 'inferred',
): Promise<void> {
  await DeadZone.findOneAndUpdate(
    {
      location: {
        $nearSphere: {
          $geometry:    { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: 100,
        },
      },
    },
    {
      $set:         { signal_score: signalScore, last_updated: new Date(), source },
      $inc:         { sample_count: 1 },
      $setOnInsert: {
        location:      { type: 'Point', coordinates: [lng, lat] },
        radius_meters: 100,
      },
    },
    { upsert: true },
  );
}
