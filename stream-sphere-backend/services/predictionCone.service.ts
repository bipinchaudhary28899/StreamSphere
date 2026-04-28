import { RadioMapCache } from '../models/radioMapCache';
import { tileId, TILE_SIZE_DEGREES } from '../utils/geo';
import { redisService } from './redis.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CorridorResult {
  has_dead_zone:           boolean;
  entry_seconds:           number | null;   // seconds until dead zone entry
  duration_seconds:        number | null;   // how long the dead zone lasts
  required_buffer_seconds: number | null;   // video seconds needed to survive it
  achievable_seconds:      number | null;   // how much we can actually prefetch
  feasible:                boolean;         // can we prefetch enough in time?
  tiles_scanned:           number;
}

export interface BranchResult {
  heading_offset: number;
  probability:    number;
  points: Array<{
    seconds:    number;
    lat:        number;
    lng:        number;
    tile_id:    string;
    coverage:   number;
    point_risk: number;
  }>;
  branch_risk: number;
}

export interface BufferTarget {
  max_buffer_length:     number;
  max_max_buffer_length: number;
  risk_score:            number;
  recommendation:        'normal' | 'prebuffer_moderate' | 'prebuffer_aggressive';
  horizon_seconds:       number;
  branches:              BranchResult[];
  corridor:              CorridorResult | null;  // null when stationary
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BRANCHES = [
  { offset: 0,   probability: 0.70 },
  { offset: -30, probability: 0.15 },
  { offset:  30, probability: 0.15 },
];
const HORIZONS = [
  { seconds: 30, weight: 0.50 },
  { seconds: 60, weight: 0.30 },
  { seconds: 90, weight: 0.20 },
];

const DEAD_ZONE_THRESHOLD  = 0.35;   // fused_score below this = weak signal
const CORRIDOR_MAX_METRES  = 5_000;  // scan up to 5 km ahead
const SAFETY_FACTOR        = 1.30;   // buffer 30% more than bare minimum
const MAX_BUFFER_CAP_S     = 300;    // hard ceiling (HLS.js practical limit)
const MIN_SPEED_FOR_CONE   = 5;      // km/h — below this skip corridor scan

// ── Geometry helpers ──────────────────────────────────────────────────────────

function toRad(deg: number): number { return deg * Math.PI / 180; }

function projectPosition(
  lat: number, lng: number, bearingDeg: number, distanceM: number,
): { lat: number; lng: number } {
  const r   = toRad(bearingDeg);
  const dLat = (distanceM / 111_320) * Math.cos(r);
  const dLng = (distanceM / (111_320 * Math.cos(toRad(lat)))) * Math.sin(r);
  return { lat: lat + dLat, lng: lng + dLng };
}

// ── Batch tile coverage fetch ─────────────────────────────────────────────────
// Collects ALL tile IDs needed for cone + corridor in one $in query.
// Replaces the previous pattern of N individual findOne calls.

async function batchFetchCoverage(tileIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(tileIds)];
  if (unique.length === 0) return new Map();

  const docs = await RadioMapCache.find(
    { tile_id: { $in: unique } },
    { tile_id: 1, fused_score: 1 },
  ).lean();

  const map = new Map<string, number>();
  for (const d of docs) map.set((d as any).tile_id, (d as any).fused_score);
  return map;
}

// ── Corridor scanner ──────────────────────────────────────────────────────────
// Projects 200m steps along heading, finds the first dead zone and measures it.

function generateCorridorPoints(
  lat: number, lng: number, heading: number, speedKmh: number,
): Array<{ tileId: string; seconds: number; distanceM: number }> {
  const speedMs    = speedKmh / 3.6;
  const stepM      = (TILE_SIZE_DEGREES * 111_320);   // ~200m per tile
  const stepSecs   = stepM / speedMs;
  const maxSteps   = Math.ceil(CORRIDOR_MAX_METRES / stepM);
  const points     = [];

  for (let i = 1; i <= maxSteps; i++) {
    const distanceM = i * stepM;
    const pos       = projectPosition(lat, lng, heading, distanceM);
    points.push({
      tileId:    tileId(pos.lat, pos.lng),
      seconds:   i * stepSecs,
      distanceM,
    });
  }
  return points;
}

function analyseCorridorCoverage(
  points:              Array<{ tileId: string; seconds: number; distanceM: number }>,
  coverageMap:         Map<string, number>,
  speedKmh:            number,
  bitrateKbps:         number,
  availableBandwidthMbps: number,
): CorridorResult {
  const DEFAULT_COVERAGE = 0.6;

  let deadStart: number | null = null;
  let deadEnd:   number | null = null;

  for (const p of points) {
    const coverage = coverageMap.get(p.tileId) ?? DEFAULT_COVERAGE;
    if (coverage < DEAD_ZONE_THRESHOLD) {
      if (deadStart === null) deadStart = p.seconds;
      deadEnd = p.seconds;
    } else if (deadStart !== null) {
      break;   // first dead zone found and ended — stop scanning
    }
  }

  if (deadStart === null) {
    return { has_dead_zone: false, entry_seconds: null, duration_seconds: null,
             required_buffer_seconds: null, achievable_seconds: null,
             feasible: true, tiles_scanned: points.length };
  }

  const stepSecs        = (TILE_SIZE_DEGREES * 111_320) / (speedKmh / 3.6);
  const durationSec     = (deadEnd! - deadStart) + stepSecs;   // include last tile
  const requiredBuf     = Math.min(Math.ceil(durationSec * SAFETY_FACTOR), MAX_BUFFER_CAP_S);

  // How many seconds of video can we download before entering the dead zone?
  // achievable = (entry_seconds × bandwidth_Mbps) / (bitrate_Mbps)
  const bitrateMbps     = bitrateKbps / 1000;
  const achievable      = availableBandwidthMbps > 0 && bitrateMbps > 0
    ? Math.floor((deadStart * availableBandwidthMbps) / bitrateMbps)
    : null;

  return {
    has_dead_zone:           true,
    entry_seconds:           Math.round(deadStart),
    duration_seconds:        Math.round(durationSec),
    required_buffer_seconds: requiredBuf,
    achievable_seconds:      achievable,
    feasible:                achievable !== null && achievable >= requiredBuf,
    tiles_scanned:           points.length,
  };
}

