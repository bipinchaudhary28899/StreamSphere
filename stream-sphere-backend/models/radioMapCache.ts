import mongoose, { Schema, Document } from 'mongoose';

// ── Context-sliced stats sub-document ────────────────────────────────────────
// Stored inside a tile for time (peak/off-peak) and movement (driving/stationary)
// dimensions so Phase 5 can pick the most relevant sub-sample.

export interface ITileStats {
  count:             number;
  avg_downlink_mbps: number;
  avg_rtt_ms:        number | null;
}

const tileStatsSchema = new Schema<ITileStats>(
  {
    count:             { type: Number, required: true },
    avg_downlink_mbps: { type: Number, required: true },
    avg_rtt_ms:        { type: Number, default: null },
  },
  { _id: false },
);

// ── Main interface ────────────────────────────────────────────────────────────

export interface IRadioMapCache extends Document {
  tile_id:  string;   // "grid:<lat_snapped>:<lng_snapped>"
  center:   { type: 'Point'; coordinates: [number, number] };

  // Coverage score from OpenCellID (static signal)
  static_score:        number;
  user_history_score:  number | null;  // legacy fused score from user pings
  fused_score:         number;         // blended score used by Phase 3

  // Observed network performance — aggregated via running average from sessions
  sample_count:        number;
  avg_downlink_mbps:   number | null;
  avg_rtt_ms:          number | null;
  avg_buffer_sec:      number | null;
  avg_bitrate_kbps:    number | null;
  // Variance of downlink readings: high variance = unstable / unreliable signal
  signal_variance:     number | null;

  // Context-sliced sub-stats (populated lazily; null until enough data)
  peak_stats:          ITileStats | null;   // UTC 7–9 AM or 5–8 PM weekdays
  offpeak_stats:       ITileStats | null;   // everything else
  driving_stats:       ITileStats | null;   // speed_kmh > 10
  stationary_stats:    ITileStats | null;   // speed_kmh < 2

  // Housekeeping
  last_updated:        Date | null;
  expires_at:          Date;
  last_fetched_static: Date | null;
}

// ── Sub-schema helpers ────────────────────────────────────────────────────────

const radioMapCacheSchema = new Schema<IRadioMapCache>(
  {
    tile_id: { type: String, required: true, unique: true },
    center: {
      type:        { type: String, enum: ['Point'], required: true },
      coordinates: { type: [Number], required: true },
    },

    static_score:       { type: Number, required: true, min: 0, max: 1 },
    user_history_score: { type: Number, default: null },
    fused_score:        { type: Number, required: true, min: 0, max: 1 },

    sample_count:      { type: Number, default: 0 },
    avg_downlink_mbps: { type: Number, default: null },
    avg_rtt_ms:        { type: Number, default: null },
    avg_buffer_sec:    { type: Number, default: null },
    avg_bitrate_kbps:  { type: Number, default: null },
    signal_variance:   { type: Number, default: null },

    peak_stats:        { type: tileStatsSchema, default: null },
    offpeak_stats:     { type: tileStatsSchema, default: null },
    driving_stats:     { type: tileStatsSchema, default: null },
    stationary_stats:  { type: tileStatsSchema, default: null },

    last_updated:        { type: Date, default: null },
    expires_at:          { type: Date, required: true },
    last_fetched_static: { type: Date, default: null },
  },
  { timestamps: true },
);

// tile_id unique index is already created by { unique: true } on the field above
radioMapCacheSchema.index({ center: '2dsphere' });
// TTL — MongoDB auto-deletes documents whose expires_at has passed.
// Tiles with real observed data get a 30-day expiry (set in writeCache);
// pure static tiles get 24 hours.
radioMapCacheSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const RadioMapCache = mongoose.model<IRadioMapCache>(
  'RadioMapCache',
  radioMapCacheSchema,
);
