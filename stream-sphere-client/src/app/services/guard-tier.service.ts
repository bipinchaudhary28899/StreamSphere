import { Injectable } from '@angular/core';

export interface GuardContext {
  connectionType:   string | null;
  downlinkMbps:     number | null;
  bufferLevelSec:   number | null;
  recentStallCount: number;  // stalls in last 60 seconds
  speedKmh:         number;  // current movement speed
}

export interface GuardDecision {
  pass:   boolean;   // true = Guard clears it, skip backend call
  reason: string;
}

// Thresholds for a "healthy" session that needs no GenABR intervention
const MIN_DOWNLINK_MBPS   = 5;
const MIN_BUFFER_SEC      = 15;
const MAX_RECENT_STALLS   = 0;
const STABLE_TYPES        = ['wifi', '4g'];

/**
 * If the user is moving faster than this, Guard must NOT pass regardless of
 * how healthy current conditions look. A moving user could enter a dead zone
 * within the next prediction cycle — Student's corridor scanner must run so
 * it can look ahead and start prebuffering while the connection is still good.
 *
 * 3 km/h ≈ slow walking pace. Below this the user is effectively stationary
 * (standing still, slight GPS drift) and spatial prediction adds no value.
 */
const MOVING_SPEED_KMH    = 3;

@Injectable({ providedIn: 'root' })
export class GuardTierService {

  evaluate(ctx: GuardContext): GuardDecision {
    // Moving users must always reach Student so the corridor scanner can look
    // ahead. Guard cannot clear a moving session no matter how good the current
    // signal is — the dead zone might be 30 seconds up the road.
    if (ctx.speedKmh >= MOVING_SPEED_KMH) {
      return { pass: false, reason: 'moving' };
    }

    // ── Stationary checks (speedKmh < 3) ─────────────────────────────────────

    // Must be on a known stable connection type
    if (!ctx.connectionType || !STABLE_TYPES.includes(ctx.connectionType)) {
      return { pass: false, reason: 'unstable_connection_type' };
    }

    // Must have strong downlink
    if (ctx.downlinkMbps === null || ctx.downlinkMbps < MIN_DOWNLINK_MBPS) {
      return { pass: false, reason: 'weak_downlink' };
    }

    // Must have a healthy buffer
    if (ctx.bufferLevelSec === null || ctx.bufferLevelSec < MIN_BUFFER_SEC) {
      return { pass: false, reason: 'low_buffer' };
    }

    // No recent stalls
    if (ctx.recentStallCount > MAX_RECENT_STALLS) {
      return { pass: false, reason: 'recent_stalls' };
    }

    return { pass: true, reason: 'all_clear' };
  }
}