// ── Dynamic buffer from corridor ──────────────────────────────────────────────
// Replaces the fixed 3-tier table when a dead zone is detected.
// Returns a continuous value based on actual dead zone geometry.

function dynamicBufferFromCorridor(
  corridor: CorridorResult,
): Pick<BufferTarget, 'max_buffer_length' | 'max_max_buffer_length' | 'recommendation'> {
  if (!corridor.has_dead_zone || corridor.required_buffer_seconds === null) {
    return { max_buffer_length: 10, max_max_buffer_length: 30, recommendation: 'normal' };
  }

  const target = corridor.required_buffer_seconds;
  // maxMaxBufferLength = target + 20% headroom
  const cap    = Math.min(Math.ceil(target * 1.2), MAX_BUFFER_CAP_S);

  const recommendation = target >= 45
    ? 'prebuffer_aggressive'
    : target >= 20
      ? 'prebuffer_moderate'
      : 'normal';

  return { max_buffer_length: target, max_max_buffer_length: cap, recommendation };
}

// ── Fixed tier fallback (used when stationary / no corridor) ──────────────────

function riskToBufferTarget(risk: number): Pick<
  BufferTarget, 'max_buffer_length' | 'max_max_buffer_length' | 'recommendation'
> {
  if (risk >= 0.45) return { max_buffer_length: 30, max_max_buffer_length: 60, recommendation: 'prebuffer_aggressive' };
  if (risk >= 0.20) return { max_buffer_length: 20, max_max_buffer_length: 45, recommendation: 'prebuffer_moderate' };
  return                  { max_buffer_length: 10, max_max_buffer_length: 30, recommendation: 'normal' };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function computeBufferTarget(
  lat:          number,
  lng:          number,
  headingDeg:   number,
  speedKmh:     number,
  bitrateKbps   = 1500,
  bandwidthMbps = 0,
): Promise<BufferTarget> {
  const isMoving = speedKmh >= MIN_SPEED_FOR_CONE;

  // ── 1. Collect all tile IDs needed (cone + corridor) in one pass ──────────
  const coneTileIds: string[] = [];
  const conePoints: Array<{
    branchIdx: number; pointIdx: number; lat: number; lng: number; tileId: string;
  }> = [];

  for (let bi = 0; bi < BRANCHES.length; bi++) {
    const bearing = (headingDeg + BRANCHES[bi].offset + 360) % 360;
    for (let pi = 0; pi < HORIZONS.length; pi++) {
      const distM = (speedKmh / 3.6) * HORIZONS[pi].seconds;
      const pos   = projectPosition(lat, lng, bearing, distM);
      const tid   = tileId(pos.lat, pos.lng);
      coneTileIds.push(tid);
      conePoints.push({ branchIdx: bi, pointIdx: pi, lat: pos.lat, lng: pos.lng, tileId: tid });
    }
  }

  // Corridor points (straight ahead only)
  const corridorPoints = isMoving
    ? generateCorridorPoints(lat, lng, headingDeg, speedKmh)
    : [];

  // ── 2. Single batch DB fetch for ALL tiles ────────────────────────────────
  const allTileIds  = [...coneTileIds, ...corridorPoints.map(p => p.tileId)];
  const coverageMap = await batchFetchCoverage(allTileIds);   // ONE query

  // ── 3. Build prediction cone from coverage map ────────────────────────────
  const DEFAULT = 0.6;
  const branchResults: BranchResult[] = BRANCHES.map(({ offset, probability }, bi) => {
    const points = HORIZONS.map(({ seconds, weight }, pi) => {
      const cp       = conePoints.find(p => p.branchIdx === bi && p.pointIdx === pi)!;
      const coverage = coverageMap.get(cp.tileId) ?? DEFAULT;
      return {
        seconds, lat: cp.lat, lng: cp.lng,
        tile_id:    cp.tileId,
        coverage,
        point_risk: probability * (1 - coverage) * weight,
      };
    });
    return { heading_offset: offset, probability, points,
             branch_risk: points.reduce((s, p) => s + p.point_risk, 0) };
  });

  const totalRisk      = branchResults.reduce((s, b) => s + b.branch_risk, 0);
  const normalisedRisk = Math.min(totalRisk, 1.0);

  // ── 4. Corridor analysis (moving users only) ──────────────────────────────
  let corridor: CorridorResult | null = null;
  let bufferSpec: Pick<BufferTarget, 'max_buffer_length' | 'max_max_buffer_length' | 'recommendation'>;

  if (isMoving && corridorPoints.length > 0) {
    corridor   = analyseCorridorCoverage(corridorPoints, coverageMap, speedKmh, bitrateKbps, bandwidthMbps);
    bufferSpec = corridor.has_dead_zone
      ? dynamicBufferFromCorridor(corridor)   // ← continuous value
      : riskToBufferTarget(normalisedRisk);   // ← 3-tier fallback
  } else {
    bufferSpec = riskToBufferTarget(normalisedRisk);
  }

  return {
    ...bufferSpec,
    risk_score:      normalisedRisk,
    horizon_seconds: HORIZONS[HORIZONS.length - 1].seconds,
    branches:        branchResults,
    corridor,
  };
}
