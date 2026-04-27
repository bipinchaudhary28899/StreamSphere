import { RadioMapCache } from '../models/radioMapCache';
import { tileId } from '../utils/geo';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BranchResult {
  heading_offset: number;   // degrees from current heading
  probability:    number;   // 0–1
  points: Array<{
    seconds:      number;
    lat:          number;
    lng:          number;
    tile_id:      string;
    coverage:     number;   // fused_score from cache, or default
    point_risk:   number;   // probability × (1 - coverage) × time_weight
  }>;
  branch_risk: number;
}

export interface BufferTarget {
  max_buffer_length:     number;   // seconds → hls.config.maxBufferLength
  max_max_buffer_length: number;   // seconds → hls.config.maxMaxBufferLength
  risk_score:            number;   // 0–1 aggregate risk
  recommendation:        'normal' | 'prebuffer_moderate' | 'prebuffer_aggressive';
  horizon_seconds:       number;
  branches:              BranchResult[];
}

// ── Cone geometry ─────────────────────────────────────────────────────────────

// Three branches: straight (70%), slight deviation (15% each side)
const BRANCHES = [
  { offset: 0,   probability: 0.70 },
  { offset: -30, probability: 0.15 },
  { offset:  30, probability: 0.15 },
];

// Time horizons and their weights (near future matters more)
const HORIZONS = [
  { seconds: 30, weight: 0.50 },
  { seconds: 60, weight: 0.30 },
  { seconds: 90, weight: 0.20 },
];

function toRad(deg: number): number { return deg * Math.PI / 180; }

/**
 * Project a position forward by `distanceM` metres along a bearing.
 * Uses the flat-earth approximation — accurate enough for <5 km.
 */
function projectPosition(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceM: number,
): { lat: number; lng: number } {
  const bearingRad = toRad(bearingDeg);
  const dLat = (distanceM / 111_320) * Math.cos(bearingRad);
  const dLng = (distanceM / (111_320 * Math.cos(toRad(lat)))) * Math.sin(bearingRad);
  return { lat: lat + dLat, lng: lng + dLng };
}

// ── Coverage lookup ───────────────────────────────────────────────────────────

async function getCachedCoverage(lat: number, lng: number): Promise<number> {
  const id  = tileId(lat, lng);
  const doc = await RadioMapCache.findOne({ tile_id: id }, { fused_score: 1 }).lean();
  // Default 0.6 when tile has never been queried (Phase 3 will populate it lazily)
  return doc ? (doc as any).fused_score : 0.6;
}

// ── Risk weighting ────────────────────────────────────────────────────────────

function riskToBufferTarget(risk: number): Pick<
  BufferTarget,
  'max_buffer_length' | 'max_max_buffer_length' | 'recommendation'
> {
  if (risk >= 0.45) {
    return { max_buffer_length: 30, max_max_buffer_length: 60, recommendation: 'prebuffer_aggressive' };
  }
  if (risk >= 0.20) {
    return { max_buffer_length: 20, max_max_buffer_length: 45, recommendation: 'prebuffer_moderate' };
  }
  return { max_buffer_length: 10, max_max_buffer_length: 30, recommendation: 'normal' };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function computeBufferTarget(
  lat: number,
  lng: number,
  headingDeg: number,
  speedKmh: number,
): Promise<BufferTarget> {
  const speedMs = speedKmh / 3.6;

  const branchResults: BranchResult[] = await Promise.all(
    BRANCHES.map(async ({ offset, probability }) => {
      const bearing = (headingDeg + offset + 360) % 360;

      const points = await Promise.all(
        HORIZONS.map(async ({ seconds, weight }) => {
          const distanceM = speedMs * seconds;
          const pos       = projectPosition(lat, lng, bearing, distanceM);
          const coverage  = await getCachedCoverage(pos.lat, pos.lng);
          const pointRisk = probability * (1 - coverage) * weight;

          return {
            seconds,
            lat:       pos.lat,
            lng:       pos.lng,
            tile_id:   tileId(pos.lat, pos.lng),
            coverage,
            point_risk: pointRisk,
          };
        }),
      );

      const branchRisk = points.reduce((sum, p) => sum + p.point_risk, 0);
      return { heading_offset: offset, probability, points, branch_risk: branchRisk };
    }),
  );

  // Aggregate risk = sum of all point risks across all branches
  const totalRisk = branchResults.reduce((sum, b) => sum + b.branch_risk, 0);
  // Normalise to 0–1 (max possible risk = 1.0 × 1.0 × sum_of_weights = 1.0)
  const normalisedRisk = Math.min(totalRisk, 1.0);

  return {
    ...riskToBufferTarget(normalisedRisk),
    risk_score:      normalisedRisk,
    horizon_seconds: HORIZONS[HORIZONS.length - 1].seconds,
    branches:        branchResults,
  };
}
