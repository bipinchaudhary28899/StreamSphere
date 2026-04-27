import { Injectable } from '@angular/core';

export interface GuardContext {
  connectionType:  string | null;
  downlinkMbps:    number | null;
  bufferLevelSec:  number | null;
  recentStallCount: number;  // stalls in last 60 seconds
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

@Injectable({ providedIn: 'root' })
export class GuardTierService {

  evaluate(ctx: GuardContext): GuardDecision {
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
